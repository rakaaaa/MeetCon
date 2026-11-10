import { createHash } from "node:crypto";
import dotenv from "dotenv";
import { z } from "zod";

const dotenvResult = dotenv.config({ path: new URL("../../../.env", import.meta.url), quiet: true });
const dotenvParsed = dotenvResult.parsed ?? {};
for (const key of ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LINKEDIN_REDIRECT_URI"] as const) {
  const fromProcess = process.env[key]?.trim() ?? "";
  const fromFile = dotenvParsed[key]?.trim() ?? "";
  const value = fromProcess || fromFile;
  if (value) process.env[key] = value;
  else delete process.env[key];
}

const tokenKeyPattern = /^[A-Za-z0-9_-]{43}$/;
const emptyToUndefined = (value: unknown) => typeof value === "string" && value.trim() === "" ? undefined : value;

/** 32-byte AES key as base64url (43 chars). Derived from POSTGRES_PASSWORD so you do not manage a separate secret. */
export function resolveTokenEncryptionKey(env: {
  TOKEN_ENCRYPTION_KEY?: string | undefined;
  POSTGRES_PASSWORD?: string | undefined;
}): string {
  const explicit = env.TOKEN_ENCRYPTION_KEY?.trim();
  if (explicit && tokenKeyPattern.test(explicit)) return explicit;
  const pg = env.POSTGRES_PASSWORD?.trim();
  if (pg) {
    return createHash("sha256").update(`meetcon:token-key:v1:${pg}`).digest("base64url");
  }
  return "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  SESSION_COOKIE_NAME: z.string().default("meetcon_session"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  POSTGRES_PASSWORD: z.string().optional(),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default("MeetPlus <no-reply@meetcon.local>"),
  DPDP_FIDUCIARY_NAME: z.string().trim().min(1).max(160).default("MeetPlus"),
  DPDP_GRIEVANCE_EMAIL: z.string().trim().email().max(254).default("privacy@meetcon.local"),
  DPDP_GRIEVANCE_POSTAL: z.string().trim().max(300).default(""),
  MEDIA_DIR: z.string().default("./data/media"),
  MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(5_000_000),
  LINKEDIN_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  LINKEDIN_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  LINKEDIN_REDIRECT_URI: z.preprocess(emptyToUndefined, z.string().url().optional()),
  OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  OPENAI_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  OPENAI_OAUTH_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  OPENAI_OAUTH_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  OPENAI_OAUTH_REDIRECT_URI: z.preprocess(emptyToUndefined, z.string().url().optional()),
  GEMINI_OAUTH_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  GEMINI_OAUTH_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  GEMINI_OAUTH_REDIRECT_URI: z.preprocess(emptyToUndefined, z.string().url().optional()),
  ANTHROPIC_OAUTH_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  ANTHROPIC_OAUTH_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  ANTHROPIC_OAUTH_REDIRECT_URI: z.preprocess(emptyToUndefined, z.string().url().optional()),
});

const parsed = schema.parse(process.env);

export const config = {
  ...parsed,
  TOKEN_ENCRYPTION_KEY: resolveTokenEncryptionKey(parsed),
};

export const isProduction = config.NODE_ENV === "production";
