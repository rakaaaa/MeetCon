export class ApiError extends Error {
  constructor(message: string, public status: number, public code = "REQUEST_ERROR") { super(message); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    if (init.body != null && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
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
    const body = await response.json().catch(() => null) as { message?: string; error?: { message?: string; code?: string } | string } | null;
    if (response.status === 401) window.dispatchEvent(new Event("meetcon:session-expired"));
    const nested = body?.error;
    const nestedMessage = nested && typeof nested === "object" ? nested.message : undefined;
    const nestedCode = nested && typeof nested === "object" ? nested.code : undefined;
    throw new ApiError(nestedMessage ?? readableError(body?.message) ?? "Something went wrong", response.status, nestedCode);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function readableError(message: string | undefined) {
  if (!message) return undefined;
  try {
    const issues = JSON.parse(message) as { message?: string; path?: (string | number)[] }[];
    if (!Array.isArray(issues)) return message;
    const text = [...new Set(issues.map((issue) => {
      const path = issue.path?.join(".") ?? "";
      if (path === "title") return "Meetup title is required.";
      if (path.endsWith(".title")) return "Each questionnaire needs a title.";
      if (path.endsWith("prompt")) return "Each question needs a prompt.";
      if (path.includes("options")) return "Each question needs all four options.";
      return issue.message ?? "";
    }).filter(Boolean))].join(" ");
    return text || message;
  } catch {
    return message;
  }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function cachedFormatter(zone: string, options: Intl.DateTimeFormatOptions) {
  const key = `${zone}\0${options.dateStyle ?? ""}\0${options.timeStyle ?? ""}\0${options.day ?? ""}\0${options.month ?? ""}\0${options.hour ?? ""}\0${options.minute ?? ""}\0${options.timeZoneName ?? ""}`;
  let cached = formatterCache.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat(undefined, { ...options, timeZone: zone });
    formatterCache.set(key, cached);
  }
  return cached;
}

export const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export const timeZoneOptions: readonly string[] = (() => {
  try { return Intl.supportedValuesOf("timeZone"); } catch { return ["UTC"]; }
})();
function zoneLabel(zone: string, date: Date) {
  return cachedFormatter(zone, { hour: "numeric", timeZoneName: "short" }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "";
}
export function formatDate(value: string | number | Date, zone: string, style: "compact" | "full" = "compact") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (style === "full") return cachedFormatter(zone, { dateStyle: "full", timeStyle: "long" }).format(date);
  const when = cachedFormatter(zone, { dateStyle: "medium", timeStyle: "short" }).format(date);
  const name = zoneLabel(zone, date);
  return name ? `${when} ${name}` : when;
}
export function formatTile(value: string, zone: string) {
  const date = new Date(value);
  return {
    day: cachedFormatter(zone, { day: "2-digit" }).format(date),
    month: cachedFormatter(zone, { month: "short" }).format(date),
  };
}
export function formatClockSpan(startMs: number, endMs: number, zone: string) {
  const formatter = cachedFormatter(zone, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  return `${formatter.format(startMs)} – ${formatter.format(endMs)}`;
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
