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
    body: { email, password, role, displayName, timeZone: "UTC", privacyNoticeVersion: "2026-11-04", acceptPrivacy: true, confirmAge18: true },
  });
  assert.equal(payload.user.email, email);
  assert.equal(payload.user.role, role);
  return payload.user;
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function cleanup() {
  const list = Object.values(emails);
  await pool.query(
    `DELETE FROM answers WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))
      OR meetup_id IN (SELECT id FROM meetups WHERE owner_id IN (SELECT id FROM users WHERE email = ANY($1)))`,
    [list],
  );
  await pool.query(
    `DELETE FROM meetup_members WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))
      OR meetup_id IN (SELECT id FROM meetups WHERE owner_id IN (SELECT id FROM users WHERE email = ANY($1)))`,
    [list],
  );
  await pool.query("DELETE FROM meetups WHERE owner_id IN (SELECT id FROM users WHERE email = ANY($1))", [list]);
  await pool.query("DELETE FROM users WHERE email = ANY($1)", [list]);
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
      sourceTimeZone: "UTC",
      status: "PUBLISHED",
      questionnaires: [{
        title: "Timed block",
        startsAt,
        endsAt,
        questions: [
          { prompt: "First timed question?", options: ["Alpha", "Beta", "Gamma", "Delta"] },
          { prompt: "Second timed question?", options: ["One", "Two", "Three", "Four"] },
          { prompt: "Third timed question?", options: ["North", "South", "East", "West"] },
        ],
      }],
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
  assert.equal(detail.questionnaires.length, 1);
  assert.equal(detail.questionnaires[0].questions.length, 3);
  await pool.query(
    `UPDATE questionnaires SET starts_at=clock_timestamp()-interval '500 milliseconds', ends_at=clock_timestamp()+interval '11500 milliseconds' WHERE meetup_id=$1`,
    [created.id],
  );
  await pool.query(
    `WITH bounds AS (
      SELECT qn.id,
        (EXTRACT(EPOCH FROM qn.ends_at) * 1000)::bigint - (EXTRACT(EPOCH FROM qn.starts_at) * 1000)::bigint AS duration_ms,
        (SELECT count(*)::int FROM questions WHERE questionnaire_id = qn.id) AS question_count
      FROM questionnaires qn WHERE qn.meetup_id=$1
    )
    UPDATE questions q
    SET opens_at = qn.starts_at + (((b.duration_ms * (q.position - 1)) / b.question_count) * interval '1 millisecond'),
        closes_at = qn.starts_at + (((b.duration_ms * q.position) / b.question_count) * interval '1 millisecond')
    FROM questionnaires qn JOIN bounds b ON b.id = qn.id
    WHERE q.questionnaire_id = qn.id`,
    [created.id],
  );
  await pool.query(
    "UPDATE meetups SET starts_at=(SELECT min(starts_at) FROM questionnaires WHERE meetup_id=$1), ends_at=(SELECT max(ends_at) FROM questionnaires WHERE meetup_id=$1) WHERE id=$1",
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
  const partial = await userA.request(`/meetups/${created.id}/active`);
  assert.equal(partial.question.id, firstQuestion.id, "one answer must leave the question open");
  assert.equal(partial.answer.selectedCount, 1);
  await userA.request(
    `/meetups/${created.id}/questions/${firstQuestion.id}/options/${competingOption.id}/count-stream`,
    { expected: 403 },
  );
  await userB.request(`/meetups/${created.id}/answers`, {
    method: "POST", expected: 201, body: { questionId: firstQuestion.id, optionId: selectedOption.id },
  });

  const secondState = await userA.request(`/meetups/${created.id}/active`);
  assert.equal(secondState.phase, "ANSWERING");
  assert.equal(secondState.question.position, 2, "every participant answering must open the next question");
  await userA.request(`/meetups/${created.id}/answers`, {
    method: "POST", expected: 201, body: { questionId: secondState.question.id, optionId: secondState.question.options[2].id },
  });
  const boundaryDeadline = Date.parse(secondState.phaseEndsAt) + 200;
  await sleep(Math.max(0, boundaryDeadline - Date.now()));
  const thirdState = await userA.request(`/meetups/${created.id}/active`);
  assert.equal(thirdState.phase, "ANSWERING");
  assert.equal(thirdState.question.position, 3, "server boundary must activate the next question");
  await userA.request(`/meetups/${created.id}/answers`, {
    method: "POST", expected: 201, body: { questionId: thirdState.question.id, optionId: thirdState.question.options[0].id },
  });
  await userB.request(`/meetups/${created.id}/answers`, {
    method: "POST", expected: 201, body: { questionId: thirdState.question.id, optionId: thirdState.question.options[1].id },
  });
  assert.equal((await userA.request(`/meetups/${created.id}/active`)).phase, "COMPLETED");

  const results = await adminA.request(`/meetups/${created.id}/results`);
  assert.equal(results.meetup.joinedCount, 2);
  assert.equal(results.questionnaires.length, 1);
  assert.equal(results.questionnaires[0].questions.length, 3);
  assert.equal(results.questionnaires[0].questions[0].answered, 2);
  assert.equal(results.questionnaires[0].questions[0].options[0].count, 2);
  assert.deepEqual(
    results.questionnaires[0].questions[1].options.map((option) => option.count),
    [0, 0, 1, 0],
  );
  assert.equal(results.questionnaires[0].questions[1].answered, 1);
  assert.equal(results.questionnaires[0].questions[2].answered, 2);

  await verifyScheduleControls(adminA, adminB, userA, userB, runId);

  console.log("API integration passed: registration, ownership, joining, timing, immutable/idempotent answers, count privacy, auto-advance, pause and resume, skip, and grouped results.");
}

async function shiftMeetupTo(meetupId, secondsBeforeStart) {
  const delta = await pool.query(
    `SELECT (EXTRACT(EPOCH FROM (clock_timestamp() - ($2::text || ' seconds')::interval - starts_at)) * 1000)::bigint AS delta_ms
     FROM questionnaires WHERE meetup_id=$1 ORDER BY position LIMIT 1`,
    [meetupId, String(secondsBeforeStart)],
  );
  const deltaMs = delta.rows[0].delta_ms;
  await pool.query(
    `UPDATE questions SET opens_at = opens_at + ($2::bigint * interval '1 millisecond'),
      closes_at = closes_at + ($2::bigint * interval '1 millisecond') WHERE meetup_id=$1`,
    [meetupId, deltaMs],
  );
  await pool.query(
    `UPDATE questionnaires SET starts_at = starts_at + ($2::bigint * interval '1 millisecond'),
      ends_at = ends_at + ($2::bigint * interval '1 millisecond') WHERE meetup_id=$1`,
    [meetupId, deltaMs],
  );
  await pool.query(
    `UPDATE meetups SET starts_at=(SELECT min(starts_at) FROM questionnaires WHERE meetup_id=$1),
      ends_at=(SELECT max(ends_at) FROM questionnaires WHERE meetup_id=$1) WHERE id=$1`,
    [meetupId],
  );
}

async function scheduleTimes(meetupId) {
  const questionnaires = (await pool.query(
    "SELECT position, starts_at, ends_at, paused_at FROM questionnaires WHERE meetup_id=$1 ORDER BY position",
    [meetupId],
  )).rows;
  const questions = (await pool.query(
    `SELECT q.position, q.opens_at, q.closes_at
     FROM questions q JOIN questionnaires qn ON qn.id=q.questionnaire_id
     WHERE q.meetup_id=$1 ORDER BY qn.position, q.position`,
    [meetupId],
  )).rows;
  const meetup = (await pool.query("SELECT starts_at, ends_at FROM meetups WHERE id=$1", [meetupId])).rows[0];
  return { questionnaires, questions, meetup };
}

async function verifyScheduleControls(adminA, adminB, userA, userB, runId) {
  const firstStart = new Date(Date.now() + 10 * 60_000).toISOString();
  const firstEnd = new Date(Date.now() + 12 * 60_000).toISOString();
  const secondEnd = new Date(Date.now() + 13 * 60_000).toISOString();
  const scheduled = await adminA.request("/meetups", {
    method: "POST",
    expected: 201,
    body: {
      title: `Schedule control ${runId}`,
      sourceTimeZone: "UTC",
      status: "PUBLISHED",
      questionnaires: [
        {
          title: "Opening block",
          startsAt: firstStart,
          endsAt: firstEnd,
          questions: [
            { prompt: "Keep this question?", options: ["Yes", "No", "Later", "Skip"] },
            { prompt: "Follow-up question?", options: ["Red", "Blue", "Green", "Gold"] },
          ],
        },
        {
          title: "Closing block",
          startsAt: firstEnd,
          endsAt: secondEnd,
          questions: [
            { prompt: "Final question?", options: ["Stay", "Leave", "Wait", "Done"] },
          ],
        },
      ],
    },
  });
  const token = new URL(scheduled.joinUrl).pathname.split("/").pop();
  await userA.request("/join/code", { method: "POST", expected: 201, body: { code: scheduled.publicCode } });
  await userB.request("/join/token", { method: "POST", expected: 201, body: { token } });
  await shiftMeetupTo(scheduled.id, 2);

  const before = await scheduleTimes(scheduled.id);
  const opening = before.questionnaires[0];
  const closing = before.questionnaires[1];
  const live = await userA.request(`/meetups/${scheduled.id}/active`);
  assert.equal(live.phase, "ANSWERING");
  assert.equal(live.paused, false);
  assert.equal(live.question.position, 1);
  const questionnaireId = live.questionnaire.id;
  await adminB.request(`/meetups/${scheduled.id}/questionnaires/${questionnaireId}/pause`, { expected: 404 });

  await adminA.request(`/meetups/${scheduled.id}/questionnaires/${questionnaireId}/pause`, { method: "POST" });
  const paused = await userA.request(`/meetups/${scheduled.id}/active`);
  assert.equal(paused.paused, true);
  assert.equal(paused.question.id, live.question.id);
  assert.equal(paused.phaseEndsAt, live.phaseEndsAt);
  const frozenAt = Date.parse(paused.serverTime);
  await sleep(1200);
  const held = await userA.request(`/meetups/${scheduled.id}/active`);
  assert.equal(Date.parse(held.serverTime), frozenAt, "paused clock must stay at the pause instant");
  assert.equal(held.question.id, live.question.id);
  const alreadyPaused = await adminA.request(`/meetups/${scheduled.id}/questionnaires/${questionnaireId}/pause`, { method: "POST", expected: 409 });
  assert.equal(alreadyPaused.error.code, "ALREADY_PAUSED");

  const openingGap = new Date(before.questions[1].opens_at).getTime() - new Date(before.questions[0].closes_at).getTime();
  assert.ok(Math.abs(openingGap - 30_000) < 1_500, `questions keep a 30 second results break, got ${openingGap}`);
  await pool.query("UPDATE meetups SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1", [scheduled.id]);
  const firstVote = await userA.request(`/meetups/${scheduled.id}/answers`, {
    method: "POST", expected: 201, body: { questionId: live.question.id, optionId: live.question.options[0].id },
  });
  assert.equal(firstVote.tallies.reduce((sum, tally) => sum + tally.count, 0), 1);
  const duringPause = await userA.request(`/meetups/${scheduled.id}/active`);
  assert.equal(duringPause.paused, true);
  assert.equal(duringPause.question.id, live.question.id, "one answer while paused must not move on");
  assert.equal(duringPause.tallies.find((tally) => tally.optionId === live.question.options[0].id).count, 1);

  const remainingWhilePaused = Date.parse(paused.phaseEndsAt) - frozenAt;
  await adminA.request(`/meetups/${scheduled.id}/questionnaires/${questionnaireId}/resume`, { method: "POST" });
  const resumed = await userA.request(`/meetups/${scheduled.id}/active`);
  assert.equal(resumed.paused, false);
  assert.equal(resumed.question.id, live.question.id);
  const remainingAfterResume = Date.parse(resumed.phaseEndsAt) - Date.parse(resumed.serverTime);
  assert.ok(Math.abs(remainingAfterResume - remainingWhilePaused) < 800, `remaining ${remainingAfterResume} vs paused ${remainingWhilePaused}`);

  const afterResume = await scheduleTimes(scheduled.id);
  const pauseMs = Date.parse(resumed.serverTime) - frozenAt;
  const grew = (row, previous) => new Date(row).getTime() - new Date(previous).getTime();
  assert.ok(Math.abs(grew(afterResume.questions[0].closes_at, before.questions[0].closes_at) - pauseMs) < 800);
  assert.ok(Math.abs(grew(afterResume.questions[1].opens_at, before.questions[1].opens_at) - pauseMs) < 800);
  assert.ok(Math.abs(grew(afterResume.questionnaires[0].ends_at, opening.ends_at) - pauseMs) < 800);
  assert.ok(Math.abs(grew(afterResume.questionnaires[1].starts_at, closing.starts_at) - pauseMs) < 800);
  assert.ok(Math.abs(grew(afterResume.questionnaires[1].ends_at, closing.ends_at) - pauseMs) < 800);
  assert.ok(Math.abs(grew(afterResume.meetup.ends_at, before.meetup.ends_at) - pauseMs) < 800);
  assert.equal(afterResume.questionnaires[0].paused_at, null);

  await userB.request(`/meetups/${scheduled.id}/answers`, {
    method: "POST", expected: 201, body: { questionId: live.question.id, optionId: live.question.options[1].id },
  });
  const between = await userA.request(`/meetups/${scheduled.id}/active`);
  assert.equal(between.phase, "WAITING");
  assert.equal(between.review.position, 1);
  assert.equal(between.review.options.reduce((sum, option) => sum + option.count, 0), 2);
  const breakMs = Date.parse(between.phaseEndsAt) - Date.parse(between.serverTime);
  assert.ok(breakMs > 25_000 && breakMs <= 32_000, `results break ${breakMs}`);
  const unusedRemoved = await scheduleTimes(scheduled.id);
  const removed = new Date(afterResume.questions[0].closes_at).getTime() - new Date(unusedRemoved.questions[0].closes_at).getTime();
  assert.ok(removed > 10_000, "unused time on the answered question must be removed");
  assert.ok(Math.abs(grew(afterResume.questions[1].opens_at, unusedRemoved.questions[1].opens_at) - removed) < 800);
  assert.ok(Math.abs(grew(afterResume.meetup.ends_at, unusedRemoved.meetup.ends_at) - removed) < 800);
  await collapseResultsBreak(scheduled.id);
  const secondQuestion = await userA.request(`/meetups/${scheduled.id}/active`);
  assert.equal(secondQuestion.phase, "ANSWERING");
  assert.equal(secondQuestion.question.position, 2);

  await adminA.request(`/meetups/${scheduled.id}/questionnaires/${questionnaireId}/advance`, { method: "POST" });
  const hold = await userA.request(`/meetups/${scheduled.id}/active`);
  assert.equal(hold.phase, "WAITING");
  assert.equal(hold.review.position, 2);
  const afterSkip = await scheduleTimes(scheduled.id);
  assert.ok(new Date(afterSkip.questions[1].closes_at).getTime() <= Date.now());
  assert.ok(Math.abs(new Date(afterSkip.questions[2].opens_at).getTime() - Date.parse(hold.serverTime) - 30_000) < 2_500);
  await collapseResultsBreak(scheduled.id);
  const forwarded = await userA.request(`/meetups/${scheduled.id}/active`);
  assert.equal(forwarded.questionnaire.position, 2);
  assert.equal(forwarded.question.position, 1);
  assert.equal(forwarded.paused, false);

  await userA.request(`/meetups/${scheduled.id}/answers`, {
    method: "POST", expected: 201, body: { questionId: forwarded.question.id, optionId: forwarded.question.options[0].id },
  });
  const waitingForLast = await userB.request(`/meetups/${scheduled.id}/active`);
  assert.equal(waitingForLast.question.id, forwarded.question.id);
  await userB.request(`/meetups/${scheduled.id}/answers`, {
    method: "POST", expected: 201, body: { questionId: forwarded.question.id, optionId: forwarded.question.options[1].id },
  });
  const finalResults = await userA.request(`/meetups/${scheduled.id}/active`);
  assert.equal(finalResults.phase, "WAITING");
  assert.equal(finalResults.review.options.reduce((sum, option) => sum + option.count, 0), 2);
  const finalBreak = Date.parse(finalResults.phaseEndsAt) - Date.parse(finalResults.serverTime);
  assert.ok(finalBreak > 20_000 && finalBreak <= 32_000, `final results break ${finalBreak}`);
}

async function collapseResultsBreak(meetupId) {
  const next = await pool.query(
    `SELECT (EXTRACT(EPOCH FROM (clock_timestamp() - opens_at)) * 1000)::bigint AS delta_ms
     FROM questions WHERE meetup_id=$1 AND opens_at > clock_timestamp() ORDER BY opens_at LIMIT 1`,
    [meetupId],
  );
  const deltaMs = next.rows[0]?.delta_ms == null ? null : Number(next.rows[0].delta_ms) - 500;
  if (deltaMs == null) return;
  await pool.query(
    `UPDATE questions SET
       opens_at = CASE WHEN opens_at > clock_timestamp() THEN opens_at + ($2::bigint * interval '1 millisecond') ELSE opens_at END,
       closes_at = CASE WHEN opens_at > clock_timestamp() THEN closes_at + ($2::bigint * interval '1 millisecond') ELSE closes_at END
     WHERE meetup_id=$1`,
    [meetupId, deltaMs],
  );
  await pool.query(
    `UPDATE questionnaires SET
       starts_at = CASE WHEN starts_at > clock_timestamp() THEN starts_at + ($2::bigint * interval '1 millisecond') ELSE starts_at END,
       ends_at = CASE WHEN ends_at > clock_timestamp() THEN ends_at + ($2::bigint * interval '1 millisecond') ELSE ends_at END
     WHERE meetup_id=$1`,
    [meetupId, deltaMs],
  );
  await pool.query(
    `UPDATE meetups SET starts_at=(SELECT min(starts_at) FROM questionnaires WHERE meetup_id=$1),
      ends_at=(SELECT max(ends_at) FROM questionnaires WHERE meetup_id=$1) WHERE id=$1`,
    [meetupId],
  );
}

try {
  await main();
} finally {
  await cleanup().catch((error) => console.error("Integration cleanup failed:", error));
  await Promise.allSettled([pool.end(), redis.quit()]);
}
