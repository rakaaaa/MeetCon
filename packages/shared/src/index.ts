import { z } from "zod";

export const RoleSchema = z.enum(["ADMIN", "USER"]);
export const ThemeSchema = z.enum(["SYSTEM", "LIGHT", "DARK"]);
export const MeetupStatusSchema = z.enum(["DRAFT", "PUBLISHED", "CANCELLED"]);
export const MeetupPhaseSchema = z.enum(["WAITING", "ANSWERING", "COMPLETED"]);
export type Role = z.infer<typeof RoleSchema>;
export type Theme = z.infer<typeof ThemeSchema>;
export type MeetupStatus = z.infer<typeof MeetupStatusSchema>;
export type MeetupPhase = z.infer<typeof MeetupPhaseSchema>;

export const IdSchema = z.string().uuid();
export const EmailSchema = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
export const DateTimeSchema = z.string().datetime({ offset: true });
export const PasswordSchema = z.string().min(12).max(128)
  .regex(/[a-z]/, "Must contain a lowercase letter")
  .regex(/[A-Z]/, "Must contain an uppercase letter")
  .regex(/[0-9]/, "Must contain a number");
export const TimeZoneSchema = z.string().min(1).max(100).refine((zone) => {
  try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; }
}, "Invalid IANA time zone");

export const PRIVACY_NOTICE_VERSION = "2026-11-04";
export const ConsentPurposeSchema = z.enum(["account", "linkedin", "assistant_drafting", "push"]);
export const ConsentActionSchema = z.enum(["granted", "withdrawn"]);
export type ConsentPurpose = z.infer<typeof ConsentPurposeSchema>;
export type ConsentAction = z.infer<typeof ConsentActionSchema>;

export const RegisterSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  displayName: z.string().trim().min(1).max(100),
  role: RoleSchema,
  timeZone: TimeZoneSchema,
  privacyNoticeVersion: z.literal(PRIVACY_NOTICE_VERSION),
  acceptPrivacy: z.literal(true),
  confirmAge18: z.literal(true),
}).strict();
export const AcceptPrivacySchema = z.object({
  privacyNoticeVersion: z.literal(PRIVACY_NOTICE_VERSION),
  acceptPrivacy: z.literal(true),
  confirmAge18: z.literal(true),
}).strict();
export const NomineeSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: EmailSchema,
  relationship: z.string().trim().min(1).max(80),
}).strict();
export const LoginSchema = z.object({ email: EmailSchema, password: z.string().min(1).max(128) }).strict();
export const ForgotPasswordSchema = z.object({ email: EmailSchema }).strict();
export const ResetPasswordSchema = z.object({ token: z.string().min(32).max(500), password: PasswordSchema }).strict();
export const ChangePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: PasswordSchema }).strict();

export const UpdateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  email: EmailSchema.optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  timeZone: TimeZoneSchema.optional(),
  theme: ThemeSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "No changes supplied");
export const DeleteAccountSchema = z.object({
  password: z.string().min(1).max(128).optional(),
  confirmation: z.literal("DELETE"),
}).strict();

export const AiProviderSchema = z.enum(["openai", "gemini", "anthropic"]);
export const SaveAiKeySchema = z.object({
  provider: AiProviderSchema,
  apiKey: z.string().trim().min(8).max(300),
}).strict();
export const GenerateQuestionSchema = z.object({
  topic: z.string().trim().min(1).max(500),
  count: z.number().int().min(1).max(20),
  title: z.string().trim().max(160).optional(),
  questionnaire: z.string().trim().max(160).optional(),
  provider: AiProviderSchema,
}).strict();

