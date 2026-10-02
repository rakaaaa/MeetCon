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

export const RegisterSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  displayName: z.string().trim().min(1).max(100),
  role: RoleSchema,
  timeZone: TimeZoneSchema,
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
  password: z.string().min(1).max(128),
  confirmation: z.literal("DELETE"),
}).strict();

export const QuestionInputSchema = z.object({
  prompt: z.string().trim().max(1000),
  options: z.array(z.string().trim().max(300)).length(4),
}).strict();
const MeetupInputObjectSchema = z.object({
  title: z.string().trim().min(1).max(160),
  startsAt: DateTimeSchema,
  endsAt: DateTimeSchema,
  sourceTimeZone: TimeZoneSchema,
  status: z.enum(["DRAFT", "PUBLISHED"]),
  questions: z.array(QuestionInputSchema).max(100),
}).strict();
const validRange = (value: { startsAt: string; endsAt: string }) => Date.parse(value.endsAt) > Date.parse(value.startsAt);
const validateMeetup = (value: z.infer<typeof MeetupInputObjectSchema>, context: z.RefinementCtx) => {
  if (!validRange(value)) context.addIssue({ code: "custom", message: "End time must be after start time", path: ["endsAt"] });
  if (value.status === "PUBLISHED") {
    if (!value.questions.length) context.addIssue({ code: "custom", message: "Published meetups require at least one question", path: ["questions"] });
    value.questions.forEach((question, questionIndex) => {
      if (!question.prompt) context.addIssue({ code: "custom", message: "Question prompt is required", path: ["questions", questionIndex, "prompt"] });
      question.options.forEach((option, optionIndex) => {
        if (!option) context.addIssue({ code: "custom", message: "All four options are required", path: ["questions", questionIndex, "options", optionIndex] });
      });
    });
  }
};
export const MeetupInputSchema = MeetupInputObjectSchema.superRefine(validateMeetup);
export const UpdateMeetupSchema = MeetupInputObjectSchema.extend({ version: z.number().int().positive() }).superRefine(validateMeetup);
export const JoinCodeSchema = z.object({ code: z.string().regex(/^\d{8}$/) }).strict();
export const JoinTokenSchema = z.object({ token: z.string().min(32).max(500) }).strict();
export const AnswerInputSchema = z.object({ questionId: IdSchema, optionId: IdSchema }).strict();

export type TimeInterval = Readonly<{ startMs: number; endMs: number }>;
export function createDeterministicIntervals(startMs: number, endMs: number, count: number): readonly TimeInterval[] {
  if (![startMs, endMs, count].every(Number.isSafeInteger) || endMs <= startMs || count <= 0) {
    throw new RangeError("Invalid interval arguments");
  }
  const duration = endMs - startMs;
  return Array.from({ length: count }, (_, index) => ({
    startMs: Math.floor(startMs + duration * index / count),
    endMs: Math.floor(startMs + duration * (index + 1) / count),
  }));
}

export type Register = z.infer<typeof RegisterSchema>;
export type UpdateProfile = z.infer<typeof UpdateProfileSchema>;
export type MeetupInput = z.infer<typeof MeetupInputSchema>;
