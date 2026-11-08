import { createHash, createHmac, createPublicKey, createVerify, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config, isProduction } from "../../config.js";
import { pool } from "../../db/index.js";
import { decryptToken, encryptToken, token } from "../../lib.js";
import { recordConsent } from "../privacy/consent.js";

export type AssistantProvider = "openai" | "gemini" | "anthropic";

const STATE_TTL_MS = 10 * 60_000;
type Pending = { userId: string; provider: AssistantProvider; state: string; verifier: string; nonce: string; exp: number };
type Tokens = { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number; scope?: string; account?: { uuid?: string; email_address?: string } };
type Identity = { sub: string; email: string | null; name: string | null };

const setup = {
  openai: {
    cookie: "meetcon_ai_openai",
    label: "ChatGPT",
    authorize: "https://auth.openai.com/api/accounts/authorize",
    token: "https://auth.openai.com/api/accounts/oauth/token",
    scopes: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    clientId: () => config.OPENAI_OAUTH_CLIENT_ID,
    secret: () => config.OPENAI_OAUTH_CLIENT_SECRET,
    redirect: () => config.OPENAI_OAUTH_REDIRECT_URI || `${config.WEB_ORIGIN}/api/auth/openai/callback`,
  },
  gemini: {
    cookie: "meetcon_ai_gemini",
    label: "Gemini",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scopes: "openid email profile https://www.googleapis.com/auth/generative-language",
    clientId: () => config.GEMINI_OAUTH_CLIENT_ID,
    secret: () => config.GEMINI_OAUTH_CLIENT_SECRET,
    redirect: () => config.GEMINI_OAUTH_REDIRECT_URI || `${config.WEB_ORIGIN}/api/auth/gemini/callback`,
  },
  anthropic: {
    cookie: "meetcon_ai_claude",
    label: "Claude",
    authorize: "https://claude.ai/oauth/authorize",
    token: "https://console.anthropic.com/v1/oauth/token",
    scopes: "user:profile user:inference",
    clientId: () => config.ANTHROPIC_OAUTH_CLIENT_ID,
    secret: () => config.ANTHROPIC_OAUTH_CLIENT_SECRET,
    redirect: () => config.ANTHROPIC_OAUTH_REDIRECT_URI || `${config.WEB_ORIGIN}/api/auth/anthropic/callback`,
  },
} as const;

export function assistantConfigured(provider: AssistantProvider) {
  return Boolean(setup[provider].clientId());
}

export function assistantClientId(provider: AssistantProvider) {
  return setup[provider].clientId() ?? null;
}

function cookieOptions() {
  return { path: "/", httpOnly: true, secure: isProduction, sameSite: "lax" as const };
}

function sign(payload: Pending) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", config.TOKEN_ENCRYPTION_KEY).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function readPending(value: string | undefined, provider: AssistantProvider): Pending | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = createHmac("sha256", config.TOKEN_ENCRYPTION_KEY).update(body).digest("base64url");
  const actual = Buffer.from(sig);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString()) as Pending;
    if (data.provider !== provider || !data.userId || !data.state || !data.verifier || !data.nonce || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function fail(reply: FastifyReply, provider: AssistantProvider, code: string) {
  reply.clearCookie(setup[provider].cookie, cookieOptions());
  return reply.redirect(`${config.WEB_ORIGIN}/settings?error=${encodeURIComponent(`${provider}_${code}`)}`);
}

export function beginAssistant(provider: AssistantProvider, request: FastifyRequest, reply: FastifyReply) {
  const current = setup[provider];
  if (!request.user) return fail(reply, provider, "signed_out");
  const clientId = current.clientId();
  if (!clientId) return fail(reply, provider, "not_configured");
  const verifier = token(64);
  const pending: Pending = { userId: request.user.id, provider, state: token(24), verifier, nonce: token(24), exp: Date.now() + STATE_TTL_MS };
  reply.setCookie(current.cookie, sign(pending), { ...cookieOptions(), maxAge: STATE_TTL_MS / 1000 });
  const url = new URL(current.authorize);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", current.redirect());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", current.scopes);
  url.searchParams.set("state", pending.state);
  url.searchParams.set("nonce", pending.nonce);
  url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
  url.searchParams.set("code_challenge_method", "S256");
  if (provider === "openai") url.searchParams.set("resource", "https://api.openai.com/v1");
  if (provider === "gemini") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
  }
  return reply.redirect(url.toString());
}

