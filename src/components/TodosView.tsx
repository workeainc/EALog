import {
  Check,
  ChevronLeft,
  ChevronRight,
  ListTodo,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { buildTodoDayStats, sortTodos, todoDateKey } from "../lib/todos";
import type { Project, Todo, TodoPriority } from "../types/tracker";

type Props = {
  todos: Todo[];
  projects: Project[];
  defaultProjectId?: string;
  onCreate: (input: {
    title: string;
    projectId: string | null;
    plannedDateString: string;
    priority: TodoPriority;
  }) => Promise<void>;
  onToggle: (todo: Todo, complete: boolean) => Promise<void>;
  onMove: (todo: Todo, date: string) => Promise<void>;
  onDelete: (todo: Todo) => Promise<void>;
};

const readableDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const shiftDate = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return todoDateKey(value);
};

export default function TodosView({
  todos,
  projects,
  defaultProjectId,
  onCreate,
  onToggle,
  onMove,
  onDelete,
}: Props) {
  const [date, setDate] = useState(todoDateKey());
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId || "");
  const [priority, setPriority] = useState<TodoPriority>("medium");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const today = todoDateKey();
  const stats = useMemo(() => buildTodoDayStats(todos, date), [todos, date]);
  const dayTodos = useMemo(
    () => sortTodos(todos.filter((todo) => todo.plannedDateString === date)),
    [todos, date],
  );
  const overdue = useMemo(
    () =>
      sortTodos(
        todos.filter(
          (todo) => todo.status === "open" && todo.plannedDateString < today,
        ),
      ),
    [todos, today],
  );
  const upcoming = useMemo(
    () =>
      sortTodos(
        todos.filter(
          (todo) =>
            todo.status === "open" &&
            todo.plannedDateString > today &&
            todo.plannedDateString <= shiftDate(today, 7),
        ),
      ),
    [todos, today],
  );
  const projectFor = (id: string | null) =>
    projects.find((project) => project.id === id);
  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError("");
    try {
      await onCreate({
        title,
        projectId: projectId || null,
        plannedDateString: date,
        priority,
      });
      setTitle("");
    } catch (reason: any) {
      setError(reason?.message || "Could not add task.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="todos-view">
      <div className="report-toolbar todo-heading">
        <div>
          <span className="eyebrow">SMART TODO</span>
          <h2>{date === today ? "Today’s tasks" : readableDate(date)}</h2>
          <p className="muted">
            Plan the work, complete it, and keep every project in sync.
          </p>
        </div>
        <div className="todo-completion">
          <b>
            {stats.completed}/{stats.planned}
          </b>
          <small>complete</small>
        </div>
      </div>
      <div className="todo-date-nav" aria-label="Task date">
        <button
          className="icon-btn"
          onClick={() => setDate(shiftDate(date, -1))}
          aria-label="Previous day"
        >
          <ChevronLeft size={18} />
        </button>
        <button className="outline-btn" onClick={() => setDate(today)}>
          {date === today ? "Today" : readableDate(date)}
        </button>
        <button
          className="icon-btn"
          onClick={() => setDate(shiftDate(date, 1))}
          aria-label="Next day"
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <form className="todo-quick-add" onSubmit={add}>
        <input
          aria-label="Task title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={240}
          placeholder="What needs to be done?"
        />
        <select
          aria-label="Project"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">Personal / Inbox</option>
          {projects
            .filter((project) => project.active)
            .map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
        </select>
        <select
          aria-label="Priority"
          value={priority}
          onChange={(event) => setPriority(event.target.value as TodoPriority)}
        >
          <option value="high">High priority</option>
          <option value="medium">Medium priority</option>
          <option value="low">Low priority</option>
        </select>
        <button className="start-btn" disabled={saving} type="submit">
          <Plus size={17} /> {saving ? "Adding…" : "Add task"}
        </button>
      </form>
      {error && <p className="sync-warning">{error}</p>}
      <div className="todo-layout">
        <article className="todo-panel">
          <div className="todo-panel-head">
            <div>
              <h3>{date === today ? "Today" : readableDate(date)}</h3>
              <p>
                {stats.open} remaining · {stats.completionPercent}% complete
              </p>
            </div>
            <span>{stats.planned} planned</span>
          </div>
          {dayTodos.length ? (
            <div className="todo-list">
              {dayTodos.map((todo) => (
                <TodoRow
                  key={todo.id}
                  todo={todo}
                  project={projectFor(todo.projectId)}
                  onToggle={onToggle}
                  onMove={onMove}
                  onDelete={onDelete}
                  canMove={todo.plannedDateString !== today}
                />
              ))}
            </div>
          ) : (
            <div className="todo-empty">
              <ListTodo size={28} />
              <h3>No tasks planned</h3>
              <p>Add the work you want to finish on this day.</p>
            </div>
          )}
        </article>
        <aside className="todo-side">
          <TodoGroup
            title="Overdue"
            subtitle="Move these deliberately—nothing is rescheduled automatically."
            todos={overdue}
            projects={projects}
            onToggle={onToggle}
            onMove={onMove}
            onDelete={onDelete}
            showMove
          />
          <TodoGroup
            title="Upcoming"
            subtitle="Your next 7 planned days."
            todos={upcoming}
            projects={projects}
            onToggle={onToggle}
            onMove={onMove}
            onDelete={onDelete}
          />
        </aside>
      </div>
    </section>
  );
}

function TodoGroup({
  title,
  subtitle,
  todos,
  projects,
  onToggle,
  onMove,
  onDelete,
  showMove = false,
}: {
  title: string;
  subtitle: string;
  todos: Todo[];
  projects: Project[];
  onToggle: Props["onToggle"];
  onMove: Props["onMove"];
  onDelete: Props["onDelete"];
  showMove?: boolean;
}) {
  return (
    <article className="todo-panel todo-compact">
      <div className="todo-panel-head">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span>{todos.length}</span>
      </div>
      {todos.length ? (
        <div className="todo-list">
          {todos.map((todo) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              project={projects.find(
                (project) => project.id === todo.projectId,
              )}
              onToggle={onToggle}
              onMove={onMove}
              onDelete={onDelete}
              canMove={showMove}
            />
          ))}
        </div>
      ) : (
        <p className="muted">Nothing here.</p>
      )}
    </article>
  );
}

function TodoRow({
  todo,
  project,
  onToggle,
  onMove,
  onDelete,
  canMove,
}: {
  todo: Todo;
  project?: Project;
  onToggle: Props["onToggle"];
  onMove: Props["onMove"];
  onDelete: Props["onDelete"];
  canMove: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className={`todo-row ${todo.status === "completed" ? "is-completed" : ""}`}
    >
      <button
        type="button"
        className="todo-check"
        disabled={busy}
        onClick={() =>
          void run(() => onToggle(todo, todo.status !== "completed"))
        }
        aria-label={
          todo.status === "completed" ? "Mark task open" : "Complete task"
        }
      >
        {todo.status === "completed" && <Check size={15} />}
      </button>
      <div className="todo-copy">
        <b>{todo.title}</b>
        <small>
          <i style={{ background: project?.color || "#999" }} />
          {project?.name || "Personal / Inbox"} · {todo.priority}
          {todo.pendingSync ? " · Syncing…" : ""}
        </small>
      </div>
      {canMove && (
        <button
          className="text-btn"
          type="button"
          disabled={busy}
          onClick={() => void run(() => onMove(todo, todoDateKey()))}
        >
          Move to today
        </button>
      )}
      <button
        className="icon-btn todo-delete"
        type="button"
        disabled={busy}
        onClick={() => void run(() => onDelete(todo))}
        aria-label="Delete task"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}
