import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, BarChart3, CalendarDays, Check, Clipboard, Copy, Download, Edit3, ExternalLink, FileDown, GripVertical, Plus, Search, Share2, Trash2, UsersRound, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { api, duration, formatDate, message, zonedInput, zonedLocalToUtc } from "../lib";
import type { Meetup, MeetupDetail, Question, ResultQuestion } from "../types";
import { Button, Card, Empty, ErrorState, Field, Loading, PageHeader, Status, Toast } from "../ui";

const phase = (m: Meetup, now = Date.now()) => m.status === "CANCELLED" ? "CANCELLED" : m.status === "DRAFT" ? "DRAFT" : now < Date.parse(m.startsAt) ? "UPCOMING" : now < Date.parse(m.endsAt) ? "LIVE" : "COMPLETED";
function useMeetups() { return useQuery({ queryKey: ["meetups"], queryFn: () => api<{ meetups: Meetup[]; serverTime: string }>("/meetups") }); }
function MeetupRow({ meetup }: { meetup: Meetup }) {
  const { user } = useAuth(); const current = phase(meetup);
  return <Card className="meetup-row"><div className="date-tile"><strong>{new Intl.DateTimeFormat(undefined, { timeZone: user!.timeZone, day: "2-digit" }).format(new Date(meetup.startsAt))}</strong><span>{new Intl.DateTimeFormat(undefined, { timeZone: user!.timeZone, month: "short" }).format(new Date(meetup.startsAt))}</span></div>
    <div className="meetup-main"><div className="row-title"><h3>{meetup.title}</h3><Status value={current}/></div><p><CalendarDays/> {formatDate(meetup.startsAt, user!.timeZone)}</p><div className="meta"><span>{meetup.questionCount} questions</span><span>{meetup.memberCount ?? 0} participants</span>{meetup.publicCode && <span>Code {meetup.publicCode}</span>}</div></div>
    <div className="row-actions"><Link className="icon-btn" aria-label="Details" to={`/admin/meetups/${meetup.id}`}><ExternalLink/></Link>{current === "UPCOMING" && <Link className="icon-btn" aria-label="Edit" to={`/admin/meetups/${meetup.id}/edit`}><Edit3/></Link>}<Link className="btn btn-secondary" to={`/admin/meetups/${meetup.id}/results`}><BarChart3/> Results</Link></div>
  </Card>;
}
export function AdminDashboard() {
  const { user } = useAuth(); const query = useMeetups();
  if (query.isLoading) return <Loading label="Preparing your dashboard…" />; if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()}/>;
  const meetups = query.data!.meetups, counts = ["UPCOMING","LIVE","COMPLETED"].map(k => meetups.filter(m => phase(m) === k).length);
  const next = [...meetups].filter(m => phase(m) === "UPCOMING").sort((a,b) => Date.parse(a.startsAt)-Date.parse(b.startsAt))[0];
  return <div className="page"><PageHeader eyebrow="Admin dashboard" title={`Good to see you, ${user!.displayName.split(" ")[0]}!`} description="Here’s what’s happening across your meetups." action={<Link className="btn btn-primary" to="/admin/create"><Plus/> Create meetup</Link>}/>
    <div className="stats"><Card><span className="stat-icon violet"><CalendarDays/></span><div><strong>{counts[0]}</strong><span>Upcoming</span></div></Card><Card><span className="stat-icon coral"><span className="live-dot"/></span><div><strong>{counts[1]}</strong><span>Live now</span></div></Card><Card><span className="stat-icon cyan"><Check/></span><div><strong>{counts[2]}</strong><span>Completed</span></div></Card><Card><span className="stat-icon green"><UsersRound/></span><div><strong>{meetups.reduce((n,m) => n + (m.memberCount ?? 0), 0)}</strong><span>Total participants</span></div></Card></div>
    <div className="section-head"><div><span className="eyebrow">Up next</span><h2>Your next meetup</h2></div><Link to="/admin/meetups">View all</Link></div>
    {next ? <MeetupRow meetup={next}/> : <Empty title="Your calendar is wide open" text="Create a meetup and invite your participants." action={<Link className="btn btn-primary" to="/admin/create">Create meetup</Link>}/>}
    <div className="section-head"><div><span className="eyebrow">Recent activity</span><h2>Latest meetups</h2></div></div>
    <div className="stack">{meetups.slice(0,3).map(m => <MeetupRow key={m.id} meetup={m}/>)}</div>
  </div>;
}
export function AdminMeetups({ resultsOnly = false }: { resultsOnly?: boolean }) {
  const query = useMeetups(); const [filter, setFilter] = useState(resultsOnly ? "LIVE" : "ALL"); const [search, setSearch] = useState("");
  if (query.isLoading) return <Loading/>; if (query.error) return <ErrorState error={query.error}/>;
  const filters = resultsOnly ? ["LIVE","COMPLETED"] : ["ALL","UPCOMING","LIVE","COMPLETED","DRAFT","CANCELLED"];
  const visible = query.data!.meetups.filter(m => (!resultsOnly || ["LIVE","COMPLETED"].includes(phase(m))) && (filter === "ALL" || phase(m) === filter) && `${m.title} ${m.publicCode}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="page"><PageHeader eyebrow={resultsOnly ? "Insights" : "Manage"} title={resultsOnly ? "Meetup results" : "Your meetups"} description={resultsOnly ? "Track responses and discover what your room chose." : "Create, share and manage every gathering."} action={!resultsOnly && <Link className="btn btn-primary" to="/admin/create"><Plus/> Create meetup</Link>}/>
    <div className="toolbar"><div className="search"><Search/><input aria-label="Search meetups" placeholder="Search title or code…" value={search} onChange={e => setSearch(e.target.value)}/></div><div className="chips">{filters.map(f => <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>{f[0]+f.slice(1).toLowerCase()}</button>)}</div></div>
    <div className="stack">{visible.map(m => <MeetupRow key={m.id} meetup={m}/>)}</div>{!visible.length && <Empty title="No meetups found" text="Try another filter or create your first meetup."/>}
  </div>;
}
const blankQuestion = (): Question => ({ prompt: "", options: Array.from({ length: 4 }, () => ({ label: "" })) });
export function MeetupEditor() {
  const { id } = useParams(); const detail = useQuery({ queryKey: ["meetup", id], queryFn: () => api<MeetupDetail>(`/meetups/${id}`), enabled: !!id });
  if (id && detail.isLoading) return <Loading/>; if (detail.error) return <ErrorState error={detail.error}/>;
  return <MeetupForm existing={detail.data}/>;
}
function MeetupForm({ existing }: { existing: MeetupDetail | undefined }) {
  const { user } = useAuth(); const navigate = useNavigate(); const queryClient = useQueryClient();
  const initialStart = zonedInput(existing?.startsAt ?? new Date(Date.now()+86400000), user!.timeZone);
  const initialEnd = zonedInput(existing?.endsAt ?? new Date(Date.now()+86400000+3600000), user!.timeZone);
  const [title, setTitle] = useState(existing?.title ?? ""); const [starts, setStarts] = useState(initialStart); const [ends, setEnds] = useState(initialEnd);
  const [questions, setQuestions] = useState<Question[]>(existing?.questions.map(q => ({...q, options: q.options.map(o => ({...o}))})) ?? [blankQuestion()]);
  const [error, setError] = useState(""); const [saving, setSaving] = useState<"DRAFT"|"PUBLISHED"|null>(null);
  let total = 0;
  try { total = Date.parse(zonedLocalToUtc(ends, user!.timeZone)) - Date.parse(zonedLocalToUtc(starts, user!.timeZone)); } catch { total = 0; }
  const interval = questions.length ? total / questions.length : 0;
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); }; addEventListener("beforeunload", warn); return () => removeEventListener("beforeunload", warn); }, []);
  const updateQuestion = (index: number, next: Question) => setQuestions(q => q.map((value, i) => i === index ? next : value));
  const move = (index: number, by: number) => setQuestions(q => { const next = [...q], target = index + by; if (target < 0 || target >= next.length) return q; [next[index], next[target]] = [next[target]!, next[index]!]; return next; });
  const save = async (status: "DRAFT"|"PUBLISHED") => { setSaving(status); setError("");
    try {
      const body = { title, startsAt: zonedLocalToUtc(starts, user!.timeZone), endsAt: zonedLocalToUtc(ends, user!.timeZone), sourceTimeZone: user!.timeZone, status, questions: questions.map(q => ({ prompt: q.prompt, options: q.options.map(o => o.label) })), ...(existing ? { version: existing.version } : {}) };
      const result = await api<Meetup>(existing ? `/meetups/${existing.id}` : "/meetups", { method: existing ? "PUT" : "POST", body: JSON.stringify(body) });
      await queryClient.invalidateQueries({ queryKey: ["meetups"] }); navigate(`/admin/meetups/${result.id ?? existing!.id}`);
    } catch (err) { setError(message(err)); document.querySelector<HTMLElement>(".field-error, .alert")?.focus(); } finally { setSaving(null); }
  };
  const readOnly = existing ? Date.now() >= Date.parse(existing.startsAt) : false;
  return <div className="page editor-page"><PageHeader eyebrow={existing ? "Edit meetup" : "New meetup"} title={existing ? existing.title : "Create something memorable"} description="Set the moment, shape the questions, then invite your room."/>
    {readOnly && <div className="alert">This meetup has started. Its schedule and questions are now read-only.</div>}{error && <div className="alert field-error" tabIndex={-1}>{error}</div>}
    <div className="editor-grid"><div className="editor-content"><Card><div className="step-title"><span>1</span><div><h2>Meetup details</h2><p>When and where in time?</p></div></div>
      <Field label="Meetup title"><input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} required disabled={readOnly} placeholder="e.g. Product Pulse — September"/></Field>
      <div className="form-grid"><Field label="Starts"><input type="datetime-local" value={starts} onChange={e => setStarts(e.target.value)} disabled={readOnly}/></Field><Field label="Ends"><input type="datetime-local" value={ends} onChange={e => setEnds(e.target.value)} disabled={readOnly}/></Field></div>
      <div className="zone-note"><CalendarDays/> Entered in <strong>{user!.timeZone}</strong>. All participants see it in their saved zone.</div></Card>
      <Card><div className="step-title"><span>2</span><div><h2>Questions</h2><p>Exactly four options per question.</p></div></div>
      <div className="question-list">{questions.map((q, index) => <Card key={index} className="question-card"><div className="question-head"><GripVertical/><strong>Question {index+1}</strong><div><button aria-label="Move up" onClick={() => move(index,-1)} disabled={readOnly || index===0}><ArrowUp/></button><button aria-label="Move down" onClick={() => move(index,1)} disabled={readOnly || index===questions.length-1}><ArrowDown/></button><button aria-label="Duplicate" onClick={() => setQuestions(v => [...v.slice(0,index+1), structuredClone(q), ...v.slice(index+1)])} disabled={readOnly}><Copy/></button><button aria-label="Delete" onClick={() => setQuestions(v => v.filter((_,i)=>i!==index))} disabled={readOnly || questions.length===1}><Trash2/></button></div></div>
        <Field label="Prompt"><textarea value={q.prompt} onChange={e => updateQuestion(index,{...q,prompt:e.target.value})} disabled={readOnly} placeholder="Ask one clear, focused question…"/></Field>
        <div className="options-grid">{q.options.map((o, oi) => <Field key={oi} label={`Option ${String.fromCharCode(65+oi)}`}><input value={o.label} onChange={e => updateQuestion(index,{...q,options:q.options.map((old,j)=>j===oi?{...old,label:e.target.value}:old)})} disabled={readOnly} placeholder={`Choice ${oi+1}`}/></Field>)}</div>
      </Card>)}</div><Button variant="secondary" onClick={() => setQuestions(q => [...q,blankQuestion()])} disabled={readOnly}><Plus/> Add question</Button></Card>
      <Card><div className="step-title"><span>3</span><div><h2>Schedule preview</h2><p>{interval > 0 ? `${duration(interval)} per question` : "Choose a valid time range"}</p></div></div>
      <div className="schedule">{questions.map((q,i) => <div key={i}><span>{i+1}</span><div><strong>{q.prompt || `Question ${i+1}`}</strong><small>{total > 0 ? `${new Intl.DateTimeFormat(undefined,{timeZone:user!.timeZone,hour:"2-digit",minute:"2-digit",timeZoneName:"short"}).format(new Date(zonedLocalToUtc(starts,user!.timeZone)).getTime()+interval*i)} – ${new Intl.DateTimeFormat(undefined,{timeZone:user!.timeZone,hour:"2-digit",minute:"2-digit",timeZoneName:"short"}).format(new Date(zonedLocalToUtc(starts,user!.timeZone)).getTime()+interval*(i+1))}` : "—"}</small></div></div>)}</div></Card></div>
      <aside className="editor-summary"><Card><span className="eyebrow">Ready when you are</span><h2>Meetup summary</h2><dl><div><dt>Questions</dt><dd>{questions.length}</dd></div><div><dt>Duration</dt><dd>{duration(total)}</dd></div><div><dt>Each question</dt><dd>{duration(interval)}</dd></div></dl><Button variant="secondary" busy={saving==="DRAFT"} disabled={readOnly} onClick={() => void save("DRAFT")}>Save draft</Button><Button busy={saving==="PUBLISHED"} disabled={readOnly} onClick={() => void save("PUBLISHED")}><Check/> {existing ? "Save & publish" : "Publish meetup"}</Button></Card></aside>
    </div></div>;
}
export function MeetupDetails() {
  const { id } = useParams(); const { user } = useAuth(); const queryClient = useQueryClient(); const [toast,setToast]=useState(""); const [qr,setQr]=useState("");
  const query = useQuery({ queryKey:["meetup",id], queryFn:()=>api<MeetupDetail>(`/meetups/${id}`) });
  useEffect(() => {
    const joinUrl = query.data?.joinUrl;
    if (!joinUrl) return;
    let cancelled = false;
    void import("qrcode").then(({ default: QRCode }) =>
      QRCode.toDataURL(joinUrl, { width: 480, margin: 2, color: { dark: "#171433", light: "#ffffff" } }).then((url) => {
        if (!cancelled) setQr(url);
      }),
    );
    return () => { cancelled = true; };
  }, [query.data?.joinUrl]);
  if(query.isLoading)return <Loading/>; if(query.error)return <ErrorState error={query.error}/>; const m=query.data!;
  const copy=async(value:string,label:string)=>{await navigator.clipboard.writeText(value);setToast(`${label} copied`);setTimeout(()=>setToast(""),2000);};
  const share=async()=>{if(navigator.share)await navigator.share({title:m.title,url:m.joinUrl});else await copy(m.joinUrl,"Link");};
  const cancel=async()=>{if(!confirm("Cancel this meetup for every participant?"))return;await api(`/meetups/${m.id}/cancel`,{method:"POST"});await queryClient.invalidateQueries({queryKey:["meetup",id]});};
  return <div className="page"><PageHeader eyebrow="Meetup details" title={m.title} description={formatDate(m.startsAt,user!.timeZone,"full")} action={<div className="actions"><Link className="btn btn-secondary" to={`/admin/meetups/${m.id}/edit`}><Edit3/> Edit</Link><Link className="btn btn-primary" to={`/admin/meetups/${m.id}/results`}><BarChart3/> Results</Link></div>}/>
    <div className="detail-grid"><div className="stack"><Card><div className="row-title"><h2>At a glance</h2><Status value={phase(m)}/></div><dl className="detail-list"><div><dt>Starts</dt><dd>{formatDate(m.startsAt,user!.timeZone,"full")}</dd></div><div><dt>Ends</dt><dd>{formatDate(m.endsAt,user!.timeZone,"full")}</dd></div><div><dt>Questions</dt><dd>{m.questionCount}</dd></div><div><dt>Participants</dt><dd>{m.memberCount ?? 0}</dd></div></dl></Card>
    <Card><h2>Questionnaire</h2><ol className="detail-questions">{m.questions.map(q=><li key={q.id}><strong>{q.prompt}</strong><div>{q.options.map(o=><span key={o.id}>{o.label}</span>)}</div></li>)}</ol></Card></div>
    <Card className="share-card"><span className="eyebrow">Invite your room</span><h2>Share meetup</h2><p>Eight-digit code</p><button className="code-block" onClick={()=>void copy(m.publicCode!,"Code")}>{m.publicCode}<Clipboard/></button>{qr&&<img src={qr} alt={`QR code for ${m.title}`}/>}<div className="share-link"><input value={m.joinUrl} readOnly/><button onClick={()=>void copy(m.joinUrl,"Link")}><Copy/></button></div><div className="share-actions"><Button onClick={()=>void share()}><Share2/> Share</Button><a className="btn btn-secondary" href={qr} download={`meetcon-${m.publicCode}.png`}><Download/> QR</a></div>{phase(m)==="UPCOMING"&&<Button variant="danger" onClick={()=>void cancel()}><X/> Cancel meetup</Button>}</Card></div>{toast&&<Toast>{toast}</Toast>}
  </div>;
}
export function ResultsDashboard() {
  const { id }=useParams(); const {user}=useAuth();
  const query=useQuery({
    queryKey:["results",id],
    queryFn:()=>api<{meetup:{id:string;title:string;joinedCount:number;startsAt:string;endsAt:string;status:string};questions:ResultQuestion[];serverTime:string}>(`/meetups/${id}/results`),
    refetchInterval:(q) => {
      const meetup = q.state.data?.meetup;
      if (!meetup) return false;
      const now = Date.now();
      return now >= Date.parse(meetup.startsAt) && now < Date.parse(meetup.endsAt) ? 10_000 : false;
    },
  });
  if(query.isLoading)return <Loading/>;if(query.error)return <ErrorState error={query.error}/>;const {meetup,questions}=query.data!;const answered=questions.reduce((n,q)=>n+q.answered,0),possible=meetup.joinedCount*questions.length;
  const download=async()=>{const r=await fetch(`/api/meetups/${id}/results.csv`,{credentials:"include"});const blob=await r.blob();const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`meetcon-${id}-results.csv`;a.click();URL.revokeObjectURL(a.href);};
  return <div className="page"><PageHeader eyebrow="Results dashboard" title={meetup.title} description={`${formatDate(meetup.startsAt,user!.timeZone)} · Live data refreshes automatically`} action={<Button variant="secondary" onClick={()=>void download()}><FileDown/> Export CSV</Button>}/>
    <div className="stats"><Card><strong>{meetup.joinedCount}</strong><span>Joined users</span></Card><Card><strong>{answered}</strong><span>Answers</span></Card><Card><strong>{Math.max(0,possible-answered)}</strong><span>Skipped / pending</span></Card><Card><strong>{possible?Math.round(answered/possible*100):0}%</strong><span>Response rate</span></Card></div>
    <div className="results-list">{questions.map(q=><details className="result-question" key={q.id} open><summary><span>Q{q.position}</span><div><strong>{q.prompt}</strong><small>{q.answered} responses</small></div></summary><div className="result-options">{q.options.map((o,i)=><div className="result-option" key={o.id}><div className="result-label"><span><i className={`accent a${i}`}/>{o.label}</span><strong>{o.count} <small>{Math.round(o.percentage)}%</small></strong></div><div className="bar"><i style={{transform:`scaleX(${o.percentage/100})`}}/></div><div className="respondents">{o.users.length?o.users.map(u=><span key={u.id}>{u.displayName}</span>):<em>No selections yet</em>}</div></div>)}</div></details>)}</div>
  </div>;
}
