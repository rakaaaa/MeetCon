import type { Role, Theme } from "@meetcon/shared";

export type User = {
  id: string; email: string; role: Role; displayName: string; phone?: string | null;
  profileImageUrl?: string | null; timeZone: string; theme: Theme; createdAt: string;
};
export type Meetup = {
  id: string; title: string; publicCode?: string; startsAt: string; endsAt: string;
  sourceTimeZone?: string; status: "DRAFT" | "PUBLISHED" | "CANCELLED"; version?: number;
  questionCount: number; memberCount?: number; organizer?: string; joinUrl?: string;
};
export type Option = { id?: string; position?: number; label: string };
export type Question = { id?: string; position?: number; prompt: string; options: Option[] };
export type MeetupDetail = Meetup & {
  questions: Question[];
  intervals: { startMs: number; endMs: number }[];
  joinUrl: string;
};
export type ActiveState = {
  meetup: Pick<Meetup, "id" | "title" | "startsAt" | "endsAt"> & { organizer: string };
  serverTime: string; participantCount: number; phase: "WAITING" | "ANSWERING" | "COMPLETED";
  phaseStartsAt?: string; phaseEndsAt: string | null; questionCount?: number;
  question?: { id: string; prompt: string; position: number; options: Required<Option>[] };
  answer?: { id: string; optionId: string; label: string; selectedCount: number } | null;
};
export type ResultQuestion = {
  id: string; position: number; prompt: string; answered: number;
  options: { id: string; position: number; label: string; count: number; percentage: number;
    users: { id: string; displayName: string; email: string; submittedAt: string }[] }[];
};
