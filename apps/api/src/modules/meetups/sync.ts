import type { PoolClient } from "pg";
import { createDeterministicIntervals, type MeetupInput } from "@meetcon/shared";
import { AppError } from "../../lib.js";
import type { QuestionnaireNotice } from "../../questionnaire-notice.js";
import { stampQuestionWindows } from "../schedule/windows.js";

type QuestionnaireInput = MeetupInput["questionnaires"][number];
type QuestionnaireStatus = "DRAFT" | "PUBLISHED";
type StoredQuestion = { id: string; position: number; prompt: string; options: { position: number; label: string }[] };
type StoredQuestionnaire = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  status: QuestionnaireStatus;
  publishedOnce: boolean;
  assistantProvider: string | null;
  pausedAt: Date | null;
  questions: StoredQuestion[];
};

function sameMinute(left: Date, iso: string): boolean {
  const right = Date.parse(iso);
  return Number.isFinite(right) && Math.floor(left.getTime() / 60_000) === Math.floor(right / 60_000);
}

function questionSame(stored: StoredQuestion, incoming: { prompt: string; options: string[] } | undefined): boolean {
  if (!incoming) return false;
  const labels = [...stored.options].sort((left, right) => left.position - right.position).map((option) => option.label);
  return stored.prompt === incoming.prompt
    && incoming.options.length === labels.length
    && incoming.options.every((label, index) => label === labels[index]);
}

function questionsSame(stored: StoredQuestion[], incoming: QuestionnaireInput["questions"]): boolean {
  return stored.length === incoming.length && stored.every((question, index) => questionSame(question, incoming[index]));
}

function assertPublishable(item: QuestionnaireInput, now: number, allowCurrentWindow: boolean): void {
  const start = Date.parse(item.startsAt);
  const end = Date.parse(item.endsAt);
  if (start <= now && !allowCurrentWindow) throw new AppError(400, "START_NOT_FUTURE", "A published questionnaire must start in the future");
  if (!item.questions.length) throw new AppError(400, "QUESTIONS_REQUIRED", "Each published questionnaire needs at least one question");
  if ((end - start) / item.questions.length < 10_000) throw new AppError(400, "INTERVAL_TOO_SHORT", "Each question needs at least 10 seconds inside its questionnaire");
  for (const question of item.questions) {
    if (!question.prompt) throw new AppError(400, "QUESTIONS_REQUIRED", "Each question needs a prompt");
    if (question.options.some((option) => !option)) throw new AppError(400, "INVALID_OPTIONS", "All four options are required");
  }
}

async function loadQuestionnaires(client: PoolClient, meetupId: string): Promise<Map<string, StoredQuestionnaire>> {
  const rows = (await client.query(`SELECT qn.id,qn.title,qn.starts_at,qn.ends_at,qn.status,qn.published_once,qn.assistant_provider,qn.paused_at,
    q.id question_id,q.position question_position,q.prompt,o.position option_position,o.label
    FROM questionnaires qn LEFT JOIN questions q ON q.questionnaire_id=qn.id
    LEFT JOIN question_options o ON o.question_id=q.id
    WHERE qn.meetup_id=$1 ORDER BY qn.position,q.position,o.position`, [meetupId])).rows;
  const questionnaires = new Map<string, StoredQuestionnaire>();
  for (const row of rows) {
    let questionnaire = questionnaires.get(row.id);
    if (!questionnaire) {
      questionnaire = {
        id: row.id, title: row.title, startsAt: new Date(row.starts_at), endsAt: new Date(row.ends_at),
        status: row.status === "DRAFT" ? "DRAFT" : "PUBLISHED", publishedOnce: row.published_once === true,
        assistantProvider: row.assistant_provider, pausedAt: row.paused_at ? new Date(row.paused_at) : null, questions: [],
      };
      questionnaires.set(row.id, questionnaire);
    }
    if (!row.question_id) continue;
    let question = questionnaire.questions.find((item) => item.id === row.question_id);
    if (!question) {
      question = { id: row.question_id, position: row.question_position, prompt: row.prompt, options: [] };
      questionnaire.questions.push(question);
    }
    if (row.option_position != null) question.options.push({ position: row.option_position, label: row.label });
  }
  return questionnaires;
}

