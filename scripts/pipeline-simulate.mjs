/**
 * Gateway smoke test (HTTPS). Used after deploy on production port or against isolated sim.
 * Env: SIM_BASE_URL, SIM_WEB_ORIGIN, SMOKE_FULL=1 to also register + session (creates a user).
 */
import process from "node:process";

const base = (process.env.SIM_BASE_URL ?? "https://127.0.0.1:30098").replace(/\/$/, "");
const webOrigin = (process.env.SIM_WEB_ORIGIN ?? process.env.WEB_ORIGIN ?? base).replace(/\/$/, "");
const smokeFull = ["1", "true", "yes", "on"].includes(
  (process.env.SMOKE_FULL ?? "").toLowerCase(),
);

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const fail = (message) => {
  console.error(`SIM FAIL: ${message}`);
  process.exit(1);
};

const ok = (message) => console.log(`SIM OK: ${message}`);

async function fetchJson(path, { method = "GET", body, cookie, origin } = {}) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: response.status, json, setCookie: response.headers.get("set-cookie") };
}

async function main() {
  console.log(`=== MeetCon smoke test ===`);
  console.log(`Base: ${base} | Origin: ${webOrigin} | full=${smokeFull}`);

  const health = await fetchJson("/health");
  if (health.status !== 200 || health.json?.status !== "ok") {
    fail(`/health expected 200 ok, got ${health.status} ${JSON.stringify(health.json)}`);
  }
  ok("gateway /health (database + redis via API)");

  if (smokeFull) {
    const email = `smoke-${Date.now()}@pipeline.test`;
    const password = "Smoke-Pipeline-Test-42!";
    let cookie = "";

    const reg = await fetchJson("/api/auth/register", {
      method: "POST",
      body: { email, password, role: "ADMIN", displayName: "Pipeline Smoke", timeZone: "UTC" },
    });
    if (reg.status !== 200 || !reg.json?.user?.email) {
      fail(`register failed: ${reg.status} ${JSON.stringify(reg.json)}`);
    }
    if (reg.setCookie) cookie = reg.setCookie.split(";", 1)[0];
    ok("POST /api/auth/register (admin)");

    const session = await fetchJson("/api/auth/session", { cookie, origin: webOrigin });
    if (session.status !== 200 || session.json?.user?.email !== email) {
      fail(`session failed: ${session.status} ${JSON.stringify(session.json)}`);
    }
    ok("GET /api/auth/session (cookie + origin)");
  }

  const index = await fetch(`${base}/`);
  const html = await index.text();
  if (!index.ok || !/html|id="root"/i.test(html)) {
    fail("SPA index not served at /");
  }
  ok("GET / (React SPA shell)");

  console.log("=== Smoke test passed ===");
}

main().catch((error) => fail(error?.message ?? String(error)));
