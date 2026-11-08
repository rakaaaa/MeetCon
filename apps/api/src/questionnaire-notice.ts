import { publisher } from "./redis.js";

export type QuestionnaireNotice = { reason: "DRAFT" | "DELETED"; title: string };

export async function publishQuestionnaireStop(meetupId: string, notice: QuestionnaireNotice): Promise<void> {
  const payload = JSON.stringify(notice);
  await publisher.set(`meetup-notice:${meetupId}`, payload, "EX", 120);
  await publisher.publish(`meetup-notice:${meetupId}`, payload);
}

export async function readQuestionnaireNotice(meetupId: string): Promise<QuestionnaireNotice | null> {
  const payload = await publisher.get(`meetup-notice:${meetupId}`);
  if (!payload) return null;
  try {
    const notice = JSON.parse(payload) as Partial<QuestionnaireNotice>;
    if ((notice.reason === "DRAFT" || notice.reason === "DELETED") && typeof notice.title === "string") {
      return { reason: notice.reason, title: notice.title };
    }
  } catch {
    return null;
  }
  return null;
}
