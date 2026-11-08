import type { PoolClient } from "pg";
import { createDeterministicIntervals } from "@meetcon/shared";

export async function stampQuestionWindows(client: PoolClient, questionnaireId: string): Promise<void> {
  const schedule = (await client.query("SELECT starts_at, ends_at FROM questionnaires WHERE id=$1", [questionnaireId])).rows[0] as { starts_at: Date; ends_at: Date } | undefined;
  const questions = (await client.query("SELECT id FROM questions WHERE questionnaire_id=$1 ORDER BY position", [questionnaireId])).rows as { id: string }[];
  if (!schedule || !questions.length) return;
  const intervals = createDeterministicIntervals(new Date(schedule.starts_at).getTime(), new Date(schedule.ends_at).getTime(), questions.length);
  for (let index = 0; index < questions.length; index++) {
    const question = questions[index];
    const interval = intervals[index];
    if (!question || !interval) continue;
    await client.query("UPDATE questions SET opens_at=$2, closes_at=$3, updated_at=now() WHERE id=$1", [
      question.id, new Date(interval.startMs).toISOString(), new Date(interval.endMs).toISOString(),
    ]);
  }
}
