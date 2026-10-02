import argon2 from "argon2";
import type { FastifyInstance, FastifyRequest } from "fastify";
import nodemailer from "nodemailer";
import { ChangePasswordSchema, ForgotPasswordSchema, LoginSchema, RegisterSchema, ResetPasswordSchema } from "@meetcon/shared";
import { config } from "../../config.js";
import { pool, transaction } from "../../db/index.js";
import { AppError, clearSessionCookie, noStore, requireUser, setSessionCookie, sha256, token } from "../../lib.js";

const mailer = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE === "true",
  ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? "" } } : {}),
});
const publicUser = (row: Record<string, unknown>) => ({
  id: row.id, email: row.email, role: row.role, displayName: row.display_name,
  phone: row.phone, profileImageUrl: row.profile_image_key ? `/media/${row.profile_image_key as string}` : null,
  timeZone: row.time_zone, theme: row.theme, createdAt: row.created_at,
});
async function createSession(userId: string, request: FastifyRequest) {
  const raw = token();
  const expires = new Date(Date.now() + config.SESSION_TTL_DAYS * 86400_000);
  await pool.query(`INSERT INTO auth_sessions(user_id,token_hash,expires_at,user_agent,ip_address)
    VALUES($1,$2,$3,$4,$5)`, [userId, sha256(raw), expires, request.headers["user-agent"]?.slice(0, 500) ?? null, request.ip]);
  return raw;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/register", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const input = RegisterSchema.parse(request.body);
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    let row;
    try {
      row = (await pool.query(`INSERT INTO users(email,password_hash,role,display_name,time_zone)
        VALUES($1,$2,$3,$4,$5) RETURNING *`, [input.email, passwordHash, input.role, input.displayName, input.timeZone])).rows[0];
    } catch (error: any) {
      if (error.code === "23505") throw new AppError(409, "EMAIL_IN_USE", "Email is already registered");
      throw error;
    }
    const raw = await createSession(row.id, request);
    setSessionCookie(reply, raw); noStore(reply);
    return { user: publicUser(row) };
  });

  app.post("/auth/login", { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const input = LoginSchema.parse(request.body);
    const result = await pool.query("SELECT * FROM users WHERE lower(email)=lower($1) AND status='ACTIVE'", [input.email]);
    const row = result.rows[0];
    if (!row || !await argon2.verify(row.password_hash, input.password)) throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    const raw = await createSession(row.id, request);
    setSessionCookie(reply, raw); noStore(reply);
    return { user: publicUser(row) };
  });

  app.get("/auth/session", async (request, reply) => {
    noStore(reply);
    if (!request.user) return { user: null };
    const row = (await pool.query("SELECT * FROM users WHERE id=$1 AND status='ACTIVE'", [request.user.id])).rows[0];
    return { user: row ? publicUser(row) : null };
  });
  app.post("/auth/logout", async (request, reply) => {
    if (request.user) await pool.query("DELETE FROM auth_sessions WHERE id=$1", [request.user.sessionId]);
    clearSessionCookie(reply); noStore(reply); return reply.code(204).send();
  });

  app.post("/auth/forgot-password", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request) => {
    const { email } = ForgotPasswordSchema.parse(request.body);
    const user = (await pool.query("SELECT id,email FROM users WHERE lower(email)=lower($1) AND status='ACTIVE'", [email])).rows[0];
    if (user) {
      const raw = token(36);
      await pool.query(`INSERT INTO password_reset_tokens(user_id,token_hash,expires_at)
        VALUES($1,$2,now()+($3 || ' minutes')::interval)`, [user.id, sha256(raw), config.RESET_TOKEN_TTL_MINUTES]);
      const url = `${config.WEB_ORIGIN}/reset-password?token=${encodeURIComponent(raw)}`;
      await mailer.sendMail({ from: config.MAIL_FROM, to: user.email, subject: "Reset your MeetCon password", text: `Reset your password: ${url}\nThis link expires soon and can be used once.` })
        .catch(() => request.log.error("Password reset email failed"));
    }
    return { message: "If that account exists, a reset email has been sent." };
  });

  app.post("/auth/reset-password", async (request) => {
    const input = ResetPasswordSchema.parse(request.body);
    await transaction(async (client) => {
      const result = await client.query(`SELECT * FROM password_reset_tokens
        WHERE token_hash=$1 AND used_at IS NULL AND expires_at > clock_timestamp() FOR UPDATE`, [sha256(input.token)]);
      const reset = result.rows[0];
      if (!reset) throw new AppError(400, "INVALID_RESET_TOKEN", "Reset token is invalid or expired");
      const hash = await argon2.hash(input.password, { type: argon2.argon2id });
      await client.query("UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2", [hash, reset.user_id]);
      await client.query("UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [reset.user_id]);
      await client.query("DELETE FROM auth_sessions WHERE user_id=$1", [reset.user_id]);
    });
    return { message: "Password reset successfully" };
  });

  app.post("/auth/change-password", async (request) => {
    const user = requireUser(request);
    const input = ChangePasswordSchema.parse(request.body);
    const row = (await pool.query("SELECT password_hash FROM users WHERE id=$1", [user.id])).rows[0];
    if (!await argon2.verify(row.password_hash, input.currentPassword)) throw new AppError(400, "INVALID_PASSWORD", "Current password is incorrect");
    const hash = await argon2.hash(input.newPassword, { type: argon2.argon2id });
    await transaction(async (client) => {
      await client.query("UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2", [hash, user.id]);
      await client.query("DELETE FROM auth_sessions WHERE user_id=$1 AND id<>$2", [user.id, user.sessionId]);
      await client.query("UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [user.id]);
    });
    return { message: "Password changed; other sessions were revoked" };
  });
}
