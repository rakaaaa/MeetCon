import assert from "node:assert/strict";
import process from "node:process";
import dotenv from "dotenv";
import Redis from "ioredis";
import pg from "pg";

dotenv.config({ path: new URL("../../../.env", import.meta.url), quiet: true });

const apiUrl = process.env.API_URL ?? "http://localhost:3001";
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

if (!databaseUrl || !redisUrl) {
  console.error("Missing prerequisite: DATABASE_URL and REDIS_URL must be configured (copy .env.example to .env).");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = "MeetCon-Integration-42";
const emails = {
  adminA: `integration-admin-a-${runId}@example.test`,
  adminB: `integration-admin-b-${runId}@example.test`,
  userA: `integration-user-a-${runId}@example.test`,
  userB: `integration-user-b-${runId}@example.test`,
};

class Client {
  cookie = "";

  async request(path, { expected = 200, method = "GET", body } = {}) {
    const response = await fetch(`${apiUrl}/api${path}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(this.cookie ? { cookie: this.cookie, origin: webOrigin } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";", 1)[0];
    const payload = response.status === 204 ? undefined : await response.json().catch(() => undefined);
    assert.equal(response.status, expected, `${method} ${path}: expected ${expected}, got ${response.status}: ${JSON.stringify(payload)}`);
    return payload;
  }
}

const register = async (client, email, role, displayName) => {
  const payload = await client.request("/auth/register", {
    method: "POST",
    expected: 200,
    body: { email, password, role, displayName, timeZone: "UTC" },
  });
  assert.equal(payload.user.email, email);
  assert.equal(payload.user.role, role);
  return payload.user;
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function cleanup() {
  await pool.query(`
    WITH test_users AS (SELECT id FROM users WHERE email = ANY($1))
    DELETE FROM answers WHERE user_id IN (SELECT id FROM test_users)
      OR meetup_id IN (SELECT id FROM meetups WHERE owner_id IN (SELECT id FROM test_users));
    WITH test_users AS (SELECT id FROM users WHERE email = ANY($1))
    DELETE FROM meetup_members WHERE user_id IN (SELECT id FROM test_users)
      OR meetup_id IN (SELECT id FROM meetups WHERE owner_id IN (SELECT id FROM test_users));
    DELETE FROM meetups WHERE owner_id IN (SELECT id FROM users WHERE email = ANY($1));
    DELETE FROM users WHERE email = ANY($1);
  `, [Object.values(emails)]);
}

async function main() {
  const health = await fetch(`${apiUrl}/health`);
  assert.equal(health.status, 200, `API health prerequisite failed at ${apiUrl}/health`);
  assert.equal((await health.json()).status, "ok");
  await redis.connect();
  assert.equal(await redis.ping(), "PONG", "Redis prerequisite failed");
  await pool.query("SELECT 1");

  const adminA = new Client(), adminB = new Client(), userA = new Client(), userB = new Client();
  await register(adminA, emails.adminA, "ADMIN", "Integration Admin A");
  await register(adminB, emails.adminB, "ADMIN", "Integration Admin B");
  await register(userA, emails.userA, "USER", "Integration User A");
  await register(userB, emails.userB, "USER", "Integration User B");

  const startsAt = new Date(Date.now() + 60_000).toISOString();
  const endsAt = new Date(Date.now() + 90_000).toISOString();
  const created = await adminA.request("/meetups", {
    method: "POST",
    expected: 201,
    body: {
      title: `Integration meetup ${runId}`,
      startsAt,
      endsAt,
      sourceTimeZone: "UTC",
      status: "PUBLISHED",
      questions: [
        { prompt: "First timed question?", options: ["Alpha", "Beta", "Gamma", "Delta"] },
        { prompt: "Second timed question?", options: ["One", "Two", "Three", "Four"] },
      ],
    },
  });
  assert.match(created.publicCode, /^\d{8}$/);
  assert.ok(created.joinUrl);

  await adminB.request(`/meetups/${created.id}`, { expected: 404 });
  await adminB.request(`/meetups/${created.id}/results`, { expected: 404 });
  const adminBList = await adminB.request("/meetups");
  assert.equal(adminBList.meetups.some((meetup) => meetup.id === created.id), false);

  const token = new URL(created.joinUrl).pathname.split("/").pop();
  const codePreview = await userA.request("/join/code/preview", { method: "POST", body: { code: created.publicCode } });
  assert.equal(codePreview.meetup.id, created.id);
  const tokenPreview = await userB.request("/join/token/preview", { method: "POST", body: { token } });
  assert.equal(tokenPreview.meetup.id, created.id);
  assert.equal((await userA.request("/join/code", { method: "POST", expected: 201, body: { code: created.publicCode } })).alreadyJoined, false);
  assert.equal((await userA.request("/join/code", { method: "POST", expected: 200, body: { code: created.publicCode } })).alreadyJoined, true);
  assert.equal((await userB.request("/join/token", { method: "POST", expected: 201, body: { token } })).alreadyJoined, false);

  const detail = await adminA.request(`/meetups/${created.id}`);
  assert.equal(detail.questions.length, 2);
  await pool.query(
    "UPDATE meetups SET starts_at=clock_timestamp()-interval '500 milliseconds', ends_at=clock_timestamp()+interval '7500 milliseconds' WHERE id=$1",
    [created.id],
  );

  const firstState = await userA.request(`/meetups/${created.id}/active`);
  assert.equal(firstState.phase, "ANSWERING");
  assert.equal(firstState.question.position, 1);
  assert.equal(firstState.question.options.some((option) => "selectedCount" in option || "count" in option), false);

  const firstQuestion = firstState.question;
  const selectedOption = firstQuestion.options[0];
  const competingOption = firstQuestion.options[1];
  const firstAnswer = await userA.request(`/meetups/${created.id}/answers`, {
    method: "POST", expected: 201, body: { questionId: firstQuestion.id, optionId: selectedOption.id },
  });
  const repeated = await userA.request(`/meetups/${created.id}/answers`, {
    method: "POST", expected: 200, body: { questionId: firstQuestion.id, optionId: selectedOption.id },
  });
  assert.equal(repeated.answer.id, firstAnswer.answer.id, "same answer must be idempotent");
  const immutable = await userA.request(`/meetups/${created.id}/answers`, {
    method: "POST", expected: 409, body: { questionId: firstQuestion.id, optionId: competingOption.id },
  });
  assert.equal(immutable.error.code, "ANSWER_IMMUTABLE");
  await userB.request(`/meetups/${created.id}/answers`, {
    method: "POST", expected: 201, body: { questionId: firstQuestion.id, optionId: selectedOption.id },
  });

  const selectedState = await userA.request(`/meetups/${created.id}/active`);
  assert.equal(selectedState.answer.selectedCount, 2);
  await userA.request(
    `/meetups/${created.id}/questions/${firstQuestion.id}/options/${competingOption.id}/count-stream`,
    { expected: 403 },
  );

  const boundaryDeadline = Date.parse(firstState.phaseEndsAt) + 150;
  await sleep(Math.max(0, boundaryDeadline - Date.now()));
  const secondState = await userA.request(`/meetups/${created.id}/active`);
  assert.equal(secondState.phase, "ANSWERING");
  assert.equal(secondState.question.position, 2, "server boundary must activate the second question");
  await userA.request(`/meetups/${created.id}/answers`, {
    method: "POST", expected: 201, body: { questionId: secondState.question.id, optionId: secondState.question.options[2].id },
  });
  await userB.request(`/meetups/${created.id}/answers`, {
    method: "POST", expected: 201, body: { questionId: secondState.question.id, optionId: secondState.question.options[3].id },
  });

  await pool.query("UPDATE meetups SET ends_at=clock_timestamp()-interval '1 millisecond' WHERE id=$1", [created.id]);
  assert.equal((await userA.request(`/meetups/${created.id}/active`)).phase, "COMPLETED");

  const results = await adminA.request(`/meetups/${created.id}/results`);
  assert.equal(results.meetup.joinedCount, 2);
  assert.equal(results.questions.length, 2);
  assert.equal(results.questions[0].answered, 2);
  assert.equal(results.questions[0].options[0].count, 2);
  assert.deepEqual(
    results.questions[1].options.map((option) => option.count),
    [0, 0, 1, 1],
  );
  assert.equal(results.questions[1].answered, 2);

  console.log("API integration passed: registration, ownership, joining, timing, immutable/idempotent answers, count privacy, boundary transition, and grouped results.");
}

try {
  await main();
} finally {
  await cleanup().catch((error) => console.error("Integration cleanup failed:", error));
  await Promise.allSettled([pool.end(), redis.quit()]);
}
