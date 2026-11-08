import type { FastifyInstance } from "fastify";
import { pool } from "../../db/index.js";
import { AppError, iso, noStore, requireUser } from "../../lib.js";

const csv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
async function resultRows(id: string, ownerId: string) {
  const meetup = (await pool.query(`SELECT m.*,owner.time_zone viewer_time_zone,clock_timestamp() server_time,
    (SELECT count(*)::int FROM meetup_members WHERE meetup_id=m.id) joined_count
    FROM meetups m JOIN users owner ON owner.id=m.owner_id WHERE m.id=$1 AND m.owner_id=$2`, [id, ownerId])).rows[0];
  if (!meetup) throw new AppError(404, "NOT_FOUND", "Meetup not found");
  const rows = (await pool.query(`SELECT qn.id questionnaire_id,qn.position questionnaire_position,qn.title questionnaire_title,qn.assistant_provider,
    qn.starts_at questionnaire_starts,qn.ends_at questionnaire_ends,qn.status questionnaire_status,qn.paused_at,
    q.id question_id,q.position question_position,q.prompt,q.opens_at question_opens,q.closes_at question_closes,
    o.id option_id,o.position option_position,o.label,a.submitted_at,u.id user_id,u.display_name,
    CASE WHEN u.status='DELETED' THEN NULL ELSE u.email END AS email,
    count(a.id) OVER(PARTITION BY o.id)::int option_count
    FROM questionnaires qn JOIN questions q ON q.questionnaire_id=qn.id JOIN question_options o ON o.question_id=q.id
    LEFT JOIN answers a ON a.question_id=q.id AND a.option_id=o.id
    LEFT JOIN users u ON u.id=a.user_id WHERE qn.meetup_id=$1
    ORDER BY qn.position,q.position,o.position,u.display_name`, [id])).rows;
  return { meetup, rows };
}

function groupResults(rows: any[]) {
  const questionnaires = new Map<string, any>();
  for (const row of rows) {
    if (!questionnaires.has(row.questionnaire_id)) questionnaires.set(row.questionnaire_id, {
      id: row.questionnaire_id, position: row.questionnaire_position, title: row.questionnaire_title, assistantProvider: row.assistant_provider,
      startsAt: iso(row.questionnaire_starts), endsAt: iso(row.questionnaire_ends), status: row.questionnaire_status === "DRAFT" ? "DRAFT" : "PUBLISHED",
      pausedAt: row.paused_at ? iso(row.paused_at) : null, questions: new Map(),
    });
    const questionnaire = questionnaires.get(row.questionnaire_id);
    if (!questionnaire.questions.has(row.question_id)) questionnaire.questions.set(row.question_id, {
      id: row.question_id, position: row.question_position, prompt: row.prompt,
      startsAt: iso(row.question_opens), endsAt: iso(row.question_closes), options: new Map(),
    });
    const question = questionnaire.questions.get(row.question_id);
    if (!question.options.has(row.option_id)) question.options.set(row.option_id, {
      id: row.option_id, position: row.option_position, label: row.label, count: row.option_count, users: [],
    });
    if (row.user_id) question.options.get(row.option_id).users.push({ id: row.user_id, displayName: row.display_name, email: row.email, submittedAt: row.submitted_at });
  }
  return [...questionnaires.values()].map((questionnaire) => {
    const questions = [...questionnaire.questions.values()];
    return {
      ...questionnaire,
      questions: questions.map((question) => {
        const options = [...question.options.values()];
        const answered = options.reduce((sum: number, option: any) => sum + option.count, 0);
        return {
          ...question,
          options: options.map((option: any) => ({ ...option, percentage: answered ? option.count / answered * 100 : 0 })),
          answered,
        };
      }),
    };
  });
}

export async function resultRoutes(app: FastifyInstance): Promise<void> {
  app.get("/meetups/:id/results", async (request, reply) => {
    const user = requireUser(request), { id } = request.params as { id: string };
    const { meetup, rows } = await resultRows(id, user.id);
    const questionnaires = groupResults(rows);
    noStore(reply);
    return {
      meetup: { id, title: meetup.title, joinedCount: meetup.joined_count, startsAt: meetup.starts_at, endsAt: meetup.ends_at, status: meetup.status },
      questionnaires,
      serverTime: meetup.server_time,
    };
  });
  app.get("/meetups/:id/results.csv", async (request, reply) => {
    const user = requireUser(request), { id } = request.params as { id: string };
    const { meetup, rows } = await resultRows(id, user.id);
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: meetup.viewer_time_zone, dateStyle: "full", timeStyle: "long" });
    const lines = [["meetup_id", "meetup_title", "questionnaire_position", "questionnaire", "questionnaire_starts_at_utc", "questionnaire_ends_at_utc", "question_position", "question", "question_starts_at_utc", "question_ends_at_utc", "option_position", "option", "user_id", "display_name", "email", "submitted_at_utc", "submitted_at_viewer_local"].map(csv).join(",")];
    for (const questionnaire of groupResults(rows)) {
      for (const question of questionnaire.questions) {
        for (const option of question.options) {
          for (const person of option.users) {
            const submitted = new Date(person.submittedAt);
            lines.push([id, meetup.title, questionnaire.position, questionnaire.title, questionnaire.startsAt, questionnaire.endsAt, question.position, question.prompt, question.startsAt ?? "", question.endsAt ?? "", option.position, option.label, person.id, person.displayName, person.email, submitted.toISOString(), formatter.format(submitted)].map(csv).join(","));
          }
        }
      }
    }
    noStore(reply); reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="meetplus-${id}-results.csv"`);
    return "\uFEFF" + lines.join("\r\n");
  });
}
