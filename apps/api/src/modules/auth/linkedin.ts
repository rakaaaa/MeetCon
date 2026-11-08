import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { PRIVACY_NOTICE_VERSION, TimeZoneSchema, type Role } from "@meetcon/shared";
import { config, isProduction } from "../../config.js";
import { transaction } from "../../db/index.js";
import { AppError, setSessionCookie } from "../../lib.js";
import { acceptPrivacy, recordConsent } from "../privacy/consent.js";
import { rememberLinkedInProfile, type LinkedInProfile } from "./linkedin-profile.js";

const OAUTH_COOKIE = "meetcon_oauth";
const STATE_TTL_MS = 10 * 60_000;

type OauthState = {
  intent: "login" | "signup";
  role: Role;
  zone: string;
  from?: string;
  privacyAccepted?: boolean;
  exp: number;
};

export function linkedInRedirectUri() {
  return config.LINKEDIN_REDIRECT_URI || `${config.WEB_ORIGIN}/api/auth/linkedin/callback`;
}

export function linkedInConfigured() {
  return Boolean(config.LINKEDIN_CLIENT_ID && config.LINKEDIN_CLIENT_SECRET);
}

function signState(payload: OauthState) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", config.TOKEN_ENCRYPTION_KEY).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function readState(state: string | undefined): OauthState | null {
  if (!state) return null;
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = createHmac("sha256", config.TOKEN_ENCRYPTION_KEY).update(body).digest("base64url");
  const actual = Buffer.from(sig);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString()) as OauthState;
    if (data.exp < Date.now()) return null;
    if (data.intent !== "login" && data.intent !== "signup") return null;
    if (data.role !== "ADMIN" && data.role !== "USER") return null;
    return { ...data, privacyAccepted: data.privacyAccepted === true };
  } catch {
    return null;
  }
}

export function safeReturnPath(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("..")) return undefined;
  return /^\/[A-Za-z0-9/_\-]*$/.test(value) ? value : undefined;
}

function cookieOptions() {
  return { path: "/", httpOnly: true, secure: isProduction, sameSite: "lax" as const };
}

export function beginLinkedIn(request: FastifyRequest, reply: FastifyReply) {
  if (!linkedInConfigured()) return reply.redirect(`${config.WEB_ORIGIN}/login?error=linkedin_not_configured`);
  const query = request.query as { intent?: string; role?: string; zone?: string; from?: string; acceptPrivacy?: string; confirmAge18?: string; notice?: string };
  const intent = query.intent === "signup" ? "signup" : "login";
  const role: Role = query.role === "ADMIN" ? "ADMIN" : "USER";
  const zoneResult = TimeZoneSchema.safeParse(query.zone);
  const zone = zoneResult.success ? zoneResult.data : "UTC";
  const from = safeReturnPath(query.from);
  const privacyAccepted = query.acceptPrivacy === "1" && query.confirmAge18 === "1" && query.notice === PRIVACY_NOTICE_VERSION;
  const state = signState({ intent, role, zone, ...(from ? { from } : {}), ...(privacyAccepted ? { privacyAccepted: true } : {}), exp: Date.now() + STATE_TTL_MS });
  reply.setCookie(OAUTH_COOKIE, state, { ...cookieOptions(), maxAge: STATE_TTL_MS / 1000 });
  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.LINKEDIN_CLIENT_ID!);
  url.searchParams.set("redirect_uri", linkedInRedirectUri());
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "openid profile email");
  return reply.redirect(url.toString());
}

function fail(reply: FastifyReply, code: string) {
  reply.clearCookie(OAUTH_COOKIE, cookieOptions());
  return reply.redirect(`${config.WEB_ORIGIN}/login?error=${encodeURIComponent(code)}`);
}

async function linkedInProfile(code: string): Promise<{ profile: LinkedInProfile; accessToken: string; expiresIn: number | undefined }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: linkedInRedirectUri(),
    client_id: config.LINKEDIN_CLIENT_ID!,
    client_secret: config.LINKEDIN_CLIENT_SECRET!,
  });
  const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!tokenResponse.ok) throw new AppError(401, "LINKEDIN_TOKEN", "LinkedIn did not accept the sign-in code");
  const tokenBody = await tokenResponse.json() as { access_token?: string; expires_in?: number };
  if (!tokenBody.access_token) throw new AppError(401, "LINKEDIN_TOKEN", "LinkedIn did not return an access token");
  const profileResponse = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!profileResponse.ok) throw new AppError(401, "LINKEDIN_PROFILE", "LinkedIn did not return a profile");
  return { profile: await profileResponse.json() as LinkedInProfile, accessToken: tokenBody.access_token, expiresIn: tokenBody.expires_in };
}

