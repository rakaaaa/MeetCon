import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { MeetupInputSchema, UpdateMeetupSchema, createDeterministicIntervals } from "@meetcon/shared";
import { config } from "../../config.js";
import { pool, transaction } from "../../db/index.js";
import { AppError, decryptToken, encryptToken, iso, noStore, ownedMeetup, requireUser, sha256, token } from "../../lib.js";

function validatePublish(input: { status: string; startsAt: string; endsAt: string; questions: unknown[] }): void {
  if (input.status === "DRAFT") return;
  const start = Date.parse(input.startsAt), end = Date.parse(input.endsAt);
  if (start <= Date.now()) throw new AppError(400, "START_NOT_FUTURE", "Published meetups must start in the future");
  if (!input.questions.length) throw new AppError(400, "QUESTIONS_REQUIRED", "Published meetups require questions");
  if ((end - start) / input.questions.length < 10_000) throw new AppError(400, "INTERVAL_TOO_SHORT", "Each question needs at least 10 seconds");
}
async function insertQuestions(client: any, meetupId: string, questions: { prompt: string; options: string[] }[]) {
  for (let index = 0; index < questions.length; index++) {
    const question = questions[index]!;
    const row = (await client.query(`INSERT INTO questions(meetup_id,position,prompt) VALUES($1,$2,$3) RETURNING id`, [meetupId, index + 1, question.prompt])).rows[0];
    for (let option = 0; option < 4; option++) await client.query(
      `INSERT INTO question_options(question_id,position,label) VALUES($1,$2,$3)`, [row.id, option + 1, question.options[option]]);
  }
}
const shape = (row: any) => ({
  id: row.id, title: row.title, publicCode: String(row.public_code), startsAt: iso(row.starts_at), endsAt: iso(row.ends_at),
  sourceTimeZone: row.source_time_zone, status: row.status, version: row.version, createdAt: iso(row.created_at),
  questionCount: Number(row.question_count ?? 0), memberCount: Number(row.member_count ?? 0),
});

