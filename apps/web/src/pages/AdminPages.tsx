import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CalendarDays, Check, Clipboard, Copy, Download, Edit3, FileDown, FileUp, GripVertical, Mic, Pause, Play, Plus, Search, Share2, SkipForward, Sparkles, Trash2, UsersRound, X } from "lucide-react";
import { memo, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { api, duration, formatDate, formatTile, message, timeZoneOptions, zonedInput, zonedLocalToUtc } from "../lib";
import { downloadQuestionWorkbook, questionsFromCsv, questionsFromWorkbook } from "../questions-excel";
import { RemainingClocks } from "../clock";
import type { AssistantProvider, Meetup, MeetupDetail, MeetupListItem, Question, ResultQuestionnaire } from "../types";
import { InsightBoard, OptionChart, QuestionPulse } from "../charts";
import { Button, Card, Collapse, Empty, ErrorState, Field, Loading, PageHeader, questionnaireIsLive, Status, Toast } from "../ui";

const phase = (m: Meetup, now = Date.now()) => m.status === "CANCELLED" ? "CANCELLED" : m.status === "DRAFT" ? "DRAFT" : now < Date.parse(m.startsAt) ? "UPCOMING" : now < Date.parse(m.endsAt) ? "LIVE" : "COMPLETED";
function scheduleWindow(starts: string, ends: string, zone: string) {
  try {
    const startMs = Date.parse(zonedLocalToUtc(starts, zone));
    return { startMs, total: Date.parse(zonedLocalToUtc(ends, zone)) - startMs };
  } catch {
    return { startMs: Number.NaN, total: 0 };
  }
}
function tally(meetups: MeetupListItem[], now = Date.now()) {
  const counts = { ALL: meetups.length, UPCOMING: 0, LIVE: 0, COMPLETED: 0, DRAFT: 0, CANCELLED: 0 };
  let participants = 0;
  for (const meetup of meetups) {
    const current = meetupStatus(meetup, now);
    participants += meetup.memberCount ?? 0;
    if (current === "UPCOMING" || current === "LIVE" || current === "COMPLETED" || current === "DRAFT" || current === "CANCELLED") counts[current] += 1;
  }
  return { counts, participants };
}
function meetupStatus(meetup: MeetupListItem, now = Date.now()) {
  return (meetup.questionnaires ?? []).some((item) => item.pausedAt) ? "LIVE" as const : phase(meetup, now);
}
function useMeetups() {
  return useQuery({
    queryKey: ["meetups"],
    queryFn: () => api<{ meetups: MeetupListItem[]; serverTime: string }>("/meetups"),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const now = Date.parse(data.serverTime);
      return data.meetups.some((meetup) => meetupStatus(meetup, now) === "LIVE") ? 10_000 : false;
    },
  });
}
function MeetupResults({ meetup }: { meetup: MeetupListItem }) {
  const joined = meetup.memberCount ?? 0;
  const published = (meetup.questionnaires ?? []).filter((item) => item.status !== "DRAFT");
  const publishedQuestions = published.flatMap((item) => item.questions ?? []);
  const answered = publishedQuestions.reduce((sum, question) => sum + question.answered, 0);
  const possible = joined * publishedQuestions.length;
  return <div className="dashboard-results">
    <InsightBoard title="Meetup" rate={responseRate(answered, possible)} rateLabel="Meetup response" caption={`${answered} of ${possible} answers`} facts={[{ value: joined, label: joined === 1 ? "Participant" : "Participants" }, { value: answered, label: answered === 1 ? "Answer" : "Answers" }, { value: Math.max(0, possible - answered), label: "Still open" }]} bars={published.map((questionnaire) => {
      const questions = questionnaire.questions ?? [];
      const answersHere = questions.reduce((sum, question) => sum + question.answered, 0);
      const questionnairePossible = joined * questions.length;
      const rate = responseRate(answersHere, questionnairePossible);
      return { id: questionnaire.id, label: questionnaire.title, value: rate, caption: `${rate}%` };
    })}/>
    {(meetup.questionnaires ?? []).map((questionnaire, index) => {
      const questions = questionnaire.questions ?? [];
      const answersHere = questions.reduce((sum, question) => sum + question.answered, 0);
      const questionnairePossible = joined * questions.length;
      const draft = questionnaire.status === "DRAFT";
      return <section className="dashboard-questionnaire stage-card" style={{ animationDelay: `${index * 70}ms` }} key={questionnaire.id}>
        <div className="dashboard-level"><h4>{questionnaire.title}</h4><p>{draft ? "Draft" : `${responseRate(answersHere, questionnairePossible)}% response`}</p></div>
        {draft ? null : <QuestionPulse questions={questions.map((question) => ({ id: question.id, label: `Q${question.position}`, value: responseRate(question.answered, joined), caption: question.prompt }))}/>}
        {questions.map((question, questionIndex) => <article className="dashboard-question stage-card" style={{ animationDelay: `${questionIndex * 60}ms` }} key={question.id}>
          <header><strong>Q{question.position}. {question.prompt}</strong><span>{question.answered} answered · {responseRate(question.answered, joined)}%</span></header>
          <OptionChart options={question.options} answered={question.answered}/>
        </article>)}
      </section>;
    })}
  </div>;
}
const MeetupRow = memo(function MeetupRow({ meetup }: { meetup: MeetupListItem }) {
  const { user } = useAuth(); const current = meetupStatus(meetup); const tile = formatTile(meetup.startsAt, user!.timeZone);
  const now = Date.now();
  const live = meetup.questionnaires?.find((item) => item.pausedAt || questionnaireIsLive(item, now));
  const answered = (meetup.questionnaires ?? []).reduce((sum, item) => item.status === "DRAFT" ? sum : sum + item.answeredCount, 0);
  return <Collapse className="card meetup-row" defaultOpen={current === "LIVE"} summary={<><div className="date-tile"><strong>{tile.day}</strong><span>{tile.month}</span></div>
    <div className="meetup-main"><div className="row-title"><h3>{meetup.title}</h3><Status value={current}/></div><p><CalendarDays/> {formatDate(meetup.startsAt, user!.timeZone)}</p><div className="meta"><span>{meetup.questionnaireCount ?? 0} questionnaires</span><span>{meetup.questionCount} questions</span>{live ? <span>{meetup.memberCount ?? 0} live · {live.answeredCount} answered</span> : <span>{meetup.memberCount ?? 0} participants · {answered} answered</span>}{current !== "DRAFT" && meetup.publicCode ? <span>Code {meetup.publicCode}</span> : null}</div></div>
    <Link className="btn btn-secondary" to={`/admin/meetups/${meetup.id}`}>Open</Link></>}>
    <MeetupResults meetup={meetup}/>
  </Collapse>;
});
const listFilters = ["ALL", "UPCOMING", "LIVE", "COMPLETED", "DRAFT", "CANCELLED"] as const;
export function AdminDashboard() {
  const { user } = useAuth(); const query = useMeetups(); const [filter, setFilter] = useState<(typeof listFilters)[number]>("ALL"); const [search, setSearch] = useState("");
  if (query.isLoading) return <Loading label="Preparing your dashboard…" />; if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()}/>;
  const meetups = query.data!.meetups;
  const now = Date.now();
  const { counts, participants } = tally(meetups, now);
  const needle = search.toLowerCase();
  const visible = meetups.filter((meetup) => (filter === "ALL" || meetupStatus(meetup, now) === filter) && `${meetup.title} ${meetup.publicCode}`.toLowerCase().includes(needle));
  const filterIcon = { ALL: <UsersRound/>, UPCOMING: <CalendarDays/>, LIVE: <span className="live-dot"/>, COMPLETED: <Check/>, DRAFT: <Edit3/>, CANCELLED: <X/> };
  const filterTone = { ALL: "green", UPCOMING: "violet", LIVE: "coral", COMPLETED: "cyan", DRAFT: "violet", CANCELLED: "coral" };
  return <div className="page"><PageHeader eyebrow="Meetups" title={`Good to see you, ${user!.displayName.split(" ")[0]}!`} description={`${participants} participants across your meetups. Open one to edit it, invite the room, or read the results.`} action={<Link className="btn btn-primary" to="/admin/create"><Plus/> Create meetup</Link>}/>
    <div className="stats">{listFilters.map((value) => <button key={value} className={`card stat-button ${filter === value ? "active" : ""}`} onClick={() => setFilter(value)}><span className={`stat-icon ${filterTone[value]}`}>{filterIcon[value]}</span><div><strong>{counts[value]}</strong><span>{value === "ALL" ? "All" : value[0] + value.slice(1).toLowerCase()}</span></div></button>)}</div>
    <div className="toolbar"><div className="search"><Search/><input aria-label="Search meetups" placeholder="Search title or code…" value={search} onChange={(event) => setSearch(event.target.value)}/></div></div>
    <div className="stack">{visible.map((meetup) => <MeetupRow key={meetup.id} meetup={meetup}/>)}</div>{!visible.length && <Empty title="No meetups in this view" text="Try another filter, or create a meetup." action={<Link className="btn btn-primary" to="/admin/create">Create meetup</Link>}/>}
  </div>;
}
export function ResultsRedirect() {
  const { id } = useParams();
  return <Navigate to={`/admin/meetups/${id}#results`} replace />;
}
const blankQuestion = (): Question => ({ prompt: "", options: Array.from({ length: 4 }, () => ({ label: "" })) });
type DraftQuestionnaire = {
  key: string; id?: string; title: string; starts: string; ends: string; status: "DRAFT" | "PUBLISHED";
  assistant?: AssistantProvider; questions: Question[];
  originalStarts?: string; originalEnds?: string; originalStartsAt?: string; originalEndsAt?: string;
  originalQuestionCount?: number; publishedOnce?: boolean;
};
const assistantLabels: Record<AssistantProvider, string> = { openai: "ChatGPT", gemini: "Gemini", anthropic: "Claude" };
type AssistantConnection = { provider: AssistantProvider; label: string; oauthAvailable: boolean; clientId: string | null; connected: boolean; ready: boolean; email: string | null; name: string | null };
function AssistantPills({ providers }: { providers: AssistantConnection[] | undefined }) {
  const connected = providers?.filter((item) => item.connected) ?? [];
  if (!connected.length) return <p className="excel-note">No assistant is connected. <Link to="/settings#assistants">Connect ChatGPT, Claude, or Gemini</Link></p>;
  return <ul className="assistant-pills">{connected.map((item) => <li key={item.provider}><strong>{item.label}</strong><span>{item.name || item.email || (item.ready ? "Connected" : "Reconnect to draft")}</span></li>)}</ul>;
}
function blankQuestionnaire(zone: string, index: number, afterEnd?: string, status: "DRAFT" | "PUBLISHED" = "PUBLISHED"): DraftQuestionnaire {
  let start = new Date(Date.now() + 86_400_000 + index * 3_600_000);
  if (afterEnd) {
    try { start = new Date(Date.parse(zonedLocalToUtc(afterEnd, zone)) + 60_000); } catch { /* keep the default hour */ }
  }
  return { key: crypto.randomUUID(), title: `Questionnaire ${index + 1}`, starts: zonedInput(start, zone), ends: zonedInput(new Date(start.getTime() + 3_600_000), zone), status, questions: [blankQuestion()] };
}
function draftsFrom(existing: MeetupDetail | undefined, zone: string): DraftQuestionnaire[] {
  if (!existing?.questionnaires.length) return [blankQuestionnaire(zone, 0)];
  return existing.questionnaires.map((item) => {
    const starts = zonedInput(item.startsAt, zone);
    const ends = zonedInput(item.endsAt, zone);
    return {
      key: item.id ?? crypto.randomUUID(),
      ...(item.id ? { id: item.id } : {}),
      title: item.title,
      starts,
      ends,
      status: item.status ?? "PUBLISHED",
      ...(item.assistantProvider ? { assistant: item.assistantProvider } : {}),
      questions: item.questions.length ? item.questions.map((question) => ({ ...question, options: question.options.map((option) => ({ ...option })) })) : [blankQuestion()],
      originalStarts: starts,
      originalEnds: ends,
      originalStartsAt: item.startsAt,
      originalEndsAt: item.endsAt,
      originalQuestionCount: item.questions.length,
      publishedOnce: item.publishedOnce ?? false,
    };
  });
}
function questionnaireAccess(item: DraftQuestionnaire, zone: string, now: number) {
  const open = { frozen: false, restarting: false, lockedQuestions: 0, note: "" };
  if (!item.originalStartsAt || !item.originalEndsAt) return open;
  const start = Date.parse(item.originalStartsAt);
  const end = Date.parse(item.originalEndsAt);
  let nextStart = Number.NaN;
  try { nextStart = Date.parse(item.starts === item.originalStarts && item.originalStartsAt ? item.originalStartsAt : zonedLocalToUtc(item.starts, zone)); } catch { /* the field is incomplete */ }
  const movedToFuture = item.starts !== item.originalStarts && Number.isFinite(nextStart) && nextStart > now;
  if (end <= now) {
    return movedToFuture
      ? { frozen: false, restarting: true, lockedQuestions: 0, note: "Earlier answers for this questionnaire will be cleared. It will run again from the first question." }
      : { frozen: true, restarting: false, lockedQuestions: item.originalQuestionCount ?? item.questions.length, note: "This questionnaire has ended. Move its start to a future time to edit it. It will then run again from the first question." };
  }
  if (start > now) return open;
  if (movedToFuture) return { frozen: false, restarting: true, lockedQuestions: 0, note: "This questionnaire will stop now and run again from the first question. Earlier answers for it will be cleared." };
  const count = item.originalQuestionCount ?? item.questions.length;
  let lockedQuestions = 0;
  if (count > 0 && end > start) {
    const span = end - start;
    for (let index = 0; index < count; index += 1) if (Math.floor(start + span * (index + 1) / count) <= now) lockedQuestions += 1;
  }
  return { frozen: false, restarting: false, lockedQuestions, note: item.status === "PUBLISHED"
    ? "Setting this to draft stops it immediately for participants. Questions that already ended stay locked unless you move the start into the future."
    : "Participants cannot see a draft questionnaire. Publish it on this same window to continue, or move the start into the future to run it from the first question." };
}
type SpeechListener = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type BrowserSpeech = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((event: SpeechListener) => void) | null; onerror: (() => void) | null; onend: (() => void) | null };
function speechRecognizer() {
  const host = window as Window & { SpeechRecognition?: new () => BrowserSpeech; webkitSpeechRecognition?: new () => BrowserSpeech };
  const Ctor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}
