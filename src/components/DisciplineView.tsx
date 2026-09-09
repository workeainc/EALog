import { AlertTriangle, Check, Clock3, Moon, Pencil, Plus, SkipForward, Sparkles, Sunrise } from "lucide-react";
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
const addDays = (key: string, days: number) => { const date = new Date(`${key}T12:00:00`); date.setDate(date.getDate() + days); return localDateKey(date); };
const inPlan = (routine: Routine, date: string) => (!routine.effectiveDate || routine.effectiveDate <= date) && (!routine.endDate || routine.endDate >= date);
const planStartDate = "2026-09-17";
const planEndDate = addDays(planStartDate, 29);
const monthlyPlan = (startDate: string): Omit<Routine, "id" | "createdAt" | "updatedAt">[] => {
  const endDate = addDays(startDate, 29);
  const routine = (name: string, category: RoutineCategory, priority: Routine["priority"], time: string, durationMinutes: number, behavior: Routine["sessionBehavior"], strict = false) => ({ name, category, priority, time, durationMinutes, windowMinutes: priority === "critical" ? 25 : 30, repeatDays: [0,1,2,3,4,5,6], reminderMinutes: 5, sessionBehavior: behavior, strict, active: true, effectiveDate: startDate, endDate });
  return [
    routine("Wake up & plan the day", "personal", "critical", "06:00", 20, "pause", true),
    routine("Fajr / morning spiritual time", "spiritual", "critical", "05:00", 20, "pause", true),
    routine("Breakfast & preparation", "health", "high", "08:00", 30, "pause"),
    routine("Morning focus block", "personal", "normal", "09:00", 210, "warn"),
    routine("Dhuhr / midday spiritual time", "spiritual", "critical", "12:30", 20, "pause", true),
    routine("Lunch & reset", "health", "high", "13:00", 45, "pause"),
    routine("Afternoon focus block", "personal", "normal", "14:15", 210, "warn"),
    routine("Asr / afternoon spiritual time", "spiritual", "critical", "16:30", 20, "pause", true),
    routine("Walk or exercise", "health", "normal", "17:45", 30, "warn"),
    routine("Maghrib / evening spiritual time", "spiritual", "critical", "18:15", 20, "pause", true),
    routine("Dinner & family time", "break", "high", "20:30", 45, "pause"),
    routine("Isha / night spiritual time", "spiritual", "critical", "20:00", 20, "pause", true),
    routine("Day review & tomorrow plan", "personal", "high", "22:30", 20, "pause"),
    routine("Sleep", "health", "critical", "23:30", 30, "pause", true),
  ];
};
const monthlyPlanNames = new Set(monthlyPlan(planStartDate).map((routine) => routine.name));

export default function DisciplineView({ uid, routines, logs }: Props) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Routine | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState("");
  const [skipRoutine, setSkipRoutine] = useState<Routine | null>(null);
  const today = localDateKey();
  const todayDay = new Date(`${today}T12:00:00`).getDay();
  const todays = useMemo(() => routines.filter((routine) => routine.active && routine.repeatDays.includes(todayDay) && inPlan(routine, today)), [routines, todayDay, today]);
  const seededPlan = routines.filter((routine) => Boolean(routine.effectiveDate && routine.endDate && monthlyPlanNames.has(routine.name)));
  const planExists = seededPlan.some((routine) => routine.effectiveDate === planStartDate && routine.endDate === planEndDate);
  const record = (id: string) => logs.find((log) => log.id === `${id}-${today}`);
  const completed = todays.filter((routine) => record(routine.id)?.status === "completed").length;
  const needsAttention = todays.filter((routine) => ["missed", "snoozed", "skipped"].includes(record(routine.id)?.status || "")).length;
  return <main className="discipline-page">
    <header><div><span className="discipline-icon"><Sparkles size={21}/></span><div><h1>Discipline</h1><p>Protect your personal commitments alongside focused work.</p>{seedError && <p className="routine-error" role="alert">{seedError}</p>}</div></div><div className="discipline-header-actions">{!planExists && <button className="outline-btn" disabled={seeding} onClick={async () => { setSeeding(true); setSeedError(""); try { if (seededPlan.length) { await Promise.all(seededPlan.map(({ id, createdAt: _createdAt, updatedAt: _updatedAt, ...routine }) => saveRoutine(uid, { ...routine, effectiveDate: planStartDate, endDate: planEndDate }, id))); } else { await Promise.all(monthlyPlan(planStartDate).map((input) => saveRoutine(uid, input))); } } catch (error) { setSeedError(error instanceof Error ? error.message : "Could not update the routine plan. Please try again."); } finally { setSeeding(false); } }}>{seeding ? "Updating plan…" : seededPlan.length ? "Move plan to 17 Sep" : "Seed plan: 17 Sep"}</button>}<button className="start-btn" onClick={() => setAdding(true)}><Plus size={16}/> New routine</button></div></header>
    <section className="discipline-summary"><article><span>Today’s routines</span><b>{todays.length}</b></article><article><span>Completed</span><b>{completed} / {todays.length}</b></article><article><span>Needs attention</span><b>{needsAttention}</b></article></section>
    <section className="discipline-timeline"><header><div><span className="eyebrow">TODAY’S ROUTINES</span><h2>{new Date(`${today}T12:00:00`).toLocaleDateString("en-GB", { weekday:"long", day:"numeric", month:"long" })}</h2></div><span>{Math.max(0, todays.length - completed)} remaining</span></header>
      {todays.length ? todays.map((routine) => { const status = record(routine.id)?.status; const special = /sleep|wake/i.test(routine.name); return <article key={routine.id} className={status || "planned"}><time>{routine.time}<small>until {addMinutes(routine.time, routine.windowMinutes)}</small></time><i className={routine.category}/><div><b>{special && (routine.name.toLowerCase().includes("sleep") ? <Moon size={14}/> : <Sunrise size={14}/>)} {routine.name} <span className={`routine-priority ${routine.priority}`}>{priorityLabel[routine.priority]}</span></b><small>{routine.category} · {routine.durationMinutes} min · {routine.priority === "critical" ? "Auto-pause and lock" : routine.sessionBehavior === "pause" ? "Auto-pause work session" : "Reminder only"}</small></div>{status ? <em>{status}</em> : <div className="routine-actions"><button onClick={() => void logRoutine(uid, routine.id, today, "completed")}><Check size={15}/>{routineAction(routine)}</button><button onClick={() => setSkipRoutine(routine)}><SkipForward size={15}/> Skip</button></div>}<button className="routine-edit" title={`Edit ${routine.name}`} onClick={() => setEditing(routine)}><Pencil size={14}/></button></article>; }) : <p className="discipline-empty">No routines planned today. Create one to start building your schedule.</p>}
    </section>
    {adding && <RoutineModal onClose={() => setAdding(false)} onSave={async input => { await saveRoutine(uid, input); setAdding(false); }}/>}
    {editing && <RoutineModal routine={editing} onClose={() => setEditing(null)} onSave={async input => { await saveRoutine(uid, input, editing.id); setEditing(null); }}/>}
    {skipRoutine && <SkipReasonModal routine={skipRoutine} onClose={() => setSkipRoutine(null)} onSave={async reason => { await logRoutine(uid, skipRoutine.id, today, "skipped", { skippedReason: reason }); setSkipRoutine(null); }}/>}
  </main>;
}

