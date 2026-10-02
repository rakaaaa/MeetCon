import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Check, CheckCircle2, Clock3, Hash, Radio, Sparkles, TicketCheck, UsersRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { api, duration, formatDate, message } from "../lib";
import type { ActiveState, Meetup } from "../types";
import { Button, Card, Empty, ErrorState, Loading, PageHeader, Status } from "../ui";

type Preview = { id: string; title: string; organizer: string; startsAt: string; endsAt: string; questionCount: number };
const memberPhase = (m: Meetup, now: number) => m.status === "CANCELLED" ? "CANCELLED" : now < Date.parse(m.startsAt) ? "UPCOMING" : now < Date.parse(m.endsAt) ? "LIVE" : "COMPLETED";

export function MyMeetups() {
  const { user } = useAuth(); const [tab,setTab]=useState("UPCOMING");
  const query=useQuery({queryKey:["my-meetups"],queryFn:()=>api<{meetups:Meetup[];serverTime:string}>("/my-meetups")});
  if(query.isLoading)return <Loading label="Finding your meetups…"/>;if(query.error)return <ErrorState error={query.error} retry={()=>void query.refetch()}/>;
  const now=Date.parse(query.data!.serverTime), visible=query.data!.meetups.filter(m=>memberPhase(m,now)===tab);
  return <div className="page"><PageHeader eyebrow="Participant space" title={`Hey ${user!.displayName.split(" ")[0]}, you’re in!`} description="Your conversations, ready when you are." action={<Link className="btn btn-primary" to="/app/join"><Hash/> Join meetup</Link>}/>
    <div className="hero-strip"><div><Radio/><span>Ready for the next conversation?</span></div><Link to="/app/join">Enter a meetup code <ArrowRight/></Link></div>
    <div className="tabs">{["UPCOMING","LIVE","COMPLETED"].map(value=><button className={tab===value?"active":""} onClick={()=>setTab(value)} key={value}>{value==="LIVE"&&<i/>}{value[0]+value.slice(1).toLowerCase()} <span>{query.data!.meetups.filter(m=>memberPhase(m,now)===value).length}</span></button>)}</div>
    <div className="meetup-cards">{visible.map(m=><Link className={`user-meetup ${tab.toLowerCase()}`} to={`/app/meetups/${m.id}`} key={m.id}><div className="user-card-top"><Status value={tab}/><span>{m.questionCount} questions</span></div><h2>{m.title}</h2><p className="organizer"><span className="avatar avatar-sm">{m.organizer?.[0]}</span>Hosted by {m.organizer}</p><div className="card-time"><CalendarDays/><div><strong>{formatDate(m.startsAt,user!.timeZone)}</strong><span>{tab==="UPCOMING"?`Starts in ${duration(Date.parse(m.startsAt)-now)}`:tab==="LIVE"?"Join live now":"Meetup completed"}</span></div></div><span className="card-cta">{tab==="LIVE"?"Join live":"Open meetup"} <ArrowRight/></span></Link>)}</div>
    {!visible.length&&<Empty icon={<TicketCheck/>} title={`No ${tab.toLowerCase()} meetups`} text="Enter an eight-digit code or open a shared invitation link." action={<Link className="btn btn-primary" to="/app/join">Join a meetup</Link>}/>}
  </div>;
}
export function JoinMeetup({ token }: { token?: string | undefined }) {
  const navigate=useNavigate();const {user}=useAuth();const [code,setCode]=useState("");const [preview,setPreview]=useState<Preview|null>(null);const [error,setError]=useState("");
  const kind=token?"token":"code", value=token??code;
  const previewMutation=useMutation({mutationFn:()=>api<{meetup:Preview}>(`/join/${kind}/preview`,{method:"POST",body:JSON.stringify({[kind]:value})}),onSuccess:r=>{setPreview(r.meetup);if(token)history.replaceState(null,"","/app/join");},onError:e=>setError(message(e))});
  const joinMutation=useMutation({mutationFn:()=>api<{meetupId:string;alreadyJoined:boolean}>(`/join/${kind}`,{method:"POST",body:JSON.stringify({[kind]:value})}),onSuccess:r=>{sessionStorage.removeItem("meetcon:join-token");navigate(`/app/meetups/${r.meetupId}`,{replace:true});},onError:e=>setError(message(e))});
  useEffect(()=>{if(token&&user?.role==="USER"&&!preview&&!previewMutation.isPending)previewMutation.mutate();},[token,user?.role]);
  const submit=(e:FormEvent)=>{e.preventDefault();setError("");previewMutation.mutate();};
  const change=(raw:string)=>setCode(raw.replace(/\D/g,"").slice(0,8));
  if(preview)return <JoinConfirmation meetup={preview} busy={joinMutation.isPending} error={error} onCancel={()=>token?navigate("/app"):setPreview(null)} onConfirm={()=>joinMutation.mutate()}/>;
  return <div className="page narrow"><PageHeader eyebrow="Join the room" title="Enter your meetup code" description="Eight digits are all it takes to join the conversation."/>
    <Card className="join-card"><span className="join-icon"><Hash/></span><form onSubmit={submit}><label className="sr-only" htmlFor="join-code">Eight-digit meetup code</label><input id="join-code" className="code-input" inputMode="numeric" autoComplete="one-time-code" placeholder="0000 0000" value={code.replace(/(\d{4})(\d+)/,"$1 $2")} onChange={e=>change(e.target.value)} onPaste={(e:ClipboardEvent<HTMLInputElement>)=>{e.preventDefault();change(e.clipboardData.getData("text"));}} autoFocus/>
      <div className="code-dots">{Array.from({length:8},(_,i)=><i className={i<code.length?"filled":""} key={i}/>)}</div>{error&&<div className="alert">{error}</div>}<Button busy={previewMutation.isPending} disabled={code.length!==8} className="wide">Preview meetup <ArrowRight/></Button></form>
      <div className="join-help"><Sparkles/><div><strong>Have a QR code?</strong><p>Scan it with your phone camera. The shared browser link opens MeetCon directly.</p></div></div></Card>
  </div>;
}
function JoinConfirmation({meetup,busy,error,onCancel,onConfirm}:{meetup:Preview;busy:boolean;error:string;onCancel:()=>void;onConfirm:()=>void}) {
  const {user}=useAuth();return <div className="page narrow"><PageHeader eyebrow="One last check" title="Ready to join?" description="Confirm this is the meetup you expected."/><Card className="confirm-card"><div className="confirm-art"><UsersRound/></div><Status value={Date.now()<Date.parse(meetup.startsAt)?"UPCOMING":"LIVE"}/><h2>{meetup.title}</h2><p>Hosted by <strong>{meetup.organizer}</strong></p><div className="confirm-facts"><div><CalendarDays/><span>When<strong>{formatDate(meetup.startsAt,user!.timeZone,"full")}</strong></span></div><div><Clock3/><span>Duration<strong>{duration(Date.parse(meetup.endsAt)-Date.parse(meetup.startsAt))}</strong></span></div><div><Hash/><span>Questions<strong>{meetup.questionCount}</strong></span></div></div>{error&&<div className="alert">{error}</div>}<Button busy={busy} className="wide" onClick={onConfirm}><Check/> Confirm & join</Button><Button variant="ghost" className="wide" onClick={onCancel}>Not this one</Button></Card></div>;
}
export function InviteGate() {
  const {token}=useParams();const {user,loading}=useAuth();
  useEffect(()=>{if(token)sessionStorage.setItem("meetcon:join-token",token);},[token]);
  if(loading)return <Loading/>;if(!user)return <Navigate to="/login" state={{from:`/join/${token}`}} replace/>;if(user.role!=="USER")return <Navigate to="/admin" replace/>;
  return <JoinMeetup token={token}/>;
}
function useServerCountdown(end:string|null|undefined,serverTime?:string) {
  const offsetRef=useRef(0);const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(serverTime)offsetRef.current=Date.parse(serverTime)-Date.now();},[serverTime]);
  useEffect(()=>{const tick=()=>setNow(Date.now()+offsetRef.current);tick();const timer=setInterval(tick,250);return()=>clearInterval(timer);},[]);
  return end?Math.max(0,Date.parse(end)-now):0;
}
export function LiveMeetup() {
  const {id}=useParams();const {user}=useAuth();const queryClient=useQueryClient();
  const query=useQuery({queryKey:["active",id],queryFn:()=>api<ActiveState>(`/meetups/${id}/active`),refetchOnWindowFocus:true,retry:1});
  const remaining=useServerCountdown(query.data?.phaseEndsAt,query.data?.serverTime);
  const refetch=useCallback(()=>void query.refetch(),[query.refetch]);
  useEffect(()=>{if(!query.data?.phaseEndsAt)return;const delay=Math.max(0,Date.parse(query.data.phaseEndsAt)-Date.parse(query.data.serverTime))+Math.random()*300;const timer=setTimeout(()=>void query.refetch(),delay);return()=>clearTimeout(timer);},[query.data?.phaseEndsAt,query.data?.serverTime,query.data?.question?.id]);
  useEffect(()=>{const visible=()=>{if(document.visibilityState==="visible")void query.refetch();};document.addEventListener("visibilitychange",visible);addEventListener("focus",visible);addEventListener("online",visible);return()=>{document.removeEventListener("visibilitychange",visible);removeEventListener("focus",visible);removeEventListener("online",visible);};},[refetch]);
  if(query.isLoading)return <Loading label="Synchronizing with the room…"/>;if(query.error)return <ErrorState error={query.error} retry={()=>void query.refetch()}/>;const state=query.data!;
  if(state.phase==="WAITING")return <Waiting state={state} remaining={remaining} zone={user!.timeZone}/>;
  if(state.phase==="COMPLETED")return <Completed state={state}/>;
  return <QuestionScreen state={state} remaining={remaining} onUpdate={(next)=>queryClient.setQueryData(["active",id],next)}/>;
}
function Waiting({state,remaining,zone}:{state:ActiveState;remaining:number;zone:string}) {
  return <div className="focus-page waiting"><div className="waiting-orb"><Radio/></div><span className="status status-upcoming"><Check/> You’re joined</span><h1>{state.meetup.title}</h1><p>Hosted by {state.meetup.organizer}</p><div className="countdown"><span>Starts in</span><strong>{duration(remaining)}</strong></div><Card className="waiting-facts"><CalendarDays/><div><span>Scheduled for</span><strong>{formatDate(state.meetup.startsAt,zone,"full")}</strong></div><UsersRound/><div><span>Ready in the room</span><strong>{state.participantCount} participants</strong></div></Card><p className="waiting-copy">Stay here — the first question will appear automatically.</p></div>;
}
function QuestionScreen({state,remaining,onUpdate}:{state:ActiveState;remaining:number;onUpdate:(s:ActiveState)=>void}) {
  const q=state.question!;const [pending,setPending]=useState<string|null>(null);const [error,setError]=useState("");const [count,setCount]=useState(state.answer?.selectedCount??0);
  useEffect(()=>{setCount(state.answer?.selectedCount??0);if(!state.answer)return;const source=new EventSource(`/api/meetups/${state.meetup.id}/questions/${q.id}/options/${state.answer.optionId}/count-stream`,{withCredentials:true});source.addEventListener("count",event=>{const data=JSON.parse((event as MessageEvent).data) as {count:number};setCount(data.count);});return()=>source.close();},[state.answer?.optionId,q.id,state.meetup.id]);
  const select=async(optionId:string)=>{if(state.answer||pending||remaining<=0)return;setPending(optionId);setError("");try{const result=await api<{answer:{id:string;optionId:string;selectedCount:number}}>(`/meetups/${state.meetup.id}/answers`,{method:"POST",body:JSON.stringify({questionId:q.id,optionId})});const option=q.options.find(o=>o.id===optionId)!;onUpdate({...state,answer:{...result.answer,label:option.label}});}catch(e){setError(message(e));}finally{setPending(null);}};
  const selected=state.answer?.optionId;
  return <div className="focus-page question-page"><header className="question-top"><div><span className="live-pill"><i/> Live</span><strong>{state.meetup.title}</strong></div><span>{state.participantCount} in the room</span></header><main><div className="question-progress"><span>Question {q.position} of {state.questionCount}</span><div>{Array.from({length:state.questionCount!},(_,i)=><i className={i<q.position?"done":""} key={i}/>)}</div></div><h1>{q.prompt}</h1>{error&&<div className="alert">{error}</div>}<div className={`answer-grid ${selected?"has-selection":""}`}>{q.options.map((o,i)=>selected&&o.id!==selected?null:<button key={o.id} className={`answer-option option-${i} ${selected===o.id?"selected":""}`} disabled={!!pending||!!selected||remaining<=0} onClick={()=>void select(o.id)}><span>{String.fromCharCode(65+i)}</span><strong>{o.label}</strong>{pending===o.id&&<small>Submitting…</small>}{selected===o.id&&<><CheckCircle2/><small className="live-count">{count} {count===1?"person":"people"} selected this option</small></>}</button>)}</div>{selected&&<p className="locked-copy">Answer locked in. Hang tight for the next question.</p>}</main><footer className="question-timer"><div><Clock3/><span>Time remaining</span><strong>{duration(remaining)}</strong></div><div className="timer-track"><i style={{transform:`scaleX(${state.phaseStartsAt&&state.phaseEndsAt?remaining/(Date.parse(state.phaseEndsAt)-Date.parse(state.phaseStartsAt)):0})`}}/></div></footer></div>;
}
function Completed({state}:{state:ActiveState}) {
  return <div className="focus-page completed"><div className="completion-icon"><CheckCircle2/></div><span className="eyebrow">That’s a wrap</span><h1>Thanks for showing up!</h1><p><strong>{state.meetup.title}</strong> is complete. Your answers were recorded.</p><Card><Sparkles/><div><strong>Every voice matters</strong><span>Your responses help make the next conversation even better.</span></div></Card><Link className="btn btn-primary" to="/app">Back to My Meetups</Link></div>;
}
