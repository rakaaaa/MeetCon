import { ArrowRight, Eye, EyeOff, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { api, browserZone, message } from "../lib";
import type { User } from "../types";
import { Button, Card, Field, Logo } from "../ui";

function AuthFrame({ children, title, text }: { children: React.ReactNode; title: string; text: string }) {
  return <main className="auth-page"><div className="auth-brand"><Logo /><h1>Every voice.<br/><span>Right on time.</span></h1><p>Energetic, focused meetups built around moments that matter.</p></div><Card className="auth-card"><Logo /><h1>{title}</h1><p>{text}</p>{children}</Card></main>;
}
export function Welcome() {
  return <AuthFrame title="Choose your path" text="How will you use MeetCon?"><div className="role-grid">
    <Link className="role-card" to="/signup?role=ADMIN"><ShieldCheck/><strong>I’m an Admin</strong><span>Create, share and run timed meetups.</span><ArrowRight/></Link>
    <Link className="role-card" to="/signup?role=USER"><UsersRound/><strong>I’m a Participant</strong><span>Join meetups and share your answer.</span><ArrowRight/></Link>
  </div><p className="auth-switch">Already have an account? <Link to="/login">Log in</Link></p></AuthFrame>;
}
function PasswordInput({ value, onChange, name = "password", autoComplete = "current-password" }: { value: string; onChange: (v: string) => void; name?: string; autoComplete?: string }) {
  const [show, setShow] = useState(false);
  return <div className="password-input"><input name={name} type={show ? "text" : "password"} value={value} onChange={e => onChange(e.target.value)} required autoComplete={autoComplete}/><button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)}>{show ? <EyeOff/> : <Eye/>}</button></div>;
}
export function Login() {
  const { user, setUser } = useAuth(); const navigate = useNavigate(); const location = useLocation();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={user.role === "ADMIN" ? "/admin" : "/app"} replace />;
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError("");
    try { const result = await api<{ user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }); setUser(result.user);
      const pending = sessionStorage.getItem("meetcon:join-token");
      navigate((location.state as { from?: string } | null)?.from ?? (result.user.role === "USER" && pending ? `/join/${pending}` : result.user.role === "ADMIN" ? "/admin" : "/app"), { replace: true });
    } catch (err) { setError(message(err)); } finally { setBusy(false); }
  };
  return <AuthFrame title="Welcome back" text="Sign in to keep the conversation moving."><form onSubmit={submit}>
    {error && <div className="alert">{error}</div>}<Field label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email"/></Field>
    <Field label="Password"><PasswordInput value={password} onChange={setPassword}/></Field><div className="form-between"><Link to="/forgot-password">Forgot password?</Link></div>
    <Button busy={busy} className="wide">Sign in <ArrowRight/></Button>
  </form><p className="auth-switch">New to MeetCon? <Link to="/welcome">Create account</Link></p></AuthFrame>;
}
export function Signup() {
  const [params] = useSearchParams(); const role = params.get("role") === "ADMIN" ? "ADMIN" : "USER";
  const { setUser } = useAuth(); const navigate = useNavigate();
  const [data, setData] = useState({ displayName: "", email: "", password: "", confirm: "", timeZone: browserZone() });
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof data, value: string) => setData(p => ({ ...p, [key]: value }));
  const submit = async (e: FormEvent) => { e.preventDefault(); if (data.password !== data.confirm) return setError("Passwords do not match.");
    setBusy(true); setError(""); try { const result = await api<{ user: User }>("/auth/register", { method: "POST", body: JSON.stringify({ displayName: data.displayName, email: data.email, password: data.password, timeZone: data.timeZone, role }) });
      setUser(result.user); const pending = sessionStorage.getItem("meetcon:join-token");
      navigate(role === "USER" && pending ? `/join/${pending}` : role === "ADMIN" ? "/admin" : "/app", { replace: true });
    } catch (err) { setError(message(err)); } finally { setBusy(false); }
  };
  return <AuthFrame title={`Create ${role === "ADMIN" ? "admin" : "participant"} account`} text={role === "ADMIN" ? "Start creating focused meetup experiences." : "Join the room and make your voice count."}><form onSubmit={submit}>
    {error && <div className="alert">{error}</div>}<Field label="Display name"><input value={data.displayName} onChange={e => set("displayName", e.target.value)} required autoComplete="name"/></Field>
    <Field label="Email"><input type="email" value={data.email} onChange={e => set("email", e.target.value)} required autoComplete="email"/></Field>
    <Field label="Password" hint="12+ characters with uppercase, lowercase and a number"><PasswordInput value={data.password} onChange={v => set("password", v)} autoComplete="new-password"/></Field>
    <Field label="Confirm password"><PasswordInput name="confirm" value={data.confirm} onChange={v => set("confirm", v)} autoComplete="new-password"/></Field>
    <Field label="Time zone" hint={`Current local time: ${new Intl.DateTimeFormat(undefined, { timeZone: data.timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date())}`}><input value={data.timeZone} onChange={e => set("timeZone", e.target.value)} required list="zones"/></Field>
    <datalist id="zones">{["UTC","Asia/Kolkata","America/New_York","America/Los_Angeles","Europe/London","Europe/Berlin","Asia/Singapore","Australia/Sydney"].map(z => <option key={z}>{z}</option>)}</datalist>
    <Button busy={busy} className="wide">Create account <ArrowRight/></Button>
  </form><p className="auth-switch"><UserRound size={16}/> Wrong role? <Link to="/welcome">Choose again</Link></p></AuthFrame>;
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
