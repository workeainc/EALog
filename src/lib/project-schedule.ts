import type {
  Project,
  ProjectScheduleEntry,
  ProjectStatus,
} from "../types/tracker";

export const localDateKey = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const nextDateKey = (date = new Date()): string => {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return localDateKey(next);
};

const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const isStatus = (value: unknown): value is ProjectStatus =>
  ["planned", "active", "on_hold", "completed", "archived"].includes(
    String(value),
  );

/** Sort and validate schedule snapshots, retaining the newest entry per day. */
export const normalizeProjectSchedule = (
  entries: ProjectScheduleEntry[] | undefined,
): ProjectScheduleEntry[] => {
  const byDate = new Map<string, ProjectScheduleEntry>();
  for (const entry of entries || []) {
    if (
      !isDateKey(entry.effectiveDate) ||
      !Number.isFinite(entry.targetMinutes) ||
      entry.targetMinutes < 1 ||
      !isStatus(entry.status)
    )
      continue;
    byDate.set(entry.effectiveDate, {
      effectiveDate: entry.effectiveDate,
      targetMinutes: Math.round(entry.targetMinutes),
      status: entry.status,
    });
  }
  return [...byDate.values()].sort((a, b) =>
    a.effectiveDate.localeCompare(b.effectiveDate),
  );
};

/**
 * Add a future effective change without rewriting past daily targets/statuses.
 * A legacy project receives a baseline snapshot at its start/first-work date.
 */
export const scheduleProjectChange = (
  project: Project,
  change: {
    effectiveDate: string;
    targetMinutes: number;
    status: ProjectStatus;
    baselineDate: string;
  },
): ProjectScheduleEntry[] => {
  const existing = normalizeProjectSchedule(project.targetSchedule);
  const baseline =
    existing[0]?.effectiveDate ||
    (isDateKey(project.startDate || "")
      ? (project.startDate as string)
      : change.baselineDate);
  const currentStatus =
    project.status || (project.active ? "active" : "archived");
  const next = existing.length
    ? existing
    : [
        {
          effectiveDate: baseline,
          targetMinutes: project.targetMinutes,
          status: currentStatus,
        },
      ];
  next.push({
    effectiveDate: change.effectiveDate,
    targetMinutes: Math.max(1, Math.round(change.targetMinutes)),
    status: change.status,
  });
  return normalizeProjectSchedule(next);
};

const planForDay = (schedule: ProjectScheduleEntry[], day: string) =>
  schedule.reduce<ProjectScheduleEntry | null>(
    (current, entry) => (entry.effectiveDate <= day ? entry : current),
    null,
  );

export type MonthPlan = {
  totalTargetMinutes: number;
  expectedMinutes: number;
  expectedTargetDays: number;
  activeTargetDays: number;
  onHoldDays: number;
};

/** Calculate a month from dated plan snapshots; only active days carry a target. */
export const getMonthPlan = (
  project: Project,
  now = new Date(),
  baselineDate = localDateKey(now),
): MonthPlan => {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  const schedule = normalizeProjectSchedule(project.targetSchedule);
  const entries = schedule.length
    ? schedule
    : [
        {
          effectiveDate: baselineDate,
          targetMinutes: project.targetMinutes,
          status: project.status || (project.active ? "active" : "archived"),
        },
      ];
  let totalTargetMinutes = 0;
  let expectedMinutes = 0;
  let expectedTargetDays = 0;
  let activeTargetDays = 0;
  let onHoldDays = 0;
  const today = localDateKey(now);
  for (let day = 0; day < daysInMonth; day += 1) {
    const current = new Date(monthStart);
    current.setDate(day + 1);
    const dateKey = localDateKey(current);
    const plan = planForDay(entries, dateKey);
    if (plan?.status === "active") {
      totalTargetMinutes += plan.targetMinutes;
      activeTargetDays += 1;
      if (dateKey <= today) {
        expectedMinutes += plan.targetMinutes;
        expectedTargetDays += 1;
      }
    } else if (plan?.status === "on_hold") {
      onHoldDays += 1;
    }
  }
  return {
    totalTargetMinutes,
    expectedMinutes,
    expectedTargetDays,
    activeTargetDays,
    onHoldDays,
  };
};
