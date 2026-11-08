import type { FastifyInstance } from "fastify";
import { QUESTION_BREAK_MS } from "@meetcon/shared";
import { config } from "../../config.js";
import { pool, transaction } from "../../db/index.js";
import { AppError, iso, noStore, ownedMeetup, requireUser } from "../../lib.js";
import { advanceQuestion, pauseQuestionnaire, publishSchedule, resumeQuestionnaire } from "../schedule/control.js";
import { readQuestionnaireNotice } from "../../questionnaire-notice.js";
import { subscriber } from "../../redis.js";

async function optionTallies(questionId: string): Promise<{ optionId: string; count: number }[]> {
  return (await pool.query(`SELECT o.id AS "optionId", count(a.id)::int AS count
    FROM question_options o LEFT JOIN answers a ON a.option_id = o.id
    WHERE o.question_id = $1 GROUP BY o.id, o.position ORDER BY o.position`, [questionId])).rows;
}

async function questionReview(meetupId: string, userId: string, clock: Date, nextBoundary: Date) {
  const previous = (await pool.query(`SELECT q.id, q.prompt, q.position, q.closes_at,
      (SELECT count(*)::int FROM questions qq WHERE qq.questionnaire_id = q.questionnaire_id) AS question_count,
      json_agg(json_build_object('id', o.id, 'position', o.position, 'label', o.label, 'count',
        (SELECT count(*)::int FROM answers a WHERE a.option_id = o.id)) ORDER BY o.position) AS options
    FROM questions q
    JOIN questionnaires qn ON qn.id = q.questionnaire_id AND qn.status = 'PUBLISHED'
    JOIN question_options o ON o.question_id = q.id
    WHERE q.meetup_id = $1 AND q.closes_at <= $2
    GROUP BY q.id
    ORDER BY q.closes_at DESC
    LIMIT 1`, [meetupId, clock.toISOString()])).rows[0] as { id: string; prompt: string; position: number; closes_at: Date; question_count: number; options: { id: string; position: number; label: string; count: number }[] } | undefined;
  if (!previous) return null;
  const gap = nextBoundary.getTime() - new Date(previous.closes_at).getTime();
  if (gap <= 0 || gap > QUESTION_BREAK_MS + 2_000) return null;
  const yours = (await pool.query("SELECT option_id FROM answers WHERE user_id=$1 AND question_id=$2", [userId, previous.id])).rows[0] as { option_id: string } | undefined;
  return {
    prompt: previous.prompt, position: previous.position, questionCount: previous.question_count,
    yourOptionId: yours?.option_id ?? null, options: previous.options,
  };
}

function openStream(request: { headers: { origin?: string | string[] | undefined }; raw: { on: (event: string, listener: () => void) => void } }, reply: { hijack: () => void; raw: { writeHead: (status: number, headers: Record<string, string>) => void; write: (chunk: string) => void } }) {
  const origin = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin;
  if (origin && origin !== config.WEB_ORIGIN) {
    throw new AppError(403, "INVALID_ORIGIN", "Request origin rejected");
  }
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store, private", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const redis = subscriber.duplicate();
  const heartbeat = setInterval(() => raw.write(": heartbeat\n\n"), 15_000);
  request.raw.on("close", () => { clearInterval(heartbeat); void redis.quit(); });
  return { raw, redis };
}

