import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { DeleteAccountSchema, UpdateProfileSchema } from "@meetcon/shared";
import { config } from "../../config.js";
import { pool, transaction } from "../../db/index.js";
import { AppError, noStore, requireUser, token } from "../../lib.js";

const allowed = new Map([["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"]]);

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/profile", async (request, reply) => {
    const user = requireUser(request); noStore(reply);
    const row = (await pool.query(`SELECT id,email,role,display_name AS "displayName",phone,time_zone AS "timeZone",
      theme,created_at AS "createdAt",profile_image_key AS "profileImageKey" FROM users WHERE id=$1`, [user.id])).rows[0];
    return { ...row, profileImageUrl: row.profileImageKey ? `/media/${row.profileImageKey}` : null, profileImageKey: undefined };
  });
  app.patch("/profile", async (request, reply) => {
    const user = requireUser(request); const input = UpdateProfileSchema.parse(request.body);
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
    await pool.query("UPDATE users SET profile_image_key=$1,updated_at=now() WHERE id=$2", [key, user.id]);
    if (oldKey) await rm(join(resolve(config.MEDIA_DIR), oldKey), { force: true });
    noStore(reply); return { profileImageUrl: `/media/${key}`, replaced: Boolean(oldKey) };
  });
  app.delete("/profile/photo", async (request, reply) => {
    const user = requireUser(request);
    const oldKey = (await pool.query("SELECT profile_image_key FROM users WHERE id=$1", [user.id])).rows[0]?.profile_image_key;
    await pool.query("UPDATE users SET profile_image_key=NULL,updated_at=now() WHERE id=$1", [user.id]);
    if (oldKey) await rm(join(resolve(config.MEDIA_DIR), oldKey), { force: true });
    return reply.code(204).send();
  });
  app.delete("/profile", async (request, reply) => {
    const user = requireUser(request); const input = DeleteAccountSchema.parse(request.body);
    const current = (await pool.query("SELECT password_hash,profile_image_key FROM users WHERE id=$1", [user.id])).rows[0];
    if (!await argon2.verify(current.password_hash, input.password)) throw new AppError(400, "INVALID_PASSWORD", "Password is incorrect");
    await transaction(async (client) => {
      if (user.role === "ADMIN") await client.query(`UPDATE meetups SET status='CANCELLED',cancelled_at=now(),updated_at=now(),version=version+1
        WHERE owner_id=$1 AND starts_at>clock_timestamp() AND status<>'CANCELLED'`, [user.id]);
      await client.query("DELETE FROM auth_sessions WHERE user_id=$1", [user.id]);
      await client.query("DELETE FROM password_reset_tokens WHERE user_id=$1", [user.id]);
      await client.query(`UPDATE users SET email=$2,display_name='Deleted user',phone=NULL,profile_image_key=NULL,
        status='DELETED',deleted_at=now(),updated_at=now() WHERE id=$1`, [user.id, `deleted-${user.id}@invalid.local`]);
    });
    if (current.profile_image_key) await rm(join(resolve(config.MEDIA_DIR), current.profile_image_key), { force: true });
    return reply.code(204).send();
  });
}
