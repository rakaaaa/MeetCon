import { PRIVACY_NOTICE_VERSION } from "@meetcon/shared";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { api, browserZone, message } from "../lib";
import { Button, Card, Field, Logo } from "../ui";
import { homeFor, readView } from "../view";

function AuthFrame({ children, title, text }: { children: React.ReactNode; title: string; text: string }) {
  return <main className="auth-page"><div className="auth-brand"><Logo /><h1>Every voice.<br/><span>Right on time.</span></h1><p>Energetic, focused meetups built around moments that matter.</p></div><Card className="auth-card"><Logo /><h1>{title}</h1><p>{text}</p>{children}</Card></main>;
}
const linkedInErrors: Record<string, string> = {
  linkedin_not_configured: "LinkedIn sign-in needs LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in .env.",
  linkedin_denied: "LinkedIn sign-in was cancelled.",
  linkedin_scope: "This LinkedIn app cannot sign people in yet. In the LinkedIn developer portal, open the app, choose Products, and add “Sign In with LinkedIn using OpenID Connect”.",
  linkedin_state: "That sign-in expired. Try again.",
  linkedin_email: "LinkedIn did not share a verified email address.",
  linkedin_unknown: "No MeetPlus account is linked to that LinkedIn profile. Create one first.",
  linkedin_closed: "This account is closed.",
  linkedin_conflict: "That LinkedIn profile is already linked to a different account.",
  linkedin_failed: "LinkedIn sign-in failed. Try again.",
  linkedin_consent: "New accounts must confirm they are 18 or older and accept the privacy notice.",
};

function linkedInHref(from: string | undefined, consent: boolean) {
  const params = new URLSearchParams({ intent: "login", role: "USER", zone: browserZone() });
  if (from?.startsWith("/") && !from.startsWith("//")) params.set("from", from);
  if (consent) {
    params.set("acceptPrivacy", "1");
    params.set("confirmAge18", "1");
    params.set("notice", PRIVACY_NOTICE_VERSION);
  }
  return `/api/auth/linkedin?${params.toString()}`;
}
function PasswordInput({ value, onChange, name = "password", autoComplete = "current-password" }: { value: string; onChange: (v: string) => void; name?: string; autoComplete?: string }) {
  const [show, setShow] = useState(false);
  return <div className="password-input"><input name={name} type={show ? "text" : "password"} value={value} onChange={e => onChange(e.target.value)} required autoComplete={autoComplete}/><button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((current) => !current)}>{show ? <EyeOff/> : <Eye/>}</button></div>;
}
export function Login() {
  const { user } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const from = params.get("from") ?? (location.state as { from?: string } | null)?.from;
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [confirmAge, setConfirmAge] = useState(false);
  if (user) return <Navigate to={homeFor(readView(user.role === "ADMIN" ? "admin" : "participant"))} replace />;
  const error = linkedInErrors[params.get("error") ?? ""] ?? "";
  const consent = acceptPrivacy && confirmAge;
  return <AuthFrame title="Welcome back" text="One LinkedIn button signs you in. The first time, it creates your account. You can host and join.">
    {error ? <div className="alert">{error}</div> : null}
    <label className="consent-check"><input type="checkbox" checked={confirmAge} onChange={(event) => setConfirmAge(event.target.checked)} /> <span>I am 18 or older.</span></label>
    <label className="consent-check"><input type="checkbox" checked={acceptPrivacy} onChange={(event) => setAcceptPrivacy(event.target.checked)} /> <span>I accept the <Link to="/privacy">privacy notice</Link>.</span></label>
    <a className="btn btn-linkedin wide" href={linkedInHref(from, consent)}>Continue with LinkedIn</a>
    <p className="auth-switch">New accounts need both confirmations. If you already have an account, you can continue and accept the notice after sign-in.</p>
  </AuthFrame>;
}
export function AuthComplete() {
  const { user, loading } = useAuth();
  const [params] = useSearchParams();
  if (loading) return <main className="launch"><Logo /><div className="launch-wave" /><p>Signing you in…</p></main>;
  if (!user) return <Navigate to="/login?error=linkedin_failed" replace />;
  const from = params.get("from");
  const pending = sessionStorage.getItem("meetcon:join-token");
  const dest = from && from.startsWith("/") && !from.startsWith("//") ? from : pending ? `/join/${pending}` : homeFor(readView(user.role === "ADMIN" ? "admin" : "participant"));
  return <Navigate to={dest} replace />;
}
export function ForgotPassword() {
  const [email, setEmail] = useState(""); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); await api("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }).catch(() => null); setBusy(false); setDone(true); };
  return <AuthFrame title="Reset your password" text="We’ll send a secure, short-lived reset link.">{done ? <div className="success-box"><ShieldCheck/><h2>Check your inbox</h2><p>If an account exists for that email, a reset link is on its way.</p><Link to="/login">Back to sign in</Link></div> : <form onSubmit={submit}><Field label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} required/></Field><Button busy={busy} className="wide">Send reset link</Button></form>}</AuthFrame>;
}
export function ResetPassword() {
  const [params] = useSearchParams(); const navigate = useNavigate(); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => { e.preventDefault(); if (password !== confirm) return setError("Passwords do not match."); setBusy(true); try { await api("/auth/reset-password", { method: "POST", body: JSON.stringify({ token: params.get("token"), password }) }); navigate("/login", { replace: true }); } catch (err) { setError(message(err)); } finally { setBusy(false); } };
  return <AuthFrame title="Choose a new password" text="This reset link can only be used once."><form onSubmit={submit}>{error && <div className="alert">{error}</div>}<Field label="New password" hint="12+ characters, mixed case and a number"><PasswordInput value={password} onChange={setPassword} autoComplete="new-password"/></Field><Field label="Confirm password"><PasswordInput name="confirm" value={confirm} onChange={setConfirm} autoComplete="new-password"/></Field><Button busy={busy} className="wide">Reset password</Button></form></AuthFrame>;
}
