import type { FastifyInstance } from "fastify";
import { pool } from "../../db/index.js";
import { AppError, noStore, requireUser } from "../../lib.js";

const csv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
async function resultRows(id: string, ownerId: string) {
  const meetup = (await pool.query(`SELECT m.*,owner.time_zone viewer_time_zone,clock_timestamp() server_time,
    (SELECT count(*)::int FROM meetup_members WHERE meetup_id=m.id) joined_count
    FROM meetups m JOIN users owner ON owner.id=m.owner_id WHERE m.id=$1 AND m.owner_id=$2`, [id, ownerId])).rows[0];
  if (!meetup) throw new AppError(404, "NOT_FOUND", "Meetup not found");
  const rows = (await pool.query(`SELECT q.id question_id,q.position question_position,q.prompt,
    o.id option_id,o.position option_position,o.label,a.submitted_at,u.id user_id,u.display_name,u.email,
    count(a.id) OVER(PARTITION BY o.id)::int option_count
    FROM questions q JOIN question_options o ON o.question_id=q.id
    LEFT JOIN answers a ON a.question_id=q.id AND a.option_id=o.id
    LEFT JOIN users u ON u.id=a.user_id WHERE q.meetup_id=$1 ORDER BY q.position,o.position,u.display_name`, [id])).rows;
  return { meetup, rows };
}

export async function resultRoutes(app: FastifyInstance): Promise<void> {
  app.get("/meetups/:id/results", async (request, reply) => {
    const user = requireUser(request, "ADMIN"), { id } = request.params as { id: string };
    const { meetup, rows } = await resultRows(id, user.id);
    const questions = new Map<string, any>();
    for (const row of rows) {
      if (!questions.has(row.question_id)) questions.set(row.question_id, { id: row.question_id, position: row.question_position, prompt: row.prompt, options: new Map() });
      const question = questions.get(row.question_id);
      if (!question.options.has(row.option_id)) question.options.set(row.option_id, { id: row.option_id, position: row.option_position, label: row.label, count: row.option_count, users: [] });
      if (row.user_id) question.options.get(row.option_id).users.push({ id: row.user_id, displayName: row.display_name, email: row.email, submittedAt: row.submitted_at });
    }
    const response = [...questions.values()].map((question) => {
      const options = [...question.options.values()];
      const answered = options.reduce((sum: number, option: any) => sum + option.count, 0);
      return { ...question, options: options.map((option: any) => ({ ...option, percentage: answered ? option.count / answered * 100 : 0 })), answered };
    });
    noStore(reply); return { meetup: { id, title: meetup.title, joinedCount: meetup.joined_count, startsAt: meetup.starts_at, endsAt: meetup.ends_at, status: meetup.status }, questions: response, serverTime: meetup.server_time };
  });
  app.get("/meetups/:id/results.csv", async (request, reply) => {
    const user = requireUser(request, "ADMIN"), { id } = request.params as { id: string };
    const { meetup, rows } = await resultRows(id, user.id);
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: meetup.viewer_time_zone, dateStyle: "full", timeStyle: "long" });
    const lines = [["meetup_id","meetup_title","question_position","question","option_position","option","user_id","display_name","email","submitted_at_utc","submitted_at_viewer_local"].map(csv).join(",")];
    for (const row of rows) if (row.user_id) {
      const submitted = new Date(row.submitted_at);
      lines.push([id, meetup.title, row.question_position, row.prompt, row.option_position, row.label, row.user_id, row.display_name, row.email, submitted.toISOString(), formatter.format(submitted)].map(csv).join(","));
    }
    noStore(reply); reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="meetcon-${id}-results.csv"`);
    return "\uFEFF" + lines.join("\r\n");
  });
}
