import type { Role, Theme } from "@meetcon/shared";

export type User = {
  id: string; email: string; role: Role; displayName: string; phone?: string | null;
  profileImageUrl?: string | null; profileImageSource?: "upload" | "linkedin" | null;
  givenName?: string | null; familyName?: string | null; locale?: string | null;
  emailVerified?: boolean | null; linkedinConnected?: boolean;
  timeZone: string; theme: Theme; createdAt: string; hasPassword?: boolean;
  privacyCurrent?: boolean;
};
export type Meetup = {
  id: string; title: string; publicCode?: string; startsAt: string; endsAt: string;
  sourceTimeZone?: string; status: "DRAFT" | "PUBLISHED" | "CANCELLED"; version?: number;
  questionCount: number; questionnaireCount?: number; memberCount?: number; organizer?: string; joinUrl?: string;
};
export type DashboardOption = { id: string; position: number; label: string; count: number };
export type DashboardQuestion = { id: string; position: number; prompt: string; answered: number; options: DashboardOption[] };
export type QuestionnaireSummaryItem = {
  id: string; title: string; position: number; startsAt: string; endsAt: string; status?: "DRAFT" | "PUBLISHED";
  questionCount: number; answeredCount: number; pausedAt?: string | null;
  questions?: DashboardQuestion[];
};
export type MeetupListItem = Meetup & { questionnaires: QuestionnaireSummaryItem[] };
export type Option = { id?: string; position?: number; label: string };
export type Question = { id?: string; position?: number; prompt: string; options: Option[] };
export type AssistantProvider = "openai" | "gemini" | "anthropic";
export type Questionnaire = {
  id?: string; position?: number; title: string; startsAt: string; endsAt: string;
  status?: "DRAFT" | "PUBLISHED"; publishedOnce?: boolean; pausedAt?: string | null;
  assistantProvider?: AssistantProvider | null;
  questions: Question[]; intervals?: { startMs: number; endMs: number }[];
};
export type MeetupDetail = Meetup & { questionnaires: Questionnaire[]; joinUrl: string };
export type ActiveState = {
  meetup: Pick<Meetup, "id" | "title" | "startsAt" | "endsAt" | "sourceTimeZone"> & { organizer: string };
  serverTime: string; participantCount: number; answeredCount?: number; phase: "WAITING" | "ANSWERING" | "COMPLETED";
  notice?: { reason: "DRAFT" | "DELETED"; title: string } | null;
  phaseStartsAt?: string; phaseEndsAt: string | null; questionEndsAt?: string; questionCount?: number;
  paused?: boolean;
  questionnaire?: { id: string; title: string; position: number; startsAt: string; endsAt: string };
  question?: { id: string; prompt: string; position: number; options: Required<Option>[] };
  answer?: { id: string; optionId: string; label: string; selectedCount: number } | null;
  tallies?: { optionId: string; count: number }[];
  review?: {
    prompt: string; position: number; questionCount: number; yourOptionId: string | null;
    options: { id: string; position: number; label: string; count: number }[];
  };
};
export type ResultQuestion = {
  id: string; position: number; prompt: string; answered: number; startsAt?: string; endsAt?: string;
  options: { id: string; position: number; label: string; count: number; percentage: number;
    users: { id: string; displayName: string; email: string; submittedAt: string }[] }[];
};
export type ResultQuestionnaire = {
  id: string; position: number; title: string; startsAt: string; endsAt: string; status?: "DRAFT" | "PUBLISHED";
  assistantProvider?: AssistantProvider | null; pausedAt?: string | null; questions: ResultQuestion[];
};
