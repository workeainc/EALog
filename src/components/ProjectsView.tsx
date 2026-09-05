import { useMemo, useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ExternalLink,
  FolderKanban,
  PauseCircle,
  Pencil,
  Play,
  RotateCcw,
  Search,
} from "lucide-react";
import type { Project, ProjectStatus } from "../types/tracker";
import {
  formatMinutes,
  normalizeReportLogs,
  type ReportLog,
} from "../lib/reports";

type Props = {
  projects: Project[];
  logs: ReportLog[];
  onEdit: (project: Project) => void;
  onStatus: (project: Project, status: ProjectStatus) => Promise<void>;
  onMove: (project: Project, direction: -1 | 1) => Promise<void>;
  onStart: (project: Project) => void;
  onReport: (project: Project) => void;
};

const statusLabel: Record<ProjectStatus, string> = {
  planned: "Planned",
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  archived: "Archived",
};

export default function ProjectsView({
  projects,
  logs,
  onEdit,
  onStatus,
  onMove,
  onStart,
  onReport,
}: Props) {
  const [filter, setFilter] = useState<"active" | "archived" | "all">("active");
  const [search, setSearch] = useState("");
  const normalized = useMemo(() => normalizeReportLogs(logs), [logs]);
  const rows = useMemo(
    () =>
      projects.filter((project) => {
        const archived =
          (project.status || (project.active ? "active" : "archived")) ===
          "archived";
        const haystack =
          `${project.name} ${project.clientName || ""} ${project.description || ""}`.toLowerCase();
        return (
          (filter === "all" ||
            (filter === "archived" ? archived : !archived)) &&
          haystack.includes(search.trim().toLowerCase())
        );
      }),
    [projects, filter, search],
  );
  const totals = (id: string) =>
    normalized
      .filter((log) => log.projectId === id)
      .reduce((sum, log) => sum + log.durationMinutes, 0);
  const recent = (id: string) =>
    normalized.filter((log) => log.projectId === id).slice(0, 1)[0];
  return (
    <section className="projects-workspace">
      <div className="report-toolbar">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <h2>Projects</h2>
          <p className="muted">
            Manage project details, targets, status, and work history.
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
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search projects or clients"
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
      <div className="project-manager-grid">
        {rows.map((project, index) => {
          const status =
            project.status || (project.active ? "active" : "archived");
          const total = totals(project.id);
          const latest = recent(project.id);
          const archived = status === "archived";
          return (
            <article
              className={`project-manager-card ${archived ? "is-archived" : ""}`}
              key={project.id}
            >
              <div className="project-manager-head">
                <div className="project-name">
                  <i style={{ background: project.color }} />
                  <div>
                    <h3>{project.name}</h3>
                    <span>{project.clientName || "Personal project"}</span>
                  </div>
                </div>
                <span className={`status-pill ${status}`}>
                  {statusLabel[status]}
                </span>
              </div>
              {project.description && (
                <p className="project-description">{project.description}</p>
              )}
              <div className="project-manager-stats">
                <div>
                  <span>Daily target</span>
                  <b>{formatMinutes(project.targetMinutes)}</b>
                </div>
                <div>
                  <span>Tracked</span>
                  <b>{formatMinutes(total)}</b>
                </div>
                <div>
                  <span>Priority</span>
                  <b className={`priority ${project.priority || "medium"}`}>
                    {project.priority || "medium"}
                  </b>
                </div>
              </div>
              <div className="project-meta">
                {project.deadlineDate && (
                  <span>Due {project.deadlineDate}</span>
                )}
                {latest && <span>Latest: {latest.date}</span>}
              </div>
              <div className="project-manager-actions">
                <button className="outline-btn" onClick={() => onEdit(project)}>
                  <Pencil size={14} /> Edit
                </button>
                {!archived && (
                  <button
                    className="start-btn"
                    disabled={status !== "active"}
                    onClick={() => onStart(project)}
                  >
                    <Play size={14} /> Start
                  </button>
                )}
                <button
                  className="outline-btn"
                  onClick={() => onReport(project)}
                >
                  Report
                </button>
                {project.referenceUrl && (
                  <a
                    className="icon-btn"
                    href={project.referenceUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open reference link"
                  >
                    <ExternalLink size={15} />
                  </a>
                )}
              </div>
              <div className="project-lifecycle">
                <button
                  className="text-btn"
                  disabled={index === 0}
                  onClick={() => void onMove(project, -1)}
                >
                  <ArrowUp size={14} /> Move up
                </button>
                <button
                  className="text-btn"
                  disabled={index === rows.length - 1}
                  onClick={() => void onMove(project, 1)}
                >
                  <ArrowDown size={14} /> Move down
                </button>
                {archived ? (
                  <button
                    className="text-btn"
                    onClick={() => void onStatus(project, "active")}
                  >
                    <RotateCcw size={14} /> Restore
                  </button>
                ) : (
                  <>
                    <button
                      className="text-btn"
                      onClick={() =>
                        void onStatus(
                          project,
                          status === "on_hold" ? "active" : "on_hold",
                        )
                      }
                    >
                      <PauseCircle size={14} />{" "}
                      {status === "on_hold" ? "Resume" : "On hold"}
                    </button>
                    <button
                      className="text-btn danger-text"
                      onClick={() => void onStatus(project, "archived")}
                    >
                      <Archive size={14} /> Archive
                    </button>
                  </>
                )}
              </div>
            </article>
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