async function insertQuestions(client: PoolClient, meetupId: string, questionnaireId: string, questions: { prompt: string; options: string[] }[]): Promise<void> {
  const schedule = (await client.query("SELECT starts_at, ends_at FROM questionnaires WHERE id=$1", [questionnaireId])).rows[0] as { starts_at: Date; ends_at: Date } | undefined;
  const intervals = schedule && questions.length
    ? createDeterministicIntervals(new Date(schedule.starts_at).getTime(), new Date(schedule.ends_at).getTime(), questions.length)
    : [];
  for (let index = 0; index < questions.length; index++) {
    const question = questions[index];
    const interval = intervals[index];
    if (!question || !interval) continue;
    const row = (await client.query(`INSERT INTO questions(meetup_id,questionnaire_id,position,prompt,opens_at,closes_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [meetupId, questionnaireId, index + 1, question.prompt, new Date(interval.startMs).toISOString(), new Date(interval.endMs).toISOString()])).rows[0];
    for (let option = 0; option < question.options.length; option++) {
      await client.query(`INSERT INTO question_options(question_id,position,label) VALUES($1,$2,$3)`, [row.id, option + 1, question.options[option]]);
    }
  }
}

async function replaceQuestions(client: PoolClient, meetupId: string, questionnaireId: string, questions: { prompt: string; options: string[] }[]): Promise<void> {
  await client.query("DELETE FROM questions WHERE questionnaire_id=$1", [questionnaireId]);
  await insertQuestions(client, meetupId, questionnaireId, questions);
}

async function patchQuestions(client: PoolClient, meetupId: string, questionnaireId: string, stored: StoredQuestion[], incoming: { prompt: string; options: string[] }[], locked: number): Promise<void> {
  for (let index = locked; index < incoming.length; index++) {
    const next = incoming[index];
    const existing = stored[index];
    if (!next) continue;
    if (existing) {
      await client.query("UPDATE questions SET prompt=$2,position=$3 WHERE id=$1", [existing.id, next.prompt, index + 1]);
      for (let option = 0; option < next.options.length; option++) {
        await client.query("UPDATE question_options SET label=$3 WHERE question_id=$1 AND position=$2", [existing.id, option + 1, next.options[option]]);
      }
    } else {
      const row = (await client.query(`INSERT INTO questions(meetup_id,questionnaire_id,position,prompt,opens_at,closes_at)
        SELECT $1,$2,$3,$4,starts_at,starts_at + interval '1 millisecond' FROM questionnaires WHERE id=$2 RETURNING id`, [meetupId, questionnaireId, index + 1, next.prompt])).rows[0];
      for (let option = 0; option < next.options.length; option++) {
        await client.query(`INSERT INTO question_options(question_id,position,label) VALUES($1,$2,$3)`, [row.id, option + 1, next.options[option]]);
      }
    }
  }
  if (stored.length > incoming.length) {
    await client.query("DELETE FROM questions WHERE questionnaire_id=$1 AND position>$2", [questionnaireId, incoming.length]);
  }
  if (stored.length !== incoming.length) await stampQuestionWindows(client, questionnaireId);
}

export async function insertQuestionnaires(client: PoolClient, meetupId: string, questionnaires: QuestionnaireInput[], status: QuestionnaireStatus): Promise<void> {
  for (let index = 0; index < questionnaires.length; index++) {
    const questionnaire = questionnaires[index];
    if (!questionnaire) continue;
    const row = (await client.query(`INSERT INTO questionnaires(meetup_id,position,title,starts_at,ends_at,assistant_provider,status,published_once)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [meetupId, index + 1, questionnaire.title, questionnaire.startsAt, questionnaire.endsAt, questionnaire.assistantProvider ?? null, status, status === "PUBLISHED"])).rows[0];
    await insertQuestions(client, meetupId, row.id, questionnaire.questions);
  }
}

