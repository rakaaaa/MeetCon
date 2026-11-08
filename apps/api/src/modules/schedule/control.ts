import type { PoolClient } from "pg";
import { AppError } from "../../lib.js";
import { publisher } from "../../redis.js";

type QuestionWindow = {
  id: string;
  position: number;
  opens_at: Date;
  closes_at: Date;
  questionnaire_id: string;
  paused_at: Date | null;
  ends_at: Date;
  status: string;
};

async function liveQuestion(client: PoolClient, meetupId: string, questionnaireId: string, clock: Date): Promise<QuestionWindow | undefined> {
  return (await client.query(`SELECT q.id, q.position, q.opens_at, q.closes_at, q.questionnaire_id, qn.paused_at, qn.ends_at, qn.status
    FROM questions q JOIN questionnaires qn ON qn.id=q.questionnaire_id
    WHERE q.meetup_id=$1 AND q.questionnaire_id=$2 AND q.opens_at <= $3 AND q.closes_at > $3
    ORDER BY q.position LIMIT 1`, [meetupId, questionnaireId, clock.toISOString()])).rows[0] as QuestionWindow | undefined;
}

async function shiftTail(client: PoolClient, meetupId: string, questionnaireId: string, afterPosition: number, oldEnd: Date, deltaMs: number): Promise<void> {
  if (deltaMs === 0) return;
  await client.query(`UPDATE questions SET opens_at = opens_at + ($2::bigint * interval '1 millisecond'),
    closes_at = closes_at + ($2::bigint * interval '1 millisecond'), updated_at=now()
    WHERE questionnaire_id=$1 AND position > $3`, [questionnaireId, deltaMs, afterPosition]);
  await client.query(`UPDATE questionnaires SET ends_at = ends_at + ($2::bigint * interval '1 millisecond'), updated_at=now() WHERE id=$1`, [questionnaireId, deltaMs]);
  const later = (await client.query("SELECT id FROM questionnaires WHERE meetup_id=$1 AND id<>$2 AND starts_at >= $3", [meetupId, questionnaireId, oldEnd.toISOString()])).rows as { id: string }[];
  for (const row of later) {
    await client.query(`UPDATE questionnaires SET starts_at = starts_at + ($2::bigint * interval '1 millisecond'),
      ends_at = ends_at + ($2::bigint * interval '1 millisecond'), updated_at=now() WHERE id=$1`, [row.id, deltaMs]);
    await client.query(`UPDATE questions SET opens_at = opens_at + ($2::bigint * interval '1 millisecond'),
      closes_at = closes_at + ($2::bigint * interval '1 millisecond'), updated_at=now() WHERE questionnaire_id=$1`, [row.id, deltaMs]);
  }
}

async function touchMeetup(client: PoolClient, meetupId: string): Promise<void> {
  await client.query(`UPDATE meetups SET
    starts_at = (SELECT min(starts_at) FROM questionnaires WHERE meetup_id=$1),
    ends_at = (SELECT max(ends_at) FROM questionnaires WHERE meetup_id=$1),
    version = version + 1, updated_at = now() WHERE id=$1`, [meetupId]);
}

export async function publishSchedule(meetupId: string): Promise<void> {
  await publisher.publish(`meetup-schedule:${meetupId}`, JSON.stringify({ at: new Date().toISOString() }));
}

export async function pauseQuestionnaire(client: PoolClient, meetupId: string, questionnaireId: string, now: Date): Promise<void> {
  const questionnaire = (await client.query("SELECT id, status, paused_at, starts_at, ends_at FROM questionnaires WHERE id=$1 AND meetup_id=$2 FOR UPDATE", [questionnaireId, meetupId])).rows[0] as { id: string; status: string; paused_at: Date | null; starts_at: Date; ends_at: Date } | undefined;
  if (!questionnaire || questionnaire.status !== "PUBLISHED") throw new AppError(409, "QUESTIONNAIRE_UNAVAILABLE", "This questionnaire is not live");
  if (questionnaire.paused_at) throw new AppError(409, "ALREADY_PAUSED", "This questionnaire is already paused");
  const question = await liveQuestion(client, meetupId, questionnaireId, now);
  if (!question) throw new AppError(409, "NOT_LIVE", "Pause is available while a question in this questionnaire is open");
  await client.query("UPDATE questionnaires SET paused_at=$2, updated_at=now() WHERE id=$1", [questionnaireId, now.toISOString()]);
  await touchMeetup(client, meetupId);
}

export async function resumeQuestionnaire(client: PoolClient, meetupId: string, questionnaireId: string, now: Date): Promise<void> {
  const questionnaire = (await client.query("SELECT id, status, paused_at, ends_at FROM questionnaires WHERE id=$1 AND meetup_id=$2 FOR UPDATE", [questionnaireId, meetupId])).rows[0] as { id: string; status: string; paused_at: Date | null; ends_at: Date } | undefined;
  if (!questionnaire?.paused_at) throw new AppError(409, "NOT_PAUSED", "This questionnaire is not paused");
  const pausedAt = new Date(questionnaire.paused_at);
  const question = await liveQuestion(client, meetupId, questionnaireId, pausedAt);
  if (!question) throw new AppError(409, "NOT_LIVE", "The paused question is no longer open");
  const delta = Math.max(0, now.getTime() - pausedAt.getTime());
  if (delta > 0) {
    await client.query("UPDATE questions SET closes_at = closes_at + ($2::bigint * interval '1 millisecond'), updated_at=now() WHERE id=$1", [question.id, delta]);
    await shiftTail(client, meetupId, questionnaireId, question.position, new Date(questionnaire.ends_at), delta);
  }
  await client.query("UPDATE questionnaires SET paused_at=NULL, updated_at=now() WHERE id=$1", [questionnaireId]);
  await touchMeetup(client, meetupId);
}

export async function advanceQuestion(client: PoolClient, meetupId: string, questionId: string, now: Date): Promise<boolean> {
  const question = (await client.query(`SELECT q.id, q.position, q.opens_at, q.closes_at, q.questionnaire_id, qn.paused_at, qn.ends_at, qn.status
    FROM questions q JOIN questionnaires qn ON qn.id=q.questionnaire_id
    WHERE q.id=$1 AND q.meetup_id=$2 FOR UPDATE OF q, qn`, [questionId, meetupId])).rows[0] as QuestionWindow | undefined;
  if (!question || question.status !== "PUBLISHED") return false;
  const opens = new Date(question.opens_at).getTime();
  const closes = new Date(question.closes_at).getTime();
  const nowMs = now.getTime();
  if (nowMs <= opens) return false;
  if (!question.paused_at && nowMs >= closes) return false;
  const delta = nowMs - closes;
  await client.query("UPDATE questions SET closes_at=$2, updated_at=now() WHERE id=$1", [question.id, now.toISOString()]);
  await shiftTail(client, meetupId, question.questionnaire_id, question.position, new Date(question.ends_at), delta);
  await client.query("UPDATE questionnaires SET paused_at=NULL, updated_at=now() WHERE id=$1", [question.questionnaire_id]);
  await touchMeetup(client, meetupId);
  return true;
}
