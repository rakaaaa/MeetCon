#!/usr/bin/env node
/**
 * One command to run MeetPlus without Docker.
 * Installs JS dependencies, starts project-local Postgres, Redis, and Mailpit,
 * migrates, then starts the API and web app.
 *
 * Database files stay in .local and are reused on the next run.
 *
 * Usage: node run-local.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createWriteStream, existsSync, mkdirSync, readFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import net from "node:net";
import EmbeddedPostgres from "embedded-postgres";

const root = dirname(fileURLToPath(import.meta.url));
process.chdir(root);

const shell = process.platform === "win32";
const localDir = join(root, ".local");
const postgresDir = join(localDir, "postgres");
const redisDir = join(localDir, "redis");
const binDir = join(localDir, "bin");

const redisZipUrl = "https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip";
const mailpitVersion = "1.27.7";

let postgres;
let redisProcess;
let mailpitProcess;
let devProcess;
let stopping = false;
let shutdownPromise;

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

function loadEnvFile() {
  if (!existsSync(".env")) return;
  for (const row of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const line = row.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function readEnv(key, fallback) {
  return process.env[key]?.trim() || fallback;
}

function portFrom(urlValue, fallback) {
  const parsed = new URL(urlValue);
  return Number(parsed.port || fallback);
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(800);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function waitFor(label, check, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  fail(`${label} did not become ready.`);
}

function pgClient() {
  const require = createRequire(join(root, "apps", "api", "package.json"));
  return require("pg");
}

async function databaseAccepts(connectionString) {
  const { Client } = pgClient();
  const client = new Client({ connectionString, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

function redisAlive(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const finish = (alive) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(800);
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("connect", () => socket.write("*1\r\n$4\r\nPING\r\n"));
    socket.once("data", (buf) => finish(buf.toString().includes("PONG")));
  });
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) fail(`Download failed (${response.status}) for ${url}`);
  await pipeline(response.body, createWriteStream(destination));
}

function extractArchive(archive, destination) {
  mkdirSync(destination, { recursive: true });
  const result = spawnSync("tar", ["-xf", archive, "-C", destination], { stdio: "inherit" });
  if (result.status !== 0) fail(`Could not extract ${archive}`);
}

async function ensurePostgres() {
  const databaseUrl = readEnv("DATABASE_URL", "postgresql://meetcon:meetcon@localhost:5432/meetcon");
  const parsed = new URL(databaseUrl);
  const port = Number(parsed.port || 5432);
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!user || !password || !database) fail("DATABASE_URL must include a user, password, and database name.");

  if (await databaseAccepts(databaseUrl)) {
    console.log("Postgres is already running. Existing data will be used.");
    return;
  }
  if (await portOpen(port)) {
    fail(`Port ${port} is in use, but MeetPlus cannot sign in with DATABASE_URL. Stop that service or change DATABASE_URL in .env.`);
  }

  mkdirSync(localDir, { recursive: true });
  postgres = new EmbeddedPostgres({
    databaseDir: postgresDir,
    port,
    user,
    password,
    persistent: true,
    autoRehydrateSymlinks: true,
    onLog: () => {},
    onError: (message) => {
      const text = String(message ?? "").trim();
      if (text) console.error(text);
    },
  });

  if (!existsSync(join(postgresDir, "PG_VERSION"))) {
    console.log("Creating local Postgres. Data is kept in .local/postgres.");
    await postgres.initialise();
  } else {
    console.log("Starting local Postgres from .local/postgres.");
  }
  await postgres.start();
  await postgres.createDatabase(database).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists/i.test(message)) throw error;
  });
}

async function ensureRedis() {
  const port = portFrom(readEnv("REDIS_URL", "redis://localhost:6379"), 6379);
  if (await redisAlive(port)) {
    console.log("Redis is already running. Existing data will be used.");
    return;
  }
  if (await portOpen(port)) {
    fail(`Port ${port} is in use, but it did not answer as Redis. Stop that service or change REDIS_URL in .env.`);
  }
  if (process.platform !== "win32" || process.arch !== "x64") {
    fail("This local runner downloads Redis for 64-bit Windows. Install Redis yourself and keep it on the REDIS_URL port, then run this command again.");
  }

  mkdirSync(redisDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  const serverExe = join(binDir, "redis-server.exe");
  const cliExe = join(binDir, "redis-cli.exe");
  if (!existsSync(serverExe) || !existsSync(cliExe)) {
    console.log("Downloading Redis into .local/bin…");
    const zip = join(localDir, "redis.zip");
    await download(redisZipUrl, zip);
    extractArchive(zip, binDir);
  }

  redisProcess = spawn(serverExe, [
    "--bind", "127.0.0.1",
    "--port", String(port),
    "--dir", redisDir,
    "--dbfilename", "dump.rdb",
    "--appendonly", "yes",
    "--appendfilename", "appendonly.aof",
    "--save", "1", "1",
  ], { cwd: redisDir, stdio: "ignore", windowsHide: true });
  redisProcess.on("exit", (code) => {
    if (!stopping && code) console.error(`Redis exited with code ${code}.`);
  });
  await waitFor("Redis", () => redisAlive(port));
  console.log("Redis is storing data in .local/redis.");
}

function mailpitAsset() {
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  if (process.platform === "win32") return [`mailpit.exe`, `https://github.com/axllent/mailpit/releases/download/v${mailpitVersion}/mailpit-windows-${arch}.zip`];
  if (process.platform === "darwin") return [`mailpit`, `https://github.com/axllent/mailpit/releases/download/v${mailpitVersion}/mailpit-darwin-${arch}.tar.gz`];
  return [`mailpit`, `https://github.com/axllent/mailpit/releases/download/v${mailpitVersion}/mailpit-linux-${arch}.tar.gz`];
}

async function ensureMailpit() {
  const smtpPort = Number(readEnv("SMTP_PORT", "1025"));
  const uiPort = Number(readEnv("MAILPIT_UI_PORT", "8025"));
  if (await portOpen(smtpPort)) {
    console.log("An SMTP server is already listening. MeetPlus will use it for mail.");
    return;
  }
  const [binaryName, url] = mailpitAsset();
  mkdirSync(binDir, { recursive: true });
  const binary = join(binDir, binaryName);
  if (!existsSync(binary)) {
    console.log("Downloading Mailpit into .local/bin…");
    const archive = join(localDir, binaryName.endsWith(".exe") ? "mailpit.zip" : "mailpit.tar.gz");
    await download(url, archive);
    extractArchive(archive, binDir);
  }
  if (!existsSync(binary)) fail("Mailpit was downloaded but the executable was not found.");
  mailpitProcess = spawn(binary, ["--smtp", `127.0.0.1:${smtpPort}`, "--listen", `127.0.0.1:${uiPort}`], {
    stdio: "ignore",
    windowsHide: true,
  });
  await waitFor("Mailpit", () => portOpen(uiPort));
  console.log(`Mailpit inbox will be at http://localhost:${uiPort}`);
}

async function stopLocalServices() {
  if (stopping) return;
  stopping = true;
  if (devProcess && !devProcess.killed) {
    if (process.platform === "win32" && devProcess.pid) {
      spawnSync("taskkill", ["/pid", String(devProcess.pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      devProcess.kill("SIGINT");
    }
  }
  if (redisProcess && !redisProcess.killed) {
    const port = portFrom(readEnv("REDIS_URL", "redis://localhost:6379"), 6379);
    const cli = join(binDir, process.platform === "win32" ? "redis-cli.exe" : "redis-cli");
    if (existsSync(cli)) spawnSync(cli, ["-p", String(port), "shutdown", "save"], { stdio: "ignore" });
    else redisProcess.kill("SIGINT");
  }
  if (mailpitProcess && !mailpitProcess.killed) mailpitProcess.kill();
  if (postgres) await postgres.stop().catch((error) => console.error(error instanceof Error ? error.message : error));
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 20) fail(`Node.js 20 or newer is required; found ${process.version}.`);

if (!existsSync(".env")) {
  if (!existsSync(".env.example")) fail("Missing .env.example; cannot bootstrap .env.");
  copyFileSync(".env.example", ".env");
  console.log("Created .env from .env.example.");
}
loadEnvFile();

console.log("Installing dependencies…");
run("corepack", ["pnpm", "install"]);
run("corepack", ["pnpm", "rebuild", "argon2", "esbuild"]);

await ensurePostgres();
await ensureRedis();
await ensureMailpit();

console.log("Applying database migrations…");
run("corepack", ["pnpm", "migrate"]);

const webOrigin = readEnv("WEB_ORIGIN", "http://localhost:5173");
const apiPort = readEnv("API_PORT", "3001");
const mailpitUi = readEnv("MAILPIT_UI_PORT", "8025");

console.log("");
console.log("MeetPlus is starting without Docker (Ctrl+C stops the app and the local database services).");
console.log("Postgres and Redis data persist in .local and are reused on the next run.");
console.log("");
console.log(`  Web app       ${webOrigin}`);
console.log(`  API health    http://localhost:${apiPort}/health`);
console.log(`  Mailpit inbox http://localhost:${mailpitUi}`);
console.log("");

devProcess = spawn("corepack", ["pnpm", "dev"], {
  cwd: root,
  stdio: "inherit",
  shell,
});

const shutdown = (exitCode = 0) => {
  shutdownPromise ??= stopLocalServices().finally(() => process.exit(exitCode));
};

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
devProcess.on("exit", (code, signal) => {
  if (stopping) return;
  shutdown(signal ? 1 : code ?? 0);
});