export const QuestionInputSchema = z.object({
  prompt: z.string().trim().max(1000),
  options: z.array(z.string().trim().max(300)).length(4),
}).strict();
export const QuestionnaireStatusSchema = z.enum(["DRAFT", "PUBLISHED"]);
export type QuestionnaireStatus = z.infer<typeof QuestionnaireStatusSchema>;
export const QuestionnaireInputSchema = z.object({
  id: IdSchema.optional(),
  title: z.string().trim().min(1).max(160),
  startsAt: DateTimeSchema,
  endsAt: DateTimeSchema,
  status: QuestionnaireStatusSchema.optional(),
  assistantProvider: AiProviderSchema.nullish(),
  questions: z.array(QuestionInputSchema).max(100),
}).strict();
const MeetupInputObjectSchema = z.object({
  title: z.string().trim().min(1).max(160),
  sourceTimeZone: TimeZoneSchema,
  status: z.enum(["DRAFT", "PUBLISHED"]),
  questionnaires: z.array(QuestionnaireInputSchema).min(1, "Add at least one questionnaire.").max(20),
}).strict();
const validateMeetup = (value: z.infer<typeof MeetupInputObjectSchema>, context: z.RefinementCtx) => {
  value.questionnaires.forEach((questionnaire, index) => {
    if (Date.parse(questionnaire.endsAt) <= Date.parse(questionnaire.startsAt)) {
      context.addIssue({ code: "custom", message: "End time must be after the start time.", path: ["questionnaires", index, "endsAt"] });
    }
    if (value.status !== "PUBLISHED" || (questionnaire.status ?? "PUBLISHED") !== "PUBLISHED") return;
    if (!questionnaire.questions.length) {
      context.addIssue({ code: "custom", message: "Each questionnaire needs at least one question.", path: ["questionnaires", index, "questions"] });
    }
    questionnaire.questions.forEach((question, questionIndex) => {
      if (!question.prompt) context.addIssue({ code: "custom", message: "Question prompt is required", path: ["questionnaires", index, "questions", questionIndex, "prompt"] });
      question.options.forEach((option, optionIndex) => {
        if (!option) context.addIssue({ code: "custom", message: "All four options are required", path: ["questionnaires", index, "questions", questionIndex, "options", optionIndex] });
      });
    });
  });
  const ordered = value.questionnaires
    .map((questionnaire, index) => ({ index, start: Date.parse(questionnaire.startsAt), end: Date.parse(questionnaire.endsAt) }))
    .sort((left, right) => left.start - right.start);
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous && current && current.start < previous.end) {
      context.addIssue({ code: "custom", message: "Questionnaires cannot overlap.", path: ["questionnaires", current.index, "startsAt"] });
    }
  }
};
export const MeetupInputSchema = MeetupInputObjectSchema.superRefine(validateMeetup);
export const UpdateMeetupSchema = MeetupInputObjectSchema.extend({ version: z.number().int().positive() }).superRefine(validateMeetup);
export const JoinCodeSchema = z.object({ code: z.string().regex(/^\d{8}$/) }).strict();
export const JoinTokenSchema = z.object({ token: z.string().min(32).max(500) }).strict();
export const AnswerInputSchema = z.object({ questionId: IdSchema, optionId: IdSchema }).strict();

export type TimeInterval = Readonly<{ startMs: number; endMs: number }>;

/** Results hold after a question. Shorter questionnaires use a shorter hold so every question still has time. */
export const QUESTION_BREAK_MS = 30_000;
const MIN_QUESTION_MS = 1_000;

export function createDeterministicIntervals(startMs: number, endMs: number, count: number): readonly TimeInterval[] {
  if (![startMs, endMs, count].every(Number.isSafeInteger) || endMs <= startMs || count <= 0) {
    throw new RangeError("Invalid interval arguments");
  }
  const duration = endMs - startMs;
  const breakBudget = duration - count * MIN_QUESTION_MS;
  const breakMs = breakBudget > 0 ? Math.min(QUESTION_BREAK_MS, Math.floor(breakBudget / count)) : 0;
  const answering = duration - breakMs * count;
  const base = Math.floor(answering / count);
  let remainder = answering - base * count;
  let cursor = startMs;
  return Array.from({ length: count }, () => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    const open = cursor;
    const close = cursor + base + extra;
    cursor = close + breakMs;
    return { startMs: open, endMs: close };
  });
}

export type ScheduleWindow = { startMs: number; endMs: number; questionCount: number };
export type ScheduleLocation =
  | { kind: "waiting"; index: number; phaseEndsAt: number }
  | { kind: "answering"; index: number; position: number; startMs: number; endMs: number }
  | { kind: "completed" };

export function locateSchedule(windows: readonly ScheduleWindow[], nowMs: number): ScheduleLocation {
  if (!windows.length) return { kind: "completed" };
  const order = windows
    .map((window, index) => ({ window, index }))
    .sort((left, right) => left.window.startMs - right.window.startMs || left.index - right.index);
  const first = order[0];
  if (!first || nowMs < first.window.startMs) {
    return first ? { kind: "waiting", index: first.index, phaseEndsAt: first.window.startMs } : { kind: "completed" };
  }
  for (let cursor = 0; cursor < order.length; cursor++) {
    const current = order[cursor];
    if (!current) continue;
    const window = current.window;
    if (nowMs >= window.startMs && nowMs < window.endMs) {
      if (window.questionCount < 1) {
        const following = order[cursor + 1];
        return following
          ? { kind: "waiting", index: following.index, phaseEndsAt: following.window.startMs }
          : { kind: "completed" };
      }
      const intervals = createDeterministicIntervals(window.startMs, window.endMs, window.questionCount);
      const openIndex = intervals.findIndex((interval) => nowMs >= interval.startMs && nowMs < interval.endMs);
      const open = openIndex >= 0 ? intervals[openIndex] : undefined;
      if (open) return { kind: "answering", index: current.index, position: openIndex + 1, startMs: open.startMs, endMs: open.endMs };
      const nextQuestion = intervals.find((interval) => interval.startMs > nowMs);
      if (nextQuestion) return { kind: "waiting", index: current.index, phaseEndsAt: nextQuestion.startMs };
      if (nowMs < window.endMs) return { kind: "waiting", index: current.index, phaseEndsAt: window.endMs };
    }
    const following = order[cursor + 1];
    if (following && nowMs < following.window.startMs) {
      return { kind: "waiting", index: following.index, phaseEndsAt: following.window.startMs };
    }
  }
  return { kind: "completed" };
}

export type Register = z.infer<typeof RegisterSchema>;
export type UpdateProfile = z.infer<typeof UpdateProfileSchema>;
export type MeetupInput = z.infer<typeof MeetupInputSchema>;
