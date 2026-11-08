import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { MeetupInputSchema, UpdateMeetupSchema, createDeterministicIntervals } from "@meetcon/shared";
import { config } from "../../config.js";
import { pool, transaction } from "../../db/index.js";
import { AppError, decryptToken, encryptToken, iso, noStore, ownedMeetup, requireUser, sha256, token } from "../../lib.js";
import { generateMeetupQuestion } from "./generate.js";
import { questionnaireSummaries, questionnaireSummarySql } from "../../questionnaire-summary.js";
import { publishQuestionnaireStop } from "../../questionnaire-notice.js";
import { insertQuestionnaires, syncQuestionnaires } from "./sync.js";

function validatePublish(input: { status: string; questionnaires: { startsAt: string; endsAt: string; questions: unknown[] }[] }): void {
  if (input.status === "DRAFT") return;
  if (!input.questionnaires.length) throw new AppError(400, "QUESTIONS_REQUIRED", "Published meetups need a questionnaire");
  const ordered = [...input.questionnaires].sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  const first = ordered[0];
  if (!first || Date.parse(first.startsAt) <= Date.now()) throw new AppError(400, "START_NOT_FUTURE", "The first questionnaire must start in the future");
  for (let index = 0; index < ordered.length; index++) {
    const item = ordered[index]!;
    const start = Date.parse(item.startsAt);
    const end = Date.parse(item.endsAt);
    const previous = ordered[index - 1];
    if (previous && start < Date.parse(previous.endsAt)) throw new AppError(400, "QUESTIONNAIRES_OVERLAP", "Questionnaires cannot overlap.");
    if (!item.questions.length) throw new AppError(400, "QUESTIONS_REQUIRED", "Each questionnaire needs at least one question");
    if ((end - start) / item.questions.length < 10_000) throw new AppError(400, "INTERVAL_TOO_SHORT", "Each question needs at least 10 seconds inside its questionnaire");
  }
}
function envelope(questionnaires: { startsAt: string; endsAt: string }[]) {
  const starts = questionnaires.map((item) => Date.parse(item.startsAt));
  const ends = questionnaires.map((item) => Date.parse(item.endsAt));
  return { startsAt: new Date(Math.min(...starts)).toISOString(), endsAt: new Date(Math.max(...ends)).toISOString() };
}
const shape = (row: any) => ({
  id: row.id, title: row.title, ...(row.status === "DRAFT" ? {} : { publicCode: String(row.public_code) }), startsAt: iso(row.starts_at), endsAt: iso(row.ends_at),
  sourceTimeZone: row.source_time_zone, status: row.status, version: row.version, createdAt: iso(row.created_at),
  questionCount: Number(row.question_count ?? 0), questionnaireCount: Number(row.questionnaire_count ?? 0), memberCount: Number(row.member_count ?? 0),
});
function questionCountOf(questionnaires: { questions: unknown[] }[]) {
  return questionnaires.reduce((sum, questionnaire) => sum + questionnaire.questions.length, 0);
}

