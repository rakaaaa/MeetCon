import { useEffect, useRef, useState } from "react";
import { duration } from "./lib";

export function useServerCountdown(end: string | null | undefined, serverTime?: string, paused = false) {
  const offsetRef = useRef(0);
  const read = () => {
    if (!end) return 0;
    if (paused && serverTime) return Math.max(0, Date.parse(end) - Date.parse(serverTime));
    return end ? Math.max(0, Date.parse(end) - (Date.now() + offsetRef.current)) : 0;
  };
  const [remaining, setRemaining] = useState(read);
  useEffect(() => {
    if (serverTime) offsetRef.current = Date.parse(serverTime) - Date.now();
    const tick = () => {
      const next = read();
      setRemaining((current) => Math.ceil(current / 1000) === Math.ceil(next / 1000) ? current : next);
    };
    tick();
    if (paused) return;
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [end, serverTime, paused]);
  return remaining;
}

export function useRoomLive(meetupId: string | undefined, questionId: string | undefined, initialJoined: number, initialAnswered: number, onStopped?: (notice: { reason: "DRAFT" | "DELETED"; title: string }) => void, onSchedule?: () => void, onProgress?: () => void) {
  const [joined, setJoined] = useState(initialJoined);
  const [answered, setAnswered] = useState(initialAnswered);
  const onStoppedRef = useRef(onStopped);
  const onScheduleRef = useRef(onSchedule);
  const onProgressRef = useRef(onProgress);
  onStoppedRef.current = onStopped;
  onScheduleRef.current = onSchedule;
  onProgressRef.current = onProgress;
  useEffect(() => { setJoined(initialJoined); }, [initialJoined]);
  useEffect(() => { setAnswered(initialAnswered); }, [questionId, initialAnswered]);
  useEffect(() => {
    if (!meetupId) return;
    const source = new EventSource(`/api/meetups/${meetupId}/presence-stream`, { withCredentials: true });
    source.addEventListener("presence", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { participantCount: number };
      setJoined(data.participantCount);
    });
    source.addEventListener("progress", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { questionId: string; answered: number; advanced?: boolean };
      if (data.questionId === questionId) setAnswered(data.answered);
      if (data.advanced) onScheduleRef.current?.();
      else onProgressRef.current?.();
    });
    source.addEventListener("schedule", () => onScheduleRef.current?.());
    source.addEventListener("questionnaire-stopped", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { reason?: string; title?: string };
      if ((data.reason === "DRAFT" || data.reason === "DELETED") && typeof data.title === "string") onStoppedRef.current?.({ reason: data.reason, title: data.title });
    });
    return () => source.close();
  }, [meetupId, questionId]);
  return { joined, answered };
}

export function RemainingClocks({ meetupEndsAt, questionnaireEndsAt, questionEndsAt, serverTime, paused = false }: {
  meetupEndsAt?: string | null;
  questionnaireEndsAt?: string | null;
  questionEndsAt?: string | null;
  serverTime?: string;
  paused?: boolean;
}) {
  const meetup = useServerCountdown(meetupEndsAt, serverTime, paused);
  const questionnaire = useServerCountdown(questionnaireEndsAt, serverTime, paused);
  const question = useServerCountdown(questionEndsAt, serverTime, paused);
  return <div className="remain-row">
    <div><span>Meetup</span><strong>{duration(meetup)}</strong></div>
    <div><span>Questionnaire</span><strong>{questionnaireEndsAt ? duration(questionnaire) : "—"}</strong></div>
    <div><span>Question</span><strong>{questionEndsAt ? duration(question) : "—"}</strong></div>
  </div>;
}
