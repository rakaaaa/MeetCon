import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Check, CheckCircle2, Clock3, Hash, Radio, Sparkles, TicketCheck, UsersRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { api, duration, formatDate, message } from "../lib";
import { RemainingClocks, useRoomLive, useServerCountdown } from "../clock";
import type { ActiveState, Meetup, MeetupListItem } from "../types";
import { nextRoomPulse, pulseRoom, type RoomMark } from "../haptics";
import { QuestionAlerts } from "../question-alerts";
import { Button, Card, Collapse, Empty, ErrorState, Loading, PageHeader, QuestionnaireSummary, questionnaireIsLive, Status } from "../ui";

type Preview = { id: string; title: string; organizer: string; startsAt: string; endsAt: string; questionCount: number; sourceTimeZone?: string };
const memberPhase = (m: Meetup, now: number) => m.status === "CANCELLED" ? "CANCELLED" : now < Date.parse(m.startsAt) ? "UPCOMING" : now < Date.parse(m.endsAt) ? "LIVE" : "COMPLETED";

export function MyMeetups() {
  const { user } = useAuth(); const [tab,setTab]=useState<"UPCOMING"|"LIVE"|"COMPLETED">("UPCOMING");
  const query=useQuery({queryKey:["my-meetups"],queryFn:()=>api<{meetups:MeetupListItem[];serverTime:string}>("/my-meetups")});
  const opened=useRef(false);
  useEffect(()=>{
    if(!query.data||opened.current)return;
    opened.current=true;
    const now=Date.parse(query.data.serverTime);
    if(query.data.meetups.some((meetup)=>memberPhase(meetup,now)==="LIVE"))setTab("LIVE");
  },[query.data]);
  if(query.isLoading)return <Loading label="Finding your meetups…"/>;if(query.error)return <ErrorState error={query.error} retry={()=>void query.refetch()}/>;
  const now=Date.parse(query.data!.serverTime);
  const grouped: Record<"UPCOMING" | "LIVE" | "COMPLETED", MeetupListItem[]> = { UPCOMING: [], LIVE: [], COMPLETED: [] };
  for (const meetup of query.data!.meetups) {
    const key = memberPhase(meetup, now);
    if (key === "UPCOMING" || key === "LIVE" || key === "COMPLETED") grouped[key].push(meetup);
  }
  const visible = grouped[tab];
  return <div className="page"><PageHeader eyebrow="Your meetups" title={`Hey ${user!.displayName.split(" ")[0]}, you’re in!`} description="Open a meetup, or join one with a code." action={<Link className="btn btn-primary" to="/app/join"><Hash/> Join meetup</Link>}/>
    <QuestionAlerts />
    <div className="tabs">{(["UPCOMING","LIVE","COMPLETED"] as const).map(value=><button className={tab===value?"active":""} onClick={()=>setTab(value)} key={value}>{value==="LIVE"?<i/>:null}{value[0]+value.slice(1).toLowerCase()} <span>{grouped[value].length}</span></button>)}</div>
    <div className="meetup-cards">{visible.map((m) => {
      const live = m.questionnaires?.find((item) => questionnaireIsLive(item, now));
      const answered = (m.questionnaires ?? []).reduce((sum, item) => item.status === "DRAFT" ? sum : sum + item.answeredCount, 0);
      return <Collapse className={`card user-meetup ${tab.toLowerCase()}`} key={m.id} defaultOpen={tab === "LIVE"} summary={<><div className="user-card-top"><Status value={tab}/><span>{m.questionCount} questions</span></div><h2>{m.title}</h2><p className="organizer"><span className="avatar avatar-sm">{m.organizer?.[0]}</span>Hosted by {m.organizer}</p><div className="card-time"><CalendarDays/><div><strong>{formatDate(m.startsAt,user!.timeZone)}</strong><span>{live ? `${m.memberCount ?? 0} live · ${live.answeredCount} answered` : tab==="UPCOMING"?`Starts in ${duration(Date.parse(m.startsAt)-now)}`:tab==="LIVE"?"Join live now":`${m.memberCount ?? 0} participants · ${answered} answered`}</span></div></div><Link className="card-cta" to={`/app/meetups/${m.id}`}>{tab==="LIVE"?"Join live":"Open meetup"} <ArrowRight/></Link></>}>
        <QuestionnaireSummary items={(m.questionnaires ?? []).filter((item) => item.status !== "DRAFT")} zone={user!.timeZone} now={now}/>
      </Collapse>;
    })}</div>
    {!visible.length&&<Empty icon={<TicketCheck/>} title={`No ${tab.toLowerCase()} meetups`} text="Enter an eight-digit code or open a shared invitation link." action={<Link className="btn btn-primary" to="/app/join">Join a meetup</Link>}/>}
  </div>;
}
export function JoinMeetup({ token }: { token?: string | undefined }) {
  const navigate=useNavigate();const {user}=useAuth();const [code,setCode]=useState("");const [preview,setPreview]=useState<Preview|null>(null);const [error,setError]=useState("");
  const kind=token?"token":"code", value=token??code;
  const previewMutation=useMutation({mutationFn:()=>api<{meetup:Preview}>(`/join/${kind}/preview`,{method:"POST",body:JSON.stringify({[kind]:value})}),onSuccess:r=>{setPreview(r.meetup);if(token)history.replaceState(null,"","/app/join");},onError:e=>setError(message(e))});
  const joinMutation=useMutation({mutationFn:()=>api<{meetupId:string;alreadyJoined:boolean}>(`/join/${kind}`,{method:"POST",body:JSON.stringify({[kind]:value})}),onSuccess:r=>{sessionStorage.removeItem("meetcon:join-token");navigate(`/app/meetups/${r.meetupId}`,{replace:true});},onError:e=>setError(message(e))});
  const requestedToken = useRef<string | undefined>(undefined);
  const lookedUpCode = useRef("");
  useEffect(() => {
    if (token || code.length !== 8 || lookedUpCode.current === code) return;
    lookedUpCode.current = code;
    previewMutation.mutate();
  }, [code, token, previewMutation.mutate]);
  useEffect(()=>{
    if (!token || !user || requestedToken.current === token) return;
    requestedToken.current = token;
    previewMutation.mutate();
  },[token, user, previewMutation.mutate]);
  const change=(raw:string)=>{const next=raw.replace(/\D/g,"").slice(0,8);setCode(next);if(next.length<8){setPreview(null);lookedUpCode.current="";}};
  const ready=preview&&(token||code.length===8);
  return <div className="page narrow"><PageHeader eyebrow="Join the room" title="Enter your meetup code" description="Eight digits are all it takes to join the conversation."/>
    <Card className="join-card"><span className="join-icon"><Hash/></span><form onSubmit={(event)=>{event.preventDefault();if(ready)joinMutation.mutate();else previewMutation.mutate();}}><label className="sr-only" htmlFor="join-code">Eight-digit meetup code</label><input id="join-code" className="code-input" inputMode="numeric" autoComplete="one-time-code" placeholder="0000 0000" value={token?"":code.replace(/(\d{4})(\d+)/,"$1 $2")} onChange={e=>change(e.target.value)} onPaste={(e:ClipboardEvent<HTMLInputElement>)=>{e.preventDefault();change(e.clipboardData.getData("text"));}} autoFocus readOnly={!!token}/>
      {!token&&<div className="code-dots">{Array.from({length:8},(_,i)=><i className={i<code.length?"filled":""} key={i}/>)}</div>}
      {ready&&preview?<div className="confirm-facts"><h2>{preview.title}</h2><p>Hosted by <strong>{preview.organizer}</strong></p><div><CalendarDays/><span>When<strong>{formatDate(preview.startsAt,user!.timeZone,"full")}</strong></span></div><p>Shown in your time zone, {user!.timeZone}. You can join while it is still running.</p></div>:null}
      {error&&<div className="alert">{error}</div>}<Button busy={previewMutation.isPending||joinMutation.isPending} disabled={!token&&code.length!==8} className="wide">{ready ? <>Join this meetup <Check/></> : <>Find meetup <ArrowRight/></>}</Button></form>
      <div className="join-help"><Sparkles/><div><strong>Have a QR code?</strong><p>Scan it with your phone camera. The shared browser link opens MeetPlus directly.</p></div></div></Card>
  </div>;
}
export function InviteGate() {
  const {token}=useParams();const {user,loading}=useAuth();
  useEffect(()=>{if(token)sessionStorage.setItem("meetcon:join-token",token);},[token]);
  if(loading)return <Loading/>;if(!user)return <Navigate to="/login" state={{from:`/join/${token}`}} replace/>;
  if(user.privacyCurrent !== true)return <Navigate to="/privacy/accept" state={{from:`/join/${token}`}} replace/>;
  return <JoinMeetup token={token}/>;
}
export function LiveMeetup() {
  const {id}=useParams();const {user}=useAuth();const queryClient=useQueryClient();
  const query=useQuery({queryKey:["active",id],queryFn:()=>api<ActiveState>(`/meetups/${id}/active`),refetchOnWindowFocus:true,retry:1});
  const refetch=useCallback(()=>void query.refetch(),[query.refetch]);
  useEffect(()=>{if(!query.data?.phaseEndsAt||query.data.paused)return;const delay=Math.max(0,Date.parse(query.data.phaseEndsAt)-Date.parse(query.data.serverTime))+Math.random()*300;const timer=setTimeout(()=>void refetch(),delay);return()=>clearTimeout(timer);},[query.data?.phaseEndsAt,query.data?.serverTime,query.data?.question?.id,query.data?.paused,refetch]);
  useEffect(()=>{const visible=()=>{if(document.visibilityState==="visible")refetch();};document.addEventListener("visibilitychange",visible);addEventListener("focus",visible);addEventListener("online",visible);return()=>{document.removeEventListener("visibilitychange",visible);removeEventListener("focus",visible);removeEventListener("online",visible);};},[refetch]);
  if(query.isLoading)return <Loading label="Synchronizing with the room…"/>;if(query.error)return <ErrorState error={query.error} retry={()=>void query.refetch()}/>;const state=query.data!;
  return <LiveRoom state={state} zone={user!.timeZone} onUpdate={(next)=>queryClient.setQueryData(["active",id],next)} onStopped={()=>void query.refetch()}/>;
}
function StopNotice({ notice }: { notice: ActiveState["notice"] }) {
  if (!notice) return null;
  const text = notice.reason === "DELETED" ? `The host removed “${notice.title}”.` : `The host paused “${notice.title}”. It is no longer live.`;
  return <div className="alert" role="status">{text}</div>;
}
function LiveRoom({state,zone,onUpdate,onStopped}:{state:ActiveState;zone:string;onUpdate:(next:ActiveState)=>void;onStopped:()=>void}) {
  const [notice, setNotice] = useState(state.notice ?? null);
  const roomMark = useRef<RoomMark | null>(null);
  useEffect(() => { if (state.notice) setNotice(state.notice); }, [state.notice]);
  useEffect(() => {
    const current: RoomMark = {
      phase: state.phase,
      questionnaireId: state.phase === "ANSWERING" ? state.questionnaire?.id ?? "" : "",
      questionId: state.phase === "ANSWERING" ? state.question?.id ?? "" : "",
      halted: Boolean(notice) && state.phase === "ANSWERING",
    };
    const pulse = nextRoomPulse(roomMark.current, current);
    roomMark.current = current;
    if (pulse) pulseRoom(pulse);
  }, [state.phase, state.questionnaire?.id, state.question?.id, notice]);
  const answerLocked = useRef(false);
  answerLocked.current = state.phase === "ANSWERING" && Boolean(state.answer);
  const room = useRoomLive(state.meetup.id, state.question?.id, state.participantCount, state.answeredCount ?? 0, (next) => { setNotice(next); onStopped(); }, onStopped, () => { if (answerLocked.current) onStopped(); });
  const joined = room.joined;
  const questionEnd = state.phase === "ANSWERING" || state.review ? state.phaseEndsAt : state.questionEndsAt;
  const clocks = <RemainingClocks meetupEndsAt={state.meetup.endsAt} questionnaireEndsAt={state.questionnaire?.endsAt ?? null} questionEndsAt={questionEnd ?? null} serverTime={state.serverTime} paused={state.paused === true}/>;
  const stopped = <StopNotice notice={notice}/>;
  if(state.phase==="WAITING")return <Waiting state={state} zone={zone} joined={joined} clocks={clocks} notice={stopped}/>;
  if(state.phase==="COMPLETED")return <Completed state={state} joined={joined} notice={stopped}/>;
  return <QuestionScreen key={state.question?.id} state={state} joined={joined} answered={room.answered} clocks={clocks} onUpdate={onUpdate} notice={stopped}/>;
}
type ChoiceStanding = "ahead" | "behind" | "tied" | "missed" | "open";
function choiceStanding(options: { id: string; count: number }[], yourOptionId?: string | null): ChoiceStanding {
  if (!yourOptionId) return "missed";
  const yours = options.find((option) => option.id === yourOptionId);
  const peak = options.reduce((highest, option) => option.count > highest ? option.count : highest, 0);
  if (!yours || peak <= 0) return "open";
  const tied = options.filter((option) => option.count === peak).length > 1;
  if (yours.count === peak) return tied ? "tied" : "ahead";
  return "behind";
}
const standingCopy: Record<ChoiceStanding, string> = {
  ahead: "Your choice is leading",
  behind: "Your choice is trailing",
  tied: "Your choice is tied for the lead",
  missed: "This question closed before you answered",
  open: "",
};
function OptionBars({ options, yourOptionId }: { options: { id: string; label: string; count: number }[]; yourOptionId?: string | null }) {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const total = options.reduce((sum, option) => sum + option.count, 0);
  const standing = choiceStanding(options, yourOptionId);
  const copy = standingCopy[standing];
  const peak = options.reduce((highest, option) => option.count > highest ? option.count : highest, 0);
  return <div className={`stage-results verdict-${standing}`}>
    {copy ? <p className={`verdict-stamp ${standing}`} role="status">{copy}</p> : null}
    <ul className="option-bars" aria-label="How many people chose each option">{options.map((option, index) => {
      const share = total > 0 ? Math.round(option.count / total * 100) : 0;
      const yours = option.id === yourOptionId;
      const lead = peak > 0 && option.count === peak;
      const mark = lead ? "is-lead" : peak > 0 ? "is-trail" : "";
      return <li className={`option-bar tone-${index} ${yours ? "yours" : ""} ${mark}`} style={{ animationDelay: `${index * 60}ms` }} key={option.id}><header><span>{String.fromCharCode(65 + index)}</span><strong>{option.label}{yours ? <small>Your choice</small> : null}</strong><em>{option.count}</em></header><div className="option-bar-track" role="meter" aria-valuemin={0} aria-valuemax={Math.max(total, 1)} aria-valuenow={option.count} aria-label={`${option.label}, ${option.count} of ${total}`}><i style={{ width: drawn ? `${share}%` : "0%" }}/></div></li>;
    })}</ul>
  </div>;
}
function Waiting({state,zone,joined,clocks,notice}:{state:ActiveState;zone:string;joined:number;clocks:ReactNode;notice:ReactNode}) {
  const next = state.questionnaire;
  const between = Date.parse(state.serverTime) >= Date.parse(state.meetup.startsAt);
  const review = state.review;
  const breakLeft = useServerCountdown(review ? state.phaseEndsAt : null, state.serverTime, state.paused === true);
  if (review) {
    return <div className="focus-page waiting results-break"><QuestionAlerts />{notice}<span className="status status-upcoming"><Check/> Results</span><p className="questionnaire-kicker">Question {review.position} of {review.questionCount}</p><h1 className="stage-prompt">{review.prompt}</h1><OptionBars options={review.options} yourOptionId={review.yourOptionId}/><p className="waiting-copy">{next ? `Next question in ${duration(breakLeft)}.` : `These results stay up for ${duration(breakLeft)}.`}</p>{clocks}<p className="waiting-copy">{joined} {joined === 1 ? "participant is" : "participants are"} here.</p></div>;
  }
  return <div className="focus-page waiting"><QuestionAlerts />{notice}<div className="waiting-orb"><Radio/></div><span className="status status-upcoming"><Check/> You’re joined</span><h1>{state.meetup.title}</h1><p>Hosted by {state.meetup.organizer}</p>{clocks}<Card className="waiting-facts"><CalendarDays/><div><span>{between ? "Up next" : "Scheduled for"}</span><strong>{next ? `${next.title} · ${formatDate(next.startsAt, zone, "full")}` : formatDate(state.meetup.startsAt, zone, "full")}</strong><small>Shown in your time zone, {zone}</small></div><UsersRound/><div><span>Joined live</span><strong>{joined} {joined===1?"participant":"participants"}</strong></div></Card><p className="waiting-copy">{between ? "Stay here — the next questionnaire opens on its own." : "Stay here — the first question will appear automatically."}</p></div>;
}
function QuestionTimer({end,serverTime,phaseStartsAt,paused,onTimeUp}:{end:string|null;serverTime?:string|undefined;phaseStartsAt?:string|undefined;paused?:boolean;onTimeUp:()=>void}) {
  const remaining=useServerCountdown(end,serverTime,paused);
  useEffect(()=>{if(end&&!paused&&remaining<=0)onTimeUp();},[end,paused,remaining,onTimeUp]);
  const span=phaseStartsAt&&end?Date.parse(end)-Date.parse(phaseStartsAt):0;
  return <footer className="question-timer"><div><Clock3/><span>Time remaining</span><strong>{duration(remaining)}</strong></div><div className="timer-track"><i style={{transform:`scaleX(${span>0?remaining/span:0})`}}/></div></footer>;
}
function QuestionScreen({state,joined,answered,clocks,onUpdate,notice}:{state:ActiveState;joined:number;answered:number;clocks:ReactNode;onUpdate:(s:ActiveState)=>void;notice:ReactNode}) {
  const {user}=useAuth();
  const q=state.question!;const [pending,setPending]=useState<string|null>(null);const [missed,setMissed]=useState<string|null>(null);const [error,setError]=useState("");
  const [timeUp,setTimeUp]=useState(()=>{if(!state.phaseEndsAt)return false;const offset=state.serverTime?Date.parse(state.serverTime)-Date.now():0;return Date.now()+offset>=Date.parse(state.phaseEndsAt);});
  const markTimeUp=useCallback(()=>setTimeUp(true),[]);
  const select=async(optionId:string)=>{if(state.answer||pending||timeUp)return;setPending(optionId);setMissed(null);setError("");try{const result=await api<{answer:{id:string;optionId:string;selectedCount:number};tallies:{optionId:string;count:number}[]}>(`/meetups/${state.meetup.id}/answers`,{method:"POST",body:JSON.stringify({questionId:q.id,optionId})});const option=q.options.find(o=>o.id===optionId)!;onUpdate({...state,answer:{...result.answer,label:option.label},tallies:result.tallies});}catch(e){setMissed(optionId);setError(message(e));}finally{setPending(null);}};
  const selected=state.answer?.optionId;
  const bars = state.tallies ? q.options.map((option) => ({ id: option.id, label: option.label, count: state.tallies?.find((tally) => tally.optionId === option.id)?.count ?? 0 })) : null;
  return <div className="focus-page question-page"><QuestionAlerts />{notice}<header className="question-top"><div><span className="live-pill"><i/> {state.paused ? "Paused" : "Live"}</span><strong>{state.meetup.title}</strong></div><span>{joined} live · {answered} answered</span></header>{clocks}<main className="stage-question">{state.paused ? <div className="alert" role="status">The host paused this question. It continues here, with the same time left.</div> : null}{state.questionnaire ? <p className="questionnaire-kicker">{state.questionnaire.title}</p> : null}<div className="question-progress"><span>Question {q.position} of {state.questionCount}</span><div>{Array.from({length:state.questionCount!},(_,i)=><i className={i<q.position?"done":""} key={i}/>)}</div></div>{state.phaseEndsAt ? <p className="questionnaire-kicker">Open until {formatDate(state.phaseEndsAt, user!.timeZone)}</p> : null}<h1 className="stage-prompt">{q.prompt}</h1>{error&&<div className="alert">{error}</div>}{timeUp && !selected ? <p className="verdict-stamp missed" role="status">This question closed before you answered</p> : null}{bars ? <OptionBars options={bars} yourOptionId={selected ?? null}/> : <div className={`answer-grid${timeUp ? " is-closed" : ""}`}>{q.options.map((o,i)=>{const pressing=pending===o.id;return <button key={o.id} className={`answer-option deal-in option-${i}${pressing?" is-pressing":""}${pending&&!pressing?" is-dimmed":""}${missed===o.id?" is-miss":""}`} style={{animationDelay:`${i*70}ms`}} disabled={!!pending||timeUp} onClick={()=>void select(o.id)}><span>{String.fromCharCode(65+i)}</span><strong>{o.label}</strong>{pressing?<small>Locking in…</small>:null}</button>;})}</div>}{selected?<p className="locked-copy">Answer locked in. The bars update as other people answer.</p>:null}</main><QuestionTimer end={state.phaseEndsAt} serverTime={state.serverTime} phaseStartsAt={state.phaseStartsAt} paused={state.paused === true} onTimeUp={markTimeUp}/></div>;
}
function Completed({state,joined,notice}:{state:ActiveState;joined:number;notice:ReactNode}) {
  return <div className="focus-page completed">{notice}<div className="completion-icon"><CheckCircle2/></div><span className="eyebrow">That’s a wrap</span><h1>Thanks for showing up!</h1><p><strong>{state.meetup.title}</strong> is complete. {joined} {joined===1?"participant":"participants"} joined.</p><Card><Sparkles/><div><strong>Every voice matters</strong><span>Your responses help make the next conversation even better.</span></div></Card><Link className="btn btn-primary" to="/app">Back to My Meetups</Link></div>;
}
