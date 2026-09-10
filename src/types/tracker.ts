import type { Timestamp } from "firebase/firestore";

/** Firestore document IDs are deliberately open-ended: users can add projects. */
export type ProjectId = string;
export type ProjectStatus =
  "planned" | "active" | "on_hold" | "completed" | "archived";
export type ProjectPriority = "low" | "medium" | "high";
export type TodoStatus = "open" | "completed";
export type TodoPriority = "low" | "medium" | "high";
export type NoteType = "important" | "message" | "information" | "status" | "decision";
export type NoteState = "active" | "archived";
export type RoutineCategory = "spiritual" | "health" | "break" | "personal";
export type RoutineStatus = "planned" | "completed" | "skipped" | "snoozed" | "missed";
export type AppMode = "workday" | "break" | "vacation";
/** A user-wide work/life mode. Dates are local calendar keys to avoid timezone drift. */
export interface AppModeState {
  mode: AppMode;
  breakStartedAt?: string;
  breakExpectedEndAt?: string | null;
  breakReason?: string;
  vacationStartDate?: string;
  vacationEndDate?: string;
  vacationReason?: string;
  relaxedDiscipline?: boolean;
  updatedAt?: Timestamp | null;
}
export interface Routine { id: string; name: string; category: RoutineCategory; priority: "critical" | "high" | "normal"; time: string; durationMinutes: number; windowMinutes: number; repeatDays: number[]; reminderMinutes: number; sessionBehavior: "warn" | "pause"; strict: boolean; active: boolean; /** Optional inclusive plan range; omitted routines stay evergreen. */ effectiveDate?: string; endDate?: string; createdAt: Timestamp | null; updatedAt: Timestamp | null; }
export interface RoutineLog { id: string; routineId: string; dateString: string; status: RoutineStatus; completedAt: Timestamp | null; skippedReason?: string; snoozedUntil?: string; }

export interface Todo {
  id: string;
  title: string;
  projectId: ProjectId | null;
  plannedDateString: string;
  status: TodoStatus;
  priority: TodoPriority;
  sortOrder: number;
  completedAt: Timestamp | null;
  completedDateString: string | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  lastMutationId: string;
  /** Optional provenance when a task is created from selected Note context. */
  sourceNoteId?: string | null;
  sourceTextHash?: string | null;
  sourceNoteTitle?: string | null;
  /** Local-only indicator supplied by the Firestore snapshot. */
  pendingSync?: boolean;
}

/** Project memory, deliberately separate from a dated actionable task. */
export interface ProjectNote {
  id: string;
  projectId: ProjectId;
  title: string;
  content: string;
  type: NoteType;
  pinned: boolean;
  state: NoteState;
  convertedTaskId: string | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  pendingSync?: boolean;
}

/** A dated snapshot of a project's work plan. Values apply from the given day. */
export interface ProjectScheduleEntry {
  effectiveDate: string;
  targetMinutes: number;
  status: ProjectStatus;
}

export interface Project {
  id: ProjectId;
  name: string;
  targetMinutes: number;
  active: boolean;
  color: string;
  sortOrder: number;
  description?: string;
  clientName?: string;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  /** Local calendar day when the project was created. */
  createdDate?: string;
  startDate?: string;
  deadlineDate?: string;
  referenceUrl?: string;
  /** Historical daily-target/status plan used for accurate monthly pacing. */
  targetSchedule?: ProjectScheduleEntry[];
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