type Jwk = { kid?: string; kty?: string; n?: string; e?: string; alg?: string; use?: string };
let jwksCache: { keys: Jwk[]; expires: number } | null = null;

async function openAiIdentity(idToken: string, nonce: string, clientId: string): Promise<Identity> {
  const [headerPart, payloadPart, signaturePart] = idToken.split(".");
  if (!headerPart || !payloadPart || !signaturePart) throw new Error("token");
  const header = JSON.parse(Buffer.from(headerPart, "base64url").toString()) as { alg?: string; kid?: string };
  if (header.alg !== "RS256" || !header.kid) throw new Error("token");
  if (!jwksCache || jwksCache.expires <= Date.now()) {
    const response = await fetch("https://auth.openai.com/.well-known/jwks.json", { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("jwks");
    const body = await response.json() as { keys?: Jwk[] };
    jwksCache = { keys: body.keys ?? [], expires: Date.now() + 10 * 60_000 };
  }
  const jwk = jwksCache.keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("token");
  const verified = createVerify("RSA-SHA256").update(`${headerPart}.${payloadPart}`).verify(createPublicKey({ key: jwk as unknown as import("node:crypto").JsonWebKey, format: "jwk" }), Buffer.from(signaturePart, "base64url"));
  if (!verified) throw new Error("token");
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString()) as { iss?: string; aud?: string | string[]; nonce?: string; exp?: number; sub?: string; email?: unknown; name?: unknown };
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== "https://auth.openai.com" || !audience.includes(clientId) || payload.nonce !== nonce || typeof payload.exp !== "number" || payload.exp * 1000 < Date.now() - 5_000 || !payload.sub) throw new Error("token");
  return { sub: payload.sub, email: typeof payload.email === "string" ? payload.email : null, name: typeof payload.name === "string" ? payload.name : null };
}

function claims(idToken: string | undefined) {
  const payload = idToken?.split(".")[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as { sub?: string; email?: string; name?: string };
  } catch {
    return {};
  }
}

async function identityFor(provider: AssistantProvider, tokens: Tokens, nonce: string, clientId: string): Promise<Identity> {
  if (provider === "openai") {
    if (!tokens.id_token) throw new Error("token");
    return openAiIdentity(tokens.id_token, nonce, clientId);
  }
  if (provider === "gemini") {
    if (!tokens.access_token) throw new Error("token");
    const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("token");
    const profile = await response.json() as { sub?: string; email?: string; name?: string };
    if (!profile.sub) throw new Error("token");
    return { sub: profile.sub, email: profile.email ?? null, name: profile.name ?? null };
  }
  const tokenClaims = claims(tokens.id_token);
  const subject = tokens.account?.uuid || tokenClaims.sub || tokens.account?.email_address || tokenClaims.email;
  if (!subject) throw new Error("token");
  return { sub: subject, email: tokens.account?.email_address || tokenClaims.email || null, name: tokenClaims.name ?? null };
}

