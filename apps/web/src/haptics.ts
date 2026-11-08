export type RoomPulse = "start" | "stop" | "question";

export type RoomMark = {
  phase: string;
  questionnaireId: string;
  questionId: string;
  halted: boolean;
};

type NativeHaptics = { vibrate?: (kind: string) => void };

export function nextRoomPulse(previous: RoomMark | null, current: RoomMark): RoomPulse | null {
  if (!previous) return null;
  const wasLive = previous.phase === "ANSWERING" && !previous.halted;
  const isLive = current.phase === "ANSWERING" && !current.halted;
  if (wasLive && !isLive) return "stop";
  if (!isLive) return null;
  if (current.questionnaireId !== previous.questionnaireId) return "start";
  if (current.questionId !== previous.questionId) return "question";
  return null;
}

export function pulseRoom(kind: RoomPulse) {
  if (document.visibilityState === "hidden") return;
  const native = (window as Window & { MeetPlusNative?: NativeHaptics }).MeetPlusNative;
  native?.vibrate?.(kind);
}
