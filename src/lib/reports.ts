/** Utilities shared by the reports view and dashboard charts.
 *
 * Firestore timestamps are accepted in addition to native Date values so the
 * helpers can be used directly with the objects returned by the SDK.
 */

import type { ReportBranding } from "../types/tracker";

export type ReportLog = {
    id?: string;
    projectId: string;
    startTime: Date | string | number | { toDate: () => Date };
    endTime: Date | string | number | { toDate: () => Date };
    durationMinutes?: number;
    notes?: string;
    dateString?: string;
};

export type ReportRow = {
    /** Firestore work-log id, retained so the Sessions screen can correct a log. */
    id?: string;
    projectId: string;
    date: string;
    startTime: Date;
    endTime: Date;
    durationMinutes: number;
    notes: string;
};

export type ReportAggregate = {
    totalMinutes: number;
    sessionCount: number;
    byProject: Record<string, number>;
    byDay: Record<string, number>;
    rows: ReportRow[];
};

export type ReportPeriod = "today" | "week" | "month" | "custom";

const dateKeyInTimeZone = (date: Date, timezone: string): string => {
    try {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).formatToParts(date);
        const values = Object.fromEntries(
            parts
                .filter((part) => part.type !== "literal")
                .map((part) => [part.type, part.value]),
        );
        return `${values.year}-${values.month}-${values.day}`;
    } catch {
        return formatDate(date);
    }
};

const shiftDateKey = (key: string, days: number): string => {
    const date = new Date(`${key}T12:00:00`);
    date.setDate(date.getDate() + days);
    return formatDate(date);
};

/** Returns inclusive YYYY-MM-DD boundaries in the requested timezone. */
export function getReportDateRange(
    period: ReportPeriod,
    now = new Date(),
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
    custom?: { from: string; to: string },
): { from: string; to: string } {
    const today = dateKeyInTimeZone(now, timezone);
    if (period === "custom") {
        if (!custom?.from || !custom?.to) return { from: today, to: today };
        return custom.from <= custom.to
            ? custom
            : { from: custom.to, to: custom.from };
    }
    if (period === "today") return { from: today, to: today };
    if (period === "month") {
        const year = Number(today.slice(0, 4));
        const month = Number(today.slice(5, 7));
        const first = `${today.slice(0, 7)}-01`;
        return {
            from: first,
            to: shiftDateKey(first, new Date(year, month, 0).getDate() - 1),
        };
    }
    // Monday-Sunday week, calculated from the local calendar key.
    const day = new Date(`${today}T12:00:00`).getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    return {
        from: shiftDateKey(today, mondayOffset),
        to: shiftDateKey(today, mondayOffset + 6),
    };
}

/** Aggregate normalized rows; active sessions are intentionally not accepted here. */
export function aggregateReportRows(
    logs: ReportLog[] | ReportRow[],
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): ReportAggregate {
    const rows = (
        logs.length && "date" in logs[0]
            ? (logs as ReportRow[])
            : normalizeReportLogs(logs as ReportLog[], timezone)
    ).map((row) => ({
        ...row,
        date: row.date || dateKeyInTimeZone(row.startTime, timezone),
    }));
    const byProject: Record<string, number> = {};
    const byDay: Record<string, number> = {};
    for (const row of rows) {
        byProject[row.projectId] =
            (byProject[row.projectId] || 0) + row.durationMinutes;
        const day = row.date || dateKeyInTimeZone(row.startTime, timezone);
        byDay[day] = (byDay[day] || 0) + row.durationMinutes;
    }
    return {
        totalMinutes: rows.reduce((sum, row) => sum + row.durationMinutes, 0),
        sessionCount: rows.length,
        byProject,
        byDay,
        rows,
    };
}

const asDate = (value: ReportLog["startTime"]): Date => {
    if (value && typeof value === "object" && "toDate" in value)
        return value.toDate();
    const date = new Date(value as string | number | Date);
    return Number.isNaN(date.getTime()) ? new Date(0) : date;
};

