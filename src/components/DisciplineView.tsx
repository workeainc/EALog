import { AlertTriangle, Check, Clock3, Moon, Plus, SkipForward, Sparkles, Sunrise } from "lucide-react";
import { useMemo, useState } from "react";
import { logRoutine, saveRoutine } from "../lib/routine-service";
import { localDateKey } from "../lib/project-schedule";
import type { Routine, RoutineCategory, RoutineLog } from "../types/tracker";

type Props = { uid: string; routines: Routine[]; logs: RoutineLog[] };
const categories: RoutineCategory[] = ["spiritual", "health", "break", "personal"];
const priorityLabel = { critical: "Critical", high: "High", normal: "Normal" } as const;
const addMinutes = (time: string, minutes: number) => {
  const [hour, minute] = time.split(":").map(Number);
  const total = ((hour * 60 + minute + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const routineAction = (routine: Routine) => routine.name.toLowerCase().includes("wake") ? "I’m awake" : routine.name.toLowerCase().includes("sleep") ? "Sleep started" : "Complete";

export default function DisciplineView({ uid, routines, logs }: Props) {
  const [adding, setAdding] = useState(false);
  const [skipRoutine, setSkipRoutine] = useState<Routine | null>(null);
  const today = localDateKey();
  const todayDay = new Date(`${today}T12:00:00`).getDay();
  const todays = useMemo(() => routines.filter((routine) => routine.active && routine.repeatDays.includes(todayDay)), [routines, todayDay]);
  const record = (id: string) => logs.find((log) => log.id === `${id}-${today}`);
  const completed = todays.filter((routine) => record(routine.id)?.status === "completed").length;
  const needsAttention = todays.filter((routine) => ["missed", "snoozed", "skipped"].includes(record(routine.id)?.status || "")).length;
  return <main className="discipline-page">
    <header><div><span className="discipline-icon"><Sparkles size={21}/></span><div><h1>Discipline</h1><p>Protect your personal commitments alongside focused work.</p></div></div><button className="start-btn" onClick={() => setAdding(true)}><Plus size={16}/> New routine</button></header>
    <section className="discipline-summary"><article><span>Today’s routines</span><b>{todays.length}</b></article><article><span>Completed</span><b>{completed} / {todays.length}</b></article><article><span>Needs attention</span><b>{needsAttention}</b></article></section>
    <section className="discipline-timeline"><header><div><span className="eyebrow">TODAY’S ROUTINES</span><h2>{new Date(`${today}T12:00:00`).toLocaleDateString("en-GB", { weekday:"long", day:"numeric", month:"long" })}</h2></div><span>{Math.max(0, todays.length - completed)} remaining</span></header>
      {todays.length ? todays.map((routine) => { const status = record(routine.id)?.status; const special = /sleep|wake/i.test(routine.name); return <article key={routine.id} className={status || "planned"}><time>{routine.time}<small>until {addMinutes(routine.time, routine.windowMinutes)}</small></time><i className={routine.category}/><div><b>{special && (routine.name.toLowerCase().includes("sleep") ? <Moon size={14}/> : <Sunrise size={14}/>)} {routine.name} <span className={`routine-priority ${routine.priority}`}>{priorityLabel[routine.priority]}</span></b><small>{routine.category} · {routine.durationMinutes} min · {routine.priority === "critical" ? "Auto-pause and lock" : routine.sessionBehavior === "pause" ? "Auto-pause work session" : "Reminder only"}</small></div>{status ? <em>{status}</em> : <div className="routine-actions"><button onClick={() => void logRoutine(uid, routine.id, today, "completed")}><Check size={15}/>{routineAction(routine)}</button><button onClick={() => setSkipRoutine(routine)}><SkipForward size={15}/> Skip</button></div>}</article>; }) : <p className="discipline-empty">No routines planned today. Create one to start building your schedule.</p>}
    </section>
    {adding && <RoutineModal onClose={() => setAdding(false)} onSave={async input => { await saveRoutine(uid, input); setAdding(false); }}/>}
    {skipRoutine && <SkipReasonModal routine={skipRoutine} onClose={() => setSkipRoutine(null)} onSave={async reason => { await logRoutine(uid, skipRoutine.id, today, "skipped", { skippedReason: reason }); setSkipRoutine(null); }}/>}
  </main>;
}

function SkipReasonModal({ routine, onClose, onSave }: { routine: Routine; onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const required = routine.priority === "critical";
  return <div className="modal-backdrop"><form className="note-modal" onSubmit={async event => { event.preventDefault(); if (required && !reason.trim()) return; setBusy(true); try { await onSave(reason.trim()); } finally { setBusy(false); } }}><div className="modal-icon warning"><AlertTriangle size={20}/></div><span className="eyebrow">SKIP ROUTINE</span><h3>{routine.name}</h3><p>{required ? "This is a critical commitment. Add a reason before deliberately skipping it." : "You can skip this routine when it cannot be completed today."}</p><label className="modal-field">{required ? "REASON (REQUIRED)" : "REASON (OPTIONAL)"}<textarea value={reason} onChange={event => setReason(event.target.value)} required={required} placeholder="Why are you skipping this routine?"/></label><div className="modal-actions"><button className="outline-btn" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="danger-btn" disabled={busy || (required && !reason.trim())}>{busy ? "Saving…" : "Confirm skip"}</button></div></form></div>;
}

function RoutineModal({ onClose, onSave }: { onClose: () => void; onSave: (input: Omit<Routine,"id"|"createdAt"|"updatedAt">) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return <div className="modal-backdrop"><form className="note-modal" onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); try { await onSave({ name: String(form.get("name")).trim(), category: String(form.get("category")) as RoutineCategory, priority: String(form.get("priority")) as Routine["priority"], time: String(form.get("time")), durationMinutes: Number(form.get("duration")), windowMinutes: Number(form.get("window")), repeatDays: [0,1,2,3,4,5,6], reminderMinutes: Number(form.get("reminder")), sessionBehavior: String(form.get("behavior")) as "warn" | "pause", strict: form.get("strict") === "on", active: true }); } finally { setBusy(false); } }}><button className="modal-close" type="button" onClick={onClose}>×</button><div className="modal-icon"><Clock3 size={20}/></div><h3>New routine</h3><label className="modal-field">ROUTINE NAME<input name="name" required placeholder="Namaz, Lunch, Sleep…"/></label><div className="routine-form-grid"><label className="modal-field">CATEGORY<select name="category">{categories.map(category => <option key={category}>{category}</option>)}</select></label><label className="modal-field">PRIORITY<select name="priority" defaultValue="normal"><option value="critical">Critical — pause and lock</option><option value="high">High — pause work</option><option value="normal">Normal — reminder</option></select></label></div><div className="routine-form-grid"><label className="modal-field">START TIME<input name="time" type="time" defaultValue="13:00" required/></label><label className="modal-field">DURATION (MIN)<input name="duration" type="number" min="1" defaultValue="15" required/></label></div><div className="routine-form-grid"><label className="modal-field">WINDOW (MIN)<input name="window" type="number" min="1" defaultValue="15" required/></label><label className="modal-field">WARN BEFORE (MIN)<input name="reminder" type="number" min="0" defaultValue="5" required/></label></div><label className="modal-field">ACTIVE SESSION<select name="behavior"><option value="pause">Automatically pause work</option><option value="warn">Reminder only</option></select></label><label className="note-pin"><input name="strict" type="checkbox"/> Keep this routine locked until I act</label><div className="modal-actions"><button className="outline-btn" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="start-btn" disabled={busy}>{busy ? "Saving…" : "Save routine"}</button></div></form></div>;
}