async function tokenRequest(provider: AssistantProvider, body: URLSearchParams) {
  const current = setup[provider];
  const clientId = current.clientId();
  if (!clientId) throw new Error("token");
  const headers: Record<string, string> = { accept: "application/json", "content-type": "application/x-www-form-urlencoded" };
  const secret = current.secret();
  if (provider === "openai" && secret) {
    const encode = (value: string) => new URLSearchParams({ value }).toString().slice("value=".length);
    headers.authorization = `Basic ${Buffer.from(`${encode(clientId)}:${encode(secret)}`).toString("base64")}`;
  } else if (secret) body.set("client_secret", secret);
  const response = await fetch(current.token, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("token");
  return await response.json() as Tokens;
}

function readyFor(provider: AssistantProvider, tokens: Tokens) {
  if (!tokens.access_token) return false;
  if (provider !== "openai") return true;
  return (tokens.scope ?? "").split(/\s+/).includes("chatgpt.tokens.use.direct");
}

export async function finishAssistant(provider: AssistantProvider, request: FastifyRequest, reply: FastifyReply) {
  const current = setup[provider];
  const query = request.query as { code?: string; state?: string; error?: string };
  const pending = readPending(request.cookies[current.cookie], provider);
  reply.clearCookie(current.cookie, cookieOptions());
  if (!request.user) return reply.redirect(`${config.WEB_ORIGIN}/settings?error=${provider}_signed_out`);
  if (!pending || pending.state !== query.state || pending.userId !== request.user.id || !assistantConfigured(provider)) return fail(reply, provider, "state");
  if (query.error) return fail(reply, provider, query.error === "access_denied" ? "denied" : "failed");
  if (!query.code) return fail(reply, provider, "failed");
  try {
    const clientId = current.clientId()!;
    const body = new URLSearchParams({ grant_type: "authorization_code", code: query.code, redirect_uri: current.redirect(), client_id: clientId, code_verifier: pending.verifier });
    if (provider === "openai") body.set("resource", "https://api.openai.com/v1");
    const tokens = await tokenRequest(provider, body);
    const identity = await identityFor(provider, tokens, pending.nonce, clientId);
    const owner = (await pool.query("SELECT user_id FROM user_assistant_connections WHERE provider=$1 AND subject=$2", [provider, identity.sub])).rows[0] as { user_id: string } | undefined;
    if (owner && owner.user_id !== request.user.id) return fail(reply, provider, "conflict");
    const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;
    await pool.query(`INSERT INTO user_assistant_connections(user_id, provider, subject, email, display_name, access_ciphertext, refresh_ciphertext, access_expires_at, scopes, ready)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (user_id, provider) DO UPDATE SET subject=EXCLUDED.subject, email=EXCLUDED.email, display_name=EXCLUDED.display_name,
        access_ciphertext=EXCLUDED.access_ciphertext, refresh_ciphertext=EXCLUDED.refresh_ciphertext, access_expires_at=EXCLUDED.access_expires_at,
        scopes=EXCLUDED.scopes, ready=EXCLUDED.ready, updated_at=now()`, [
      request.user.id, provider, identity.sub, identity.email, identity.name,
      tokens.access_token ? encryptToken(tokens.access_token) : null,
      tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      expiresAt, tokens.scope ?? "", readyFor(provider, tokens),
    ]);
    await recordConsent(pool, request.user.id, "assistant_drafting", "granted");
    return reply.redirect(`${config.WEB_ORIGIN}/settings?assistant=${provider}`);
  } catch {
    return fail(reply, provider, "failed");
  }
}

export async function assistantAccessToken(userId: string, provider: AssistantProvider): Promise<string | null> {
  const row = (await pool.query("SELECT access_ciphertext, refresh_ciphertext, access_expires_at, ready FROM user_assistant_connections WHERE user_id=$1 AND provider=$2", [userId, provider])).rows[0] as { access_ciphertext: string | null; refresh_ciphertext: string | null; access_expires_at: Date | string | null; ready: boolean } | undefined;
  if (!row?.ready || !row.access_ciphertext) return null;
  const expires = row.access_expires_at ? new Date(row.access_expires_at).getTime() : 0;
  if (expires > Date.now() + 60_000) return decryptToken(row.access_ciphertext);
  const clientId = setup[provider].clientId();
  if (!row.refresh_ciphertext || !clientId) return expires > Date.now() ? decryptToken(row.access_ciphertext) : null;
  try {
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: decryptToken(row.refresh_ciphertext), client_id: clientId });
    if (provider === "openai") body.set("resource", "https://api.openai.com/v1");
    const tokens = await tokenRequest(provider, body);
    if (!tokens.access_token) return null;
    await pool.query(`UPDATE user_assistant_connections SET access_ciphertext=$3, refresh_ciphertext=COALESCE($4, refresh_ciphertext), access_expires_at=$5, scopes=COALESCE(NULLIF($6, ''), scopes), ready=$7, updated_at=now() WHERE user_id=$1 AND provider=$2`, [
      userId, provider, encryptToken(tokens.access_token), tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000), tokens.scope ?? "", readyFor(provider, tokens),
    ]);
    return readyFor(provider, tokens) ? tokens.access_token : null;
  } catch {
    return null;
  }
}
