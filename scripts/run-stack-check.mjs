import { existsSync, copyFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const mode = process.argv[2];
if (!["integration", "e2e"].includes(mode)) {
  console.error("Usage: node scripts/run-stack-check.mjs <integration|e2e>");
  process.exit(2);
}

const command = (name) => name;
const run = (executable, args, options = {}) => {
  const result = spawnSync(command(executable), args, { stdio: "inherit", shell: process.platform === "win32", ...options });
  if (result.error?.code === "ENOENT") {
    console.error(`Missing prerequisite: ${executable} is not installed or is not on PATH.`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const check = (executable, args, message) => {
  const result = spawnSync(command(executable), args, { stdio: "ignore", shell: process.platform === "win32" });
  if (result.error?.code === "ENOENT" || result.status !== 0) {
    console.error(message);
    process.exit(1);
  }
};

check("docker", ["compose", "version"], "Missing prerequisite: Docker Compose v2 is required to run stack verification.");
check("docker", ["info"], "Missing prerequisite: Docker is installed but its daemon is not running or cannot be reached.");
check("corepack", ["pnpm", "--version"], "Missing prerequisite: Corepack-managed pnpm is required.");

if (!existsSync(".env")) {
  if (!existsSync(".env.example")) {
    console.error("Missing prerequisite: .env.example was not found.");
    process.exit(1);
  }
  copyFileSync(".env.example", ".env");
  console.log("Created .env from .env.example.");
}

run("docker", ["compose", "up", "-d", "--wait"]);
run("corepack", ["pnpm", "migrate"]);

const children = [];
const start = (args) => {
  const child = spawn(command("corepack"), ["pnpm", ...args], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  children.push(child);
  child.once("exit", (code) => {
    if (code && !process.exitCode) process.exitCode = code;
  });
};

const waitFor = async (url, label) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The child process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${label} did not become ready at ${url} within 30 seconds.`);
};

const stopChildren = () => {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
};
process.once("SIGINT", () => { stopChildren(); process.exit(130); });
process.once("SIGTERM", () => { stopChildren(); process.exit(143); });

try {
  start(["--filter", "@meetcon/api", "run", "dev"]);
  await waitFor("http://localhost:3001/health", "API");

  if (mode === "integration") {
    run("corepack", ["pnpm", "--filter", "@meetcon/api", "run", "test:integration"]);
  } else {
    start(["--filter", "@meetcon/web", "run", "dev"]);
    await waitFor("http://localhost:5173/login", "Web app");
    run("corepack", ["pnpm", "exec", "playwright", "test"]);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  stopChildren();
}
