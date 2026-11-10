#!/usr/bin/env node
/**
 * Reject a production or simulation env file that still looks like local development.
 * Local development uses `.env` (localhost, Mailpit, password meetcon).
 * Usage: node deploy/validate-production-env.mjs .env.production
 */
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

const file = process.argv[2] || ".env.production";
if (!existsSync(file)) {
  console.error(`Missing ${file}`);
  process.exit(1);
}

const env = new Map();
for (const line of readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  env.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
}

function get(key) {
  return env.get(key) ?? "";
}

let failed = false;
function fail(message) {
  console.error(message);
  failed = true;
}

for (const key of ["POSTGRES_PASSWORD", "DATABASE_URL", "REDIS_URL", "WEB_ORIGIN"]) {
  if (!get(key)) fail(`Missing ${key} in ${file}`);
}

if (get("NODE_ENV") !== "production") {
  fail(`NODE_ENV must be production in ${file}. Local development uses .env.`);
}

const blockedPasswords = new Set([
  "meetcon",
  "change-me",
  "change-me-use-openssl-rand-base64-24",
]);
if (blockedPasswords.has(get("POSTGRES_PASSWORD"))) {
  fail(`POSTGRES_PASSWORD in ${file} is still a development or example value.`);
}

if (/@(localhost|127\.0\.0\.1)[:/]/.test(get("DATABASE_URL"))) {
  fail(`DATABASE_URL in ${file} must use the Docker hostname postgres, not localhost.`);
}

if (/^redis:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(get("REDIS_URL"))) {
  fail(`REDIS_URL in ${file} must use the Docker hostname redis, not localhost.`);
}

const origin = get("WEB_ORIGIN");
if (origin && !origin.startsWith("https://")) {
  fail(`WEB_ORIGIN in ${file} must start with https://`);
}

if (basename(file) === ".env.simulation") {
  const port = get("GATEWAY_PUBLIC_PORT") || "30998";
  if (origin && !new RegExp(`:${port}(/|$)`).test(origin)) {
    console.error(`WARN: WEB_ORIGIN should include :${port} (got ${origin})`);
  }
}

const password = get("POSTGRES_PASSWORD");
if (password && !get("DATABASE_URL").includes(password)) {
  console.error("WARN: DATABASE_URL password may not match POSTGRES_PASSWORD");
}

if (get("SMTP_PASSWORD") === "change-me") {
  console.error("WARN: SMTP_PASSWORD is still the example value. Password reset mail will fail until it is set.");
}

if (basename(file) === ".env.production" && /(localhost|127\.0\.0\.1)/.test(origin)) {
  fail("WEB_ORIGIN in .env.production must be the public host. Simulation uses .env.simulation and 127.0.0.1:30998.");
}

if (failed) process.exit(1);
console.log(`Production env OK (${basename(file)}).`);
