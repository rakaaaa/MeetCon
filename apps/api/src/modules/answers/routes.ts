import type { FastifyInstance } from "fastify";
import { AnswerInputSchema } from "@meetcon/shared";
import { transaction } from "../../db/index.js";
import { AppError, noStore, requireUser } from "../../lib.js";
import { publisher } from "../../redis.js";

export async function answerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/meetups/:id/answers", async (request, reply) => {
    const user = requireUser(request, "USER"), { id } = request.params as { id: string };
    const input = AnswerInputSchema.parse(request.body);
    const committed = await transaction(async (client) => {
      const meetup = (await client.query(`SELECT *,clock_timestamp() db_now,
        (SELECT count(*)::int FROM questions WHERE meetup_id=meetups.id) question_count
        FROM meetups WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!meetup || meetup.status !== "PUBLISHED") throw new AppError(409, "MEETUP_UNAVAILABLE", "Meetup is not available");
      if (!(await client.query("SELECT 1 FROM meetup_members WHERE meetup_id=$1 AND user_id=$2", [id, user.id])).rowCount) {
        throw new AppError(403, "MEMBERSHIP_REQUIRED", "Join this meetup before answering");
      }
      const now = new Date(meetup.db_now), start = new Date(meetup.starts_at), end = new Date(meetup.ends_at);
      if (now < start || now >= end) throw new AppError(409, "ANSWER_WINDOW_CLOSED", "Answer window is closed");
      const question = (await client.query(`SELECT q.id,q.position FROM questions q
        JOIN question_options o ON o.question_id=q.id AND o.id=$3
        WHERE q.meetup_id=$1 AND q.id=$2`, [id, input.questionId, input.optionId])).rows[0];
      if (!question) throw new AppError(400, "INVALID_OPTION", "Option does not belong to this question");
      const intervalStart = start.getTime() + Math.floor((end.getTime() - start.getTime()) * (question.position - 1) / meetup.question_count);
      const intervalEnd = start.getTime() + Math.floor((end.getTime() - start.getTime()) * question.position / meetup.question_count);
      if (now.getTime() < intervalStart || now.getTime() >= intervalEnd) throw new AppError(409, "ANSWER_WINDOW_CLOSED", "This question is not active");
      const existing = (await client.query("SELECT id,option_id,submitted_at FROM answers WHERE user_id=$1 AND question_id=$2 FOR UPDATE", [user.id, input.questionId])).rows[0];
      if (existing && existing.option_id !== input.optionId) throw new AppError(409, "ANSWER_IMMUTABLE", "An answer was already submitted");
      let answer = existing;
      if (!answer) {
        try {
          answer = (await client.query(`INSERT INTO answers(meetup_id,question_id,option_id,user_id)
            VALUES($1,$2,$3,$4) RETURNING id,option_id,submitted_at`, [id, input.questionId, input.optionId, user.id])).rows[0];
        } catch (error: any) {
          if (error.code !== "23505") throw error;
          const raced = (await client.query("SELECT id,option_id,submitted_at FROM answers WHERE user_id=$1 AND question_id=$2", [user.id, input.questionId])).rows[0];
          if (raced.option_id !== input.optionId) throw new AppError(409, "ANSWER_IMMUTABLE", "An answer was already submitted");
          answer = raced;
        }
      }
      const count = Number((await client.query("SELECT count(*) count FROM answers WHERE question_id=$1 AND option_id=$2", [input.questionId, input.optionId])).rows[0].count);
      return { id: answer.id, optionId: answer.option_id, submittedAt: answer.submitted_at, selectedCount: count, inserted: !existing };
    });
    if (committed.inserted) await publisher.publish(`answer-count:${input.questionId}:${input.optionId}`, JSON.stringify({ count: committed.selectedCount }));
    noStore(reply); return reply.code(committed.inserted ? 201 : 200).send({ answer: { ...committed, inserted: undefined } });
  });
}
