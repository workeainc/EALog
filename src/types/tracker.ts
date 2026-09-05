import type { Timestamp } from "firebase/firestore";

/** Firestore document IDs are deliberately open-ended: users can add projects. */
export type ProjectId = string;

export interface Project {
    id: ProjectId;
    name: string;
    targetMinutes: number;
    active: boolean;
    color: string;
    sortOrder: number;
}

/**
 * Creates a readable Firestore-safe project id.  Existing ids are considered
 * case-insensitively, so "Client Portal" cannot silently overwrite a project
 * named "client-portal".  A numeric suffix keeps generated ids collision safe.
 */
export function createProjectId(
    name: string,
    existingIds: Iterable<string> = [],
): ProjectId {
    const base = name
        .trim()
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
    if (!base)
        throw new Error(
            "Enter a project name containing at least one letter or number.",
        );
    const known = new Set(Array.from(existingIds, (id) => id.toLowerCase()));
    if (!known.has(base)) return base;
    let suffix = 2;
    while (known.has(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
}

export interface WorkLog {
    id: string;
    projectId: ProjectId;
    startTime: Timestamp;
    endTime: Timestamp;
    durationMinutes: number;
    notes: string;
    /** Original long-form detail retained alongside the concise report summary. */
    details?: string;
    /** Local work-day key, e.g. 2026-09-04. */
    dateString: string;
    createdAt?: Timestamp;
}

export interface ActiveSession {
    projectId: ProjectId;
    /** Original session start, retained through pauses for reporting. */
    startTime: Timestamp;
    /** Beginning of the currently-running segment. Legacy sessions use startTime. */
    segmentStartedAt?: Timestamp;
    /** Accumulated active seconds from completed segments. */
    accumulatedSeconds?: number;
    /** Present only while explicitly paused. */
    pausedAt?: Timestamp;
    /** Guards against legacy clients attempting automatic pauses. */
    pauseReason?: "manual";
    /** Local work-day key captured when the session begins. */
    dateString: string;
}

/** Safe, plain-text values that may appear on a generated work report. */
export interface ReportBranding {
    displayName?: string;
    designation?: string;
    companyName?: string;
    reportFooter?: string;
    signatureLabel?: string;
    /** Optional HTTPS asset for a future report header; never interpreted as HTML. */
    logoUrl?: string;
}

export interface TrackerProfile extends ReportBranding {
    timezone: string;
    dailyTargetMinutes: number;
}

export type WorkLogInput = Omit<WorkLog, "id" | "createdAt">;

export type ReportPeriodType = "today" | "week" | "month" | "custom";

/** Inclusive local-calendar range used by dashboard and reports. */
export interface ReportFilters {
    period: ReportPeriodType;
    from: string;
    to: string;
    /** IANA timezone used to derive local date keys (defaults to browser timezone). */
    timezone: string;
    projectId?: ProjectId | "all";
}
