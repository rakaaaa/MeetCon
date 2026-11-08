import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { AcceptPrivacySchema, AiProviderSchema, DeleteAccountSchema, NomineeSchema, SaveAiKeySchema, UpdateProfileSchema } from "@meetcon/shared";
import { config } from "../../config.js";
import { pool, transaction } from "../../db/index.js";
import { AppError, encryptToken, iso, noStore, requireUser, token } from "../../lib.js";
import { syncStoredLinkedInProfile } from "../auth/linkedin-profile.js";
import { assistantClientId, assistantConfigured, type AssistantProvider } from "../auth/assistants.js";
import { acceptPrivacy, privacyContact, recordConsent } from "../privacy/consent.js";

const allowed = new Map([["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"]]);
const profileSelect = `SELECT id,email,role,display_name AS "displayName",phone,time_zone AS "timeZone",theme,
  created_at AS "createdAt",given_name AS "givenName",family_name AS "familyName",locale,
  email_verified AS "emailVerified",(linkedin_sub IS NOT NULL) AS "linkedinConnected",
  (password_hash IS NOT NULL) AS "hasPassword",profile_image_source AS "profileImageSource",
  CASE WHEN profile_image_key IS NULL THEN NULL ELSE '/media/' || profile_image_key END AS "profileImageUrl"
  FROM users`;