/** Normalize Firestore logs and calculate duration when it was not persisted. */
export function normalizeReportLogs(
    logs: ReportLog[],
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): ReportRow[] {
    return logs.map((log) => {
        const startTime = asDate(log.startTime);
        const endTime = asDate(log.endTime);
        const durationMinutes = Number.isFinite(log.durationMinutes)
            ? Number(log.durationMinutes)
            : Math.max(
                  0,
                  Math.round((endTime.getTime() - startTime.getTime()) / 60000),
              );
        return {
            id: log.id,
            projectId: log.projectId,
            date: log.dateString || dateKeyInTimeZone(startTime, timezone),
            startTime,
            endTime,
            durationMinutes,
            notes: log.notes || "",
        };
    });
}

export function formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function filterLogsByRange(
    logs: ReportLog[] | ReportRow[],
    from?: Date,
    to?: Date,
): ReportRow[] {
    const rows =
        "date" in (logs[0] || {})
            ? (logs as ReportRow[])
            : normalizeReportLogs(logs as ReportLog[]);
    const start = from ? from.getTime() : -Infinity;
    // Include the complete end date when callers pass a date at midnight.
    const end = to
        ? to.getTime() +
          (to.getHours() === 0 && to.getMinutes() === 0 ? 86400000 - 1 : 0)
        : Infinity;
    return rows.filter(
        (row) =>
            row.startTime.getTime() >= start && row.startTime.getTime() <= end,
    );
}

export function aggregateMinutesByProject(
    rows: ReportRow[],
): Record<string, number> {
    return rows.reduce<Record<string, number>>((result, row) => {
        result[row.projectId] =
            (result[row.projectId] || 0) + row.durationMinutes;
        return result;
    }, {});
}