function QuestionAssistant({ title, questionnaire, group, disabled, onImported }: { title: string; questionnaire: string; group: string; disabled: boolean; onImported: (provider: AssistantProvider, questions: { prompt: string; options: string[] }[], note: string) => void }) {
  const assistants = useQuery({ queryKey: ["assistants"], queryFn: () => api<{ providers: AssistantConnection[] }>("/profile/assistants"), enabled: !disabled });
  const ready = assistants.data?.providers.filter((item) => item.ready) ?? [];
  const [provider, setProvider] = useState<AssistantProvider | "">("");
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(5);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recognition = useRef<BrowserSpeech | null>(null);
  useEffect(() => {
    if (!ready.length) return;
    setProvider((current) => current && ready.some((item) => item.provider === current) ? current : ready[0]!.provider);
  }, [assistants.data]);
  useEffect(() => () => recognition.current?.stop(), []);
  const toggleVoice = () => {
    if (listening) { recognition.current?.stop(); setListening(false); return; }
    const next = speechRecognizer();
    if (!next) { setError("This browser cannot use voice input. Type the topic instead."); return; }
    next.lang = navigator.language || "en-US";
    next.interimResults = true;
    next.continuous = false;
    next.onresult = (event) => {
      const transcript = Array.from(event.results, (result) => result[0]?.transcript ?? "").join(" ").trim();
      if (transcript) setTopic(transcript);
    };
    next.onerror = () => setListening(false);
    next.onend = () => setListening(false);
    recognition.current = next;
    try { next.start(); setListening(true); setError(""); } catch { setError("The microphone could not start."); }
  };
  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (!provider) return;
    const asked = Math.min(20, Math.max(1, count));
    setBusy(true); setError("");
    try {
      const result = await api<{ csv: string; count: number; requested: number }>("/meetups/questions/generate", { method: "POST", body: JSON.stringify({ topic, count: asked, title, questionnaire, provider }) });
      const imported = questionsFromCsv(result.csv);
      const note = imported.length === asked ? `${imported.length} questions from ${assistantLabels[provider]} are in this questionnaire.` : `${assistantLabels[provider]} returned ${imported.length} of ${asked} questions.`;
      onImported(provider, imported.map((question) => ({ prompt: question.prompt, options: [...question.options] })), note);
    } catch (err) { setError(message(err)); } finally { setBusy(false); }
  };
  return <form className="ai-draft" onSubmit={(event) => void generate(event)}>
    <div className="step-title"><Sparkles/><div><h3>Draft with a connected assistant</h3><p>Enter a topic and how many questions you want, up to 20. The assistant replies as a CSV in the Excel format, and those questions replace the ones below.</p></div></div>
    {ready.length ? <div className="provider-choice" role="radiogroup" aria-label="Assistant">{ready.map((item) => <label key={item.provider} className={provider === item.provider ? "active" : ""}><input type="radio" name={`${group}-assistant`} value={item.provider} checked={provider === item.provider} onChange={() => setProvider(item.provider)} disabled={disabled || busy}/><strong>{item.label}</strong><span>{item.name || item.email}</span></label>)}</div> : <p className="excel-note">Connect ChatGPT, Claude, or Gemini in <Link to="/settings#assistants">Settings</Link> before drafting.</p>}
    <div className="draft-fields"><Field label="Topic"><textarea value={topic} onChange={(event) => setTopic(event.target.value)} disabled={disabled || busy || !ready.length} maxLength={500} placeholder="For example: how the team wants to spend the next planning hour"/></Field><Field label="Questions"><input type="number" min={1} max={20} value={count} onChange={(event) => setCount(Number(event.target.value))} disabled={disabled || busy || !ready.length}/></Field></div>
    {error ? <div className="alert">{error}</div> : null}
    <div className="ai-draft-actions"><button type="button" className={`btn btn-secondary ${listening ? "mic-live" : ""}`} onClick={toggleVoice} disabled={disabled || busy || !ready.length} aria-pressed={listening}><Mic/> {listening ? "Stop voice" : "Speak topic"}</button><Button busy={busy} disabled={disabled || !topic.trim() || !provider || !ready.length}><Sparkles/> Create questions</Button></div>
  </form>;
}
function ExportQuestions({ title, questions }: { title: string; questions: { prompt: string; options: { label: string; position?: number }[] }[] }) {
  const rows = questions.map((question) => ({ prompt: question.prompt, options: [...question.options].sort((left, right) => (left.position ?? 0) - (right.position ?? 0)) }));
  const filled = rows.some((question) => question.prompt.trim());
  return <Button type="button" variant="secondary" disabled={!filled} onClick={() => void downloadQuestionWorkbook(title, rows, "questions")}><FileDown/> Export questions</Button>;
}
function QuestionnaireEditor({ item, index, total, zone, showStatus, meetupTitle, onChange, onMove, onRemove }: {
  item: DraftQuestionnaire; index: number; total: number; zone: string; showStatus: boolean; meetupTitle: string;
  onChange: (next: DraftQuestionnaire) => void; onMove: (by: number) => void; onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState("");
  const [importNotice, setImportNotice] = useState("");
  const span = scheduleWindow(item.starts, item.ends, zone).total;
  const each = item.questions.length && span > 0 ? duration(span / item.questions.length) : "—";
  const lock = questionnaireAccess(item, zone, Date.now());
  const contentLocked = lock.frozen;
  const structureLocked = lock.frozen || lock.lockedQuestions > 0;
  const sameWindow = item.starts === item.originalStarts && item.ends === item.originalEnds;
  let nextStart = Number.NaN;
  try { nextStart = Date.parse(zonedLocalToUtc(item.starts, zone)); } catch { /* incomplete date */ }
  const canPublish = !item.originalStartsAt || nextStart > Date.now() || (!!item.publishedOnce && sameWindow);
  const uploadQuestions = async (file?: File) => {
    if (!file || structureLocked) return;
    setImportError("");
    setImportNotice("");
    try {
      const imported = await questionsFromWorkbook(await file.arrayBuffer());
      onChange({ ...item, questions: imported.map((question) => ({ prompt: question.prompt, options: question.options.map((label) => ({ label })) })) });
      setImportNotice(`${imported.length} ${imported.length === 1 ? "question is" : "questions are"} ready. Save the meetup to keep them.`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "That Excel file could not be read.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const updateQuestion = (questionIndex: number, next: Question) => onChange({ ...item, questions: item.questions.map((question, i) => i === questionIndex ? next : question) });
  const moveQuestion = (questionIndex: number, by: number) => {
    const next = [...item.questions];
    const target = questionIndex + by;
    const current = next[questionIndex];
    const other = next[target];
    if (!current || !other || target < 0 || target >= next.length) return;
    next[questionIndex] = other;
    next[target] = current;
    onChange({ ...item, questions: next });
  };
  return <Collapse className="card questionnaire-card" defaultOpen={index === 0} summary={<div className="questionnaire-head"><div className="step-title"><span>{index + 1}</span><div><h2>{item.title.trim() || `Questionnaire ${index + 1}`}</h2>{item.assistant ? <span className="assistant-badge">Drafted with {assistantLabels[item.assistant]}</span> : null}<p>{item.questions.length} questions · each gets {each}{showStatus ? ` · ${item.status === "DRAFT" ? "Draft" : "Published"}` : ""}</p></div></div><div className="questionnaire-actions"><button type="button" aria-label="Move questionnaire up" onClick={() => onMove(-1)} disabled={index === 0}><ArrowUp/></button><button type="button" aria-label="Move questionnaire down" onClick={() => onMove(1)} disabled={index === total - 1}><ArrowDown/></button><button type="button" aria-label="Delete questionnaire" onClick={onRemove} disabled={contentLocked || total === 1}><Trash2/></button></div></div>}>
    {lock.note ? <p className="muted-note">{lock.note}</p> : null}
    {showStatus ? <Field label="Questionnaire status"><select value={item.status} disabled={contentLocked} onChange={(event) => onChange({ ...item, status: event.target.value === "DRAFT" ? "DRAFT" : "PUBLISHED" })}><option value="DRAFT">Draft</option><option value="PUBLISHED" disabled={!canPublish}>Published</option></select></Field> : null}
    <Field label="Questionnaire title"><input value={item.title} onChange={(event) => onChange({ ...item, title: event.target.value })} maxLength={160} disabled={contentLocked}/></Field>
    <div className="form-grid"><Field label="Starts"><input type="datetime-local" value={item.starts} onChange={(event) => onChange({ ...item, starts: event.target.value })}/></Field><Field label="Ends"><input type="datetime-local" value={item.ends} onChange={(event) => onChange({ ...item, ends: event.target.value })} disabled={endLocked(lock)}/></Field></div>
    <div className="excel-actions"><Button type="button" variant="secondary" onClick={() => void downloadQuestionWorkbook(item.title || `Questionnaire ${index + 1}`, item.questions, "format")}><FileDown/> Download Excel format</Button><ExportQuestions title={item.title || `Questionnaire ${index + 1}`} questions={item.questions}/><Button type="button" variant="secondary" disabled={structureLocked} onClick={() => fileRef.current?.click()}><FileUp/> Upload questions</Button><input ref={fileRef} hidden type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void uploadQuestions(event.target.files?.[0])}/></div>
    <p className="excel-note">Export uses the same columns as the Excel format. Add up to 20 questions, then upload. The upload replaces the questions in this questionnaire.</p>
    {importError ? <div className="alert" role="alert">{importError}</div> : null}
    {importNotice ? <div className="success-box">{importNotice}</div> : null}
    <QuestionAssistant title={meetupTitle} questionnaire={item.title || `Questionnaire ${index + 1}`} group={item.key} disabled={structureLocked} onImported={(provider, questions, note) => {
      onChange({ ...item, assistant: provider, questions: questions.map((question) => ({ prompt: question.prompt, options: question.options.map((label) => ({ label })) })) });
      setImportNotice(note);
    }} />
    <div className="question-list">{item.questions.map((question, questionIndex) => {
      const questionLocked = contentLocked || questionIndex < lock.lockedQuestions;
      return <Card key={`${item.key}-${questionIndex}`} className="question-card"><div className="question-head"><GripVertical/><strong>Question {questionIndex + 1}</strong><div><button type="button" aria-label="Move up" onClick={() => moveQuestion(questionIndex, -1)} disabled={structureLocked || questionIndex === 0}><ArrowUp/></button><button type="button" aria-label="Move down" onClick={() => moveQuestion(questionIndex, 1)} disabled={structureLocked || questionIndex === item.questions.length - 1}><ArrowDown/></button><button type="button" aria-label="Duplicate" onClick={() => onChange({ ...item, questions: [...item.questions.slice(0, questionIndex + 1), structuredClone(question), ...item.questions.slice(questionIndex + 1)] })} disabled={structureLocked}><Copy/></button><button type="button" aria-label="Delete" onClick={() => onChange({ ...item, questions: item.questions.filter((_, i) => i !== questionIndex) })} disabled={structureLocked || item.questions.length === 1}><Trash2/></button></div></div>
      <Field label="Prompt"><textarea value={question.prompt} onChange={(event) => updateQuestion(questionIndex, { ...question, prompt: event.target.value })} disabled={questionLocked} placeholder="Ask one clear, focused question…"/></Field>
      <div className="options-grid">{question.options.map((option, optionIndex) => <Field key={optionIndex} label={`Option ${String.fromCharCode(65 + optionIndex)}`}><input value={option.label} onChange={(event) => updateQuestion(questionIndex, { ...question, options: question.options.map((old, j) => j === optionIndex ? { ...old, label: event.target.value } : old) })} disabled={questionLocked} placeholder={`Choice ${optionIndex + 1}`}/></Field>)}</div>
    </Card>;
    })}</div>
    <Button type="button" variant="secondary" onClick={() => onChange({ ...item, questions: [...item.questions, blankQuestion()] })} disabled={structureLocked}><Plus/> Add question</Button>
  </Collapse>;
}
function endLocked(lock: { frozen: boolean; lockedQuestions: number }) {
  return !lock.frozen && lock.lockedQuestions > 0;
}
export function MeetupEditor() {
  const { id } = useParams(); const detail = useQuery({ queryKey: ["meetup", id], queryFn: () => api<MeetupDetail>(`/meetups/${id}`), enabled: !!id });
  if (id && detail.isLoading) return <Loading/>; if (detail.error) return <ErrorState error={detail.error}/>;
  return <MeetupForm existing={detail.data}/>;
}
function MeetupForm({ existing }: { existing: MeetupDetail | undefined }) {
  const { user } = useAuth(); const navigate = useNavigate(); const queryClient = useQueryClient();
  const assistants = useQuery({ queryKey: ["assistants"], queryFn: () => api<{ providers: AssistantConnection[] }>("/profile/assistants") });
  const initialZone = existing?.sourceTimeZone || user!.timeZone;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [zone, setZone] = useState(initialZone);
  const [questionnaires, setQuestionnaires] = useState<DraftQuestionnaire[]>(() => draftsFrom(existing, initialZone));
  const [error, setError] = useState(""); const [saving, setSaving] = useState<"DRAFT"|"PUBLISHED"|null>(null);
  const zoneChoices = timeZoneOptions.includes(zone) ? timeZoneOptions : [zone, ...timeZoneOptions];
  const questionTotal = questionnaires.reduce((sum, item) => sum + item.questions.length, 0);
  const spans = questionnaires.flatMap((item) => {
    const window = scheduleWindow(item.starts, item.ends, zone);
    return Number.isFinite(window.startMs) && window.total > 0 ? [window] : [];
  });
  const firstStart = spans.length ? Math.min(...spans.map((item) => item.startMs)) : Number.NaN;
  const lastEnd = spans.length ? Math.max(...spans.map((item) => item.startMs + item.total)) : Number.NaN;
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); }; addEventListener("beforeunload", warn); return () => removeEventListener("beforeunload", warn); }, []);
  const stamp = (item: DraftQuestionnaire, field: "starts" | "ends") => {
    if (field === "starts" && item.originalStarts && item.starts === item.originalStarts && item.originalStartsAt) return item.originalStartsAt;
    if (field === "ends" && item.originalEnds && item.ends === item.originalEnds && item.originalEndsAt) return item.originalEndsAt;
    return zonedLocalToUtc(item[field], zone);
  };
  const save = async (status: "DRAFT"|"PUBLISHED") => { setSaving(status); setError("");
    try {
      const publishedMeetup = existing?.status === "PUBLISHED";
      const body = { title, sourceTimeZone: zone, status, questionnaires: questionnaires.map((item) => ({ ...(item.id ? { id: item.id } : {}), title: item.title, startsAt: stamp(item, "starts"), endsAt: stamp(item, "ends"), status: publishedMeetup ? item.status : status, ...(item.assistant ? { assistantProvider: item.assistant } : {}), questions: item.questions.map((question) => ({ prompt: question.prompt, options: question.options.map((option) => option.label) })) })), ...(existing ? { version: existing.version } : {}) };
      const result = await api<Meetup>(existing ? `/meetups/${existing.id}` : "/meetups", { method: existing ? "PUT" : "POST", body: JSON.stringify(body) });
      const savedId = result.id ?? existing!.id;
      queryClient.setQueryData<MeetupDetail>(["meetup", savedId], (current) => current ? { ...current, title: result.title, status: result.status, startsAt: result.startsAt, endsAt: result.endsAt, ...(result.version !== undefined ? { version: result.version } : {}), ...(result.publicCode ? { publicCode: result.publicCode } : {}), questionCount: result.questionCount || current.questionCount, questionnaireCount: result.questionnaireCount ?? current.questionnaireCount ?? current.questionnaires.length } : current);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["meetup", savedId] }),
        queryClient.invalidateQueries({ queryKey: ["meetups"] }),
      ]);
      navigate(`/admin/meetups/${savedId}`);
    } catch (err) { setError(message(err)); } finally { setSaving(null); }
  };
  const zoneLocked = questionnaires.some((item) => item.originalStartsAt && Date.parse(item.originalStartsAt) <= Date.now());
  const showStatus = existing?.status === "PUBLISHED";
  return <div className="page editor-page"><PageHeader eyebrow={existing ? "Edit meetup" : "New meetup"} title={existing ? existing.title : "Create something memorable"} description="Pick one time zone for this meetup. Every questionnaire and question uses it."/>
    <div className="editor-grid"><div className="editor-content"><Collapse className="card" defaultOpen summary={<div className="step-title"><span>1</span><div><h2>Meetup details</h2><p>One time zone covers every questionnaire and question.</p></div></div>}>
      <Field label="Meetup title"><input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} required placeholder="e.g. Product Pulse — September"/></Field>
      <Field label="Meetup time zone"><select value={zone} disabled={zoneLocked} onChange={(event) => setZone(event.target.value)}>{zoneChoices.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
      <div className="zone-note"><CalendarDays/> Start and stop times below are in <strong>{zone}</strong>. MeetPlus stores them in GMT. Each participant sees them in their own time zone.{zoneLocked ? " The time zone stays fixed once a questionnaire has started." : ""}</div></Collapse>
      {questionnaires.map((item, index) => <QuestionnaireEditor key={item.key} item={item} index={index} total={questionnaires.length} zone={zone} showStatus={showStatus} meetupTitle={title} onMove={(by) => setQuestionnaires((current) => { const next = [...current]; const target = index + by; const from = next[index]; const other = next[target]; if (!from || !other || target < 0 || target >= next.length) return current; next[index] = other; next[target] = from; return next; })} onRemove={() => setQuestionnaires((current) => current.filter((entry) => entry.key !== item.key))} onChange={(next) => setQuestionnaires((current) => current.map((entry) => entry.key === item.key ? next : entry))} />)}
      <Button type="button" variant="secondary" onClick={() => setQuestionnaires((current) => [...current, blankQuestionnaire(zone, current.length, current[current.length - 1]?.ends, showStatus ? "DRAFT" : "PUBLISHED")])}><Plus/> Add questionnaire</Button></div>
      <aside className="editor-summary"><Card><span className="eyebrow">Ready when you are</span><h2>Meetup summary</h2><dl><div><dt>Questionnaires</dt><dd>{questionnaires.length}</dd></div><div><dt>Questions</dt><dd>{questionTotal}</dd></div><div><dt>First start</dt><dd>{Number.isFinite(firstStart) ? formatDate(firstStart, zone) : "—"}</dd></div><div><dt>Last stop</dt><dd>{Number.isFinite(lastEnd) ? formatDate(lastEnd, zone) : "—"}</dd></div></dl><h3>Connected assistants</h3><AssistantPills providers={assistants.data?.providers}/>{error && <div className="alert" role="alert">{error}</div>}{showStatus ? <Button type="button" busy={saving==="PUBLISHED"} disabled={saving !== null} onClick={() => void save("PUBLISHED")}><Check/> Save changes</Button> : <><Button type="button" variant="secondary" busy={saving==="DRAFT"} disabled={saving !== null} onClick={() => void save("DRAFT")}>Save draft</Button><Button type="button" busy={saving==="PUBLISHED"} disabled={saving !== null} onClick={() => void save("PUBLISHED")}><Check/> {existing ? "Save & publish" : "Publish meetup"}</Button></>}</Card></aside>
    </div></div>;
}
export function MeetupDetails() {
  const { id } = useParams(); const { user } = useAuth(); const queryClient = useQueryClient(); const [toast,setToast]=useState(""); const [qr,setQr]=useState(""); const [pane, setPane] = useState("scoreboard");
  const query = useQuery({ queryKey:["meetup",id], queryFn:()=>api<MeetupDetail>(`/meetups/${id}`) });
  useEffect(() => {
    const joinUrl = query.data?.status === "DRAFT" ? "" : query.data?.joinUrl;
    if (!joinUrl) return;
    let cancelled = false;
    void import("qrcode").then(({ default: QRCode }) =>
      QRCode.toDataURL(joinUrl, { width: 480, margin: 2, color: { dark: "#171433", light: "#ffffff" } }).then((url) => {
        if (!cancelled) setQr(url);
      }),
    );
    return () => { cancelled = true; };
  }, [query.data?.joinUrl, query.data?.status]);
  const questionnaires = query.data?.questionnaires;
  useEffect(() => {
    if (!questionnaires) return;
    const apply = () => {
      const hash = window.location.hash;
      if (hash === "#invite") setPane("invite");
      else if (hash.startsWith("#q-")) {
        const target = hash.slice(3);
        setPane(questionnaires.some((item) => item.id === target) ? target : "scoreboard");
      } else setPane("scoreboard");
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [questionnaires]);
  if(query.isLoading)return <Loading/>; if(query.error)return <ErrorState error={query.error}/>; const m=query.data!;
  const copy=async(value:string,label:string)=>{await navigator.clipboard.writeText(value);setToast(`${label} copied`);setTimeout(()=>setToast(""),2000);};
  const share=async()=>{if(navigator.share)await navigator.share({title:m.title,url:m.joinUrl});else await copy(m.joinUrl,"Link");};
  const cancel=async()=>{if(!confirm("Cancel this meetup for every participant?"))return;await api(`/meetups/${m.id}/cancel`,{method:"POST"});await queryClient.invalidateQueries({queryKey:["meetup",id]});};
  const openPane = (next: string) => {
    const hash = next === "scoreboard" ? "#scoreboard" : next === "invite" ? "#invite" : `#q-${next}`;
    if (window.location.hash !== hash) window.location.hash = hash;
  };
  const current = m.questionnaires.some((questionnaire) => questionnaire.pausedAt) ? "LIVE" : phase(m);
  const scheduled = current === "DRAFT" || current === "CANCELLED";
  const now = Date.now();
  const selected = m.questionnaires.find((item) => item.id === pane);
  const invite = current === "DRAFT"
    ? <Card className="share-card"><span className="eyebrow">Invite your room</span><h2>Share after publish</h2><p>The code, link, and QR code appear when this meetup is published. Participants cannot join a draft.</p></Card>
    : <Card className="share-card"><span className="eyebrow">Invite your room</span><h2>Share meetup</h2><p>Eight-digit code</p><button className="code-block" onClick={()=>void copy(m.publicCode!,"Code")}>{m.publicCode}<Clipboard/></button>{qr&&<img src={qr} alt={`QR code for ${m.title}`}/>}<div className="share-link"><input value={m.joinUrl} readOnly/><button onClick={()=>void copy(m.joinUrl,"Link")}><Copy/></button></div><div className="share-actions"><Button onClick={()=>void share()}><Share2/> Share</Button><a className="btn btn-secondary" href={qr} download={`meetplus-${m.publicCode}.png`}><Download/> QR</a></div>{phase(m)==="UPCOMING"&&<Button variant="danger" onClick={()=>void cancel()}><X/> Cancel meetup</Button>}</Card>;
  return <div className="page"><PageHeader eyebrow="Meetup" title={m.title} description={`${formatDate(m.startsAt,user!.timeZone,"full")} – ${formatDate(m.endsAt,user!.timeZone,"full")}`} action={<div className="actions"><Status value={current}/>{current !== "CANCELLED" ? <Link className="btn btn-secondary" to={`/admin/meetups/${m.id}/edit`}><Edit3/> Edit</Link> : null}</div>}/>
    <div className="meetup-shell">
      <MeetupNav pane={pane} now={now} invite questionnaires={m.questionnaires} onSelect={openPane}/>
      <div className="meetup-panel">
        {scheduled ? pane === "invite" ? <div className="invite-panel">{invite}</div> : selected ? <Card><div className="card-head"><div><h2>{selected.title}</h2>{selected.assistantProvider ? <span className="assistant-badge">Drafted with {assistantLabels[selected.assistantProvider]}</span> : null}<p>{formatDate(selected.startsAt, user!.timeZone)} – {formatDate(selected.endsAt, user!.timeZone)} · {selected.questions.length} questions</p></div><ExportQuestions title={selected.title} questions={selected.questions}/></div><ol className="detail-questions">{selected.questions.map((question) => <li key={question.id}><strong>{question.prompt}</strong><div>{question.options.map((option) => <span key={option.id}>{option.label}</span>)}</div></li>)}</ol></Card> : <ScheduleScoreboard meetup={m} now={now} onOpen={openPane}/> : <>
          <div hidden={pane === "invite"}><ResultsDashboard embedded view={pane === "invite" ? "scoreboard" : pane} onOpenQuestionnaire={openPane}/></div>
          {pane === "invite" ? <div className="invite-panel">{invite}</div> : null}
        </>}
      </div>
    </div>
    {toast&&<Toast>{toast}</Toast>}
  </div>;
}
function ScheduleScoreboard({ meetup, now, onOpen }: { meetup: MeetupDetail; now: number; onOpen: (id: string) => void }) {
  return <>
    <div className="insight-facts"><div><strong>{meetup.questionnaires.length}</strong><span>Questionnaires</span></div><div><strong>{meetup.questionCount}</strong><span>Questions</span></div><div><strong>{meetup.memberCount ?? 0}</strong><span>Participants</span></div></div>
    <ul className="scoreboard">{meetup.questionnaires.map((item, index) => {
      const mark = scoreMark(item, now);
      return <li key={item.id}><button type="button" className="score-row" style={{ animationDelay: `${index * 55}ms` }} aria-label={`Open ${item.title}`} onClick={() => item.id && onOpen(item.id)}><span className={`nav-mark ${mark.toLowerCase()}`}>{mark}</span><strong>{item.title}</strong><em>{item.questions.length} {item.questions.length === 1 ? "question" : "questions"}</em></button></li>;
    })}</ul>
  </>;
}
type ResultsPayload = { meetup: { id: string; title: string; joinedCount: number; startsAt: string; endsAt: string; status: string }; questionnaires: ResultQuestionnaire[]; serverTime: string };
type AnswerEvent = { questionId: string; optionId: string; count: number; answered: number; advanced?: boolean; user?: { id: string; displayName: string; email: string; submittedAt: string } };
function liveEnds(questionnaires: ResultQuestionnaire[], now: number) {
  const ordered = questionnaires.filter((item) => item.status !== "DRAFT").sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  const current = ordered.find((item) => questionnaireIsLive(item, now));
  const upcoming = ordered.find((item) => Date.parse(item.startsAt) > now);
  const questionnaire = current ?? upcoming;
  const questions = questionnaire?.questions ?? [];
  const active = current
    ? questions.find((question) => question.startsAt && question.endsAt && now >= Date.parse(question.startsAt) && now < Date.parse(question.endsAt))
    : questions[0];
  return { questionnaireEndsAt: questionnaire?.endsAt ?? null, questionEndsAt: active?.endsAt ?? null };
}
function applyAnswer(current: ResultsPayload, event: AnswerEvent): ResultsPayload {
  return { ...current, questionnaires: current.questionnaires.map((questionnaire) => ({ ...questionnaire, questions: questionnaire.questions.map((question) => {
    if (question.id !== event.questionId) return question;
    const options = question.options.map((option) => {
      if (option.id !== event.optionId) return { ...option, percentage: event.answered ? option.count / event.answered * 100 : 0 };
      const person = event.user;
      const users = person && !option.users.some((entry) => entry.id === person.id) ? [...option.users, person] : option.users;
      return { ...option, count: event.count, users, percentage: event.answered ? event.count / event.answered * 100 : 0 };
    });
    return { ...question, answered: event.answered, options };
  }) })) };
}
function responseRate(answered: number, possible: number) {
  return possible ? Math.round(answered / possible * 100) : 0;
}
function scoreMark(item: { status?: string; pausedAt?: string | null; startsAt: string; endsAt: string }, now: number) {
  if (item.pausedAt) return "Paused";
  if (item.status === "DRAFT") return "Draft";
  if (questionnaireIsLive(item, now)) return "Live";
  if (now < Date.parse(item.startsAt)) return "Upcoming";
  return "Done";
}
function MeetupNav({ pane, onSelect, questionnaires, now, invite = false }: {
  pane: string; onSelect: (pane: string) => void; now: number; invite?: boolean;
  questionnaires: { id?: string; title: string; status?: string; pausedAt?: string | null; startsAt: string; endsAt: string }[];
}) {
  return <nav className="meetup-nav" aria-label="Meetup">
    <button type="button" aria-current={pane === "scoreboard" ? "page" : undefined} onClick={() => onSelect("scoreboard")}>Scoreboard</button>
    {questionnaires.map((item) => {
      const mark = scoreMark(item, now);
      return <button type="button" key={item.id} aria-current={pane === item.id ? "page" : undefined} onClick={() => item.id && onSelect(item.id)}>
        <strong>{item.title}</strong><span className={`nav-mark ${mark.toLowerCase()}`}>{mark}</span>
      </button>;
    })}
    {invite ? <button type="button" aria-current={pane === "invite" ? "page" : undefined} onClick={() => onSelect("invite")}>Invite</button> : null}
  </nav>;
}
function QuestionnaireResult({ questionnaire, joined, zone, now, controls }: { questionnaire: ResultQuestionnaire; joined: number; zone: string; now: number; controls: ReactNode }) {
  const draft = questionnaire.status === "DRAFT";
  const answeredHere = questionnaire.questions.reduce((sum, question) => sum + question.answered, 0);
  const possible = joined * questionnaire.questions.length;
  const rate = responseRate(answeredHere, possible);
  return <section>
    <div className="section-head"><div><span className="eyebrow">{scoreMark(questionnaire, now)}</span><h2>{questionnaire.title}</h2>{questionnaire.assistantProvider ? <span className="assistant-badge">Drafted with {assistantLabels[questionnaire.assistantProvider]}</span> : null}<p>{formatDate(questionnaire.startsAt, zone)} – {formatDate(questionnaire.endsAt, zone)}</p></div><ExportQuestions title={questionnaire.title} questions={questionnaire.questions}/></div>
    {controls}
    <InsightBoard title={questionnaire.title} rate={rate} rateLabel={draft ? "Draft" : "Questionnaire response"} caption={`${answeredHere} of ${possible} answers`} facts={[{ value: joined, label: joined === 1 ? "Participant" : "Participants" }, { value: answeredHere, label: answeredHere === 1 ? "Answer" : "Answers" }, { value: Math.max(0, possible - answeredHere), label: "Still open" }]}/>
    {draft ? null : <QuestionPulse questions={questionnaire.questions.map((question) => ({ id: question.id, label: `Q${question.position}`, value: responseRate(question.answered, joined), caption: question.prompt }))}/>}
    {questionnaire.questions.map((question, index) => <article className="result-question stage-card" style={{ animationDelay: `${index * 70}ms` }} key={question.id}><header><span>Q{question.position}</span><div><strong className="stage-prompt">{question.prompt}</strong><small>{question.answered} {question.answered === 1 ? "participant answered" : "participants answered"}{question.startsAt && question.endsAt ? ` · ${formatDate(question.startsAt, zone)} – ${formatDate(question.endsAt, zone)}` : ""}</small></div></header><OptionChart answered={question.answered} showPeople options={question.options.map((option) => ({ id: option.id, label: option.label, count: option.count, people: option.users }))}/></article>)}
  </section>;
}
export function ResultsDashboard({ embedded = false, view, onOpenQuestionnaire }: { embedded?: boolean; view?: string; onOpenQuestionnaire?: (id: string) => void }) {
  const { id }=useParams(); const {user}=useAuth(); const queryClient = useQueryClient();
  const [localView, setLocalView] = useState("scoreboard");
  const query=useQuery({
    queryKey:["results",id],
    queryFn:()=>api<ResultsPayload>(`/meetups/${id}/results`),
    refetchInterval:(q) => {
      const meetup = q.state.data?.meetup;
      if (!meetup) return false;
      if (q.state.data?.questionnaires.some((item) => item.pausedAt)) return 10_000;
      const now = Date.now();
      return now >= Date.parse(meetup.startsAt) && now < Date.parse(meetup.endsAt) ? 10_000 : false;
    },
  });
  const ready = Boolean(query.data);
  const [controlError, setControlError] = useState("");
  const [controlBusy, setControlBusy] = useState<"" | "pause" | "resume" | "advance">("");
  useEffect(() => {
    if (!id || !ready) return;
    const source = new EventSource(`/api/meetups/${id}/host-stream`, { withCredentials: true });
    source.addEventListener("presence", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { participantCount: number };
      queryClient.setQueryData<ResultsPayload>(["results", id], (current) => current ? { ...current, meetup: { ...current.meetup, joinedCount: data.participantCount } } : current);
      queryClient.setQueryData<MeetupDetail>(["meetup", id], (current) => current ? { ...current, memberCount: data.participantCount } : current);
    });
    source.addEventListener("answer", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as AnswerEvent;
      if (data.advanced) {
        void query.refetch();
        void queryClient.invalidateQueries({ queryKey: ["meetup", id] });
        return;
      }
      queryClient.setQueryData<ResultsPayload>(["results", id], (current) => current ? applyAnswer(current, data) : current);
    });
    source.addEventListener("schedule", () => {
      void query.refetch();
      void queryClient.invalidateQueries({ queryKey: ["meetup", id] });
    });
    return () => source.close();
  }, [id, ready, queryClient]);
  useEffect(() => {
    const data = query.data;
    if (!data) return;
    const offset = Date.parse(data.serverTime) - Date.now();
    const ends = liveEnds(data.questionnaires, Date.now() + offset);
    const marks = [data.meetup.endsAt, ends.questionnaireEndsAt, ends.questionEndsAt].flatMap((value) => value ? [Date.parse(value)] : []);
    const next = Math.min(...marks.filter((value) => value > Date.now() + offset));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => void query.refetch(), Math.max(0, next - (Date.now() + offset)) + 250);
    return () => clearTimeout(timer);
  }, [query.data, query.refetch]);
  if(query.isLoading)return <Loading/>;if(query.error)return <ErrorState error={query.error}/>;const {meetup,questionnaires,serverTime}=query.data!;const scored=questionnaires.filter((item)=>item.status!=="DRAFT");const questions=scored.flatMap((item)=>item.questions);const answered=questions.reduce((n,q)=>n+q.answered,0),possible=meetup.joinedCount*questions.length;
  const held = questionnaires.find((item) => item.pausedAt);
  const offset = Date.parse(serverTime) - Date.now();
  const now = held?.pausedAt ? Date.parse(held.pausedAt) : Date.now() + offset;
  const ends = liveEnds(questionnaires, now);
  const liveQuestionnaire = held ?? questionnaires.find((item) => questionnaireIsLive(item, now));
  const download=async()=>{const r=await fetch(`/api/meetups/${id}/results.csv`,{credentials:"include"});const blob=await r.blob();const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`meetplus-${id}-results.csv`;a.click();URL.revokeObjectURL(a.href);};
  const control = async (action: "pause" | "resume" | "advance") => {
    if (!id || !liveQuestionnaire) return;
    setControlBusy(action);
    setControlError("");
    try {
      await api(`/meetups/${id}/questionnaires/${liveQuestionnaire.id}/${action}`, { method: "POST" });
      await Promise.all([query.refetch(), queryClient.invalidateQueries({ queryKey: ["meetup", id] })]);
    } catch (err) {
      setControlError(message(err));
    } finally {
      setControlBusy("");
    }
  };
  const selectedView = view ?? localView;
  const openQuestionnaire = onOpenQuestionnaire ?? ((next: string) => setLocalView(next));
  const showing = selectedView === "scoreboard" ? undefined : questionnaires.find((item) => item.id === selectedView);
  const liveControlPanel = liveQuestionnaire ? <div className="live-controls"><div className="actions">{held ? <Button type="button" busy={controlBusy==="resume"} disabled={controlBusy!==""} onClick={()=>void control("resume")}><Play/> Resume</Button> : <Button type="button" variant="secondary" busy={controlBusy==="pause"} disabled={controlBusy!==""} onClick={()=>void control("pause")}><Pause/> Pause</Button>}<Button type="button" variant="secondary" busy={controlBusy==="advance"} disabled={controlBusy!==""} onClick={()=>void control("advance")}><SkipForward/> Next question</Button></div><p>Pause holds the current question. Next question skips ahead and shows the results first.</p>{controlError ? <div className="alert">{controlError}</div> : null}</div> : null;
  const scoreboard = <><div className="section-head"><div><h2>Scoreboard</h2><p>Meetup response, then each questionnaire. Open one for its questions. Times are in {user!.timeZone}.</p></div><Button variant="secondary" onClick={()=>void download()}><FileDown/> Export CSV</Button></div>
    <RemainingClocks meetupEndsAt={meetup.endsAt} questionnaireEndsAt={ends.questionnaireEndsAt} questionEndsAt={ends.questionEndsAt} serverTime={held?.pausedAt ?? serverTime} paused={Boolean(held)}/>
    {liveControlPanel}
    <InsightBoard title="Meetup" rate={responseRate(answered, possible)} rateLabel="Meetup response" caption={`${answered} of ${possible} answers`} facts={[{ value: meetup.joinedCount, label: meetup.joinedCount === 1 ? "Participant" : "Participants" }, { value: answered, label: answered === 1 ? "Answer" : "Answers" }, { value: Math.max(0, possible - answered), label: "Still open" }]}/>
    <ul className="scoreboard">{questionnaires.map((questionnaire, index) => {
      const answersHere = questionnaire.questions.reduce((sum, question) => sum + question.answered, 0);
      const rate = responseRate(answersHere, meetup.joinedCount * questionnaire.questions.length);
      const mark = scoreMark(questionnaire, now);
      return <li key={questionnaire.id}><button type="button" className="score-row" style={{ animationDelay: `${index * 55}ms` }} aria-label={`Open ${questionnaire.title}`} onClick={() => openQuestionnaire(questionnaire.id)}><span className={`nav-mark ${mark.toLowerCase()}`}>{mark}</span><strong>{questionnaire.title}</strong><i role="meter" aria-label={`${questionnaire.title}, ${rate}% response`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={rate}><b style={{ transform: `scaleX(${rate / 100})` }}/></i><em>{rate}%</em></button></li>;
    })}</ul></>;
  const panel = showing ? <QuestionnaireResult questionnaire={showing} joined={meetup.joinedCount} zone={user!.timeZone} now={now} controls={showing.id === liveQuestionnaire?.id ? liveControlPanel : null}/> : scoreboard;
  if (embedded) return <section id="results">{panel}</section>;
  return <div className="page"><PageHeader eyebrow="Results" title={meetup.title} description={formatDate(meetup.startsAt,user!.timeZone)} action={<Button variant="secondary" onClick={()=>void download()}><FileDown/> Export CSV</Button>}/>
    <div className="meetup-shell"><MeetupNav pane={showing ? showing.id : "scoreboard"} now={now} questionnaires={questionnaires} onSelect={openQuestionnaire}/><div className="meetup-panel">{panel}</div></div>
  </div>;
}
