import { LoaderCircle, Sparkles, WifiOff } from "lucide-react";
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export function Logo({ compact = false }: { compact?: boolean }) {
  return <div className="logo"><span className="logo-mark"><Sparkles size={20} /></span>{!compact && <strong>MeetCon</strong>}</div>;
}
export function Button({ variant = "primary", busy, children, className = "", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; busy?: boolean }) {
  return <button className={`btn btn-${variant} ${className}`} disabled={busy || props.disabled} {...props}>
    {busy && <LoaderCircle className="spin" size={18} />}{children}
  </button>;
}
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}
export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="page-head"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</header>;
}
export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="center-state" role="status"><LoaderCircle className="spin" size={32} /><p>{label}</p></div>;
}
export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <Card className="empty">{icon}<h2>{title}</h2><p>{text}</p>{action}</Card>;
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return <Card className="empty error-state"><h2>We hit a snag</h2><p>{error instanceof Error ? error.message : "Please try again."}</p>{retry && <Button onClick={retry}>Try again</Button>}</Card>;
}
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}{error && <small className="field-error">{error}</small>}</label>;
}
export function Avatar({ name, src, size = "md" }: { name: string; src?: string | null | undefined; size?: "sm" | "md" | "lg" }) {
  return src ? <img className={`avatar avatar-${size}`} src={src} alt="" /> : <span className={`avatar avatar-${size}`}>{name.split(/\s+/).slice(0, 2).map(x => x[0]).join("").toUpperCase()}</span>;
}
export function Status({ value }: { value: string }) {
  return <span className={`status status-${value.toLowerCase()}`}>{value === "PUBLISHED" ? "Upcoming" : value}</span>;
}
export function OfflineBar({ onOnline }: { onOnline?: () => void }) {
  const [state, setState] = useState<"online" | "offline" | "back">(() => navigator.onLine ? "online" : "offline");
  useEffect(() => {
    let timer = 0;
    const offline = () => setState("offline");
    const online = () => { setState("back"); onOnline?.(); timer = window.setTimeout(() => setState("online"), 2400); };
    addEventListener("offline", offline); addEventListener("online", online);
    addEventListener("meetcon:request-failed", offline);
    return () => { removeEventListener("offline", offline); removeEventListener("online", online); removeEventListener("meetcon:request-failed", offline); clearTimeout(timer); };
  }, [onOnline]);
  if (state === "online") return null;
  return <div id="meetcon-offline-bar" data-meetcon-connectivity-banner className={`network-bar ${state}`} role="status" aria-live="polite"><WifiOff size={18} />{state === "offline" ? "No internet connection" : "Back online — syncing…"}</div>;
}
export function Toast({ children }: { children: ReactNode }) { return <div className="toast" role="status">{children}</div>; }