function displayName(profile: LinkedInProfile, email: string) {
  const combined = [profile.given_name, profile.family_name].filter(Boolean).join(" ");
  const name = (profile.name || combined || email.split("@")[0] || "LinkedIn member").trim().replace(/\s+/g, " ");
  return name.slice(0, 100) || "LinkedIn member";
}

export async function finishLinkedIn(request: FastifyRequest, reply: FastifyReply, createSession: (userId: string, request: FastifyRequest) => Promise<string>) {
  const query = request.query as { code?: string; state?: string; error?: string };
  if (query.error === "unauthorized_scope_error") return fail(reply, "linkedin_scope");
  if (query.error) return fail(reply, "linkedin_denied");
  const cookie = request.cookies[OAUTH_COOKIE];
  const state = readState(query.state);
  if (!query.code || !state || !cookie || cookie !== query.state) return fail(reply, "linkedin_state");
  reply.clearCookie(OAUTH_COOKIE, cookieOptions());
  let linked: { profile: LinkedInProfile; accessToken: string; expiresIn: number | undefined };
  try {
    linked = await linkedInProfile(query.code);
  } catch {
    return fail(reply, "linkedin_failed");
  }
  const profile = linked.profile;
  const email = profile.email?.trim().toLowerCase();
  const sub = profile.sub?.trim();
  if (!sub || !email || profile.email_verified === false) return fail(reply, "linkedin_email");

  let account;
  try {
    account = await transaction(async (client) => {
      const found = await client.query("SELECT * FROM users WHERE linkedin_sub=$1 OR lower(email)=lower($2) FOR UPDATE", [sub, email]);
      const match = found.rows.find((user) => user.linkedin_sub === sub) ?? found.rows[0];
      if (found.rows.length > 1 && match?.linkedin_sub !== sub) throw new AppError(409, "LINKEDIN_CONFLICT", "LinkedIn account conflict");
      if (match?.status === "DELETED") throw new AppError(403, "ACCOUNT_CLOSED", "Account closed");
      if (match?.linkedin_sub && match.linkedin_sub !== sub) throw new AppError(409, "LINKEDIN_CONFLICT", "LinkedIn account conflict");
      if (match) {
        const linkedNow = !match.linkedin_sub;
        if (linkedNow) {
          await client.query("UPDATE users SET linkedin_sub=$1, updated_at=now() WHERE id=$2", [sub, match.id]);
          match.linkedin_sub = sub;
          await recordConsent(client, match.id, "linkedin", "granted");
        }
        return { row: match, created: false };
      }
      if (!state.privacyAccepted) throw new AppError(403, "CONSENT_REQUIRED", "Privacy notice and age confirmation are required");
      const role = state.intent === "signup" ? state.role : "USER";
      const created = await client.query(`INSERT INTO users(email, password_hash, role, display_name, time_zone, linkedin_sub, privacy_notice_version, privacy_accepted_at, age_confirmed_at)
        VALUES($1, NULL, $2, $3, $4, $5, $6, clock_timestamp(), clock_timestamp()) RETURNING *`,
      [email, role, displayName(profile, email), state.zone, sub, PRIVACY_NOTICE_VERSION]);
      const row = created.rows[0];
      await recordConsent(client, row.id, "account", "granted");
      await recordConsent(client, row.id, "linkedin", "granted");
      return { row, created: true };
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "ACCOUNT_CLOSED") return fail(reply, "linkedin_closed");
    if (error instanceof AppError && error.code === "CONSENT_REQUIRED") return fail(reply, "linkedin_consent");
    if (error instanceof AppError && error.code === "LINKEDIN_UNKNOWN") return fail(reply, "linkedin_unknown");
    if (error instanceof AppError && error.code === "LINKEDIN_CONFLICT") return fail(reply, "linkedin_conflict");
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "23505") return fail(reply, "linkedin_conflict");
    return fail(reply, "linkedin_failed");
  }

  const row = account.row;
  if (!account.created && state.privacyAccepted) await acceptPrivacy(row.id);

  try {
    await rememberLinkedInProfile(row.id, profile, linked.accessToken, linked.expiresIn);
  } catch {
    // Sign-in still completes when the extra profile details cannot be stored.
  }
  const raw = await createSession(row.id, request);
  setSessionCookie(reply, raw);
  const destination = new URL("/auth/complete", config.WEB_ORIGIN);
  if (state.from) destination.searchParams.set("from", state.from);
  return reply.redirect(destination.toString());
}