export async function syncQuestionnaires(client: PoolClient, meetupId: string, incoming: QuestionnaireInput[], options: { now: Date; forceStatus: QuestionnaireStatus | null }): Promise<QuestionnaireNotice[]> {
  const stored = await loadQuestionnaires(client, meetupId);
  const seen = new Set<string>();
  const notices: QuestionnaireNotice[] = [];
  const nowMs = options.now.getTime();
  for (const item of incoming) {
    if (!item.id) continue;
    if (seen.has(item.id) || !stored.has(item.id)) throw new AppError(400, "QUESTIONNAIRE_NOT_FOUND", "Questionnaire does not belong to this meetup");
    seen.add(item.id);
  }
  for (const questionnaire of stored.values()) {
    if (seen.has(questionnaire.id)) continue;
    if (questionnaire.endsAt.getTime() <= nowMs) throw new AppError(409, "QUESTIONNAIRE_LOCKED", "A questionnaire that has ended cannot be deleted");
    if (questionnaire.startsAt.getTime() <= nowMs && questionnaire.status === "PUBLISHED") notices.push({ reason: "DELETED", title: questionnaire.title });
  }

  const planned = await Promise.all(incoming.map(async (item, index) => {
    const existing = item.id ? stored.get(item.id) : undefined;
    const desired: QuestionnaireStatus = options.forceStatus ?? (existing ? (item.status ?? existing.status) : (item.status ?? "DRAFT"));
    const nextStart = Date.parse(item.startsAt);
    const phase = !existing ? "new" : existing.pausedAt ? "live" : existing.endsAt.getTime() <= nowMs ? "past" : existing.startsAt.getTime() > nowMs ? "future" : "live";
    const restart = !!existing && existing.startsAt.getTime() <= nowMs && nextStart > nowMs;
    const sameWindow = !!existing && sameMinute(existing.startsAt, item.startsAt) && sameMinute(existing.endsAt, item.endsAt);
    const republishSameWindow = desired === "PUBLISHED" && !!existing?.publishedOnce && phase === "live" && sameWindow;
    if (desired === "PUBLISHED" && !(phase === "past" && !restart)) assertPublishable(item, nowMs, republishSameWindow);
    if (existing && phase === "past" && !restart) {
      const assistantSame = item.assistantProvider === undefined || (item.assistantProvider ?? null) === existing.assistantProvider;
      const unchanged = existing.title === item.title && existing.status === desired && assistantSame && sameWindow && questionsSame(existing.questions, item.questions);
      if (!unchanged) throw new AppError(409, "QUESTIONNAIRE_LOCKED", "This questionnaire has ended. Move its start to a future time to edit it.");
    }
    let locked = 0;
    if (existing && phase === "live" && !restart) {
      if (existing.pausedAt) throw new AppError(409, "QUESTIONNAIRE_PAUSED", "Resume this questionnaire before editing it");
      if (!sameMinute(existing.startsAt, item.startsAt)) throw new AppError(409, "QUESTIONNAIRE_LOCKED", "Move the start to a future time to change when this questionnaire begins");
      locked = Number((await client.query("SELECT count(*)::int AS count FROM questions WHERE questionnaire_id=$1 AND closes_at<=$2", [existing.id, new Date(nowMs).toISOString()])).rows[0]?.count ?? 0);
      if (locked > 0 && !sameMinute(existing.endsAt, item.endsAt)) throw new AppError(409, "QUESTIONNAIRE_LOCKED", "Move the start to a future time to change this questionnaire's schedule");
      if (locked > 0 && item.questions.length !== existing.questions.length) throw new AppError(409, "QUESTIONNAIRE_LOCKED", "Question count cannot change while earlier questions have ended");
      for (let questionIndex = 0; questionIndex < locked; questionIndex++) {
        const storedQuestion = existing.questions[questionIndex];
        if (!storedQuestion || !questionSame(storedQuestion, item.questions[questionIndex])) throw new AppError(409, "QUESTIONNAIRE_LOCKED", "Questions that have already ended cannot be changed");
      }
      if (existing.status === "PUBLISHED" && desired === "DRAFT") notices.push({ reason: "DRAFT", title: item.title });
    }
    if (existing && phase === "live" && restart && existing.status === "PUBLISHED") notices.push({ reason: "DRAFT", title: existing.title });
    const assistant = item.assistantProvider === undefined ? (existing?.assistantProvider ?? null) : (item.assistantProvider ?? null);
    const questionsReplaced = !existing || restart || (phase === "future" && !questionsSame(existing.questions, item.questions));
    const restamp = !!existing && !questionsReplaced && locked === 0 && !sameWindow;
    return { item, existing, desired, phase, restart, position: index + 1, assistant, locked, restamp };
  }));

  await client.query("UPDATE questionnaires SET position=position+100 WHERE meetup_id=$1", [meetupId]);
  for (const questionnaire of stored.values()) {
    if (!seen.has(questionnaire.id)) await client.query("DELETE FROM questionnaires WHERE id=$1", [questionnaire.id]);
  }
  for (const plan of planned) {
    const publishedOnce = (plan.existing?.publishedOnce ?? false) || plan.desired === "PUBLISHED";
    if (!plan.existing) {
      const row = (await client.query(`INSERT INTO questionnaires(meetup_id,position,title,starts_at,ends_at,assistant_provider,status,published_once)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [meetupId, plan.position, plan.item.title, plan.item.startsAt, plan.item.endsAt, plan.assistant, plan.desired, publishedOnce])).rows[0];
      await insertQuestions(client, meetupId, row.id, plan.item.questions);
      continue;
    }
    await client.query(`UPDATE questionnaires SET position=$2,title=$3,starts_at=$4,ends_at=$5,assistant_provider=$6,status=$7,published_once=$8,updated_at=now()
      WHERE id=$1`, [plan.existing.id, plan.position, plan.item.title, plan.item.startsAt, plan.item.endsAt, plan.assistant, plan.desired, publishedOnce]);
    if (plan.restart || (plan.phase === "future" && !questionsSame(plan.existing.questions, plan.item.questions))) {
      await replaceQuestions(client, meetupId, plan.existing.id, plan.item.questions);
    } else if (plan.phase === "live") {
      if (!questionsSame(plan.existing.questions, plan.item.questions)) await patchQuestions(client, meetupId, plan.existing.id, plan.existing.questions, plan.item.questions, plan.locked);
    }
    if (plan.restamp) await stampQuestionWindows(client, plan.existing.id);
  }
  return notices;
}
