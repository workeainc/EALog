import { Bell, CalendarDays, Check, ChevronLeft, ChevronRight, ListTodo, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
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
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(`${todoDateKey()}T12:00:00`));
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
  const selectDate = (selected: string) => { setDate(selected); setTab("today"); setCalendarMonth(new Date(`${selected}T12:00:00`)); };
  const add = async (event: React.FormEvent) => {
    event.preventDefault(); if (!title.trim()) return; setSaving(true); setError("");
    try { await onCreate({ title, projectId: projectId || null, plannedDateString: date, priority }); setTitle(""); }
    catch (reason: any) { setError(reason?.message || "Could not add task."); }
    finally { setSaving(false); }
  };
  return <section className="todos-view todos-workspace">
    <div className="todo-page-heading">
      <div><h2>Tasks</h2><p className="muted">Plan your day, connect tasks with projects, and keep momentum.</p></div>
      <div className="todo-heading-actions"><label className="todo-global-search"><Search size={15} /><input value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="Search tasks, projects…" aria-label="Search tasks and projects" /></label><button type="button" className="icon-btn" aria-label="Open calendar" onClick={() => selectDate(today)}><CalendarDays size={16} /></button><button type="button" className="icon-btn todo-notification" aria-label="Notifications"><Bell size={16} /><i /></button></div>
    </div>
    <div className="todo-workspace-toolbar">
      <div className="todo-date-nav" aria-label="Task date">
        <button className="icon-btn" type="button" onClick={() => selectDate(shiftDate(date, -1))} aria-label="Previous day"><ChevronLeft size={18} /></button>
        <button className="outline-btn todo-date-button" type="button" onClick={() => selectDate(today)}>{readableDate(date)}</button>
        <button className="icon-btn" type="button" onClick={() => selectDate(shiftDate(date, 1))} aria-label="Next day"><ChevronRight size={18} /></button>
        <button className="outline-btn todo-calendar-button" type="button" onClick={() => setCalendarMonth(new Date(`${date}T12:00:00`))}><CalendarDays size={15} /> Calendar</button>
      </div>
      <div className="todo-tabs" role="tablist" aria-label="Task views">
        {([ ["today", "Today"], ["upcoming", "Upcoming"], ["completed", "Completed"] ] as const).map(([value, label]) => <button key={value} role="tab" type="button" aria-selected={tab === value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{label}</button>)}
      </div>
    </div>
    {error && <p className="sync-warning">{error}</p>}
    <div className="todo-dashboard-grid">
      <form className="todo-quick-add" onSubmit={add}>
          <input aria-label="Task title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} placeholder="Add a task…" />
          <select aria-label="Project" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Select project</option>{projects.filter((project) => project.active).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
          <select aria-label="Priority" value={priority} onChange={(event) => setPriority(event.target.value as TodoPriority)}><option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Low priority</option></select>
          <button className="start-btn" disabled={saving} type="submit"><Plus size={17} />{saving ? "Adding…" : "Add task"}</button>
      </form>
      <div className="todo-primary-column">
        <article className="todo-panel todo-main-panel">
          <div className="todo-panel-head"><div><h3>{panelTitle}</h3><p>{tab === "today" ? `${stats.open} remaining · ${stats.completionPercent}% plan completed` : tab === "upcoming" ? "Your next 7 planned days" : "Finished work from the last 14 days"}</p></div><span>{activeTodos.length} tasks</span></div>
          {displayedTodos.length ? <div className="todo-list">{displayedTodos.map((todo) => <TodoRow key={todo.id} todo={todo} project={projectFor(todo.projectId)} onToggle={onToggle} onMove={onMove} onDelete={onDelete} onEdit={setEditingTodo} canMove={todo.status === "open" && todo.plannedDateString !== today} />)}</div> : <div className="todo-empty"><ListTodo size={28} /><h3>No tasks here</h3><p>Add the work you want to finish, or choose another view.</p></div>}
        </article>
      </div>
      <aside className="todo-side">
        <TodoGroup title="Overdue" subtitle="Move these deliberately—nothing is rescheduled automatically." todos={overdue.filter(matchesSearch)} projects={projects} onToggle={onToggle} onMove={onMove} onDelete={onDelete} onEdit={setEditingTodo} showMove />
        <TodoGroup title="Recently completed" subtitle="Finished work from the last 14 days." todos={recentlyCompleted.filter(matchesSearch).slice(0, 5)} projects={projects} onToggle={onToggle} onMove={onMove} onDelete={onDelete} onEdit={setEditingTodo} />
      </aside>
      <aside className="todo-calendar-column">
        <TaskCalendar todos={todos} month={calendarMonth} selectedDate={date} onPrevious={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} onNext={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} onSelect={selectDate} />
        <p className="todo-calendar-hint"><CalendarDays size={16} />Click a date to view its tasks for that day.</p>
      </aside>
    </div>
    {editingTodo && <TodoEditModal todo={editingTodo} projects={projects} onClose={() => setEditingTodo(null)} onSave={async (patch) => { await onUpdate(editingTodo, patch); setEditingTodo(null); }} />}
  </section>;
}

function TodoGroup({ title, subtitle, todos, projects, onToggle, onMove, onDelete, onEdit, showMove = false }: { title: string; subtitle: string; todos: Todo[]; projects: Project[]; onToggle: Props["onToggle"]; onMove: Props["onMove"]; onDelete: Props["onDelete"]; onEdit: (todo: Todo) => void; showMove?: boolean }) {
  return <article className="todo-panel todo-compact"><div className="todo-panel-head"><div><h3>{title}</h3><p>{subtitle}</p></div><span>{todos.length}</span></div>{todos.length ? <div className="todo-list">{todos.map((todo) => <TodoRow key={todo.id} todo={todo} project={projects.find((project) => project.id === todo.projectId)} onToggle={onToggle} onMove={onMove} onDelete={onDelete} onEdit={onEdit} canMove={showMove && todo.plannedDateString !== todoDateKey()} compact />)}</div> : <p className="muted todo-group-empty">Nothing here.</p>}</article>;
}

function TodoRow({ todo, project, onToggle, onMove, onDelete, onEdit, canMove, compact = false }: { todo: Todo; project?: Project; onToggle: Props["onToggle"]; onMove: Props["onMove"]; onDelete: Props["onDelete"]; onEdit: (todo: Todo) => void; canMove: boolean; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => { setBusy(true); try { await action(); } finally { setBusy(false); } };
  const timelineLabel = todo.status === "completed" ? `Completed ${todo.completedDateString ? readableDate(todo.completedDateString) : ""}` : todo.plannedDateString === todoDateKey() ? "Today" : readableDate(todo.plannedDateString);
  return <div className={`todo-row ${compact ? "todo-row-compact" : ""} ${todo.status === "completed" ? "is-completed" : ""}`}>
    <button type="button" className="todo-check" disabled={busy} onClick={() => void run(() => onToggle(todo, todo.status !== "completed"))} aria-label={todo.status === "completed" ? "Mark task open" : "Complete task"}>{todo.status === "completed" && <Check size={15} />}</button>
    <div className="todo-copy"><b>{todo.title}</b><small><i style={{ background: project?.color || "#999" }} />{project?.name || (todo.projectId ? "Deleted project" : "Personal / Inbox")}<span className={`todo-priority ${todo.priority}`}>{todo.priority}</span><em>{timelineLabel}</em>{todo.pendingSync ? " · Syncing…" : ""}</small></div>
    {canMove && <button className="text-btn todo-move" type="button" disabled={busy} onClick={() => void run(() => onMove(todo, todoDateKey()))}>Move to today</button>}
    <div className="todo-row-actions"><button className="icon-btn todo-edit" type="button" disabled={busy} onClick={() => onEdit(todo)} aria-label="Edit task"><Pencil size={14} /></button><button className="icon-btn todo-delete" type="button" disabled={busy} onClick={() => void run(() => onDelete(todo))} aria-label="Delete task"><Trash2 size={15} /></button></div>
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
