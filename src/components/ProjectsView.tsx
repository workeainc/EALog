import { useMemo, useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ExternalLink,
  FolderKanban,
  PauseCircle,
  Pencil,
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
};
const labels: Record<ProjectStatus, string> = {
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
}: Props) {
  const [filter, setFilter] = useState<"active" | "archived" | "all">("active");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
  const total = (id: string) =>
    normalized
      .filter((log) => log.projectId === id)
      .reduce((sum, log) => sum + log.durationMinutes, 0);
  const latest = (id: string) =>
    normalized.filter((log) => log.projectId === id)[0];
  return (
    <section className="projects-workspace">
      <div className="report-toolbar">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <h2>Projects</h2>
          <p className="muted">
            Open a project to view and manage its details. Your Focus Timer
            stays in Overview.
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
      <div className="project-accordion">
        {rows.map((project, index) => {
          const status = (project.status ||
            (project.active ? "active" : "archived")) as ProjectStatus;
          const archived = status === "archived";
          const open = expandedId === project.id;
          return (
            <article
              className={`project-accordion-item ${archived ? "is-archived" : ""} ${open ? "is-open" : ""}`}
              key={project.id}
            >
              <button
                type="button"
                className="project-accordion-trigger"
                onClick={() => setExpandedId(open ? null : project.id)}
                aria-expanded={open}
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
                <span className={`status-pill ${status}`}>
                  {labels[status]}
                </span>
                <ChevronDown size={18} className={open ? "chevron-open" : ""} />
              </button>
              {open && (
                <div className="project-accordion-detail">
                  <div className="project-manager-stats">
                    <div>
                      <span>Daily target</span>
                      <b>{formatMinutes(project.targetMinutes)}</b>
                    </div>
                    <div>
                      <span>Total tracked</span>
                      <b>{formatMinutes(total(project.id))}</b>
                    </div>
                    <div>
                      <span>Priority</span>
                      <b className={`priority ${project.priority || "medium"}`}>
                        {project.priority || "medium"}
                      </b>
                    </div>
                  </div>
                  {project.description && (
                    <p className="project-description">{project.description}</p>
                  )}
                  <div className="project-meta">
                    {project.startDate && (
                      <span>Started {project.startDate}</span>
                    )}
                    {project.deadlineDate && (
                      <span>Due {project.deadlineDate}</span>
                    )}
                    {latest(project.id) && (
                      <span>Latest session: {latest(project.id)?.date}</span>
                    )}
                  </div>
                  <div className="project-manager-actions">
                    <button
                      className="outline-btn"
                      onClick={() => onEdit(project)}
                    >
                      <Pencil size={14} /> Edit details
                    </button>
                    {project.referenceUrl && (
                      <a
                        className="outline-btn"
                        href={project.referenceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={14} /> Open link
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
                </div>
              )}
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
