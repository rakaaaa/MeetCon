import { useEffect, useId, useRef, useState } from "react";

export type ChartFact = { value: number; label: string };
export type ChartBar = { id: string; label: string; value: number; caption: string };
export type ChartOption = { id: string; label: string; count: number; people?: { id: string; displayName: string }[] };

const RING_SIZE = 120;
const RING_STROKE = 12;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function tone(index: number) {
  return `tone-${index % 4}`;
}

function useDrawIn() {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return drawn;
}

function useRisingCount(options: ChartOption[]) {
  const signature = options.map((option) => `${option.id}:${option.count}`).join("|");
  const previous = useRef(signature);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [rising, setRising] = useState("");
  useEffect(() => {
    const prior = previous.current;
    previous.current = signature;
    if (prior === signature) return;
    const before = new Map(prior.split("|").filter(Boolean).map((part) => {
      const split = part.lastIndexOf(":");
      return [part.slice(0, split), Number(part.slice(split + 1))] as const;
    }));
    const hit = optionsRef.current.find((option) => option.count > (before.get(option.id) ?? 0));
    if (!hit) return;
    setRising(hit.id);
    const timer = window.setTimeout(() => setRising(""), 700);
    return () => window.clearTimeout(timer);
  }, [signature]);
  return rising;
}

function leadLine(options: ChartOption[], answered: number) {
  const first = options[0];
  if (!first || answered <= 0) return { title: "No answers yet", detail: "The chart fills in as people choose." };
  let best = first;
  let ties = 1;
  for (let index = 1; index < options.length; index += 1) {
    const option = options[index]!;
    if (option.count > best.count) {
      best = option;
      ties = 1;
    } else if (option.count === best.count) ties += 1;
  }
  if (best.count === 0) return { title: "No answers yet", detail: "The chart fills in as people choose." };
  const share = Math.round(best.count / answered * 100);
  if (ties > 1) return { title: `${ties} options are tied`, detail: `${best.count} each · ${share}%` };
  return { title: `${best.label} leads`, detail: `${best.count} of ${answered} · ${share}%` };
}

export function RateRing({ value, label, caption }: { value: number; label: string; caption: string }) {
  const gradientId = `ring-${useId().replace(/:/g, "")}`;
  const drawnIn = useDrawIn();
  const clamped = Math.max(0, Math.min(100, value));
  const drawn = drawnIn ? Math.round(clamped / 100 * RING_CIRCUMFERENCE * 10) / 10 : 0;
  return <figure className="ring-chart">
    <svg viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} role="img" aria-label={`${label}, ${clamped}%`}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style={{ stopColor: "var(--primary)" }}/>
          <stop offset="100%" style={{ stopColor: "var(--cyan)" }}/>
        </linearGradient>
      </defs>
      <circle className="ring-track" cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS}/>
      {clamped > 0 ? <circle className="ring-value" cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} stroke={`url(#${gradientId})`} strokeDasharray={`${drawn} ${RING_CIRCUMFERENCE}`} transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}/> : null}
      <text x={RING_SIZE / 2} y={RING_SIZE / 2} dominantBaseline="central" textAnchor="middle">{clamped}%</text>
    </svg>
    <figcaption><strong>{label}</strong><span>{caption}</span></figcaption>
  </figure>;
}

export function InsightBoard({ title, rate, rateLabel, caption, facts, bars }: {
  title: string; rate: number; rateLabel: string; caption: string; facts: ChartFact[]; bars?: ChartBar[];
}) {
  const drawn = useDrawIn();
  return <section className="insight-board stage-card" aria-label={title}>
    <RateRing value={rate} label={rateLabel} caption={caption}/>
    <div className="insight-facts">{facts.map((fact, index) => <div className="stage-card" style={{ animationDelay: `${index * 60}ms` }} key={fact.label}><strong>{fact.value}</strong><span>{fact.label}</span></div>)}</div>
    {bars && bars.length > 0 ? <div className="compare-chart" role="group" aria-label="Response by questionnaire">
      {bars.map((bar, index) => <div className="compare-row stage-card" style={{ animationDelay: `${index * 55}ms` }} key={bar.id}>
        <strong title={bar.label}>{bar.label}</strong>
        <i role="meter" aria-label={`${bar.label}, ${bar.value}% response`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={bar.value}><b style={{ transform: `scaleX(${drawn ? bar.value / 100 : 0})` }}/></i>
        <span>{bar.caption}</span>
      </div>)}
    </div> : null}
  </section>;
}

export function QuestionPulse({ questions }: { questions: ChartBar[] }) {
  const drawn = useDrawIn();
  if (!questions.length) return null;
  return <div className="question-pulse" role="group" aria-label="Response by question">
    {questions.map((question, index) => <div className="question-pulse-row stage-card" style={{ animationDelay: `${index * 50}ms` }} key={question.id}>
      <strong>{question.label}</strong>
      <i role="meter" aria-label={`${question.caption}, ${question.value}% answered`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={question.value} title={question.caption}><b style={{ transform: `scaleX(${drawn ? question.value / 100 : 0})` }}/></i>
      <span>{question.value}%</span>
    </div>)}
  </div>;
}

export function OptionChart({ options, answered, showPeople = false }: { options: ChartOption[]; answered: number; showPeople?: boolean }) {
  const drawn = useDrawIn();
  const rising = useRisingCount(options);
  const lead = leadLine(options, answered);
  const peak = options.reduce((highest, option) => option.count > highest ? option.count : highest, 0);
  const uniqueLead = options.filter((option) => option.count === peak && peak > 0).length === 1;
  return <div className="option-chart">
    <p className="chart-leader"><strong>{lead.title}</strong><small>{lead.detail}</small></p>
    <div className="share-strip" role="img" aria-label={answered > 0 ? options.map((option) => `${option.label} ${option.count}`).join(", ") : "No answers yet"}>
      {answered > 0 ? options.map((option, index) => option.count > 0 ? <i key={option.id} className={tone(index)} style={{ flexGrow: option.count }}/> : null) : <i className="share-empty"/>}
    </div>
    <div className="column-chart" role="group" aria-label="Option totals">
      {options.map((option, index) => {
        const height = peak > 0 ? option.count / peak * 100 : 0;
        const standing = uniqueLead && option.count === peak ? " is-lead" : peak > 0 && option.count < peak ? " is-trail" : "";
        return <div className={`column${standing}${rising === option.id ? " is-rising" : ""}`} key={option.id}>
          <span>{option.count}</span>
          <div className="column-track" role="meter" aria-label={`${option.label}, ${option.count} of ${answered}`} aria-valuemin={0} aria-valuemax={Math.max(answered, 1)} aria-valuenow={option.count}><i className={tone(index)} style={{ height: drawn ? `${height}%` : "0%" }}/></div>
          <span className="column-label">{option.label}</span>
        </div>;
      })}
    </div>
    {showPeople ? <ul className="option-people">{options.map((option, index) => <li key={option.id}><span className={`swatch ${tone(index)}`}/><strong>{option.label}</strong><em>{option.count}</em><div className="respondents">{option.people && option.people.length > 0 ? option.people.map((person) => <span key={person.id}>{person.displayName}</span>) : <em>No selections yet</em>}</div></li>)}</ul> : null}
  </div>;
}
