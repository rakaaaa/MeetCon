import type { FastifyInstance } from "fastify";
import { AnswerInputSchema } from "@meetcon/shared";
import { transaction } from "../../db/index.js";
import { AppError, noStore, requireUser } from "../../lib.js";
import { publisher } from "../../redis.js";
import { advanceQuestion, publishSchedule } from "../schedule/control.js";

export async function answerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/meetups/:id/answers", async (request, reply) => {
    const user = requireUser(request), { id } = request.params as { id: string };
    const input = AnswerInputSchema.parse(request.body);
    const committed = await transaction(async (client) => {
      const meetup = (await client.query(`SELECT *,clock_timestamp() db_now FROM meetups WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      const member = (await client.query("SELECT 1 FROM meetup_members WHERE meetup_id=$1 AND user_id=$2", [id, user.id])).rowCount;
      if (!meetup || meetup.status !== "PUBLISHED") {
        throw new AppError(409, "MEETUP_UNAVAILABLE", "Meetup is not available");
      }
      if (!member) throw new AppError(403, "MEMBERSHIP_REQUIRED", "Join this meetup before answering");
      const now = new Date(meetup.db_now);
      const question = (await client.query(`SELECT q.id,q.position,q.opens_at,q.closes_at,qn.paused_at,qn.status
        FROM questions q JOIN questionnaires qn ON qn.id=q.questionnaire_id
        JOIN question_options o ON o.question_id=q.id AND o.id=$3
        WHERE q.meetup_id=$1 AND q.id=$2`, [id, input.questionId, input.optionId])).rows[0];
      if (!question) throw new AppError(400, "INVALID_OPTION", "Option does not belong to this question");
      if (question.status !== "PUBLISHED") throw new AppError(409, "QUESTIONNAIRE_UNAVAILABLE", "This questionnaire is not live");
      if (!question.paused_at && now >= new Date(meetup.ends_at)) throw new AppError(409, "MEETUP_ENDED", "This meetup has ended");
      const clock = question.paused_at ? new Date(question.paused_at) : now;
      const opens = new Date(question.opens_at).getTime();
      const closes = new Date(question.closes_at).getTime();
      if (clock.getTime() >= closes) throw new AppError(409, "QUESTION_ENDED", "This question has ended");
      if (clock.getTime() < opens) throw new AppError(409, "ANSWER_WINDOW_CLOSED", "This question is not open yet");
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
      const answered = Number((await client.query("SELECT count(*)::int count FROM answers WHERE question_id=$1", [input.questionId])).rows[0].count);
      const members = Number((await client.query("SELECT count(*)::int count FROM meetup_members WHERE meetup_id=$1", [id])).rows[0].count);
      const tallies = (await client.query(`SELECT o.id AS "optionId", count(a.id)::int AS count
        FROM question_options o LEFT JOIN answers a ON a.option_id = o.id
        WHERE o.question_id = $1 GROUP BY o.id, o.position ORDER BY o.position`, [input.questionId])).rows as { optionId: string; count: number }[];
      const advanced = !existing && members > 0 && answered >= members ? await advanceQuestion(client, id, input.questionId, now) : false;
      return { id: answer.id, optionId: answer.option_id, submittedAt: answer.submitted_at, selectedCount: count, answered, inserted: !existing, advanced, tallies };
    });
    if (committed.inserted) {
      await publisher.publish(`answer-count:${input.questionId}:${input.optionId}`, JSON.stringify({ count: committed.selectedCount }));
      await publisher.publish(`meetup-answers:${id}`, JSON.stringify({
        questionId: input.questionId, optionId: input.optionId, count: committed.selectedCount, answered: committed.answered, advanced: committed.advanced,
        user: { id: user.id, displayName: user.displayName, email: user.email, submittedAt: new Date(committed.submittedAt).toISOString() },
      }));
      await publisher.publish(`meetup-progress:${id}`, JSON.stringify({ questionId: input.questionId, answered: committed.answered, advanced: committed.advanced }));
      if (committed.advanced) await publishSchedule(id);
    }
    const { inserted, answered: _answered, advanced: _advanced, tallies, ...answer } = committed;
    noStore(reply); return reply.code(inserted ? 201 : 200).send({ answer, tallies });
  });
}
