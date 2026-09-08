import {
  Archive,
  ArrowLeft,
  ExternalLink,
  FolderKanban,
  PauseCircle,
  Pencil,
  RotateCcw,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  formatMinutes,
  normalizeReportLogs,
  type ReportLog,
} from "../lib/reports";
import { getMonthPlan, localDateKey } from "../lib/project-schedule";
import type { Project, ProjectStatus } from "../types/tracker";

type Props = {
  projects: Project[];
  logs: ReportLog[];
  selectedProjectId?: string | null;
  onSelectProject: (id: string | null) => void;
  onEdit: (project: Project) => void;
  onStatus: (project: Project, status: ProjectStatus) => Promise<void>;
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
  selectedProjectId,
  onSelectProject,
  onEdit,
  onStatus,
}: Props) {
  const [filter, setFilter] = useState<"active" | "archived" | "all">("active");
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
    const today = new Date().toISOString().slice(0, 10);
    const todayMinutes = projectSessions
      .filter((log) => log.date === today)
      .reduce((sum, log) => sum + log.durationMinutes, 0);
    const dailyActivity = projectSessions.reduce<
      Record<string, { minutes: number; sessions: number }>
    >((days, session) => {
      const entry = days[session.date] || { minutes: 0, sessions: 0 };
      entry.minutes += session.durationMinutes;
      entry.sessions += 1;
      days[session.date] = entry;
      return days;
    }, {});
    const selectedDaySessions = selectedDay
      ? projectSessions.filter((session) => session.date === selectedDay)
      : [];
    const selectedDayMinutes = selectedDaySessions.reduce(
      (sum, session) => sum + session.durationMinutes,
      0,
    );
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
    return (
      <section className="project-dashboard">
        <button
          className="text-btn project-back"
          onClick={() => onSelectProject(null)}
        >
          <ArrowLeft size={15} /> All projects
        </button>
        <div className="project-dashboard-hero">
          <div>
            <span className="eyebrow">PROJECT DASHBOARD</span>
            <div className="project-dashboard-title">
              <i style={{ background: selected.color }} />
              <h2>{selected.name}</h2>
              <span className={`status-pill ${status}`}>{labels[status]}</span>
            </div>
            <p className="muted">
              {selected.clientName || "Personal project"}
              {selected.description ? ` · ${selected.description}` : ""}
            </p>
          </div>
          <button className="outline-btn" onClick={() => onEdit(selected)}>
            <Pencil size={14} /> Edit project
          </button>
        </div>
        <div className="project-dashboard-stats">
          <div>
            <span>Today</span>
            <b>{formatMinutes(todayMinutes)}</b>
            <small>of {formatMinutes(selected.targetMinutes)} target</small>
          </div>
          <div>
            <span>Total tracked</span>
            <b>{formatMinutes(total(selected.id))}</b>
            <small>{projectSessions.length} completed sessions</small>
          </div>
          <div>
            <span>Priority</span>
            <b className={`priority ${selected.priority || "medium"}`}>
              {selected.priority || "medium"}
            </b>
            <small>
              {selected.deadlineDate
                ? `Due ${selected.deadlineDate}`
                : "No deadline"}
            </small>
          </div>
        </div>
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
        <div className="project-dashboard-grid">
          <article className="project-dashboard-card">
            <h3>Project details</h3>
            <dl>
              <div>
                <dt>Status</dt>
                <dd>{labels[status]}</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{selected.startDate || "Not set"}</dd>
              </div>
              <div>
                <dt>Deadline</dt>
                <dd>{selected.deadlineDate || "Not set"}</dd>
              </div>
              {selected.referenceUrl && (
                <div>
                  <dt>Reference</dt>
                  <dd>
                    <a
                      href={selected.referenceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open link <ExternalLink size={13} />
                    </a>
                  </dd>
                </div>
              )}
            </dl>
            <div className="project-lifecycle">
              {status === "archived" ? (
                <button
                  className="text-btn"
                  onClick={() => void onStatus(selected, "active")}
                >
                  <RotateCcw size={14} /> Restore
                </button>
              ) : (
                <>
                  <button
                    className="text-btn"
                    onClick={() =>
                      void onStatus(
                        selected,
                        status === "on_hold" ? "active" : "on_hold",
                      )
                    }
                  >
                    <PauseCircle size={14} />{" "}
                    {status === "on_hold" ? "Resume" : "On hold"}
                  </button>
                  <button
                    className="text-btn danger-text"
                    onClick={() => void onStatus(selected, "archived")}
                  >
                    <Archive size={14} /> Archive
                  </button>
                </>
              )}
            </div>
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
                        {activity.sessions === 1 ? "" : "s"}
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
              </section>
            )}
          </article>
        </div>
      </section>
    );
  }
  const rows = projects.filter((project) => {
    const archived = statusFor(project) === "archived";
    const haystack =
      `${project.name} ${project.clientName || ""}`.toLowerCase();
    return (
      (filter === "all" || (filter === "archived" ? archived : !archived)) &&
      haystack.includes(search.toLowerCase())
    );
  });
  return (
    <section className="projects-workspace">
      <div className="report-toolbar">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <h2>Projects</h2>
          <p className="muted">
            Choose a project to open its own detailed dashboard.
          </p>
        </div>
        <div className="project-count">{projects.length} total</div>
      </div>
      <div className="project-manager-tools">
        <label htmlFor="project-search">
          <Search size={16} />
          <input
            id="project-search"
            name="project-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects"
          />
        </label>
        <div className="activity-tabs">
          {(["active", "archived", "all"] as const).map((item) => (
            <button
              key={item}
              className={filter === item ? "selected" : ""}
              onClick={() => setFilter(item)}
            >
              {item === "active"
                ? "Active"
                : item === "archived"
                  ? "Archived"
                  : "All"}
            </button>
          ))}
        </div>
      </div>
      <div className="project-accordion">
        {rows.map((project) => {
          const status = statusFor(project);
          return (
            <button
              className="project-accordion-trigger project-sidebar-row"
              key={project.id}
              onClick={() => onSelectProject(project.id)}
            >
              <span className="project-name">
                <i style={{ background: project.color }} />
                <span>
                  <b>{project.name}</b>
                  <small>{project.clientName || "Personal project"}</small>
                </span>
              </span>
              <span className="project-accordion-summary">
                <b>{formatMinutes(total(project.id))}</b>
                <small>tracked</small>
              </span>
              <span className={`status-pill ${status}`}>{labels[status]}</span>
            </button>
          );
        })}
      </div>
      {!rows.length && (
        <div className="report-empty">
          <FolderKanban size={28} />
          <h3>No projects found</h3>
          <p>Try another filter or create a project from Overview.</p>
        </div>
      )}
    </section>
  );
}