export async function meetupRoutes(app: FastifyInstance): Promise<void> {
  app.post("/meetups/questions/generate", { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } }, async (request) => {
    const user = requireUser(request);
    return generateMeetupQuestion(user.id, request.body);
  });
  app.post("/meetups", async (request, reply) => {
    const user = requireUser(request), input = MeetupInputSchema.parse(request.body); validatePublish(input);
    const window = envelope(input.questionnaires);
    const created = await transaction(async (client) => {
      const raw = token(36);
      let row: any;
      for (let attempt = 0; attempt < 20 && !row; attempt++) {
        const code = randomInt(10_000_000, 100_000_000);
        row = (await client.query(`INSERT INTO meetups(owner_id,public_code,join_token_hash,join_token_ciphertext,title,
          starts_at,ends_at,source_time_zone,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT(public_code) DO NOTHING RETURNING *`,
        [user.id, code, sha256(raw), encryptToken(raw), input.title, window.startsAt, window.endsAt, input.sourceTimeZone, input.status])).rows[0];
      }
      if (!row) throw new AppError(503, "CODE_EXHAUSTED", "Could not allocate an invitation code");
      await insertQuestionnaires(client, row.id, input.questionnaires, input.status);
      return { ...shape({ ...row, question_count: questionCountOf(input.questionnaires), questionnaire_count: input.questionnaires.length }), joinToken: raw };
    });
    const { joinToken, ...meetup } = created;
    noStore(reply); return reply.code(201).send({ ...meetup, ...(meetup.status === "DRAFT" ? {} : { joinUrl: `${config.WEB_ORIGIN}/join/${joinToken}` }) });
  });
  app.get("/meetups", async (request, reply) => {
    const user = requireUser(request);
    const [listed, scored] = await Promise.all([
      pool.query(`SELECT m.*,count(DISTINCT q.id) question_count,count(DISTINCT qn.id) questionnaire_count,count(DISTINCT mm.id) member_count,
        ${questionnaireSummarySql} questionnaires
        FROM meetups m LEFT JOIN questions q ON q.meetup_id=m.id LEFT JOIN questionnaires qn ON qn.meetup_id=m.id
        LEFT JOIN meetup_members mm ON mm.meetup_id=m.id
        WHERE m.owner_id=$1 GROUP BY m.id ORDER BY m.starts_at DESC`, [user.id]),
      pool.query(`SELECT q.questionnaire_id,q.id question_id,q.position question_position,q.prompt,
        o.id option_id,o.position option_position,o.label,count(a.id)::int option_count
        FROM questions q
        JOIN meetups m ON m.id=q.meetup_id AND m.owner_id=$1
        JOIN questionnaires qn ON qn.id=q.questionnaire_id
        JOIN question_options o ON o.question_id=q.id
        LEFT JOIN answers a ON a.option_id=o.id
        GROUP BY qn.position,q.id,o.id
        ORDER BY qn.position,q.position,o.position`, [user.id]),
    ]);
    const questionsByQuestionnaire = new Map<string, Map<string, { id: string; position: number; prompt: string; options: { id: string; position: number; label: string; count: number }[] }>>();
    for (const row of scored.rows as { questionnaire_id: string; question_id: string; question_position: number; prompt: string; option_id: string; option_position: number; label: string; option_count: number }[]) {
      let questions = questionsByQuestionnaire.get(row.questionnaire_id);
      if (!questions) {
        questions = new Map();
        questionsByQuestionnaire.set(row.questionnaire_id, questions);
      }
      let question = questions.get(row.question_id);
      if (!question) {
        question = { id: row.question_id, position: row.question_position, prompt: row.prompt, options: [] };
        questions.set(row.question_id, question);
      }
      question.options.push({ id: row.option_id, position: row.option_position, label: row.label, count: Number(row.option_count) });
    }
    noStore(reply);
    return {
      meetups: listed.rows.map((row) => ({
        ...shape(row),
        questionnaires: questionnaireSummaries(row.questionnaires).map((questionnaire) => ({
          ...questionnaire,
          questions: [...(questionsByQuestionnaire.get(questionnaire.id)?.values() ?? [])].map((question) => ({
            ...question,
            answered: question.options.reduce((sum, option) => sum + option.count, 0),
          })),
        })),
      })),
      serverTime: new Date().toISOString(),
    };
  });
  app.get("/meetups/:id", async (request, reply) => {
    const user = requireUser(request), { id } = request.params as { id: string };
    const result = await pool.query(`SELECT m.*,(SELECT count(*) FROM meetup_members WHERE meetup_id=m.id) member_count,
      qn.id questionnaire_id,qn.position questionnaire_position,qn.title questionnaire_title,qn.starts_at questionnaire_starts,qn.ends_at questionnaire_ends,qn.assistant_provider,qn.status questionnaire_status,qn.published_once,qn.paused_at,
      q.id question_id,q.position,q.prompt,o.id option_id,o.position option_position,o.label
      FROM meetups m LEFT JOIN questionnaires qn ON qn.meetup_id=m.id
      LEFT JOIN questions q ON q.questionnaire_id=qn.id LEFT JOIN question_options o ON o.question_id=q.id
      WHERE m.id=$1 AND m.owner_id=$2 ORDER BY qn.position,q.position,o.position`, [id, user.id]);
    if (!result.rowCount) throw new AppError(404, "NOT_FOUND", "Meetup not found");
    const first = result.rows[0], questionnaires = new Map<string, any>();
    for (const row of result.rows) if (row.questionnaire_id) {
      if (!questionnaires.has(row.questionnaire_id)) questionnaires.set(row.questionnaire_id, {
        id: row.questionnaire_id, position: row.questionnaire_position, title: row.questionnaire_title,
        startsAt: iso(row.questionnaire_starts), endsAt: iso(row.questionnaire_ends), assistantProvider: row.assistant_provider,
        status: row.questionnaire_status === "DRAFT" ? "DRAFT" : "PUBLISHED", publishedOnce: row.published_once === true,
        pausedAt: row.paused_at ? iso(row.paused_at) : null, questions: new Map(),
      });
      if (!row.question_id) continue;
      const questionnaire = questionnaires.get(row.questionnaire_id);
      if (!questionnaire.questions.has(row.question_id)) questionnaire.questions.set(row.question_id, { id: row.question_id, position: row.position, prompt: row.prompt, options: [] });
      if (row.option_id) questionnaire.questions.get(row.question_id).options.push({ id: row.option_id, position: row.option_position, label: row.label });
    }
    const listed = [...questionnaires.values()].map((questionnaire) => {
      const questions = [...questionnaire.questions.values()];
      const intervals = questions.length
        ? createDeterministicIntervals(Date.parse(questionnaire.startsAt), Date.parse(questionnaire.endsAt), questions.length)
        : [];
      return { ...questionnaire, questions, intervals };
    });
    noStore(reply);
    const shaped = shape({ ...first, question_count: listed.reduce((sum, questionnaire) => sum + questionnaire.questions.length, 0), questionnaire_count: listed.length });
    return {
      ...shaped,
      questionnaires: listed,
      ...(first.status === "DRAFT" ? {} : { joinUrl: `${config.WEB_ORIGIN}/join/${decryptToken(first.join_token_ciphertext)}` }),
    };
  });
  app.put("/meetups/:id", async (request) => {
    const user = requireUser(request), { id } = request.params as { id: string };
    const input = UpdateMeetupSchema.parse(request.body);
    const window = envelope(input.questionnaires);
    const saved = await transaction(async (client) => {
      const meetup = await ownedMeetup(client, id, user.id, true);
      if (meetup.status === "CANCELLED") throw new AppError(409, "MEETUP_CANCELLED", "Cancelled meetups cannot be edited");
      if (meetup.version !== input.version) throw new AppError(409, "VERSION_CONFLICT", "Meetup was changed elsewhere", { currentVersion: meetup.version });
      const now = new Date(meetup.db_now);
      const started = await client.query("SELECT 1 FROM questionnaires WHERE meetup_id=$1 AND starts_at<=$2 LIMIT 1", [id, now.toISOString()]);
      if ((started.rowCount ?? 0) > 0 && input.sourceTimeZone !== meetup.source_time_zone) {
        throw new AppError(409, "TIME_ZONE_LOCKED", "The time zone cannot change after a questionnaire has started");
      }
      const publishing = meetup.status !== "PUBLISHED" && input.status === "PUBLISHED";
      if (publishing) validatePublish({ ...input, status: "PUBLISHED" });
      const status = meetup.status === "PUBLISHED" ? "PUBLISHED" : input.status;
      const stops = await syncQuestionnaires(client, id, input.questionnaires, { now, forceStatus: publishing ? "PUBLISHED" : status === "DRAFT" ? "DRAFT" : null });
      const row = (await client.query(`UPDATE meetups SET title=$2,starts_at=$3,ends_at=$4,source_time_zone=$5,status=$6,
        version=version+1,updated_at=now() WHERE id=$1 RETURNING *`, [id, input.title, window.startsAt, window.endsAt, input.sourceTimeZone, status])).rows[0];
      return { meetup: shape({ ...row, question_count: questionCountOf(input.questionnaires), questionnaire_count: input.questionnaires.length }), stops };
    });
    await Promise.all(saved.stops.map((stop) => publishQuestionnaireStop(id, stop)));
    return saved.meetup;
  });
  app.post("/meetups/:id/publish", async (request) => {
    const user = requireUser(request), { id } = request.params as { id: string };
    return transaction(async (client) => {
      const meetup = await ownedMeetup(client, id, user.id, true);
      const forms = (await client.query(`SELECT qn.starts_at,qn.ends_at,count(q.id)::int question_count,
        count(q.id) FILTER (WHERE btrim(q.prompt)='')::int blank_prompts
        FROM questionnaires qn LEFT JOIN questions q ON q.questionnaire_id=qn.id
        WHERE qn.meetup_id=$1 GROUP BY qn.id,qn.starts_at,qn.ends_at`, [id])).rows;
      validatePublish({
        status: "PUBLISHED",
        questionnaires: forms.map((row) => ({ startsAt: iso(row.starts_at), endsAt: iso(row.ends_at), questions: Array(Number(row.question_count)) })),
      });
      if (forms.some((row) => Number(row.blank_prompts) > 0)) throw new AppError(400, "QUESTIONS_REQUIRED", "Each question needs a prompt");
      const invalid = await client.query(`SELECT q.id FROM questions q LEFT JOIN question_options o ON o.question_id=q.id
        WHERE q.meetup_id=$1 GROUP BY q.id HAVING count(o.id)<>4`, [id]);
      if (invalid.rowCount) throw new AppError(400, "INVALID_OPTIONS", "Every question must have exactly four options");
      if (meetup.status === "CANCELLED") throw new AppError(409, "MEETUP_CANCELLED", "Cancelled meetups cannot be edited");
      await client.query("UPDATE meetups SET status='PUBLISHED',version=version+1,updated_at=now() WHERE id=$1", [id]);
      await client.query("UPDATE questionnaires SET status='PUBLISHED',published_once=true,updated_at=now() WHERE meetup_id=$1", [id]);
      return { status: "PUBLISHED" };
    });
  });
  app.post("/meetups/:id/cancel", async (request) => {
    const user = requireUser(request), { id } = request.params as { id: string };
    const result = await pool.query(`UPDATE meetups SET status='CANCELLED',cancelled_at=clock_timestamp(),updated_at=now(),version=version+1
      WHERE id=$1 AND owner_id=$2 AND status<>'CANCELLED' RETURNING id,status,version`, [id, user.id]);
    if (!result.rowCount) throw new AppError(404, "NOT_FOUND", "Meetup not found");
    return result.rows[0];
  });
  app.delete("/meetups/:id", async (request, reply) => {
    const user = requireUser(request), { id } = request.params as { id: string };
    const result = await pool.query(`DELETE FROM meetups WHERE id=$1 AND owner_id=$2 AND status='DRAFT' AND starts_at>clock_timestamp() RETURNING id`, [id, user.id]);
    if (!result.rowCount) throw new AppError(409, "NOT_DELETABLE", "Only future drafts can be deleted");
    return reply.code(204).send();
  });
}