export async function liveStateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/meetups/:id/active", async (request, reply) => {
    const user = requireUser(request), { id } = request.params as { id: string };
    const result = await pool.query(`SELECT m.*,clock_timestamp() db_now,u.display_name organizer,
      (SELECT count(*) FROM meetup_members WHERE meetup_id=m.id)::int member_count
      FROM meetup_members mm JOIN meetups m ON m.id=mm.meetup_id JOIN users u ON u.id=m.owner_id
      WHERE mm.meetup_id=$1 AND mm.user_id=$2`, [id, user.id]);
    const meetup = result.rows[0];
    if (!meetup) throw new AppError(404, "NOT_FOUND", "Meetup not found");
    if (meetup.status === "CANCELLED") throw new AppError(410, "MEETUP_CANCELLED", "Meetup was cancelled");
    const now = new Date(meetup.db_now);
    const notice = await readQuestionnaireNotice(id);
    const pausedRow = (await pool.query(`SELECT qn.id,qn.position,qn.title,qn.starts_at,qn.ends_at,qn.paused_at,
      (SELECT count(*)::int FROM questions WHERE questionnaire_id=qn.id) question_count
      FROM questionnaires qn WHERE qn.meetup_id=$1 AND qn.status='PUBLISHED' AND qn.paused_at IS NOT NULL
      ORDER BY qn.paused_at DESC LIMIT 1`, [id])).rows[0];
    const clock = pausedRow ? new Date(pausedRow.paused_at) : now;
    const base: any = { meetup: { id, title: meetup.title, organizer: meetup.organizer, startsAt: iso(meetup.starts_at), endsAt: iso(meetup.ends_at), sourceTimeZone: meetup.source_time_zone }, serverTime: iso(clock), participantCount: meetup.member_count, paused: Boolean(pausedRow), ...(notice ? { notice } : {}) };
    const describe = (row: any) => ({ id: row.id, title: row.title, position: row.position, startsAt: iso(row.starts_at), endsAt: iso(row.ends_at) });
    const open = (await pool.query(`SELECT qn.id,qn.position,qn.title,qn.starts_at,qn.ends_at,
      (SELECT count(*)::int FROM questions WHERE questionnaire_id=qn.id) question_count,
      q.id question_id,q.prompt,q.position question_position,q.opens_at,q.closes_at,
      json_agg(json_build_object('id',o.id,'position',o.position,'label',o.label) ORDER BY o.position) options
      FROM questionnaires qn JOIN questions q ON q.questionnaire_id=qn.id JOIN question_options o ON o.question_id=q.id
      WHERE qn.meetup_id=$1 AND qn.status='PUBLISHED' AND q.opens_at <= $2 AND q.closes_at > $2
      ${pausedRow ? "AND qn.id=$3" : ""}
      GROUP BY qn.id,q.id ORDER BY q.opens_at LIMIT 1`, pausedRow ? [id, clock.toISOString(), pausedRow.id] : [id, clock.toISOString()])).rows[0];
    if (open) {
      const [answer, answeredCount] = await Promise.all([
        pool.query(`SELECT a.id,a.option_id,o.label,(SELECT count(*)::int FROM answers WHERE question_id=a.question_id AND option_id=a.option_id) selected_count
          FROM answers a JOIN question_options o ON o.id=a.option_id WHERE a.user_id=$1 AND a.question_id=$2`, [user.id, open.question_id]).then((result) => result.rows[0]),
        pool.query("SELECT count(DISTINCT user_id)::int count FROM answers WHERE question_id=$1", [open.question_id]).then((result) => Number(result.rows[0].count)),
      ]);
      const tallies = answer ? await optionTallies(open.question_id) : null;
      noStore(reply);
      return { ...base, phase: "ANSWERING", answeredCount, phaseStartsAt: iso(open.opens_at), phaseEndsAt: iso(open.closes_at),
        questionCount: open.question_count, questionnaire: describe(open),
        question: { id: open.question_id, prompt: open.prompt, position: open.question_position, options: open.options },
        answer: answer ? { id: answer.id, optionId: answer.option_id, label: answer.label, selectedCount: answer.selected_count } : null,
        ...(tallies ? { tallies } : {}) };
    }
    const upcoming = (await pool.query(`SELECT qn.id,qn.position,qn.title,qn.starts_at,qn.ends_at,q.opens_at,q.closes_at
      FROM questionnaires qn JOIN questions q ON q.questionnaire_id=qn.id
      WHERE qn.meetup_id=$1 AND qn.status='PUBLISHED' AND q.opens_at > $2
      ORDER BY q.opens_at LIMIT 1`, [id, clock.toISOString()])).rows[0];
    const boundary = upcoming ? new Date(upcoming.opens_at) : new Date(meetup.ends_at);
    const review = boundary.getTime() > clock.getTime() ? await questionReview(id, user.id, clock, boundary) : null;
    noStore(reply);
    if (upcoming) return { ...base, phase: "WAITING", phaseEndsAt: iso(upcoming.opens_at), questionnaire: describe(upcoming), questionEndsAt: iso(upcoming.closes_at), ...(review ? { review } : {}) };
    if (now < new Date(meetup.ends_at)) return { ...base, phase: "WAITING", phaseEndsAt: iso(new Date(meetup.ends_at)), ...(review ? { review } : {}) };
    return { ...base, phase: "COMPLETED", phaseEndsAt: null };
  });

  const control = (action: "pause" | "resume" | "advance") => {
    app.post(`/meetups/:id/questionnaires/:questionnaireId/${action}`, async (request, reply) => {
      const user = requireUser(request);
      const { id, questionnaireId } = request.params as { id: string; questionnaireId: string };
      await transaction(async (client) => {
        const meetup = await ownedMeetup(client, id, user.id, true);
        if (meetup.status !== "PUBLISHED") throw new AppError(409, "MEETUP_UNAVAILABLE", "Meetup is not live");
        const now = new Date(meetup.db_now);
        if (action === "pause") await pauseQuestionnaire(client, id, questionnaireId, now);
        else if (action === "resume") await resumeQuestionnaire(client, id, questionnaireId, now);
        else {
          const question = (await client.query(`SELECT q.id FROM questions q JOIN questionnaires qn ON qn.id=q.questionnaire_id
            WHERE q.questionnaire_id=$1 AND q.meetup_id=$2 AND qn.status='PUBLISHED'
            AND q.opens_at <= COALESCE(qn.paused_at, $3::timestamptz) AND q.closes_at > COALESCE(qn.paused_at, $3::timestamptz)
            ORDER BY q.position LIMIT 1`, [questionnaireId, id, now.toISOString()])).rows[0] as { id: string } | undefined;
          if (!question) throw new AppError(409, "NOT_LIVE", "There is no open question to move past");
          const moved = await advanceQuestion(client, id, question.id, now);
          if (!moved) throw new AppError(409, "NOT_LIVE", "There is no open question to move past");
        }
      });
      await publishSchedule(id);
      noStore(reply);
      return { ok: true };
    });
  };
  control("pause");
  control("resume");
  control("advance");

  app.get("/meetups/:id/presence-stream", async (request, reply) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const allowed = await pool.query(`SELECT 1 FROM meetups m WHERE m.id=$1 AND m.status IN ('PUBLISHED','DRAFT') AND (m.owner_id=$2 OR EXISTS (
      SELECT 1 FROM meetup_members mm WHERE mm.meetup_id=m.id AND mm.user_id=$2))`, [id, user.id]);
    if (!allowed.rowCount) throw new AppError(403, "FORBIDDEN", "Join this meetup to see the room");
    const { raw, redis } = openStream(request, reply);
    await redis.subscribe(`meetup-presence:${id}`, `meetup-progress:${id}`, `meetup-notice:${id}`, `meetup-schedule:${id}`);
    redis.on("message", (channel: string, message: string) => {
      const event = channel.startsWith("meetup-progress:") ? "progress" : channel.startsWith("meetup-notice:") ? "questionnaire-stopped" : channel.startsWith("meetup-schedule:") ? "schedule" : "presence";
      raw.write(`event: ${event}\ndata: ${message}\n\n`);
    });
    const count = Number((await pool.query("SELECT count(*)::int count FROM meetup_members WHERE meetup_id=$1", [id])).rows[0].count);
    raw.write(`event: presence\ndata: ${JSON.stringify({ participantCount: count })}\n\n`);
  });

  app.get("/meetups/:id/host-stream", async (request, reply) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const owned = await pool.query("SELECT 1 FROM meetups WHERE id=$1 AND owner_id=$2", [id, user.id]);
    if (!owned.rowCount) throw new AppError(403, "FORBIDDEN", "Only the meetup host can watch answer counts");
    const { raw, redis } = openStream(request, reply);
    await redis.subscribe(`meetup-presence:${id}`, `meetup-answers:${id}`, `meetup-schedule:${id}`);
    redis.on("message", (channel: string, message: string) => {
      const event = channel.startsWith("meetup-answers:") ? "answer" : channel.startsWith("meetup-schedule:") ? "schedule" : "presence";
      raw.write(`event: ${event}\ndata: ${message}\n\n`);
    });
    const count = Number((await pool.query("SELECT count(*)::int count FROM meetup_members WHERE meetup_id=$1", [id])).rows[0].count);
    raw.write(`event: presence\ndata: ${JSON.stringify({ participantCount: count })}\n\n`);
  });

  app.get("/meetups/:id/questions/:questionId/options/:optionId/count-stream", async (request, reply) => {
    const user = requireUser(request);
    if (request.headers.origin && request.headers.origin !== config.WEB_ORIGIN) {
      throw new AppError(403, "INVALID_ORIGIN", "Request origin rejected");
    }
    const { id, questionId, optionId } = request.params as { id: string; questionId: string; optionId: string };
    const allowed = await pool.query(`SELECT 1 FROM answers a JOIN meetup_members mm ON mm.meetup_id=a.meetup_id AND mm.user_id=a.user_id
      WHERE a.meetup_id=$1 AND a.question_id=$2 AND a.option_id=$3 AND a.user_id=$4`, [id, questionId, optionId, user.id]);
    if (!allowed.rowCount) throw new AppError(403, "FORBIDDEN", "Count stream is only available for your selected option");
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store, private", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const channel = `answer-count:${questionId}:${optionId}`;
    const sendCount = async () => {
      const count = Number((await pool.query("SELECT count(*) count FROM answers WHERE question_id=$1 AND option_id=$2", [questionId, optionId])).rows[0].count);
      raw.write(`event: count\ndata: ${JSON.stringify({ count })}\n\n`);
    };
    await sendCount();
    const redis = subscriber.duplicate();
    await redis.subscribe(channel);
    redis.on("message", (_channel: string, message: string) => raw.write(`event: count\ndata: ${message}\n\n`));
    const heartbeat = setInterval(() => raw.write(": heartbeat\n\n"), 15_000);
    request.raw.on("close", () => { clearInterval(heartbeat); void redis.unsubscribe(channel).finally(() => redis.quit()); });
  });
}
