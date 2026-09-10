import {
  Archive,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Flag,
  FolderKanban,
  MoreVertical,
  PauseCircle,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Target,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  formatMinutes,
  normalizeReportLogs,
  type ReportLog,
} from "../lib/reports";
import { getMonthPlan, localDateKey } from "../lib/project-schedule";
import { buildTodoDayStats, todosForProjectOnDate } from "../lib/todos";
import type { FinanceTransaction, Project, ProjectNote, ProjectStatus, Todo } from "../types/tracker";

type Props = {
  projects: Project[];
  logs: ReportLog[];
  todos: Todo[];
  notes?: ProjectNote[];
  selectedProjectId?: string | null;
  onSelectProject: (id: string | null) => void;
  onEdit: (project: Project) => void;
  onCreate: () => void;
  onStatus: (project: Project, status: ProjectStatus) => Promise<void>;
  onOpenNotes?: (projectId: string) => void;
  financeTransactions?: FinanceTransaction[];
};
const labels: Record<ProjectStatus, string> = {
  planned: "Planned",
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  archived: "Archived",
};
const statusFor = (project: Project) =>
  (project.status || (project.active ? "active" : "archived")) as ProjectStatus;

const readableDate = (dateKey: string) =>
  new Date(`${dateKey}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export default function ProjectsView({
  projects,
  logs,
  todos,
  notes = [],
  selectedProjectId,
  onSelectProject,
  onEdit,
  onCreate,
  onStatus,
  onOpenNotes,
  financeTransactions = [],
}: Props) {
  const [filter, setFilter] = useState<ProjectStatus | "all">("active");
  const [search, setSearch] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  useEffect(() => {
    setSelectedDay(null);
  }, [selectedProjectId]);
  const sessions = useMemo(
    () =>
      normalizeReportLogs(logs).sort(
        (a, b) => b.startTime.getTime() - a.startTime.getTime(),
      ),
    [logs],
  );
  const total = (id: string) =>
    sessions
      .filter((log) => log.projectId === id)
      .reduce((sum, log) => sum + log.durationMinutes, 0);
  const selected = projects.find((project) => project.id === selectedProjectId);
  if (selected) {
    const status = statusFor(selected);
    const projectSessions = sessions.filter(
      (log) => log.projectId === selected.id,
    );
    const today = localDateKey();
    const todayMinutes = projectSessions
      .filter((log) => log.date === today)
      .reduce((sum, log) => sum + log.durationMinutes, 0);
    const dailyActivity = projectSessions.reduce<
      Record<
        string,
        {
          minutes: number;
          sessions: number;
          planned: number;
          completed: number;
        }
      >
    >((days, session) => {
      const entry = days[session.date] || {
        minutes: 0,
        sessions: 0,
        planned: 0,
        completed: 0,
      };
      entry.minutes += session.durationMinutes;
      entry.sessions += 1;
      days[session.date] = entry;
      return days;
    }, {});
    todos
      .filter((todo) => todo.projectId === selected.id)
      .forEach((todo) => {
        const entry = dailyActivity[todo.plannedDateString] || {
          minutes: 0,
          sessions: 0,
          planned: 0,
          completed: 0,
        };
        entry.planned += 1;
        if (todo.status === "completed") entry.completed += 1;
        dailyActivity[todo.plannedDateString] = entry;
      });
    const selectedDaySessions = selectedDay
      ? projectSessions.filter((session) => session.date === selectedDay)
      : [];
    const selectedDayMinutes = selectedDaySessions.reduce(
      (sum, session) => sum + session.durationMinutes,
      0,
    );
    const todayProjectTodos = todosForProjectOnDate(todos, selected.id, today);
    const projectNotes = notes.filter((note) => note.projectId === selected.id && note.state === "active").sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0));
    const todayTodoStats = buildTodoDayStats(todayProjectTodos, today);
    const selectedDayProjectTodos = selectedDay
      ? todosForProjectOnDate(todos, selected.id, selectedDay)
      : [];
    const selectedDayTodoStats = selectedDay
      ? buildTodoDayStats(selectedDayProjectTodos, selectedDay)
      : null;
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).getDate();
    const monthlyMinutes = projectSessions
      .filter((session) => session.date.startsWith(monthPrefix))
      .reduce((sum, session) => sum + session.durationMinutes, 0);
    const earliestSessionDate = [...projectSessions].sort((a, b) =>
      a.date.localeCompare(b.date),
    )[0]?.date;
    const monthPlan = getMonthPlan(
      selected,
      now,
      selected.startDate ||
        selected.createdDate ||
        earliestSessionDate ||
        localDateKey(now),
    );
    const monthTodos = todos.filter(
      (todo) =>
        todo.projectId === selected.id &&
        todo.plannedDateString.startsWith(monthPrefix),
    );
    const monthCompletedTodos = monthTodos.filter(
      (todo) => todo.status === "completed",
    ).length;
    const expectedMinutes = monthPlan.expectedMinutes;
    const monthTargetMinutes = monthPlan.totalTargetMinutes;
    const paceDifference = monthlyMinutes - expectedMinutes;
    const progressPercent = Math.min(
      100,
      monthTargetMinutes ? (monthlyMinutes / monthTargetMinutes) * 100 : 0,
    );
    const expectedPercent = Math.min(
      100,
      monthTargetMinutes ? (expectedMinutes / monthTargetMinutes) * 100 : 0,
    );
    const deadlineDays = selected.deadlineDate ? Math.ceil((new Date(`${selected.deadlineDate}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000) : null;
    const healthState = status === "on_hold" ? "On hold" : status === "completed" ? "Completed" : paceDifference >= 0 ? "On track" : paceDifference > -selected.targetMinutes * 2 ? "At risk" : "Behind";
    const healthCopy = status === "on_hold" ? "This project is paused; target days are excluded while on hold." : status === "completed" ? "This project is marked complete." : paceDifference >= 0 ? `You're ${formatMinutes(Math.abs(paceDifference))} ahead of this month's expected pace.` : `${formatMinutes(Math.abs(paceDifference))} behind pace. Add time on future target days to catch up.`;
    const upcomingProjectTodos = todos.filter((todo) => todo.projectId === selected.id && todo.status === "open" && todo.plannedDateString > today).sort((a, b) => a.plannedDateString.localeCompare(b.plannedDateString)).slice(0, 2);
    const financials = financeTransactions.filter((transaction) => transaction.projectId === selected.id);
    const revenue = financials.filter((transaction) => transaction.type === "income").reduce((sum, transaction) => sum + transaction.amount, 0);
    const costs = financials.filter((transaction) => transaction.type === "expense").reduce((sum, transaction) => sum + transaction.amount, 0);
    const profit = revenue - costs;
    return (
      <section className="project-dashboard">
        <button
          className="text-btn project-back"
          onClick={() => onSelectProject(null)}
        >
          <ArrowLeft size={15} /> All projects
        </button>
        <div className="project-command-hero">
          <div>
            <div className="project-dashboard-title">
              <i style={{ background: selected.color }} />
              <h2>{selected.name}</h2>
              <span className={`status-pill ${status}`}>{labels[status]}</span>
            </div>
            <p className="project-command-description">{selected.description || selected.clientName || "Personal project"}</p>
            <small>{selected.clientName || "Personal project"} · Started {selected.startDate ? readableDate(selected.startDate) : "not set"}</small>
            <div className="project-hero-metrics"><span><small>Today</small><b>{formatMinutes(todayMinutes)}</b></span><span><small>This month</small><b>{formatMinutes(monthlyMinutes)}</b></span><span><small>Deadline</small><b>{deadlineDays === null ? "No deadline" : deadlineDays < 0 ? "Overdue" : `${deadlineDays} days`}</b></span></div>
          </div>
          <div className="project-hero-actions"><button className="outline-btn" onClick={() => onEdit(selected)}><Pencil size={14} /> Edit project</button>{status === "archived" ? <button className="text-btn" onClick={() => void onStatus(selected, "active")}><RotateCcw size={14} /> Restore</button> : <><button className="text-btn" onClick={() => void onStatus(selected, status === "on_hold" ? "active" : "on_hold")}><PauseCircle size={14} /> {status === "on_hold" ? "Resume" : "On hold"}</button><button className="text-btn danger-text" onClick={() => void onStatus(selected, "archived")}><Archive size={14} /> Archive</button></>}</div>
        </div>
        <section className="project-health-section">
        <article className="project-month-progress">
          <div className="project-month-progress-head">
            <div>
              <span className="eyebrow">MONTHLY PROGRESS</span>
              <h3>
                {now.toLocaleDateString("en-GB", {
                  month: "long",
                  year: "numeric",
                })}
              </h3>
              <p>
                {formatMinutes(monthlyMinutes)} tracked of{" "}
                {formatMinutes(monthTargetMinutes)} planned target
              </p>
            </div>
            <div className="project-month-pace">
              <b>{formatMinutes(expectedMinutes)}</b>
              <small>expected by today</small>
            </div>
          </div>
          <div
            className="project-month-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={monthTargetMinutes}
            aria-valuenow={monthlyMinutes}
            aria-label={`${selected.name} monthly progress`}
          >
            <span style={{ width: `${progressPercent}%` }} />
            <i
              style={{ left: `${expectedPercent}%` }}
              title="Expected by today"
            />
          </div>
          <div className="project-month-progress-foot">
            <span>
              Day {now.getDate()} of {daysInMonth} ·{" "}
              {monthPlan.expectedTargetDays} target day
              {monthPlan.expectedTargetDays === 1 ? "" : "s"} by today ·{" "}
              {monthPlan.activeTargetDays} planned this month
              {monthPlan.onHoldDays ? ` · ${monthPlan.onHoldDays} on hold` : ""}
            </span>
            <b className={paceDifference >= 0 ? "ahead" : "behind"}>
              {paceDifference >= 0 ? "+" : "−"}
              {formatMinutes(Math.abs(paceDifference))}{" "}
              {paceDifference >= 0 ? "ahead of pace" : "behind pace"}
            </b>
          </div>
        </article>
        <aside className={`project-health-card ${healthState.toLowerCase().replace(" ", "-")}`}><span className="eyebrow">PROJECT HEALTH</span><h3>{healthState}</h3><b className={paceDifference >= 0 ? "ahead" : "behind"}>{paceDifference >= 0 ? "+" : "−"}{formatMinutes(Math.abs(paceDifference))} {paceDifference >= 0 ? "ahead" : "behind"}</b><p>{healthCopy}</p><dl><div><dt>Daily target</dt><dd>{formatMinutes(selected.targetMinutes)}</dd></div><div><dt>Expected today</dt><dd>{formatMinutes(expectedMinutes)}</dd></div><div><dt>Sessions</dt><dd>{projectSessions.length}</dd></div></dl></aside>
        </section>
        <section className="project-financial-card"><div><span className="eyebrow">FINANCIAL PERFORMANCE</span><h3>Project economics</h3></div><div><span><small>Revenue</small><b>৳{revenue.toLocaleString()}</b></span><span><small>Expenses</small><b>৳{costs.toLocaleString()}</b></span><span><small>Profit</small><b className={profit >= 0 ? "ahead" : "behind"}>৳{profit.toLocaleString()}</b></span><span><small>Margin</small><b>{revenue ? `${Math.round(profit / revenue * 100)}%` : "—"}</b></span></div></section>
        <div className="project-dashboard-grid">
          <article className="project-dashboard-card project-todo-summary">
            <span className="eyebrow">TODAY’S TASKS</span>
            <h3>
              {todayTodoStats.completedFromPlan}/{todayTodoStats.planned}{" "}
              completed
            </h3>
            <p className="muted">
              {todayTodoStats.open
                ? `${todayTodoStats.open} task${todayTodoStats.open === 1 ? "" : "s"} remaining`
                : todayTodoStats.planned
                  ? "All planned tasks completed"
                  : "No tasks planned for today"}
            </p>
            {todayProjectTodos.slice(0, 3).map((todo) => (
              <div className="project-todo-line" key={todo.id}>
                <i className={todo.status === "completed" ? "done" : ""} />
                <span>{todo.title}</span>
              </div>
            ))}
            {upcomingProjectTodos.length > 0 && <div className="project-upcoming"><span>Upcoming</span>{upcomingProjectTodos.map((todo) => <p key={todo.id}>{readableDate(todo.plannedDateString)} · {todo.title}</p>)}</div>}
          </article>
          <article className="project-dashboard-card project-notes-summary">
            <div className="project-notes-head"><div><span className="eyebrow">NOTES</span><h3>{projectNotes.filter((note) => note.pinned).length} pinned · {projectNotes.length} active</h3></div><button className="text-btn" onClick={() => onOpenNotes?.(selected.id)}>View all notes →</button></div>
            {projectNotes[0] && <p className="project-note-latest">Latest: {projectNotes[0].title}</p>}
            {projectNotes.slice(0, 3).map((note) => <div className="project-note-line" key={note.id}><i style={{ background: selected.color }} /><span><b>{note.title}</b><small>{note.type}{note.pinned ? " · Pinned" : ""}</small></span></div>)}
            {!projectNotes.length && <p className="muted">No notes for this project yet.</p>}
            <button className="text-btn" onClick={() => onOpenNotes?.(selected.id)}>+ Add note</button>
          </article>
          <article className="project-dashboard-card">
            <h3>Activity by day</h3>
            {Object.keys(dailyActivity).length ? (
              <div className="project-day-list">
                {Object.entries(dailyActivity)
                  .sort(([a], [b]) => b.localeCompare(a))
                  .map(([day, activity]) => (
                    <button
                      type="button"
                      key={day}
                      className={selectedDay === day ? "is-selected" : ""}
                      onClick={() => setSelectedDay(day)}
                      aria-expanded={selectedDay === day}
                      aria-label={`Show ${activity.sessions} session${activity.sessions === 1 ? "" : "s"} for ${day}`}
                    >
                      <span>{readableDate(day)}</span>
                      <b>{formatMinutes(activity.minutes)}</b>
                      <small>
                        {activity.sessions} session
                        {activity.sessions === 1 ? "" : "s"} ·{" "}
                        {activity.completed}/{activity.planned} tasks
                      </small>
                    </button>
                  ))}
              </div>
            ) : (
              <p className="muted">
                No completed sessions for this project yet.
              </p>
            )}
            {selectedDay && (
              <section className="project-day-drilldown" aria-live="polite">
                <div className="project-day-drilldown-head">
                  <div>
                    <span className="eyebrow">SESSION DETAILS</span>
                    <h4>{readableDate(selectedDay)}</h4>
                    <p>
                      {formatMinutes(selectedDayMinutes)} across{" "}
                      {selectedDaySessions.length} session
                      {selectedDaySessions.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <button
                    className="text-btn"
                    type="button"
                    onClick={() => setSelectedDay(null)}
                  >
                    Close
                  </button>
                </div>
                <div className="project-session-list">
                  {selectedDaySessions.map((session) => (
                    <div
                      key={
                        session.id ||
                        `${session.startTime.getTime()}-${session.notes}`
                      }
                    >
                      <span>
                        {session.startTime.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        –
                        {session.endTime.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <b>{formatMinutes(session.durationMinutes)}</b>
                      <p>{session.notes || "No work note added."}</p>
                    </div>
                  ))}
                </div>
                <div className="project-day-todos">
                  <h5>Tasks</h5>
                  <p>
                    {selectedDayTodoStats?.completedFromPlan || 0}/
                    {selectedDayTodoStats?.planned || 0} completed
                  </p>
                  {selectedDayProjectTodos.length ? (
                    <ul>
                      {selectedDayProjectTodos.map((todo) => (
                        <li
                          className={todo.status === "completed" ? "done" : ""}
                          key={todo.id}
                        >
                          {todo.title}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No tasks were planned for this project on this day.</p>
                  )}
                </div>
              </section>
            )}
          </article>
        </div>
      </section>
    );
  }
  const today = localDateKey();
  const totalTracked = sessions.reduce((sum, session) => sum + session.durationMinutes, 0);
  const todayTracked = sessions
    .filter((session) => session.date === today)
    .reduce((sum, session) => sum + session.durationMinutes, 0);
  const todayTasks = buildTodoDayStats(todos, today);
  const activeProjects = projects.filter((project) => statusFor(project) === "active");
  const onTrackCount = activeProjects.filter((project) => {
    const worked = sessions.filter((session) => session.projectId === project.id && session.date === today)
      .reduce((sum, session) => sum + session.durationMinutes, 0);
    return worked >= project.targetMinutes;
  }).length;
  const behindCount = activeProjects.filter((project) => {
    const worked = sessions.filter((session) => session.projectId === project.id && session.date === today)
      .reduce((sum, session) => sum + session.durationMinutes, 0);
    return worked > 0 && worked < project.targetMinutes;
  }).length;
  const rows = projects.filter((project) => {
    const haystack = `${project.name} ${project.clientName || ""}`.toLowerCase();
    return (filter === "all" || statusFor(project) === filter) && haystack.includes(search.toLowerCase());
  });
  const distribution = projects
    .map((project) => ({ project, minutes: total(project.id) }))
    .filter((item) => item.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
  let cursor = 0;
  const distributionGradient = totalTracked
    ? `conic-gradient(${distribution.map(({ project, minutes }) => {
        const start = cursor;
        cursor += (minutes / totalTracked) * 100;
        return `${project.color} ${start}% ${cursor}%`;
      }).join(", ")})`
    : "#e9eff8";
  return (
    <section className="projects-workspace">
      <div className="projects-page-heading">
        <div><span className="projects-heading-icon"><FolderKanban size={22} /></span><div><h2>Projects</h2><p>Manage your projects, track progress and stay on schedule.</p></div></div>
        <div className="projects-heading-actions"><span className="projects-sync"><CheckCircle2 size={14} /> Synced</span><button className="start-btn projects-new" onClick={onCreate}><Plus size={17} /> New project</button></div>
      </div>
      <div className="project-kpi-grid">
        <ProjectKpi icon={<FolderKanban size={19} />} label="Total Projects" value={String(projects.length)} note={`${activeProjects.length} active · ${projects.filter((project) => statusFor(project) === "on_hold").length} on hold`} tone="purple" />
        <ProjectKpi icon={<Clock3 size={19} />} label="Total Tracked Time" value={formatMinutes(totalTracked)} note={`${formatMinutes(todayTracked)} today`} tone="blue" />
        <ProjectKpi icon={<CheckCircle2 size={19} />} label="Today's Tasks" value={`${todayTasks.completedFromPlan} / ${todayTasks.planned}`} note={todayTasks.planned ? `${todayTasks.completionPercent}% complete` : "No tasks planned"} tone="green" />
        <ProjectKpi icon={<Target size={19} />} label="On Track" value={String(onTrackCount)} note={`${activeProjects.length ? Math.round((onTrackCount / activeProjects.length) * 100) : 0}% of active projects`} tone="violet" />
        <ProjectKpi icon={<Flag size={19} />} label="Behind Pace" value={String(behindCount)} note={behindCount ? "Needs attention today" : "All clear today"} tone="orange" />
      </div>
      <div className="project-manager-tools project-manager-toolbar">
        <label className="project-search" htmlFor="project-search">
          <Search size={16} />
          <input
            id="project-search"
            name="project-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects"
          />
        </label>
        <div className="project-status-tabs">
          {(["active", "on_hold", "completed", "archived", "all"] as const).map((item) => (
            <button
              key={item}
              className={filter === item ? "selected" : ""}
              onClick={() => setFilter(item)}
            >
              {item === "all" ? "All" : labels[item]}
            </button>
          ))}
        </div>
      </div>
      <div className="projects-portfolio-grid">
        <div className="project-directory"><b className="project-directory-count">{rows.length} project{rows.length === 1 ? "" : "s"}</b><div className="project-list-modern">{rows.map((project) => {
          const status = statusFor(project);
          const todayMinutes = sessions.filter((session) => session.projectId === project.id && session.date === today).reduce((sum, session) => sum + session.durationMinutes, 0);
          const todoStats = buildTodoDayStats(todos.filter((todo) => todo.projectId === project.id), today);
          const timePercent = project.targetMinutes ? Math.round((todayMinutes / project.targetMinutes) * 100) : 0;
          const taskPercent = todoStats.planned ? todoStats.completionPercent : 0;
          return <article className="project-row-modern" style={{ "--project-color": project.color } as CSSProperties} key={project.id}>
            <div className="project-row-main"><button className="project-row-title" onClick={() => onSelectProject(project.id)}><i style={{ background: project.color }}><FolderKanban size={18} /></i><span><b>{project.name}</b><em className={`priority ${project.priority || "medium"}`}>{project.priority || "medium"} priority</em><small>Client: {project.clientName || "Personal"}</small><p>{project.description || "No project description added yet."}</p></span></button>{project.referenceUrl && <a href={project.referenceUrl} target="_blank" rel="noreferrer">Open reference <ExternalLink size={12} /></a>}</div>
            <div className="project-row-metrics"><div><small>Today</small><b>{formatMinutes(todayMinutes)} / {formatMinutes(project.targetMinutes)}</b><ProjectBar value={timePercent} color={project.color} /><em>{timePercent}%</em></div><div><small>Total</small><b>{formatMinutes(total(project.id))}</b><span>tracked</span></div><div><small>Tasks</small><b>{todoStats.completedFromPlan} / {todoStats.planned}</b><ProjectBar value={taskPercent} color="#18bd82" /><em>{taskPercent}%</em></div></div>
            <div className="project-row-meta"><span className={`status-pill ${status}`}>{labels[status]}</span><button className="icon-btn" aria-label={`Edit ${project.name}`} title="Edit project" onClick={() => onEdit(project)}><Pencil size={15} /></button><button className="icon-btn" aria-label={`Open ${project.name} dashboard`} title="Open dashboard" onClick={() => onSelectProject(project.id)}><MoreVertical size={16} /></button><small><CalendarDays size={13} /> Start: {project.startDate || project.createdDate || "Not set"}</small><small><Flag size={13} /> {project.deadlineDate ? `Deadline: ${project.deadlineDate}` : "No deadline"}</small></div>
          </article>;
        })}</div>{!rows.length && <div className="report-empty"><FolderKanban size={28} /><h3>No projects found</h3><p>Try another filter or create a new project.</p></div>}</div>
        <aside className="projects-overview-aside"><section className="portfolio-card"><h3>Project Overview</h3><div className="portfolio-donut" style={{ background: distributionGradient }}><div><b>{formatMinutes(totalTracked)}</b><small>Total tracked</small></div></div><div className="portfolio-legend">{distribution.slice(0, 5).map(({ project, minutes }) => <div key={project.id}><i style={{ background: project.color }} /><span>{project.name}</span><b>{totalTracked ? Math.round((minutes / totalTracked) * 100) : 0}%</b></div>)}</div></section><section className="portfolio-card"><h3>Project Status</h3>{(["active", "on_hold", "completed", "archived"] as ProjectStatus[]).map((status) => <div className="portfolio-status" key={status}><i className={status} /><span>{labels[status]}</span><b>{projects.filter((project) => statusFor(project) === status).length}</b></div>)}</section><section className="portfolio-card"><h3>Recent Activity</h3><div className="portfolio-activity">{sessions.slice(0, 4).map((session) => <button key={session.id || `${session.projectId}-${session.startTime.getTime()}`} onClick={() => onSelectProject(session.projectId)}><i style={{ background: projects.find((project) => project.id === session.projectId)?.color }} /><span><b>{projects.find((project) => project.id === session.projectId)?.name || "Project"}</b><small>{session.notes || "Session completed"}</small></span><em>{formatMinutes(session.durationMinutes)}</em></button>) || <p>No activity yet.</p>}</div></section></aside>
      </div>
    </section>
  );
}

function ProjectKpi({ icon, label, value, note, tone }: { icon: ReactNode; label: string; value: string; note: string; tone: string }) {
  return <article className="project-kpi"><span className={`project-kpi-icon ${tone}`}>{icon}</span><div><small>{label}</small><strong>{value}</strong><em>{note}</em></div></article>;
}

function ProjectBar({ value, color }: { value: number; color: string }) {
  return <span className="project-mini-bar"><i style={{ width: `${Math.min(100, value)}%`, background: color }} /></span>;
}