const csvCell = (value: unknown): string => {
    const text = value == null ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function rowsToCsv(rows: ReportRow[]): string {
    const header = [
        "Project",
        "Date",
        "Start time",
        "End time",
        "Duration (minutes)",
        "Notes",
    ];
    const body = rows.map((row) => [
        row.projectId,
        row.date,
        row.startTime.toISOString(),
        row.endTime.toISOString(),
        row.durationMinutes,
        row.notes,
    ]);
    return [header, ...body]
        .map((line) => line.map(csvCell).join(","))
        .join("\r\n");
}

/** Browser-only convenience for downloading a report. */
export function downloadCsv(filename: string, rows: ReportRow[]): void {
    if (typeof document === "undefined") return;
    const blob = new Blob(["\uFEFF", rowsToCsv(rows)], {
        type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

export type ProjectReport = ReportAggregate & {
    projectId?: string;
    projectName: string;
    targetMinutes?: number;
    from: string;
    to: string;
    generatedAt: Date;
    /** Present for the all-projects overview; ordered by project name. */
    projectBreakdown?: ProjectBreakdown[];
};

export type ReportProjectInput = {
    id: string;
    name: string;
    target?: number;
    targetMinutes?: number;
    active?: boolean;
};

export type ProjectBreakdown = {
    projectId: string;
    projectName: string;
    totalMinutes: number;
    sessionCount: number;
    targetMinutes: number;
    completionPercentage: number | null;
};

/**
 * Creates a stable project overview. Project records are kept even when they
 * have no sessions, while legacy/deleted project IDs in logs remain visible.
 */
export function buildProjectBreakdown(
    rows: ReportRow[],
    projects: ReportProjectInput[],
    targetDays = 1,
): ProjectBreakdown[] {
    const summaries = new Map<string, ProjectBreakdown>();
    for (const project of projects) {
        const targetMinutes = Math.max(
            0,
            (project.targetMinutes ?? project.target ?? 0) *
                Math.max(1, targetDays),
        );
        summaries.set(project.id, {
            projectId: project.id,
            projectName: project.name || "Untitled project",
            totalMinutes: 0,
            sessionCount: 0,
            targetMinutes,
            completionPercentage: targetMinutes ? 0 : null,
        });
    }
    for (const row of rows) {
        const summary = summaries.get(row.projectId) || {
            projectId: row.projectId,
            projectName: row.projectId || "Unassigned project",
            totalMinutes: 0,
            sessionCount: 0,
            targetMinutes: 0,
            completionPercentage: null,
        };
        summary.totalMinutes += row.durationMinutes;
        summary.sessionCount += 1;
        summary.completionPercentage = summary.targetMinutes
            ? Math.round((summary.totalMinutes / summary.targetMinutes) * 100)
            : null;
        summaries.set(row.projectId, summary);
    }
    return [...summaries.values()].sort(
        (a, b) =>
            a.projectName.localeCompare(b.projectName, undefined, {
                sensitivity: "base",
            }) || a.projectId.localeCompare(b.projectId),
    );
}

export function formatMinutes(total: number): string {
    const hours = Math.floor(Math.max(0, total) / 60);
    const minutes = Math.max(0, total) % 60;
    return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function formatReportSummary(report: ProjectReport): string {
    const lines = [
        `Workhours report — ${report.projectName}`,
        `Period: ${report.from} to ${report.to}`,
        `Total tracked: ${formatMinutes(report.totalMinutes)} (${report.sessionCount} session${report.sessionCount === 1 ? "" : "s"})`,
    ];
    if (report.targetMinutes)
        lines.push(
            `Target: ${formatMinutes(report.targetMinutes)} (${Math.round((report.totalMinutes / report.targetMinutes) * 100)}%)`,
        );
    if (report.projectBreakdown?.length) {
        lines.push("", "Project breakdown:");
        report.projectBreakdown.forEach((project) => {
            const target = project.targetMinutes
                ? ` / ${formatMinutes(project.targetMinutes)} target (${project.completionPercentage}%)`
                : "";
            lines.push(
                `• ${project.projectName}: ${formatMinutes(project.totalMinutes)} · ${project.sessionCount} session${project.sessionCount === 1 ? "" : "s"}${target}`,
            );
        });
    }
    lines.push(
        "",
        ...report.rows.map(
            (row) =>
                `${row.date} · ${row.startTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–${row.endTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${formatMinutes(row.durationMinutes)}${row.notes ? ` — ${row.notes}` : ""}`,
        ),
    );
    return lines.join("\n");
}

export function openWhatsApp(report: ProjectReport): void {
    if (typeof window === "undefined") return;
    const url = `https://wa.me/?text=${encodeURIComponent(formatReportSummary(report))}`;
    window.open(url, "_blank", "noopener,noreferrer");
}

export function openEmail(report: ProjectReport): void {
    if (typeof window === "undefined") return;
    const subject = `Workhours report — ${report.projectName} (${report.from} to ${report.to})`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(formatReportSummary(report))}`;
}

export async function copyReportSummary(
    report: ProjectReport,
): Promise<boolean> {
    if (typeof navigator === "undefined" || !navigator.clipboard) return false;
    try {
        await navigator.clipboard.writeText(formatReportSummary(report));
        return true;
    } catch {
        return false;
    }
}

/** Build an actual PDF Blob so it can be previewed, downloaded, or shared as a file. */

const BRAND_LIMITS = {
    displayName: 80,
    designation: 100,
    companyName: 120,
    reportFooter: 240,
    signatureLabel: 80,
} as const;
function cleanBrandText(
    value: unknown,
    field: keyof typeof BRAND_LIMITS,
): string {
    if (typeof value !== "string") return "";
    return value
        .trim()
        .replace(/[<>]/g, "")
        .replace(/\s+/g, " ")
        .slice(0, BRAND_LIMITS[field]);
}
function safeBranding(branding?: ReportBranding) {
    return {
        displayName:
            cleanBrandText(branding?.displayName, "displayName") || "Developer",
        designation: cleanBrandText(branding?.designation, "designation"),
        companyName: cleanBrandText(branding?.companyName, "companyName"),
        reportFooter:
            cleanBrandText(branding?.reportFooter, "reportFooter") ||
            "Workhours Tracking System Verified",
        signatureLabel:
            cleanBrandText(branding?.signatureLabel, "signatureLabel") ||
            "Management Signature",
    };
}
function safePdfText(value: unknown, max = 500): string {
    return typeof value === "string"
        ? value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max)
        : "";
}

export async function createProjectReportPdf(
    report: ProjectReport,
    branding?: ReportBranding,
): Promise<{ blob: Blob; file: File; filename: string }> {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const filename = `workhours-${safeFilename(report.projectName)}-${report.from}-to-${report.to}.pdf`;
    const pageWidth = 210;
    const left = 16;
    const right = 194;
    const purple: [number, number, number] = [55, 48, 145];
    const ink: [number, number, number] = [39, 45, 67];
    const muted: [number, number, number] = [91, 108, 139];
    const brand = safeBranding(branding);
    let y = 18;
    const ensureSpace = (height: number) => {
        if (y + height > 278) {
            pdf.addPage();
            y = 18;
        }
    };
    const text = (
        value: string,
        x: number,
        maxWidth: number,
        size = 9,
        color: [number, number, number] = [45, 42, 66],
    ) => {
        pdf.setFontSize(size);
        pdf.setTextColor(...color);
        const lines = pdf.splitTextToSize(value, maxWidth) as string[];
        ensureSpace(lines.length * (size * 0.48 + 1));
        pdf.text(lines, x, y);
        y += lines.length * (size * 0.48 + 1);
    };
    // Executive header inspired by the provided reference report.
    pdf.setTextColor(...purple);
    pdf.setFontSize(17);
    pdf.setFont("helvetica", "bold");
    pdf.text("WORKHOURS WORK LOG REPORT", left, y);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...muted);
    pdf.text(
        brand.companyName || "Individual & Executive Deliverable Report",
        left,
        y + 7,
    );
    pdf.setFontSize(8);
    pdf.setTextColor(...muted);
    pdf.text(
        `Date Generated: ${report.generatedAt.toLocaleDateString()}`,
        right,
        y - 3,
        { align: "right" },
    );
    pdf.text(`Period: ${periodLabel(report.from, report.to)}`, right, y + 2, {
        align: "right",
    });
    pdf.text(
        brand.designation
            ? `Prepared by: ${brand.designation}`
            : "Recipient: Executive Management",
        right,
        y + 7,
        { align: "right" },
    );
    pdf.setDrawColor(...purple);
    pdf.setLineWidth(0.65);
    pdf.line(left, y + 13, right, y + 13);
    y += 26;
    pdf.setFillColor(241, 244, 249);
    pdf.roundedRect(left, y, right - left, 20, 3, 3, "F");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(...muted);
    pdf.text("PROJECT FOCUS", left + 4, y + 7);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(...ink);
    pdf.text(safePdfText(report.projectName, 100), left + 4, y + 14);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(...muted);
    pdf.text("TOTAL TIME SPENT", right - 4, y + 7, { align: "right" });
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.setTextColor(76, 68, 219);
    pdf.text(formatMinutes(report.totalMinutes), right - 4, y + 15, {
        align: "right",
    });
    y += 31;
    // Executive summary keeps the all-project overview useful when printed.
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10.5);
    pdf.setTextColor(...ink);
    pdf.text("EXECUTIVE SUMMARY", left, y);
    pdf.setDrawColor(205, 211, 222);
    pdf.setLineWidth(0.25);
    pdf.line(left, y + 3, right, y + 3);
    y += 9;
    const completion = report.targetMinutes
        ? Math.round((report.totalMinutes / report.targetMinutes) * 100)
        : null;
    text(
        `Tracked ${formatMinutes(report.totalMinutes)} across ${report.sessionCount} session${report.sessionCount === 1 ? "" : "s"} and ${Object.keys(report.byDay).length} day${Object.keys(report.byDay).length === 1 ? "" : "s"}.${report.targetMinutes ? ` Target ${formatMinutes(report.targetMinutes)} (${completion}% complete).` : ""}`,
        left,
        right - left,
        8.5,
        muted,
    );
    if (report.projectBreakdown?.length) {
        ensureSpace(14 + report.projectBreakdown.length * 6);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8);
        pdf.setTextColor(...ink);
        pdf.text("PROJECT TOTALS", left, y + 2);
        y += 7;
        report.projectBreakdown.forEach((project) => {
            const progress = project.targetMinutes
                ? ` · ${project.completionPercentage}% of ${formatMinutes(project.targetMinutes)}`
                : "";
            text(
                `${safePdfText(project.projectName, 70)} — ${formatMinutes(project.totalMinutes)} · ${project.sessionCount} session${project.sessionCount === 1 ? "" : "s"}${progress}`,
                left + 3,
                right - left - 3,
                7.8,
                muted,
            );
        });
        y += 2;
    }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10.5);
    pdf.setTextColor(...ink);
    pdf.text("COMPLETED DELIVERABLES & NOTES", left, y);
    pdf.setDrawColor(205, 211, 222);
    pdf.setLineWidth(0.25);
    pdf.line(left, y + 3, right, y + 3);
    y += 10;
    pdf.setFillColor(246, 248, 251);
    pdf.rect(left, y - 5, right - left, 9, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.2);
    pdf.setTextColor(...muted);
    pdf.text("DATE", left + 3, y + 1);
    pdf.text("PROJECT", left + 29, y + 1);
    pdf.text("DURATION", left + 57, y + 1);
    pdf.text("ACCOMPLISHMENTS / NOTES", left + 79, y + 1);
    y += 9;
    report.rows.forEach((row, index) => {
        const time = `${row.startTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - ${row.endTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
        const noteLines = pdf.splitTextToSize(
            safePdfText(row.notes, 600) || "No note",
            92,
        ) as string[];
        const height = Math.max(15, noteLines.length * 4.8 + 8);
        ensureSpace(height + 3);
        pdf.setFillColor(
            index % 2 ? 252 : 255,
            index % 2 ? 252 : 255,
            index % 2 ? 254 : 255,
        );
        pdf.rect(left, y - 4, right - left, height, "F");
        pdf.setDrawColor(224, 228, 236);
        pdf.line(left, y - 4 + height, right, y - 4 + height);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(...ink);
        pdf.setFontSize(8);
        pdf.text(row.date, left + 3, y + 1);
        const projectName =
            report.projectBreakdown?.find(
                (project) => project.projectId === row.projectId,
            )?.projectName || report.projectName;
        pdf.text(safePdfText(projectName, 40), left + 29, y + 1);
        pdf.setTextColor(76, 68, 219);
        pdf.setFont("helvetica", "bold");
        pdf.text(formatMinutes(row.durationMinutes), left + 57, y + 1);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(...ink);
        pdf.setFontSize(8);
        pdf.text(noteLines, left + 79, y + 1);
        y += height + 3;
    });
    ensureSpace(34);
    y += 8;
    pdf.setDrawColor(205, 211, 222);
    pdf.line(left, y, right, y);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...ink);
    pdf.text(`Submitted by ${brand.displayName}`, left, y + 12);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...muted);
    if (brand.designation) pdf.text(brand.designation, left, y + 17);
    text(brand.reportFooter, left, 105, 7.3, muted);
    pdf.line(153, y + 14, right, y + 14);
    pdf.setFontSize(7);
    pdf.text(brand.signatureLabel, right, Math.max(y + 19, y + 26), {
        align: "right",
    });
    pdf.setTextColor(130, 126, 146);
    pdf.setFontSize(7);
    pdf.text(`Generated ${report.generatedAt.toLocaleString()}`, left, 288);
    const blob = pdf.output("blob");
    return {
        blob,
        file: new File([blob], filename, { type: "application/pdf" }),
        filename,
    };
}

export async function downloadProjectReportPdf(
    report: ProjectReport,
    branding?: ReportBranding,
): Promise<void> {
    const { blob, filename } = await createProjectReportPdf(report, branding);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareProjectReportPdf(
    report: ProjectReport,
    branding?: ReportBranding,
): Promise<"shared" | "downloaded"> {
    const { file, blob, filename } = await createProjectReportPdf(
        report,
        branding,
    );
    if (
        navigator.share &&
        (!navigator.canShare || navigator.canShare({ files: [file] }))
    ) {
        await navigator.share({
            title: `Workhours report - ${report.projectName}`,
            text: formatReportSummary(report),
            files: [file],
        });
        return "shared";
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return "downloaded";
}

function safeFilename(value: string): string {
    return (
        value
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "") || "report"
    );
}
function periodLabel(from: string, to: string): string {
    return from === to ? from : `${from} - ${to}`;
}
