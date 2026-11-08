import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { config, isProduction } from "./config.js";
import { pool } from "./db/index.js";

export class AppError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const token = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const iso = (value: Date | string) => new Date(value).toISOString();

const encryptionKey = Buffer.from(config.TOKEN_ENCRYPTION_KEY, "base64url");
export function encryptToken(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}
export function decryptToken(value: string): string {
  const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part ?? "", "base64url"));
  if (!iv || !tag || !encrypted) throw new AppError(500, "TOKEN_DECRYPTION_FAILED", "Invitation is unavailable");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export type SessionUser = { id: string; email: string; role: "ADMIN" | "USER"; displayName: string; timeZone: string; theme: string; sessionId: string };
declare module "fastify" {
  interface FastifyRequest { user: SessionUser | null }
}

export async function authenticate(request: FastifyRequest): Promise<void> {
  const raw = request.cookies[config.SESSION_COOKIE_NAME];
  request.user = null;
  if (!raw) return;
  const result = await pool.query<SessionUser>(`
    UPDATE auth_sessions s SET last_seen_at=now()
    FROM users u WHERE s.token_hash=$1 AND s.user_id=u.id AND s.expires_at > now() AND u.status='ACTIVE'
    RETURNING u.id,u.email,u.role,u.display_name AS "displayName",u.time_zone AS "timeZone",
      u.theme,s.id AS "sessionId"`, [sha256(raw)]);
  request.user = result.rows[0] ?? null;
}
export function requireUser(request: FastifyRequest, role?: "ADMIN" | "USER"): SessionUser {
  if (!request.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
  if (role && request.user.role !== role) throw new AppError(403, "FORBIDDEN", "This account cannot perform that action");
  return request.user;
}
export function setSessionCookie(reply: FastifyReply, value: string): void {
  reply.setCookie(config.SESSION_COOKIE_NAME, value, {
    path: "/", httpOnly: true, secure: isProduction, sameSite: "lax",
    maxAge: config.SESSION_TTL_DAYS * 86400,
  });
}
export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(config.SESSION_COOKIE_NAME, { path: "/", httpOnly: true, secure: isProduction, sameSite: "lax" });
}
export function noStore(reply: FastifyReply): void { reply.header("Cache-Control", "no-store, private"); }

export function requireOrigin(request: FastifyRequest): void {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method) || !request.cookies[config.SESSION_COOKIE_NAME]) return;
  const origin = request.headers.origin;
  if (origin !== config.WEB_ORIGIN) throw new AppError(403, "INVALID_ORIGIN", "Request origin rejected");
}

export async function ownedMeetup(client: PoolClient, id: string, ownerId: string, lock = false) {
  const result = await client.query(`SELECT *, clock_timestamp() AS db_now FROM meetups
    WHERE id=$1 AND owner_id=$2 ${lock ? "FOR UPDATE" : ""}`, [id, ownerId]);
  const meetup = result.rows[0];
  if (!meetup) throw new AppError(404, "NOT_FOUND", "Meetup not found");
  return meetup;
}
