import type { FastifyInstance } from "fastify";
import { config } from "../../config.js";
import { pool } from "../../db/index.js";
import { AppError, iso, noStore, requireUser } from "../../lib.js";
import { subscriber } from "../../redis.js";

function boundary(start: Date, end: Date, position: number, count: number): [Date, Date] {
  const duration = end.getTime() - start.getTime();
  return [new Date(Math.floor(start.getTime() + duration * (position - 1) / count)), new Date(Math.floor(start.getTime() + duration * position / count))];
}

export async function liveStateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/meetups/:id/active", async (request, reply) => {
    const user = requireUser(request, "USER"), { id } = request.params as { id: string };
    const result = await pool.query(`SELECT m.*,clock_timestamp() db_now,u.display_name organizer,
      (SELECT count(*) FROM questions WHERE meetup_id=m.id)::int question_count,
      (SELECT count(*) FROM meetup_members WHERE meetup_id=m.id)::int member_count
      FROM meetup_members mm JOIN meetups m ON m.id=mm.meetup_id JOIN users u ON u.id=m.owner_id
      WHERE mm.meetup_id=$1 AND mm.user_id=$2`, [id, user.id]);
    const meetup = result.rows[0];
    if (!meetup) throw new AppError(404, "NOT_FOUND", "Meetup not found");
    if (meetup.status === "CANCELLED") throw new AppError(410, "MEETUP_CANCELLED", "Meetup was cancelled");
    const now = new Date(meetup.db_now), start = new Date(meetup.starts_at), end = new Date(meetup.ends_at);
    const base: any = { meetup: { id, title: meetup.title, organizer: meetup.organizer, startsAt: iso(start), endsAt: iso(end) }, serverTime: iso(now), participantCount: meetup.member_count };
    if (now < start) { noStore(reply); return { ...base, phase: "WAITING", phaseEndsAt: iso(start) }; }
    if (now >= end || !meetup.question_count) { noStore(reply); return { ...base, phase: "COMPLETED", phaseEndsAt: null }; }
    const elapsed = now.getTime() - start.getTime(), duration = end.getTime() - start.getTime();
    const position = Math.min(meetup.question_count, Math.floor(elapsed * meetup.question_count / duration) + 1);
    const [intervalStart, intervalEnd] = boundary(start, end, position, meetup.question_count);
    const question = (await pool.query(`SELECT q.id,q.prompt,q.position,json_agg(json_build_object('id',o.id,'position',o.position,'label',o.label) ORDER BY o.position) options
      FROM questions q JOIN question_options o ON o.question_id=q.id WHERE q.meetup_id=$1 AND q.position=$2 GROUP BY q.id`, [id, position])).rows[0];
    if (!question) { noStore(reply); return { ...base, phase: "COMPLETED", phaseEndsAt: null }; }
    const answer = (await pool.query(`SELECT a.id,a.option_id,o.label,(SELECT count(*)::int FROM answers WHERE question_id=a.question_id AND option_id=a.option_id) selected_count
      FROM answers a JOIN question_options o ON o.id=a.option_id WHERE a.user_id=$1 AND a.question_id=$2`, [user.id, question.id])).rows[0];
    noStore(reply); return { ...base, phase: "ANSWERING", phaseStartsAt: iso(intervalStart), phaseEndsAt: iso(intervalEnd),
      questionCount: meetup.question_count, question, answer: answer ? { id: answer.id, optionId: answer.option_id, label: answer.label, selectedCount: answer.selected_count } : null };
  });

  app.get("/meetups/:id/questions/:questionId/options/:optionId/count-stream", async (request, reply) => {
    const user = requireUser(request, "USER");
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
