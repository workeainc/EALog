import { useEffect, useMemo, useState } from "react";
import {
    Copy,
    Download,
    Eye,
    Mail,
    MessageCircle,
    RefreshCw,
    Send,
    X,
} from "lucide-react";
import {
    aggregateReportRows,
    buildProjectBreakdown,
    formatMinutes,
    createProjectReportPdf,
    downloadProjectReportPdf,
    getReportDateRange,
    normalizeReportLogs,
    openEmail,
    openWhatsApp,
    copyReportSummary,
    shareProjectReportPdf,
    type ProjectReport,
    type ReportPeriod,
} from "../lib/reports";
import type { ReportBranding } from "../types/tracker";

type ReportProject = {
    id: string;
    name: string;
    target?: number;
    targetMinutes?: number;
    color?: string;
    active?: boolean;
};
type Props = {
    projects: ReportProject[];
    uid: string | null;
    tracker: any;
    demoLogs: any[];
    branding?: ReportBranding | null;
};

export default function ReportsView({
    projects,
    uid,
    tracker,
    demoLogs,
    branding,
}: Props) {
    const [projectId, setProjectId] = useState("all");
    const [period, setPeriod] = useState<ReportPeriod>("today");
    const [customFrom, setCustomFrom] = useState("");
    const [customTo, setCustomTo] = useState("");
    const [logs, setLogs] = useState<any[]>(demoLogs);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [copied, setCopied] = useState(false);
    const [pdfPreview, setPdfPreview] = useState<{
        url: string;
        filename: string;
    } | null>(null);
    const [shareHint, setShareHint] = useState("");
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const range = useMemo(
        () =>
            getReportDateRange(period, new Date(), timezone, {
                from: customFrom,
                to: customTo,
            }),
        [period, customFrom, customTo, timezone],
    );

    useEffect(() => {
        let cancelled = false;
        if (!uid || !tracker) {
            setLogs(demoLogs);
            return;
        }
        setLoading(true);
        setError("");
        tracker
            .getWorkLogs(uid, range.from, range.to)
            .then((rows: any[]) => {
                if (!cancelled) setLogs(rows);
            })
            .catch((e: any) => {
                if (!cancelled)
                    setError(e?.message || "Could not load report data.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [uid, tracker, range.from, range.to, demoLogs]);

    const report = useMemo<ProjectReport>(() => {
        const normalized = normalizeReportLogs(logs).filter(
            (row) =>
                row.date >= range.from &&
                row.date <= range.to &&
                (projectId === "all" || row.projectId === projectId),
        );
        const aggregate = aggregateReportRows(normalized, timezone);
        const project = projects.find((item) => item.id === projectId);
        const dayCount = Math.max(
            1,
            Math.round(
                (new Date(`${range.to}T12:00:00`).getTime() -
                    new Date(`${range.from}T12:00:00`).getTime()) /
                    86_400_000,
            ) + 1,
        );
        const dailyTarget =
            projectId === "all"
                ? projects
                      .filter((item) => item.active !== false)
                      .reduce(
                          (sum, item) =>
                              sum + (item.targetMinutes ?? item.target ?? 0),
                          0,
                      )
                : (project?.targetMinutes ?? project?.target ?? 0);
        return {
            ...aggregate,
            projectId: projectId === "all" ? undefined : projectId,
            projectName: project?.name || "All projects",
            targetMinutes: dailyTarget * dayCount,
            projectBreakdown:
                projectId === "all"
                    ? buildProjectBreakdown(normalized, projects, dayCount)
                    : undefined,
            from: range.from,
            to: range.to,
            generatedAt: new Date(),
        };
    }, [logs, range.from, range.to, projectId, projects, timezone]);
    const pct = report.targetMinutes
        ? Math.min(
              100,
              Math.round((report.totalMinutes / report.targetMinutes) * 100),
          )
        : 0;

    const shareCopy = async () => {
        setCopied(await copyReportSummary(report));
        window.setTimeout(() => setCopied(false), 1800);
    };
    const previewPdf = async () => {
        const { blob, filename } = await createProjectReportPdf(
            report,
            branding || undefined,
        );
        if (pdfPreview) URL.revokeObjectURL(pdfPreview.url);
        setPdfPreview({ url: URL.createObjectURL(blob), filename });
    };
    const downloadPdf = async () => {
        await downloadProjectReportPdf(report, branding || undefined);
    };
    const sharePdf = async (destination: "share" | "whatsapp" | "email") => {
        try {
            const outcome = await shareProjectReportPdf(
                report,
                branding || undefined,
            );
            if (outcome === "shared") {
                setShareHint(
                    "Choose WhatsApp or your email app in the share sheet; the PDF is attached.",
                );
                return;
            }
            setShareHint(
                `PDF downloaded. ${destination === "whatsapp" ? "WhatsApp opened - attach the downloaded PDF before sending." : destination === "email" ? "Your email app opened - attach the downloaded PDF before sending." : "Attach it in the app you choose."}`,
            );
            if (destination === "whatsapp") openWhatsApp(report);
            if (destination === "email") openEmail(report);
        } catch (e: any) {
            if (e?.name !== "AbortError")
                setShareHint(
                    "Could not open the share sheet. Download the PDF and attach it manually.",
                );
        }
    };
    return (
        <section className="reports-view">
            <div className="report-toolbar">
                <div>
                    <h2>Reports</h2>
                    <p className="muted">
                        Boss-ready time summaries by project and period.
                    </p>
                </div>
                <button
                    className="outline-btn"
                    onClick={() => setLogs([...logs])}
                >
                    <RefreshCw size={15} /> Refresh
                </button>
            </div>
            <div className="report-filters">
                <label htmlFor="report-project">
                    Project
                    <select
                        id="report-project"
                        name="report-project"
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                    >
                        <option value="all">All projects</option>
                        {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label htmlFor="report-period">
                    Period
                    <select
                        id="report-period"
                        name="report-period"
                        value={period}
                        onChange={(e) =>
                            setPeriod(e.target.value as ReportPeriod)
                        }
                    >
                        <option value="today">Daily</option>
                        <option value="week">Weekly</option>
                        <option value="month">Monthly</option>
                        <option value="custom">Custom range</option>
                    </select>
                </label>
                {period === "custom" && (
                    <>
                        <label htmlFor="report-from">
                            From
                            <input
                                id="report-from"
                                name="report-from"
                                type="date"
                                value={customFrom}
                                onChange={(e) => setCustomFrom(e.target.value)}
                            />
                        </label>
                        <label htmlFor="report-to">
                            To
                            <input
                                id="report-to"
                                name="report-to"
                                type="date"
                                value={customTo}
                                onChange={(e) => setCustomTo(e.target.value)}
                            />
                        </label>
                    </>
                )}
            </div>
            {error && <p className="sync-warning">{error}</p>}
            <div className="report-preview">
                <div className="report-preview-head">
                    <div>
                        <span className="eyebrow">WORKHOURS REPORT</span>
                        <h3>{report.projectName}</h3>
                        <p className="muted">
                            {report.from} → {report.to} · Generated{" "}
                            {report.generatedAt.toLocaleString()}
                        </p>
                        {(branding?.displayName || branding?.companyName) && (
                            <p className="report-brand-preview">
                                Prepared by{" "}
                                {branding.displayName || "Developer"}
                                {branding.designation
                                    ? ` · ${branding.designation}`
                                    : ""}
                                {branding.companyName
                                    ? ` · ${branding.companyName}`
                                    : ""}
                            </p>
                        )}
                    </div>
                    <div className="report-actions">
                        <button
                            className="outline-btn"
                            disabled={loading}
                            onClick={previewPdf}
                        >
                            <Eye size={15} /> Preview PDF
                        </button>
                        <button
                            className="start-btn"
                            disabled={loading}
                            onClick={downloadPdf}
                        >
                            <Download size={15} /> Download PDF
                        </button>
                        <button
                            className="outline-btn"
                            disabled={loading}
                            onClick={() => sharePdf("share")}
                        >
                            <Send size={15} /> Share PDF
                        </button>
                        <button
                            className="outline-btn"
                            disabled={loading}
                            onClick={() => sharePdf("whatsapp")}
                        >
                            <MessageCircle size={15} /> WhatsApp PDF
                        </button>
                        <button
                            className="outline-btn"
                            disabled={loading}
                            onClick={() => sharePdf("email")}
                        >
                            <Mail size={15} /> Email PDF
                        </button>
                        <button
                            className="outline-btn"
                            disabled={loading}
                            onClick={shareCopy}
                        >
                            {copied ? (
                                "Copied!"
                            ) : (
                                <>
                                    <Copy size={15} /> Copy summary
                                </>
                            )}
                        </button>
                    </div>
                </div>
                {shareHint && <p className="share-hint">{shareHint}</p>}
                {loading ? (
                    <div className="report-empty">Loading report…</div>
                ) : report.sessionCount === 0 ? (
                    <div className="report-empty">
                        <h3>No sessions found</h3>
                        <p>Try another period or project.</p>
                    </div>
                ) : (
                    <>
                        <div className="report-kpis">
                            <div>
                                <span>Total tracked</span>
                                <strong>
                                    {formatMinutes(report.totalMinutes)}
                                </strong>
                            </div>
                            <div>
                                <span>Sessions</span>
                                <strong>{report.sessionCount}</strong>
                            </div>
                            <div>
                                <span>Days worked</span>
                                <strong>
                                    {Object.keys(report.byDay).length}
                                </strong>
                            </div>
                            {report.targetMinutes && (
                                <div>
                                    <span>Target completion</span>
                                    <strong>{pct}%</strong>
                                    <div className="mini-track">
                                        <i style={{ width: `${pct}%` }} />
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="report-day-list">
                            <h4>Day-by-day breakdown</h4>
                            {Object.entries(report.byDay)
                                .sort(([a], [b]) => a.localeCompare(b))
                                .map(([day, minutes]) => (
                                    <div key={day}>
                                        <span>{day}</span>
                                        <b>{formatMinutes(minutes)}</b>
                                    </div>
                                ))}
                        </div>
                        {report.projectBreakdown && (
                            <div className="report-project-breakdown">
                                <div className="report-breakdown-heading">
                                    <div>
                                        <h4>Project breakdown</h4>
                                        <p>
                                            Totals and targets across this
                                            report period.
                                        </p>
                                    </div>
                                    <span>{report.projectBreakdown.length} projects</span>
                                </div>
                                <div className="report-project-grid">
                                    {report.projectBreakdown.map((project) => (
                                        <article key={project.projectId}>
                                            <h5>{project.projectName}</h5>
                                            <strong>
                                                {formatMinutes(project.totalMinutes)}
                                            </strong>
                                            <p>
                                                {project.sessionCount} session
                                                {project.sessionCount === 1 ? "" : "s"}
                                                {project.targetMinutes
                                                    ? ` · ${formatMinutes(project.targetMinutes)} target`
                                                    : " · No target"}
                                            </p>
                                            {project.completionPercentage !== null && (
                                                <>
                                                    <div className="mini-track">
                                                        <i
                                                            style={{
                                                                width: `${Math.min(100, project.completionPercentage)}%`,
                                                            }}
                                                        />
                                                    </div>
                                                    <small>
                                                        {project.completionPercentage}% complete
                                                    </small>
                                                </>
                                            )}
                                        </article>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div className="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th>DATE</th>
                                        {projectId === "all" && <th>PROJECT</th>}
                                        <th>START</th>
                                        <th>END</th>
                                        <th>DURATION</th>
                                        <th>NOTES</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {report.rows.map((row, i) => (
                                        <tr key={`${row.date}-${i}`}>
                                            <td>{row.date}</td>
                                            {projectId === "all" && (
                                                <td>
                                                    {projects.find(
                                                        (project) =>
                                                            project.id === row.projectId,
                                                    )?.name || row.projectId || "Unassigned project"}
                                                </td>
                                            )}
                                            <td>
                                                {row.startTime.toLocaleTimeString(
                                                    [],
                                                    {
                                                        hour: "2-digit",
                                                        minute: "2-digit",
                                                    },
                                                )}
                                            </td>
                                            <td>
                                                {row.endTime.toLocaleTimeString(
                                                    [],
                                                    {
                                                        hour: "2-digit",
                                                        minute: "2-digit",
                                                    },
                                                )}
                                            </td>
                                            <td>
                                                <b>
                                                    {formatMinutes(
                                                        row.durationMinutes,
                                                    )}
                                                </b>
                                            </td>
                                            <td className="report-note">
                                                {row.notes || "—"}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>
            {pdfPreview && (
                <div
                    className="pdf-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-label="PDF preview"
                >
                    <div className="pdf-dialog">
                        <div className="pdf-dialog-head">
                            <b>{pdfPreview.filename}</b>
                            <div>
                                <a
                                    className="outline-btn"
                                    href={pdfPreview.url}
                                    download={pdfPreview.filename}
                                >
                                    <Download size={15} /> Download
                                </a>
                                <button
                                    className="icon-btn"
                                    onClick={() => {
                                        URL.revokeObjectURL(pdfPreview.url);
                                        setPdfPreview(null);
                                    }}
                                >
                                    <X size={19} />
                                </button>
                            </div>
                        </div>
                        <iframe
                            title="Workhours PDF preview"
                            src={pdfPreview.url}
                        />
                    </div>
                </div>
            )}
        </section>
    );
}
