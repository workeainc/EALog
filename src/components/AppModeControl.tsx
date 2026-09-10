import { Coffee, Palmtree, Play, TimerReset } from "lucide-react";
import { useState } from "react";
import type { AppMode, AppModeState } from "../types/tracker";

type Props = {
  mode: AppMode;
  state: AppModeState;
  onStartBreak: (minutes: number, reason: string) => Promise<void>;
  onResumeWork: () => Promise<void>;
  onPlanVacation: (startDate: string, endDate: string, reason: string, relaxed: boolean) => Promise<void>;
  onEndVacation: () => Promise<void>;
};

const todayKey = () => new Date().toLocaleDateString("en-CA");
const tomorrowKey = () => { const date = new Date(); date.setDate(date.getDate() + 1); return date.toLocaleDateString("en-CA"); };

export default function AppModeControl({ mode, state, onStartBreak, onResumeWork, onPlanVacation, onEndVacation }: Props) {
  const [panel, setPanel] = useState<"menu" | "break" | "vacation" | null>(null);
  const [busy, setBusy] = useState(false);
  const [duration, setDuration] = useState(20);
  const [reason, setReason] = useState("");
  const [startDate, setStartDate] = useState(todayKey);
  const [endDate, setEndDate] = useState(tomorrowKey);
  const [relaxed, setRelaxed] = useState(true);
  const label = mode === "vacation" ? "Vacation mode" : mode === "break" ? "On break" : "Working";

  return <div className="app-mode-control">
    <button className={`app-mode-pill ${mode}`} type="button" onClick={() => setPanel("menu")} aria-haspopup="dialog">
      {mode === "vacation" ? <Palmtree size={15} /> : mode === "break" ? <Coffee size={15} /> : <i />}{label}
    </button>
    {panel === "menu" && <div className="app-mode-menu" role="dialog" aria-label="Day mode">
      <span className="eyebrow">CURRENT MODE</span><b>{label}</b>
      {mode === "workday" && <><button onClick={() => setPanel("break")}><Coffee size={16} /> Start break</button><button onClick={() => setPanel("vacation")}><Palmtree size={16} /> Plan vacation</button></>}
      {mode === "break" && <><p>{state.breakReason || "Recovery break"}{state.breakExpectedEndAt ? ` · until ${new Date(state.breakExpectedEndAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</p><button className="mode-primary" disabled={busy} onClick={async () => { setBusy(true); try { await onResumeWork(); setPanel(null); } finally { setBusy(false); } }}><Play size={16} /> Resume work</button></>}
      {mode === "vacation" && <><p>{state.vacationStartDate} to {state.vacationEndDate}</p><button className="mode-primary" disabled={busy} onClick={async () => { setBusy(true); try { await onEndVacation(); setPanel(null); } finally { setBusy(false); } }}><Play size={16} /> End vacation</button></>}
    </div>}
    {panel === "break" && <div className="modal-backdrop"><form className="note-modal mode-modal" onSubmit={async event => { event.preventDefault(); setBusy(true); try { await onStartBreak(duration, reason.trim()); setPanel(null); } finally { setBusy(false); } }}><button type="button" className="modal-close" onClick={() => setPanel(null)}>×</button><div className="modal-icon warning"><Coffee size={20} /></div><span className="eyebrow">START BREAK</span><h3>Step away without losing your day</h3><p>Your active work session will pause. Break time is never counted as work.</p><div className="mode-duration"><label>Duration</label><div>{[10,20,30,45].map(value => <button type="button" className={duration === value ? "active" : ""} key={value} onClick={() => setDuration(value)}>{value}m</button>)}</div></div><label className="modal-field">REASON <input value={reason} onChange={event => setReason(event.target.value)} placeholder="Lunch, rest, namaz, personal…" /></label><div className="modal-actions"><button type="button" className="outline-btn" onClick={() => setPanel(null)}>Cancel</button><button className="start-btn" disabled={busy}>{busy ? "Starting…" : "Start break"}</button></div></form></div>}
    {panel === "vacation" && <div className="modal-backdrop"><form className="note-modal mode-modal" onSubmit={async event => { event.preventDefault(); if (endDate < startDate) return; setBusy(true); try { await onPlanVacation(startDate, endDate, reason.trim(), relaxed); setPanel(null); } finally { setBusy(false); } }}><button type="button" className="modal-close" onClick={() => setPanel(null)}>×</button><div className="modal-icon"><Palmtree size={20} /></div><span className="eyebrow">PLAN VACATION</span><h3>Take time away from work</h3><p>Work tracking, tasks, and project pressure pause during these dates. Personal discipline stays active.</p><div className="routine-form-grid"><label className="modal-field">FROM<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} required /></label><label className="modal-field">TO<input type="date" min={startDate} value={endDate} onChange={event => setEndDate(event.target.value)} required /></label></div><label className="modal-field">NOTE (OPTIONAL)<input value={reason} onChange={event => setReason(event.target.value)} placeholder="Family trip, recovery, leave…" /></label><label className="note-pin"><input type="checkbox" checked={relaxed} onChange={event => setRelaxed(event.target.checked)} /> Relax work-focused routine reminders</label><div className="modal-actions"><button type="button" className="outline-btn" onClick={() => setPanel(null)}>Cancel</button><button className="start-btn" disabled={busy}>{busy ? "Saving…" : "Start vacation"}</button></div></form></div>}
  </div>;
}