async function loadProfile(userId: string) {
  return (await pool.query(`${profileSelect} WHERE id=$1`, [userId])).rows[0];
}

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/privacy/contact", async () => privacyContact());
  app.post("/profile/privacy", async (request, reply) => {
    const user = requireUser(request);
    AcceptPrivacySchema.parse(request.body);
    await acceptPrivacy(user.id);
    noStore(reply);
    return { privacyCurrent: true };
  });
  app.get("/profile/privacy", async (request, reply) => {
    const user = requireUser(request);
    noStore(reply);
    const row = (await pool.query(`SELECT nominee_name, nominee_email, nominee_relationship FROM users WHERE id=$1`, [user.id])).rows[0] as
      { nominee_name: string | null; nominee_email: string | null; nominee_relationship: string | null };
    return {
      ...privacyContact(),
      nominee: row?.nominee_name && row.nominee_email && row.nominee_relationship
        ? { name: row.nominee_name, email: row.nominee_email, relationship: row.nominee_relationship }
        : null,
    };
  });
  app.put("/profile/nominee", async (request, reply) => {
    const user = requireUser(request);
    const input = NomineeSchema.parse(request.body);
    await pool.query(`UPDATE users SET nominee_name=$2, nominee_email=$3, nominee_relationship=$4, updated_at=now() WHERE id=$1`,
      [user.id, input.name, input.email, input.relationship]);
    noStore(reply);
    return input;
  });
  app.delete("/profile/nominee", async (request, reply) => {
    const user = requireUser(request);
    await pool.query(`UPDATE users SET nominee_name=NULL, nominee_email=NULL, nominee_relationship=NULL, updated_at=now() WHERE id=$1`, [user.id]);
    return reply.code(204).send();
  });
  app.get("/profile/export", async (request, reply) => {
    const user = requireUser(request);
    noStore(reply);
    const profile = (await pool.query(`SELECT id, email, display_name AS "displayName", phone, time_zone AS "timeZone", theme,
      created_at AS "createdAt", privacy_notice_version AS "privacyNoticeVersion", privacy_accepted_at AS "privacyAcceptedAt",
      age_confirmed_at AS "ageConfirmedAt", nominee_name AS "nomineeName", nominee_email AS "nomineeEmail",
      nominee_relationship AS "nomineeRelationship"
      FROM users WHERE id=$1`, [user.id])).rows[0];
    const memberships = (await pool.query(`SELECT m.id AS "meetupId", m.title, mm.joined_via AS "joinedVia", mm.joined_at AS "joinedAt"
      FROM meetup_members mm JOIN meetups m ON m.id=mm.meetup_id WHERE mm.user_id=$1 ORDER BY mm.joined_at DESC`, [user.id])).rows;
    const answers = (await pool.query(`SELECT a.meetup_id AS "meetupId", m.title AS "meetupTitle", q.prompt, o.label, a.submitted_at AS "submittedAt"
      FROM answers a JOIN meetups m ON m.id=a.meetup_id JOIN questions q ON q.id=a.question_id
      JOIN question_options o ON o.id=a.option_id WHERE a.user_id=$1 ORDER BY a.submitted_at`, [user.id])).rows;
    const assistants = (await pool.query(`SELECT provider, email, display_name AS name, ready FROM user_assistant_connections WHERE user_id=$1`, [user.id])).rows;
    const push = (await pool.query("SELECT EXISTS(SELECT 1 FROM push_subscriptions WHERE user_id=$1) AS enabled", [user.id])).rows[0] as { enabled: boolean };
    const stamp = (value: Date | string | null) => value ? iso(value) : null;
    return {
      exportedAt: new Date().toISOString(),
      profile: profile ? {
        ...profile,
        createdAt: stamp(profile.createdAt),
        privacyAcceptedAt: stamp(profile.privacyAcceptedAt),
        ageConfirmedAt: stamp(profile.ageConfirmedAt),
      } : null,
      memberships: memberships.map((row) => ({ ...row, joinedAt: stamp(row.joinedAt) })),
      answers: answers.map((row) => ({ ...row, submittedAt: stamp(row.submittedAt) })),
      assistants,
      pushEnabled: Boolean(push?.enabled),
    };
  });
  app.get("/profile", async (request, reply) => {
    const user = requireUser(request); noStore(reply);
    return loadProfile(user.id);
  });
  app.post("/profile/linkedin/sync", async (request, reply) => {
    const user = requireUser(request);
    await syncStoredLinkedInProfile(user.id);
    noStore(reply);
    return loadProfile(user.id);
  });
  app.patch("/profile", async (request, reply) => {
    const user = requireUser(request); const input = UpdateProfileSchema.parse(request.body);
    if (input.email) {
      const linked = (await pool.query("SELECT linkedin_sub FROM users WHERE id=$1", [user.id])).rows[0];
      if (linked?.linkedin_sub) throw new AppError(400, "LINKEDIN_EMAIL", "Email comes from LinkedIn and cannot be changed here.");
    }
    try {
      const row = (await pool.query(`UPDATE users SET
        display_name=COALESCE($2,display_name),email=COALESCE($3,email),
        phone=CASE WHEN $4::boolean THEN $5 ELSE phone END,time_zone=COALESCE($6,time_zone),
        theme=COALESCE($7,theme),updated_at=now() WHERE id=$1 RETURNING id,email,role,
        display_name AS "displayName",phone,time_zone AS "timeZone",theme,created_at AS "createdAt"`,
      [user.id, input.displayName ?? null, input.email ?? null, "phone" in input, input.phone ?? null, input.timeZone ?? null, input.theme ?? null])).rows[0];
      noStore(reply); return row;
    } catch (error: any) {
      if (error.code === "23505") throw new AppError(409, "EMAIL_IN_USE", "Email is already registered");
      throw error;
    }
  });
  app.post("/profile/photo", async (request, reply) => {
    const user = requireUser(request);
    const file = await request.file({ limits: { fileSize: config.MAX_IMAGE_BYTES, files: 1 } });
    if (!file || !allowed.has(file.mimetype)) throw new AppError(415, "INVALID_IMAGE", "Use a JPEG, PNG, or WebP image");
    const bytes = await file.toBuffer();
    if (bytes.length > config.MAX_IMAGE_BYTES) throw new AppError(413, "IMAGE_TOO_LARGE", "Image is too large");
    await mkdir(resolve(config.MEDIA_DIR), { recursive: true });
    const key = `${user.id}/${token(18)}${allowed.get(file.mimetype)}`;
    const path = join(resolve(config.MEDIA_DIR), key);
    await mkdir(join(resolve(config.MEDIA_DIR), user.id), { recursive: true });
    await writeFile(path, bytes, { flag: "wx" });
    const oldKey = (await pool.query("SELECT profile_image_key FROM users WHERE id=$1", [user.id])).rows[0]?.profile_image_key;
    await pool.query("UPDATE users SET profile_image_key=$1,profile_image_source='upload',updated_at=now() WHERE id=$2", [key, user.id]);
    if (oldKey) await rm(join(resolve(config.MEDIA_DIR), oldKey), { force: true });
    noStore(reply); return { profileImageUrl: `/media/${key}`, replaced: Boolean(oldKey) };
  });
  app.delete("/profile/photo", async (request, reply) => {
    const user = requireUser(request);
    const oldKey = (await pool.query("SELECT profile_image_key FROM users WHERE id=$1", [user.id])).rows[0]?.profile_image_key;
    await pool.query("UPDATE users SET profile_image_key=NULL,profile_image_source=NULL,updated_at=now() WHERE id=$1", [user.id]);
    if (oldKey) await rm(join(resolve(config.MEDIA_DIR), oldKey), { force: true });
    return reply.code(204).send();
  });
  app.delete("/profile", async (request, reply) => {
    const user = requireUser(request); const input = DeleteAccountSchema.parse(request.body);
    const current = (await pool.query(`SELECT password_hash, profile_image_key, linkedin_sub,
      EXISTS(SELECT 1 FROM user_assistant_connections WHERE user_id=$1) AS assistants,
      EXISTS(SELECT 1 FROM push_subscriptions WHERE user_id=$1) AS push
      FROM users WHERE id=$1`, [user.id])).rows[0];
    if (current.password_hash) {
      if (!input.password || !await argon2.verify(current.password_hash, input.password)) throw new AppError(400, "INVALID_PASSWORD", "Password is incorrect");
    }
    await transaction(async (client) => {
      await recordConsent(client, user.id, "account", "withdrawn");
      if (current.linkedin_sub) await recordConsent(client, user.id, "linkedin", "withdrawn");
      if (current.assistants) await recordConsent(client, user.id, "assistant_drafting", "withdrawn");
      if (current.push) await recordConsent(client, user.id, "push", "withdrawn");
      await client.query(`UPDATE meetups SET status='CANCELLED',cancelled_at=now(),updated_at=now(),version=version+1
        WHERE owner_id=$1 AND starts_at>clock_timestamp() AND status<>'CANCELLED'`, [user.id]);
      await client.query("DELETE FROM user_ai_keys WHERE user_id=$1", [user.id]);
      await client.query("DELETE FROM user_assistant_connections WHERE user_id=$1", [user.id]);
      await client.query("DELETE FROM auth_sessions WHERE user_id=$1", [user.id]);
      await client.query("DELETE FROM password_reset_tokens WHERE user_id=$1", [user.id]);
      await client.query("DELETE FROM push_subscriptions WHERE user_id=$1", [user.id]);
      await client.query("DELETE FROM question_notifications WHERE user_id=$1", [user.id]);
      await client.query(`UPDATE users SET email=$2,display_name='Deleted user',phone=NULL,profile_image_key=NULL,
        profile_image_source=NULL,given_name=NULL,family_name=NULL,locale=NULL,email_verified=NULL,
        linkedin_picture_url=NULL,linkedin_access_ciphertext=NULL,linkedin_access_expires_at=NULL,
        linkedin_sub=NULL,password_hash=NULL,nominee_name=NULL,nominee_email=NULL,nominee_relationship=NULL,
        status='DELETED',deleted_at=now(),updated_at=now() WHERE id=$1`, [user.id, `deleted-${user.id}@invalid.local`]);
    });
    if (current.profile_image_key) await rm(join(resolve(config.MEDIA_DIR), current.profile_image_key), { force: true });
    return reply.code(204).send();
  });

  app.get("/profile/ai-keys", async (request, reply) => {
    const user = requireUser(request); noStore(reply);
    const rows = (await pool.query("SELECT provider, key_hint FROM user_ai_keys WHERE user_id=$1", [user.id])).rows as { provider: string; key_hint: string }[];
    const saved = new Map(rows.map((row) => [row.provider, row.key_hint]));
    return {
      providers: AiProviderSchema.options.map((provider) => ({
        provider, configured: saved.has(provider), hint: saved.get(provider) ?? null,
      })),
    };
  });
  app.put("/profile/ai-keys", async (request, reply) => {
    const user = requireUser(request);
    const input = SaveAiKeySchema.parse(request.body);
    const hint = input.apiKey.slice(-4);
    await pool.query(`INSERT INTO user_ai_keys(user_id, provider, key_ciphertext, key_hint)
      VALUES($1,$2,$3,$4)
      ON CONFLICT (user_id, provider) DO UPDATE SET key_ciphertext=EXCLUDED.key_ciphertext, key_hint=EXCLUDED.key_hint, updated_at=now()`,
    [user.id, input.provider, encryptToken(input.apiKey), hint]);
    noStore(reply);
    return { provider: input.provider, configured: true, hint };
  });
  app.delete("/profile/ai-keys/:provider", async (request, reply) => {
    const user = requireUser(request);
    const provider = AiProviderSchema.parse((request.params as { provider: string }).provider);
    await pool.query("DELETE FROM user_ai_keys WHERE user_id=$1 AND provider=$2", [user.id, provider]);
    return reply.code(204).send();
  });

  app.get("/profile/assistants", async (request, reply) => {
    const user = requireUser(request); noStore(reply);
    const rows = (await pool.query("SELECT provider, email, display_name, ready FROM user_assistant_connections WHERE user_id=$1", [user.id])).rows as { provider: AssistantProvider; email: string | null; display_name: string | null; ready: boolean }[];
    const saved = new Map(rows.map((row) => [row.provider, row]));
    const providers = (["openai", "gemini", "anthropic"] as const).map((provider) => {
      const current = saved.get(provider);
      return {
        provider,
        label: provider === "openai" ? "ChatGPT" : provider === "gemini" ? "Gemini" : "Claude",
        oauthAvailable: assistantConfigured(provider),
        clientId: assistantClientId(provider),
        connected: Boolean(current),
        ready: Boolean(current?.ready),
        email: current?.email ?? null,
        name: current?.display_name ?? null,
      };
    });
    return { providers };
  });
  app.delete("/profile/assistants/:provider", async (request, reply) => {
    const user = requireUser(request);
    const provider = (request.params as { provider: string }).provider;
    if (provider !== "openai" && provider !== "gemini" && provider !== "anthropic") throw new AppError(404, "NOT_FOUND", "Assistant not found");
    const removed = await pool.query("DELETE FROM user_assistant_connections WHERE user_id=$1 AND provider=$2 RETURNING provider", [user.id, provider]);
    if (removed.rowCount) await recordConsent(pool, user.id, "assistant_drafting", "withdrawn");
    return reply.code(204).send();
  });
}
