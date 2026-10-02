#!/usr/bin/env node
/**
 * One command to run the full MeetCon dev stack:
 * Docker (Postgres, Redis, Mailpit) → migrate → API + web dev servers.
 *
 * Usage: node run.mjs   |   pnpm start   |   ./run.sh   |   run.bat
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
process.chdir(root);

const shell = process.platform === "win32";

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell,
    ...options,
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function readEnv(key, fallback) {
  if (!existsSync(".env")) return fallback;
  const line = readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .find((row) => row.startsWith(`${key}=`));
  if (!line) return fallback;
  const value = line.slice(key.length + 1).trim();
  return value || fallback;
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 20) {
  fail(`Node.js 20 or newer is required; found ${process.version}.`);
}

run("docker", ["compose", "version"]);
run("docker", ["info"]);

if (!existsSync(".env")) {
  if (!existsSync(".env.example")) fail("Missing .env.example; cannot bootstrap .env.");
  copyFileSync(".env.example", ".env");
  console.log("Created .env from .env.example.\n");
}

console.log("Installing dependencies…");
run("corepack", ["pnpm", "install"]);

console.log("Starting PostgreSQL, Redis, and Mailpit…");
run("docker", ["compose", "up", "-d", "--wait"]);

console.log("Applying database migrations…");
run("corepack", ["pnpm", "migrate"]);

const webOrigin = readEnv("WEB_ORIGIN", "http://localhost:5173");
const apiPort = readEnv("API_PORT", "3001");
const mailpitUi = readEnv("MAILPIT_UI_PORT", "8025");

console.log("");
console.log("MeetCon is starting (Ctrl+C stops API + web; Docker services keep running).");
console.log("");
console.log(`  Web app       ${webOrigin}`);
console.log(`  API health    http://localhost:${apiPort}/health`);
console.log(`  Mailpit inbox http://localhost:${mailpitUi}`);
console.log("");

const dev = spawn("corepack", ["pnpm", "dev"], {
  cwd: root,
  stdio: "inherit",
  shell,
});

const stopDev = (signal) => {
  if (!dev.killed) dev.kill(signal);
};

process.on("SIGINT", () => stopDev("SIGINT"));
process.on("SIGTERM", () => stopDev("SIGTERM"));

dev.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
