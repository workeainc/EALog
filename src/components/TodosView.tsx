import { AlertCircle, Bell, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, ListTodo, Move, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { buildTodoDayStats, sortTodos, todoDateKey } from "../lib/todos";
import type { Project, Todo, TodoPriority } from "../types/tracker";

type TaskTab = "today" | "upcoming" | "completed";
type Props = {
  todos: Todo[]; projects: Project[]; defaultProjectId?: string;
  onCreate: (input: { title: string; projectId: string | null; plannedDateString: string; priority: TodoPriority }) => Promise<void>;
  onToggle: (todo: Todo, complete: boolean) => Promise<void>;
  onMove: (todo: Todo, date: string) => Promise<void>;
  onUpdate: (todo: Todo, patch: { title: string; projectId: string | null; priority: TodoPriority; plannedDateString: string }) => Promise<void>;
  onDelete: (todo: Todo) => Promise<void>;
};
const readableDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
const shiftDate = (date: string, days: number) => { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + days); return todoDateKey(value); };

export default function TodosView({ todos, projects, defaultProjectId, onCreate, onToggle, onMove, onUpdate, onDelete }: Props) {
  const [date, setDate] = useState(todoDateKey());
  const [tab, setTab] = useState<TaskTab>("today");
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId || "");
  const [priority, setPriority] = useState<TodoPriority>("medium");
  const [taskSearch, setTaskSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const today = todoDateKey();
  const stats = useMemo(() => buildTodoDayStats(todos, date), [todos, date]);
  const dayTodos = useMemo(() => sortTodos(todos.filter((todo) => todo.plannedDateString === date)), [todos, date]);
  const overdue = useMemo(() => sortTodos(todos.filter((todo) => todo.status === "open" && todo.plannedDateString < today)), [todos, today]);
  const upcoming = useMemo(() => sortTodos(todos.filter((todo) => todo.status === "open" && todo.plannedDateString > today && todo.plannedDateString <= shiftDate(today, 7))), [todos, today]);
  const recentlyCompleted = useMemo(() => sortTodos(todos.filter((todo) => todo.status === "completed" && todo.completedDateString && todo.completedDateString >= shiftDate(today, -14))), [todos, today]);
  const projectFor = (id: string | null) => projects.find((project) => project.id === id);
  const activeTodos = tab === "today" ? dayTodos : tab === "upcoming" ? upcoming : recentlyCompleted;
  const matchesSearch = (todo: Todo) => `${todo.title} ${projectFor(todo.projectId)?.name || ""}`.toLowerCase().includes(taskSearch.trim().toLowerCase());
  const displayedTodos = activeTodos.filter(matchesSearch);
  const panelTitle = tab === "today" ? (date === today ? "Today's tasks" : readableDate(date)) : tab === "upcoming" ? "Upcoming tasks" : "Recently completed";
  const selectDate = (selected: string) => { setDate(selected); setTab("today"); };
  const add = async (event: React.FormEvent) => {
    event.preventDefault(); if (!title.trim()) return; setSaving(true); setError("");
    try { await onCreate({ title, projectId: projectId || null, plannedDateString: date, priority }); setTitle(""); }
    catch (reason: any) { setError(reason?.message || "Could not add task."); }
    finally { setSaving(false); }
  };
  return <section className="task-target" aria-label="Tasks workspace">
    <header className="task-target-header"><div><h2>Tasks</h2><p>Plan your day, connect tasks with projects, and keep momentum.</p></div><div className="task-target-header-actions"><label><Search size={16} /><input value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="Search tasks, projects…" aria-label="Search tasks and projects" /></label><button type="button" onClick={() => selectDate(today)} aria-label="Open calendar"><CalendarDays size={17} /></button><button type="button" className="task-target-bell" aria-label="Notifications"><Bell size={17} /><i /></button></div></header>
    <div className="task-target-controls"><div className="task-target-date"><button type="button" onClick={() => selectDate(shiftDate(date, -1))} aria-label="Previous day"><ChevronLeft size={17} /></button><span>{date === today ? `Today, ${new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : readableDate(date)}</span><button type="button" onClick={() => selectDate(shiftDate(date, 1))} aria-label="Next day"><ChevronRight size={17} /></button></div><button className="task-target-calendar" type="button" onClick={() => selectDate(today)}><CalendarDays size={16} /> Calendar</button><div className="task-target-tabs">{([ ["today", "Today"], ["upcoming", "Upcoming"], ["completed", "Completed"] ] as const).map(([value, label]) => <button key={value} type="button" className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{label}</button>)}</div></div>
    {error && <p className="sync-warning">{error}</p>}
    <form className="task-target-add" onSubmit={add}><input aria-label="Task title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} placeholder="Add a task…" /><select aria-label="Project" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Select project</option>{projects.filter((project) => project.active).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><select aria-label="Priority" value={priority} onChange={(event) => setPriority(event.target.value as TodoPriority)}><option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Low priority</option></select><button disabled={saving} type="submit"><Plus size={17} />{saving ? "Adding…" : "Add task"}</button></form>
    <div className="task-target-grid"><article className="task-target-main"><h3>{panelTitle} <span>({displayedTodos.length})</span></h3>{displayedTodos.length ? <div>{displayedTodos.map((todo) => <TargetTaskCard key={todo.id} todo={todo} project={projectFor(todo.projectId)} onToggle={onToggle} onMove={onMove} onDelete={onDelete} onEdit={setEditingTodo} canMove={todo.status === "open" && todo.plannedDateString !== today} />)}</div> : <div className="task-target-empty"><ListTodo size={28} /><b>No tasks here</b><p>Add the work you want to finish.</p></div>}</article><aside className="task-target-side"><TargetSidePanel title="Overdue" todos={overdue.filter(matchesSearch)} projects={projects} icon={<AlertCircle size={17} />} tone="overdue" onToggle={onToggle} onMove={onMove} onDelete={onDelete} onEdit={setEditingTodo} /><TargetSidePanel title="Recently completed" todos={recentlyCompleted.filter(matchesSearch).slice(0, 5)} projects={projects} icon={<CheckCircle2 size={17} />} tone="completed" onToggle={onToggle} onMove={onMove} onDelete={onDelete} onEdit={setEditingTodo} /></aside></div>
    {editingTodo && <TodoEditModal todo={editingTodo} projects={projects} onClose={() => setEditingTodo(null)} onSave={async (patch) => { await onUpdate(editingTodo, patch); setEditingTodo(null); }} />}
  </section>;
}

function TodoGroup({ title, subtitle, todos, projects, onToggle, onMove, onDelete, onEdit, showMove = false }: { title: string; subtitle: string; todos: Todo[]; projects: Project[]; onToggle: Props["onToggle"]; onMove: Props["onMove"]; onDelete: Props["onDelete"]; onEdit: (todo: Todo) => void; showMove?: boolean }) {
  const overdueGroup = title === "Overdue";
  return <article className={`todo-panel todo-compact ${overdueGroup ? "todo-overdue-panel" : "todo-completed-panel"}`}><div className="todo-panel-head"><div><i className="todo-group-icon">{overdueGroup ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}</i><h3>{title} ({todos.length})</h3></div><button className="text-btn" type="button">View all</button></div>{todos.length ? <div className="todo-list">{todos.map((todo) => <TodoRow key={todo.id} todo={todo} project={projects.find((project) => project.id === todo.projectId)} onToggle={onToggle} onMove={onMove} onDelete={onDelete} onEdit={onEdit} canMove={showMove && todo.plannedDateString !== todoDateKey()} compact />)}</div> : <p className="muted todo-group-empty">Nothing here.</p>}</article>;
}

function TargetTaskCard({ todo, project, onToggle, onMove, onDelete, onEdit, canMove }: { todo: Todo; project?: Project; onToggle: Props["onToggle"]; onMove: Props["onMove"]; onDelete: Props["onDelete"]; onEdit: (todo: Todo) => void; canMove: boolean }) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => { setBusy(true); try { await action(); } finally { setBusy(false); } };
  const completed = todo.status === "completed";
  const dateLabel = completed ? `Completed ${todo.completedDateString ? readableDate(todo.completedDateString) : ""}` : todo.plannedDateString === todoDateKey() ? "Today" : readableDate(todo.plannedDateString);
  return <article className={`task-target-card ${completed ? "completed" : ""}`}><div className="task-target-card-main"><button type="button" className="task-target-check" disabled={busy} onClick={() => void run(() => onToggle(todo, !completed))} aria-label={completed ? "Mark task open" : "Complete task"}>{completed && <Check size={14} />}</button><div><h4>{todo.title}</h4><p>{completed ? "Completed work item" : "Planned work item for this project"}</p><footer><span className="task-target-project"><i style={{ background: project?.color || "#64748b" }} />{project?.name || "Personal / Inbox"}</span><span className={`task-target-priority ${todo.priority}`}>{todo.priority}</span><span className={completed ? "done-date" : ""}><CalendarDays size={12} />{dateLabel}</span></footer></div></div><div className="task-target-row-actions">{canMove && <button type="button" aria-label="Move task to today" disabled={busy} onClick={() => void run(() => onMove(todo, todoDateKey()))}><Move size={15} /></button>}<button type="button" aria-label="Edit task" disabled={busy} onClick={() => onEdit(todo)}><Pencil size={15} /></button><button type="button" aria-label="Delete task" disabled={busy} onClick={() => void run(() => onDelete(todo))}><Trash2 size={15} /></button></div></article>;
}

function TargetSidePanel({ title, todos, projects, icon, tone, onToggle, onMove, onDelete, onEdit }: { title: string; todos: Todo[]; projects: Project[]; icon: ReactNode; tone: "overdue" | "completed"; onToggle: Props["onToggle"]; onMove: Props["onMove"]; onDelete: Props["onDelete"]; onEdit: (todo: Todo) => void }) {
  return <section className={`task-target-side-card ${tone}`}><header><div><i>{icon}</i><h3>{title} ({todos.length})</h3></div><button type="button">View all</button></header>{todos.length ? <div>{todos.map((todo) => <TargetTaskCard key={todo.id} todo={todo} project={projects.find((project) => project.id === todo.projectId)} onToggle={onToggle} onMove={onMove} onDelete={onDelete} onEdit={onEdit} canMove={tone === "overdue"} />)}</div> : <p>Nothing here.</p>}</section>;
}

function TodoRow({ todo, project, onToggle, onMove, onDelete, onEdit, canMove, compact = false }: { todo: Todo; project?: Project; onToggle: Props["onToggle"]; onMove: Props["onMove"]; onDelete: Props["onDelete"]; onEdit: (todo: Todo) => void; canMove: boolean; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => { setBusy(true); try { await action(); } finally { setBusy(false); } };
  const timelineLabel = todo.status === "completed" ? `Completed ${todo.completedDateString ? readableDate(todo.completedDateString) : ""}` : todo.plannedDateString === todoDateKey() ? "Today" : readableDate(todo.plannedDateString);
  return <div className={`todo-row ${compact ? "todo-row-compact" : ""} ${todo.status === "completed" ? "is-completed" : ""}`}>
    <div className="todo-row-content"><button type="button" className="todo-check" disabled={busy} onClick={() => void run(() => onToggle(todo, todo.status !== "completed"))} aria-label={todo.status === "completed" ? "Mark task open" : "Complete task"}>{todo.status === "completed" && <Check size={15} />}</button><div className="todo-copy"><b>{todo.title}</b>{!compact && <p>{todo.status === "completed" ? "Completed work item" : "Planned work item for this project"}</p>}<small><span className="todo-project-tag"><i style={{ background: project?.color || "#999" }} />{project?.name || (todo.projectId ? "Deleted project" : "Personal / Inbox")}</span><span className={`todo-priority ${todo.priority}`}>{todo.priority}</span><em><CalendarDays size={11} />{timelineLabel}</em>{todo.pendingSync ? " · Syncing…" : ""}</small></div></div>
    <div className="todo-row-actions">{canMove && <button className="icon-btn todo-move" type="button" disabled={busy} onClick={() => void run(() => onMove(todo, todoDateKey()))} aria-label="Move task to today"><Move size={14} /></button>}<button className="icon-btn todo-edit" type="button" disabled={busy} onClick={() => onEdit(todo)} aria-label="Edit task"><Pencil size={14} /></button><button className="icon-btn todo-delete" type="button" disabled={busy} onClick={() => void run(() => onDelete(todo))} aria-label="Delete task"><Trash2 size={15} /></button></div>
  </div>;
}

function TaskCalendar({ todos, month, selectedDate, onPrevious, onNext, onSelect }: { todos: Todo[]; month: Date; selectedDate: string; onPrevious: () => void; onNext: () => void; onSelect: (date: string) => void }) {
  const year = month.getFullYear(), monthIndex = month.getMonth();
  const first = new Date(year, monthIndex, 1), days = new Date(year, monthIndex + 1, 0).getDate(), mondayOffset = (first.getDay() + 6) % 7;
  const cells = Array.from({ length: mondayOffset + days }, (_, index) => index < mondayOffset ? null : todoDateKey(new Date(year, monthIndex, index - mondayOffset + 1)));
  return <section className="task-calendar" aria-label="Task calendar"><div className="task-calendar-head"><button className="icon-btn" type="button" onClick={onPrevious} aria-label="Previous month"><ChevronLeft size={17} /></button><h3>{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</h3><button className="icon-btn" type="button" onClick={onNext} aria-label="Next month"><ChevronRight size={17} /></button></div><div className="task-calendar-weekdays">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day}>{day}</span>)}</div><div className="task-calendar-grid">{cells.map((calendarDate, index) => { if (!calendarDate) return <span key={`blank-${index}`} />; const stats = buildTodoDayStats(todos, calendarDate); return <button type="button" key={calendarDate} className={calendarDate === selectedDate ? "selected" : ""} onClick={() => onSelect(calendarDate)} aria-label={`${readableDate(calendarDate)}: ${stats.planned} planned, ${stats.completedOnDate} completed, ${stats.overdue} overdue`}><b>{Number(calendarDate.slice(-2))}</b><span className="task-calendar-dots">{stats.planned > 0 && <i className="planned" />}{stats.completedOnDate > 0 && <i className="completed" />}{stats.overdue > 0 && <i className="overdue" />}</span></button>; })}</div><p className="task-calendar-legend"><i className="planned" /> planned <i className="completed" /> completed <i className="overdue" /> overdue</p></section>;
}

function TodoEditModal({ todo, projects, onClose, onSave }: { todo: Todo; projects: Project[]; onClose: () => void; onSave: (patch: { title: string; projectId: string | null; priority: TodoPriority; plannedDateString: string }) => Promise<void> }) {
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const submit = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true); setError(""); try { await onSave({ title: String(form.get("title") || "").trim(), projectId: String(form.get("projectId") || "") || null, priority: String(form.get("priority")) as TodoPriority, plannedDateString: String(form.get("plannedDateString") || "") }); } catch (reason: any) { setError(reason?.message || "Could not update task."); } finally { setSaving(false); } };
  return <div className="modal-backdrop" role="presentation"><form className="note-modal todo-edit-modal" onSubmit={submit}><button className="modal-close" type="button" onClick={onClose} disabled={saving} aria-label="Close edit task"><X size={18} /></button><div className="modal-icon"><Pencil size={20} /></div><h3>Edit task</h3><p>Editing the planned date does not change when this task was completed.</p><label className="modal-field">TASK TITLE<input name="title" defaultValue={todo.title} maxLength={240} required /></label><label className="modal-field">PROJECT<select name="projectId" defaultValue={todo.projectId || ""}><option value="">Personal / Inbox</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><div className="todo-edit-grid"><label className="modal-field">PRIORITY<select name="priority" defaultValue={todo.priority}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label className="modal-field">PLANNED DATE<input name="plannedDateString" type="date" defaultValue={todo.plannedDateString} required /></label></div>{error && <p className="sync-warning">{error}</p>}<div className="modal-actions"><button className="outline-btn" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="start-btn" disabled={saving} type="submit">{saving ? "Saving…" : "Save changes"}</button></div></form></div>;
}
