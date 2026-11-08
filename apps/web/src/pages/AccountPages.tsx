import { useQuery } from "@tanstack/react-query";
import { Camera, Check, ChevronDown, Globe, Info, KeyRound, Moon, Palette, Save, ShieldAlert, Sparkles, Sun, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { api, formatDate, message, timeZoneOptions } from "../lib";
import type { User } from "../types";
import { QuestionAlerts } from "../question-alerts";
import { YourDataSection } from "./PrivacyPage";
import { Avatar, Button, Card, Field, PageHeader } from "../ui";

function localeLabel(locale: string) {
  const [language, region] = locale.split(/[-_]/);
  try {
    const languageName = language ? new Intl.DisplayNames(undefined, { type: "language" }).of(language) : "";
    const regionName = region ? new Intl.DisplayNames(undefined, { type: "region" }).of(region) : "";
    return [languageName, regionName].filter(Boolean).join(" · ") || locale;
  } catch {
    return locale;
  }
}
export function Profile() {
  const { user, setUser } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const profile = useQuery({ queryKey: ["profile", user!.id], queryFn: () => api<User>("/profile") });
  const account = profile.data ? { ...user!, ...profile.data } : user!;
  const [form, setForm] = useState({ displayName: account.displayName, email: account.email, phone: account.phone ?? "" });
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    setForm({ displayName: account.displayName, email: account.email, phone: account.phone ?? "" });
  }, [account.displayName, account.email, account.phone]);
  const dirty = form.displayName !== account.displayName || form.email !== account.email || form.phone !== (account.phone ?? "");
  const save = async () => {
    setError("");
    try {
      const updated = await api<User>("/profile", { method: "PATCH", body: JSON.stringify({ displayName: form.displayName, phone: form.phone || null, ...(account.linkedinConnected ? {} : { email: form.email }) }) });
      setUser((current) => current ? { ...current, ...updated } : current);
      await profile.refetch();
    } catch (err) { setError(message(err)); }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    const data = new FormData();
    data.append("file", file);
    try {
      const result = await api<{ profileImageUrl: string }>("/profile/photo", { method: "POST", body: data });
      setUser((current) => current ? { ...current, profileImageUrl: result.profileImageUrl, profileImageSource: "upload" } : current);
      await profile.refetch();
    } catch (err) { setError(message(err)); }
  };
  const remove = async () => {
    await api("/profile/photo", { method: "DELETE" });
    setUser((current) => current ? { ...current, profileImageUrl: null, profileImageSource: null } : current);
    await profile.refetch();
  };
  const refreshLinkedIn = async () => {
    setRefreshing(true); setError("");
    try {
      const updated = await api<User>("/profile/linkedin/sync", { method: "POST" });
      setUser((current) => current ? { ...current, ...updated } : current);
      await profile.refetch();
    } catch (err) { setError(message(err)); } finally { setRefreshing(false); }
  };
  const linkedInName = [account.givenName, account.familyName].filter(Boolean).join(" ");
  const linkedInNameDiffers = linkedInName.length > 0 && linkedInName.toLowerCase() !== account.displayName.trim().toLowerCase();
  return <div className="page"><PageHeader eyebrow="Your account" title="Profile" description="Photo, name, and contact details." action={<Link className="btn btn-secondary" to="/settings">Settings</Link>}/>
    {error && <div className="alert">{error}</div>}
    <Card className="profile-sheet">
      <div className="profile-identity">
        <div className="avatar-wrap"><Avatar size="lg" name={account.displayName} src={account.profileImageUrl}/><button aria-label="Change profile photo" onClick={() => fileRef.current?.click()}><Camera/></button><input ref={fileRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void upload(event.target.files?.[0])}/></div>
        <div>
          <h2>{account.displayName}</h2>
          {account.linkedinConnected ? <p>{account.email}{account.emailVerified ? " · verified" : ""}</p> : null}
          <p>Member since {formatDate(account.createdAt, account.timeZone)}</p>
        </div>
      </div>
      <div className="form-grid">
        <Field label="Display name"><input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}/></Field>
        {account.linkedinConnected ? null : <Field label="Email"><input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}/></Field>}
        <Field label="Phone"><input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="Optional"/></Field>
      </div>
      <dl className="profile-facts">
        <div><dt>Time zone</dt><dd>{account.timeZone} · <Link to="/settings#timezone">Change</Link></dd></div>
        {account.locale ? <div><dt>Language</dt><dd>{localeLabel(account.locale)}</dd></div> : null}
        {linkedInNameDiffers ? <div><dt>LinkedIn name</dt><dd>{linkedInName}</dd></div> : null}
        {account.profileImageSource === "linkedin" ? <div><dt>Photo</dt><dd>From LinkedIn</dd></div> : null}
      </dl>
      <div className="actions">
        {account.linkedinConnected ? <Button type="button" variant="secondary" busy={refreshing} onClick={() => void refreshLinkedIn()}>Refresh LinkedIn</Button> : null}
        {account.profileImageUrl ? <Button type="button" variant="ghost" onClick={() => void remove()}>Remove photo</Button> : null}
        {dirty ? <Button type="button" variant="ghost" onClick={() => setForm({ displayName: account.displayName, email: account.email, phone: account.phone ?? "" })}>Cancel</Button> : null}
        {dirty ? <Button type="button" onClick={() => void save()} disabled={!form.displayName || (!account.linkedinConnected && !form.email)}><Save/> Save</Button> : null}
      </div>
    </Card>
  </div>;
}
type AssistantAccount = { provider: "openai" | "gemini" | "anthropic"; label: string; oauthAvailable: boolean; clientId: string | null; connected: boolean; ready: boolean; email: string | null; name: string | null };
const assistantNames = { openai: "ChatGPT", gemini: "Gemini", anthropic: "Claude" } as const;
function assistantNotice(code: string | null, connected: string | null) {
  if (connected && connected in assistantNames) return `${assistantNames[connected as keyof typeof assistantNames]} connected.`;
  const match = /^(openai|gemini|anthropic)_(not_configured|denied|state|conflict|failed|signed_out)$/.exec(code ?? "");
  if (!match) return code ? "The assistant could not be connected." : "";
  const name = assistantNames[match[1] as keyof typeof assistantNames];
  const reason = match[2];
  if (reason === "signed_out") return "Sign in again, then connect the assistant.";
  if (reason === "not_configured") return `${name} sign-in is not configured on this server.`;
  if (reason === "denied") return `${name} connection was cancelled.`;
  if (reason === "state") return `That ${name} connection expired. Try again.`;
  if (reason === "conflict") return `That ${name} account is already connected to another MeetPlus account.`;
  return `${name} could not be connected. Try again.`;
}
function AssistantsCard() {
  const query = useQuery({ queryKey: ["assistants"], queryFn: () => api<{ providers: AssistantAccount[] }>("/profile/assistants") });
  const [error, setError] = useState("");
  const disconnect = async (provider: AssistantAccount["provider"]) => {
    setError("");
    try { await api(`/profile/assistants/${provider}`, { method: "DELETE" }); await query.refetch(); } catch (err) { setError(message(err)); }
  };
  return <section id="assistants"><div className="settings-title"><Sparkles/><div><h2>Question assistants</h2><p>Connect ChatGPT, Claude, or Gemini. MeetPlus drafts questions with that sign-in and does not store an API key.</p></div></div>
    {error ? <div className="alert">{error}</div> : null}
    <div className="assistant-row">{(query.data?.providers ?? []).map((item) => <Card key={item.provider} className="assistant-card"><h3>{item.label}</h3>
      {item.connected ? <>
        <p>{item.name || item.email || "Connected"}</p>
        <p className="excel-note">{item.ready ? "Ready to draft questions." : "Reconnect and allow question drafting."}</p>
        <div className="actions">{item.oauthAvailable ? <a className="btn btn-secondary" href={`/api/auth/${item.provider}/connect`} {...(item.provider === "openai" && item.clientId ? { "data-oai-siwc-button": "", "data-oai-siwc-button-client": item.clientId } : {})}>Reconnect</a> : null}<Button type="button" variant="ghost" onClick={() => void disconnect(item.provider)}>Disconnect</Button></div>
      </> : item.oauthAvailable ? <a className="btn btn-primary" href={`/api/auth/${item.provider}/connect`} {...(item.provider === "openai" && item.clientId ? { "data-oai-siwc-button": "", "data-oai-siwc-button-client": item.clientId } : {})}>Connect {item.label}</a> : <p className="excel-note">This server does not have an OAuth client for {item.label} yet.</p>}
    </Card>)}</div>
  </section>;
}
export function Settings() {
  const {user,setUser}=useAuth();const navigate=useNavigate();const [params]=useSearchParams();
  const [password,setPassword]=useState({current:"",next:"",confirm:""});const [deleteForm,setDeleteForm]=useState({password:"",confirmation:""});const [zone,setZone]=useState(user!.timeZone);const [notice,setNotice]=useState("");const [error,setError]=useState("");
  useEffect(() => { setZone(user!.timeZone); }, [user!.timeZone]);
  useEffect(() => {
    const code = params.get("error");
    const connected = params.get("assistant");
    const text = assistantNotice(code, connected);
    if (code) setError(text);
    else if (connected) setNotice(text);
    if (code || connected) navigate("/settings", { replace: true });
  }, [navigate, params]);
  const theme=async(value:"LIGHT"|"DARK"|"SYSTEM")=>{setUser((current)=>current?{...current,theme:value}:current);try{await api("/profile",{method:"PATCH",body:JSON.stringify({theme:value})});}catch(e){setError(message(e));}};
  const saveZone=async()=>{setError("");setNotice("");try{const updated=await api<User>("/profile",{method:"PATCH",body:JSON.stringify({timeZone:zone})});setUser((current)=>current?{...current,...updated}:current);setNotice("Time zone saved. Meetup times stay the same instant and display in this zone.");}catch(e){setError(message(e));}};
  const changePassword=async(e:FormEvent)=>{e.preventDefault();if(password.next!==password.confirm)return setError("New passwords do not match.");try{const r=await api<{message:string}>("/auth/change-password",{method:"POST",body:JSON.stringify({currentPassword:password.current,newPassword:password.next})});setNotice(r.message);setError("");setPassword({current:"",next:"",confirm:""});}catch(e){setError(message(e));}};
  const deleteAccount=async(e:FormEvent)=>{e.preventDefault();if(!confirm("This removes your name, email, phone, photo, and sign-in. Meetup answers stay as anonymous results. Continue?"))return;try{await api("/profile",{method:"DELETE",body:JSON.stringify(user!.hasPassword === false ? { confirmation: deleteForm.confirmation } : deleteForm)});setUser(null);navigate("/login",{replace:true});}catch(err){setError(message(err));}};
  const zones = timeZoneOptions.includes(user!.timeZone) ? timeZoneOptions : [user!.timeZone, ...timeZoneOptions];
  return <div className="page settings-page"><PageHeader eyebrow="Preferences" title="Settings" description="Connected assistants, question alerts, appearance, time zone, and account security."/>
    {(error||notice)&&<div className={error?"alert":"success-box"}>{error||notice}</div>}
    <AssistantsCard />
    <QuestionAlerts variant="settings" />
    <Card><div className="settings-title"><Palette/><div><h2>Appearance</h2><p>Applied instantly on this device and saved to your account.</p></div></div><div className="theme-grid">{([["LIGHT",Sun,"Light"],["DARK",Moon,"Dark"],["SYSTEM",Palette,"System"]] as const).map(([value,Icon,label])=><button key={value} className={user!.theme===value?"active":""} onClick={()=>void theme(value)}><span className={`theme-preview ${value.toLowerCase()}`}><Icon/></span><strong>{label}</strong>{user!.theme===value&&<Check/>}</button>)}</div></Card>
    <Card><div className="settings-title" id="timezone"><Globe/><div><h2>Time zone</h2><p>Meetup, questionnaire, and question times are shown in this zone. Stored instants do not move.</p></div></div><Field label="Your time zone"><select value={zone} onChange={(event)=>setZone(event.target.value)}>{zones.map((item)=><option key={item} value={item}>{item}</option>)}</select></Field><div className="zone-preview"><strong>Preview</strong><span>{formatDate(new Date(), zone, "full")}</span></div>{zone!==user!.timeZone?<Button type="button" onClick={()=>void saveZone()}><Save/> Save time zone</Button>:null}</Card>
    {user!.hasPassword === false ? <Card><div className="settings-title"><KeyRound/><div><h2>Sign-in</h2><p>This account uses LinkedIn. There is no MeetPlus password to change.</p></div></div></Card> : <Card><div className="settings-title"><KeyRound/><div><h2>Change password</h2><p>Other signed-in sessions will be revoked.</p></div></div><form onSubmit={changePassword} className="form-grid"><Field label="Current password"><input type="password" value={password.current} onChange={e=>setPassword((current)=>({...current,current:e.target.value}))} required/></Field><Field label="New password" hint="12+ characters, mixed case and a number"><input type="password" value={password.next} onChange={e=>setPassword((current)=>({...current,next:e.target.value}))} required/></Field><Field label="Confirm new password"><input type="password" value={password.confirm} onChange={e=>setPassword((current)=>({...current,confirm:e.target.value}))} required/></Field><div><Button>Update password</Button></div></form></Card>}
    <YourDataSection />
    <Card className="danger-zone"><div className="settings-title"><ShieldAlert/><div><h2>Delete account</h2><p>Meetups you host that have not started will be cancelled. Your name, email, phone, photo, and sign-in are removed. Meetup answers stay so hosts can keep anonymous results, shown as Deleted user without your email.</p></div></div><form onSubmit={deleteAccount} className="form-grid">{user!.hasPassword === false ? null : <Field label="Current password"><input type="password" value={deleteForm.password} onChange={e=>setDeleteForm((current)=>({...current,password:e.target.value}))} required/></Field>}<Field label='Type "DELETE" to confirm'><input value={deleteForm.confirmation} onChange={e=>setDeleteForm((current)=>({...current,confirmation:e.target.value}))} required/></Field><div><Button variant="danger" disabled={deleteForm.confirmation!=="DELETE"}><Trash2/> Delete my account</Button></div></form></Card>
  </div>;
}
const helpSections: [string,string][]=[["Creating and joining","Admins choose one time zone for a meetup, then add questionnaires. Each questionnaire has its own start, stop, and four-option questions in that time zone. MeetPlus stores the times in GMT, and every participant sees them in their own time zone. Share a code, link, or QR. People can join while a meetup, questionnaire, or question is still running, and cannot join one that has already ended. Connect ChatGPT, Claude, or Gemini in Settings, then enter a topic and a count up to 20. The assistant returns questions in the Excel format. You can also download that format, export a questionnaire, or upload up to 20 questions."],["How timing works","Questions inside a questionnaire share that questionnaire’s start and stop. When there is room, each question is followed by 30 seconds so you can see how many people chose each option. A shorter questionnaire uses a shorter break. The host can pause the live questionnaire and resume it on the same question; the paused time is added to that questionnaire, the ones after it, and the meetup. The host can also skip to the next question, and the question moves on by itself once every joined participant has answered. A later questionnaire waits until its own start time. Your screen converts the stored GMT time into your time zone."],["Permanent answers","A submitted choice is final. This keeps live results fair and prevents changes after seeing participation."],["Connectivity","If you go offline, MeetPlus keeps the current screen visible and resynchronizes when you reconnect. Turn on question alerts to get a notification when the next question starts."],["Account support","Sign in with the LinkedIn account you used to join. For additional support, contact your MeetPlus workspace administrator."]];
export function Help(){const [search,setSearch]=useState("");return <div className="page narrow"><PageHeader eyebrow="Support" title="How can we help?" description="Quick answers for a smooth meetup."/><input className="help-search" placeholder="Search help…" value={search} onChange={e=>setSearch(e.target.value)}/><div className="help-list">{helpSections.filter(([a,b])=>(a+b).toLowerCase().includes(search.toLowerCase())).map(([title,text])=><details key={title}><summary>{title}<ChevronDown/></summary><p>{text}</p></details>)}</div><section id="about"><Card className="about-card"><span className="logo-mark"><Info/></span><h2>MeetPlus Web</h2><p>Version 1.0.0 · React 19</p><p>MeetPlus stores only the account and response information needed to operate timed meetups. Participant choices are visible to the owning administrator; live participant views never reveal competing option counts or names.</p><p><Link to="/privacy">Read the privacy notice</Link>.</p></Card></section></div>}
