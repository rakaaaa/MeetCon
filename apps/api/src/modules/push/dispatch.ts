import { createRequire } from "node:module";
import { config } from "../../config.js";
import { pool } from "../../db/index.js";
import "./keys.js";

const webpush = createRequire(import.meta.url)("web-push") as typeof import("web-push");

type Log = { error: (error: unknown, message?: string) => void };
type LiveRow = {
  meetup_id: string;
  meetup_title: string;
  question_id: string;
  prompt: string;
};

let running = false;

export async function dispatchQuestionPushes(log: Log): Promise<void> {
  if (running) return;
  running = true;
  try {
    const rows = (await pool.query<LiveRow>(`SELECT m.id AS meetup_id, m.title AS meetup_title, q.id AS question_id, q.prompt
      FROM meetups m
      JOIN questionnaires qn ON qn.meetup_id=m.id
      JOIN questions q ON q.questionnaire_id=qn.id
      WHERE m.status = 'PUBLISHED' AND qn.status = 'PUBLISHED' AND qn.paused_at IS NULL
        AND q.opens_at <= now() AND q.closes_at > now()`)).rows;
    await Promise.all(rows.map((row) => notifyQuestion({ meetupId: row.meetup_id, title: row.meetup_title, questionId: row.question_id, prompt: row.prompt }, log)));
  } finally {
    running = false;
  }
}

async function notifyQuestion(item: { meetupId: string; title: string; questionId: string; prompt: string }, log: Log) {
  const claimed = await pool.query<{ user_id: string }>(`INSERT INTO question_notifications(question_id, user_id)
    SELECT $1, mm.user_id FROM meetup_members mm
    WHERE mm.meetup_id=$2 AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id=mm.user_id)
    ON CONFLICT DO NOTHING RETURNING user_id`, [item.questionId, item.meetupId]);
  const userIds = claimed.rows.map((row) => row.user_id);
  if (!userIds.length) return;
  const subscriptions = (await pool.query<{ user_id: string; endpoint: string; p256dh: string; auth: string }>(
    "SELECT user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1::uuid[])", [userIds],
  )).rows;
  const prompt = item.prompt.trim();
  const payload = JSON.stringify({
    title: item.title,
    body: prompt.length > 140 ? `${prompt.slice(0, 137)}…` : prompt || "The next question is open.",
    url: `${config.WEB_ORIGIN}/app/meetups/${item.meetupId}`,
    tag: item.questionId,
  });
  const failed = new Set(userIds);
  const gone: string[] = [];
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        payload,
        { TTL: 120, urgency: "high", topic: item.questionId.replaceAll("-", "") },
      );
      failed.delete(subscription.user_id);
    } catch (error) {
      if (error instanceof webpush.WebPushError && (error.statusCode === 404 || error.statusCode === 410)) gone.push(subscription.endpoint);
      else log.error(error, "Question push failed");
    }
  }));
  if (gone.length) await pool.query("DELETE FROM push_subscriptions WHERE endpoint = ANY($1::text[])", [gone]);
  const retry = [...failed].filter((userId) => subscriptions.some((subscription) => subscription.user_id === userId && !gone.includes(subscription.endpoint)));
  if (retry.length) await pool.query("DELETE FROM question_notifications WHERE question_id=$1 AND user_id = ANY($2::uuid[])", [item.questionId, retry]);
}
