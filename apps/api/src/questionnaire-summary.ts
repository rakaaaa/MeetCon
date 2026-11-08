import { iso } from "./lib.js";

export const questionnaireSummarySql = `COALESCE((
  SELECT json_agg(json_build_object(
    'id', qn.id,
    'title', qn.title,
    'position', qn.position,
    'startsAt', qn.starts_at,
    'endsAt', qn.ends_at,
    'status', qn.status,
    'pausedAt', qn.paused_at,
    'questionCount', (SELECT count(*)::int FROM questions q WHERE q.questionnaire_id=qn.id),
    'answeredCount', (SELECT count(DISTINCT a.user_id)::int FROM answers a JOIN questions q ON q.id=a.question_id WHERE q.questionnaire_id=qn.id)
  ) ORDER BY qn.position)
  FROM questionnaires qn WHERE qn.meetup_id=m.id
), '[]'::json)`;

export function questionnaireSummaries(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { id?: unknown; title?: unknown; position?: unknown; startsAt?: unknown; endsAt?: unknown; status?: unknown; questionCount?: unknown; answeredCount?: unknown; pausedAt?: unknown };
    if (typeof row.id !== "string" || (typeof row.startsAt !== "string" && !(row.startsAt instanceof Date)) || (typeof row.endsAt !== "string" && !(row.endsAt instanceof Date))) return [];
    const pausedAt = typeof row.pausedAt === "string" || row.pausedAt instanceof Date ? iso(row.pausedAt) : null;
    return [{
      id: row.id,
      title: typeof row.title === "string" ? row.title : "",
      position: Number(row.position ?? 0),
      startsAt: iso(row.startsAt),
      endsAt: iso(row.endsAt),
      status: row.status === "DRAFT" ? "DRAFT" as const : "PUBLISHED" as const,
      questionCount: Number(row.questionCount ?? 0),
      answeredCount: Number(row.answeredCount ?? 0),
      pausedAt,
    }];
  });
}