export async function meetupRoutes(app: FastifyInstance): Promise<void> {
  app.post("/meetups", async (request, reply) => {
    const user = requireUser(request, "ADMIN"), input = MeetupInputSchema.parse(request.body); validatePublish(input);
    const created = await transaction(async (client) => {
      const raw = token(36);
      let row: any;
      for (let attempt = 0; attempt < 20 && !row; attempt++) {
        const code = randomInt(10_000_000, 100_000_000);
        row = (await client.query(`INSERT INTO meetups(owner_id,public_code,join_token_hash,join_token_ciphertext,title,
          starts_at,ends_at,source_time_zone,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT(public_code) DO NOTHING RETURNING *`,
        [user.id, code, sha256(raw), encryptToken(raw), input.title, input.startsAt, input.endsAt, input.sourceTimeZone, input.status])).rows[0];
      }
      if (!row) throw new AppError(503, "CODE_EXHAUSTED", "Could not allocate an invitation code");
      await insertQuestions(client, row.id, input.questions);
      return { ...shape(row), joinToken: raw };
    });
    const { joinToken, ...meetup } = created;
    noStore(reply); return reply.code(201).send({ ...meetup, joinUrl: `${config.WEB_ORIGIN}/join/${joinToken}` });
  });
  app.get("/meetups", async (request, reply) => {
    const user = requireUser(request, "ADMIN");
    const rows = (await pool.query(`SELECT m.*,count(DISTINCT q.id) question_count,count(DISTINCT mm.id) member_count
      FROM meetups m LEFT JOIN questions q ON q.meetup_id=m.id LEFT JOIN meetup_members mm ON mm.meetup_id=m.id
      WHERE m.owner_id=$1 GROUP BY m.id ORDER BY m.starts_at DESC`, [user.id])).rows;
    noStore(reply); return { meetups: rows.map(shape), serverTime: new Date().toISOString() };
  });
  app.get("/meetups/:id", async (request, reply) => {
    const user = requireUser(request, "ADMIN"), { id } = request.params as { id: string };
    const result = await pool.query(`SELECT m.*,q.id question_id,q.position,q.prompt,o.id option_id,o.position option_position,o.label
      FROM meetups m LEFT JOIN questions q ON q.meetup_id=m.id LEFT JOIN question_options o ON o.question_id=q.id
      WHERE m.id=$1 AND m.owner_id=$2 ORDER BY q.position,o.position`, [id, user.id]);
    if (!result.rowCount) throw new AppError(404, "NOT_FOUND", "Meetup not found");
    const first = result.rows[0], questions = new Map<string, any>();
    for (const row of result.rows) if (row.question_id) {
      if (!questions.has(row.question_id)) questions.set(row.question_id, { id: row.question_id, position: row.position, prompt: row.prompt, options: [] });
      questions.get(row.question_id).options.push({ id: row.option_id, position: row.option_position, label: row.label });
    }
    const joinToken = decryptToken(first.join_token_ciphertext); noStore(reply);
    const intervals = createDeterministicIntervals(new Date(first.starts_at).getTime(), new Date(first.ends_at).getTime(), Math.max(questions.size, 1));
    return { ...shape({ ...first, question_count: questions.size }), questions: [...questions.values()], intervals, joinUrl: `${config.WEB_ORIGIN}/join/${joinToken}` };
  });
  app.put("/meetups/:id", async (request) => {
    const user = requireUser(request, "ADMIN"), { id } = request.params as { id: string };
    const input = UpdateMeetupSchema.parse(request.body); validatePublish(input);
    return transaction(async (client) => {
      const meetup = await ownedMeetup(client, id, user.id, true);
      if (meetup.status === "CANCELLED") throw new AppError(409, "MEETUP_CANCELLED", "Cancelled meetups cannot be edited");
      if (new Date(meetup.db_now) >= new Date(meetup.starts_at)) throw new AppError(409, "MEETUP_STARTED", "Started meetups are read-only");
      if (meetup.version !== input.version) throw new AppError(409, "VERSION_CONFLICT", "Meetup was changed elsewhere", { currentVersion: meetup.version });
      await client.query("DELETE FROM questions WHERE meetup_id=$1", [id]);
      await insertQuestions(client, id, input.questions);
      const row = (await client.query(`UPDATE meetups SET title=$2,starts_at=$3,ends_at=$4,source_time_zone=$5,status=$6,
        version=version+1,updated_at=now() WHERE id=$1 RETURNING *`, [id, input.title, input.startsAt, input.endsAt, input.sourceTimeZone, input.status])).rows[0];
      return shape({ ...row, question_count: input.questions.length });
    });
  });
  app.post("/meetups/:id/publish", async (request) => {
    const user = requireUser(request, "ADMIN"), { id } = request.params as { id: string };
    return transaction(async (client) => {
      const meetup = await ownedMeetup(client, id, user.id, true);
      const count = Number((await client.query("SELECT count(*) count FROM questions WHERE meetup_id=$1", [id])).rows[0].count);
      validatePublish({ status: "PUBLISHED", startsAt: iso(meetup.starts_at), endsAt: iso(meetup.ends_at), questions: Array(count) });
      const invalid = await client.query(`SELECT q.id FROM questions q LEFT JOIN question_options o ON o.question_id=q.id
        WHERE q.meetup_id=$1 GROUP BY q.id HAVING count(o.id)<>4`, [id]);
      if (invalid.rowCount) throw new AppError(400, "INVALID_OPTIONS", "Every question must have exactly four options");
      await client.query("UPDATE meetups SET status='PUBLISHED',version=version+1,updated_at=now() WHERE id=$1", [id]);
      return { status: "PUBLISHED" };
    });
  });
  app.post("/meetups/:id/cancel", async (request) => {
    const user = requireUser(request, "ADMIN"), { id } = request.params as { id: string };
    const result = await pool.query(`UPDATE meetups SET status='CANCELLED',cancelled_at=clock_timestamp(),updated_at=now(),version=version+1
      WHERE id=$1 AND owner_id=$2 AND status<>'CANCELLED' RETURNING id,status,version`, [id, user.id]);
    if (!result.rowCount) throw new AppError(404, "NOT_FOUND", "Meetup not found");
    return result.rows[0];
  });
  app.delete("/meetups/:id", async (request, reply) => {
    const user = requireUser(request, "ADMIN"), { id } = request.params as { id: string };
    const result = await pool.query(`DELETE FROM meetups WHERE id=$1 AND owner_id=$2 AND status='DRAFT' AND starts_at>clock_timestamp() RETURNING id`, [id, user.id]);
    if (!result.rowCount) throw new AppError(409, "NOT_DELETABLE", "Only future drafts can be deleted");
    return reply.code(204).send();
  });
}
