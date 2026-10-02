export class ApiError extends Error {
  constructor(message: string, public status: number, public code = "REQUEST_ERROR") { super(message); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
    response = await fetch(`/api${path}`, {
      credentials: "include",
      ...init,
      headers,
    });
  } catch {
    window.dispatchEvent(new Event("meetcon:request-failed"));
    throw new ApiError("Unable to connect. Check your internet connection.", 0, "NETWORK_ERROR");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string; code?: string } } | null;
    if (response.status === 401) window.dispatchEvent(new Event("meetcon:session-expired"));
    throw new ApiError(body?.error?.message ?? "Something went wrong", response.status, body?.error?.code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export function formatDate(value: string | number | Date, zone: string, style: "compact" | "full" = "compact") {
  return new Intl.DateTimeFormat(undefined, style === "full"
    ? { timeZone: zone, dateStyle: "full", timeStyle: "long" }
    : { timeZone: zone, dateStyle: "medium", timeStyle: "short", timeZoneName: "short" }).format(new Date(value));
}
export function duration(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(seconds / 86400), h = Math.floor(seconds % 86400 / 3600);
  const m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, (!d && !h) && `${s}s`].filter(Boolean).join(" ");
}
export const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
export const message = (error: unknown) => error instanceof Error ? error.message : "Something went wrong";
export function localInput(iso: string) {
  const date = new Date(iso); const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}
export function zonedInput(value: string | Date, zone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function zonedLocalToUtc(value: string, zone: string) {
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) throw new Error("Choose a valid date and time");
  const dateValues = datePart.split("-").map(Number), timeValues = timePart.split(":").map(Number);
  const year = dateValues[0] ?? NaN, month = dateValues[1] ?? NaN, day = dateValues[2] ?? NaN, hour = timeValues[0] ?? NaN, minute = timeValues[1] ?? NaN;
  if (![year, month, day, hour, minute].every(Number.isFinite)) throw new Error("Choose a valid date and time");
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(p => [p.type, p.value]));
    const seen = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    guess += target - seen;
  }
  const check = formatter.formatToParts(new Date(guess));
  const rendered = Object.fromEntries(check.map(p => [p.type, p.value]));
  if (Number(rendered.year) !== year || Number(rendered.month) !== month || Number(rendered.day) !== day || Number(rendered.hour) !== hour || Number(rendered.minute) !== minute) {
    throw new Error("That local time does not exist in this time zone. Choose another time.");
  }
  return new Date(guess).toISOString();
}
