#!/usr/bin/env node
/**
 * Production Docker stack (project meetcon-prod).
 * Local development is `node run.mjs` / `run.bat`: project meetcon, app on the host.
 *
 * Usage: node run-production.mjs   |   run-production.bat   |   pnpm start:prod
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
process.chdir(root);
const shell = process.platform === "win32";

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell, env });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("docker", ["compose", "version"]);
run("docker", ["info"]);

if (!existsSync(".env.production")) {
  fail(
    [
      "Missing .env.production.",
      "Copy .env.production.example to .env.production and set real secrets.",
      "Do not reuse .env. That file is only for local development (run.bat).",
    ].join("\n"),
  );
}

run("node", ["deploy/validate-production-env.mjs", ".env.production"]);

if (!existsSync("deploy/certs/fullchain.pem") || !existsSync("deploy/certs/privkey.pem")) {
  fail(
    [
      "Missing TLS files deploy/certs/fullchain.pem and deploy/certs/privkey.pem.",
      "For a public host, install the real certificate.",
      "For a private lab only: sh deploy/certs/generate-self-signed.sh your-hostname",
    ].join("\n"),
  );
}

const sha = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" });
const imageTag = process.env.MEETCON_IMAGE_TAG
  || (sha.status === 0 ? sha.stdout.trim() : "")
  || "production";

const env = {
  ...process.env,
  COMPOSE_DISABLE_ENV_FILE: "1",
  COMPOSE_FILE: "docker-compose.prod.yml",
  COMPOSE_PROJECT_NAME: "meetcon-prod",
  MEETCON_IMAGE_TAG: imageTag,
};

console.log("");
console.log("MeetPlus production Docker");
console.log(`  Project       meetcon-prod`);
console.log(`  Env file      .env.production`);
console.log(`  Image tag     ${imageTag}`);
console.log("  Local dev     run.bat  (project meetcon, http://localhost:5173)");
console.log("");

run(
  "docker",
  ["compose", "--env-file", ".env.production", "-f", "docker-compose.prod.yml", "-p", "meetcon-prod", "up", "-d", "--build"],
  env,
);

if (imageTag !== "production") {
  run("docker", ["tag", `meetcon-api:${imageTag}`, "meetcon-api:production"], env);
  run("docker", ["tag", `meetcon-gateway:${imageTag}`, "meetcon-gateway:production"], env);
}

console.log("");
console.log(`Production images meetcon-api:${imageTag} and meetcon-gateway:${imageTag} are running.`);
console.log("Health: curl http://127.0.0.1:30098/health");
console.log("The :production tag points at this build. Roll back with MEETCON_IMAGE_TAG=<older-sha>.");