function SkipReasonModal({ routine, onClose, onSave }: { routine: Routine; onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const required = routine.priority === "critical";
  return <div className="modal-backdrop"><form className="note-modal" onSubmit={async event => { event.preventDefault(); if (required && !reason.trim()) return; setBusy(true); try { await onSave(reason.trim()); } finally { setBusy(false); } }}><div className="modal-icon warning"><AlertTriangle size={20}/></div><span className="eyebrow">SKIP ROUTINE</span><h3>{routine.name}</h3><p>{required ? "This is a critical commitment. Add a reason before deliberately skipping it." : "You can skip this routine when it cannot be completed today."}</p><label className="modal-field">{required ? "REASON (REQUIRED)" : "REASON (OPTIONAL)"}<textarea value={reason} onChange={event => setReason(event.target.value)} required={required} placeholder="Why are you skipping this routine?"/></label><div className="modal-actions"><button className="outline-btn" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="danger-btn" disabled={busy || (required && !reason.trim())}>{busy ? "Saving…" : "Confirm skip"}</button></div></form></div>;
}

function RoutineModal({ routine, onClose, onSave }: { routine?: Routine; onClose: () => void; onSave: (input: Omit<Routine,"id"|"createdAt"|"updatedAt">) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return <div className="modal-backdrop"><form className="note-modal" onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); try { await onSave({ name: String(form.get("name")).trim(), category: String(form.get("category")) as RoutineCategory, priority: String(form.get("priority")) as Routine["priority"], time: String(form.get("time")), durationMinutes: Number(form.get("duration")), windowMinutes: Number(form.get("window")), repeatDays: routine?.repeatDays || [0,1,2,3,4,5,6], reminderMinutes: Number(form.get("reminder")), sessionBehavior: String(form.get("behavior")) as "warn" | "pause", strict: form.get("strict") === "on", active: routine?.active ?? true, effectiveDate: routine?.effectiveDate, endDate: routine?.endDate }); } finally { setBusy(false); } }}><button className="modal-close" type="button" onClick={onClose}>×</button><div className="modal-icon"><Clock3 size={20}/></div><h3>{routine ? "Edit routine" : "New routine"}</h3><label className="modal-field">ROUTINE NAME<input name="name" required placeholder="Namaz, Lunch, Sleep…" defaultValue={routine?.name}/></label><div className="routine-form-grid"><label className="modal-field">CATEGORY<select name="category" defaultValue={routine?.category || "personal"}>{categories.map(category => <option key={category}>{category}</option>)}</select></label><label className="modal-field">PRIORITY<select name="priority" defaultValue={routine?.priority || "normal"}><option value="critical">Critical — pause and lock</option><option value="high">High — pause work</option><option value="normal">Normal — reminder</option></select></label></div><div className="routine-form-grid"><label className="modal-field">START TIME<input name="time" type="time" defaultValue={routine?.time || "13:00"} required/></label><label className="modal-field">DURATION (MIN)<input name="duration" type="number" min="1" defaultValue={routine?.durationMinutes || 15} required/></label></div><div className="routine-form-grid"><label className="modal-field">WINDOW (MIN)<input name="window" type="number" min="1" defaultValue={routine?.windowMinutes || 15} required/></label><label className="modal-field">WARN BEFORE (MIN)<input name="reminder" type="number" min="0" defaultValue={routine?.reminderMinutes || 5} required/></label></div><label className="modal-field">ACTIVE SESSION<select name="behavior" defaultValue={routine?.sessionBehavior || "pause"}><option value="pause">Automatically pause work</option><option value="warn">Reminder only</option></select></label><label className="note-pin"><input name="strict" type="checkbox" defaultChecked={routine?.strict}/> Keep this routine locked until I act</label>{routine?.endDate && <p className="routine-plan-range">Part of your plan: {routine.effectiveDate} to {routine.endDate}</p>}<div className="modal-actions"><button className="outline-btn" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="start-btn" disabled={busy}>{busy ? "Saving…" : routine ? "Save changes" : "Save routine"}</button></div></form></div>;
}
