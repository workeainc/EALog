import {
  Timestamp,
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  enqueue,
  listForUser,
  listReady,
  markFailed,
  markSent,
  retry,
  type OutboxCommand,
} from "./offline-outbox";
import { toDateString } from "./date";
import {
  createProjectId,
  type ActiveSession,
  type Project,
  type ProjectId,
  type ProjectScheduleEntry,
  type ProjectStatus,
  type TrackerProfile,
  type WorkLog,
} from "../types/tracker";

const PROJECT_COLORS = [
  "#7357ef",
  "#e26f45",
  "#2ca876",
  "#3488e8",
  "#dc4f8c",
  "#c89b3c",
  "#0ea5e9",
  "#8b5cf6",
];
const projectStatuses = [
  "planned",
  "active",
  "on_hold",
  "completed",
  "archived",
] as const;
const isDateKey = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const cleanProjectSchedule = (value: unknown): ProjectScheduleEntry[] => {
  if (!Array.isArray(value)) return [];
  const byDate = new Map<string, ProjectScheduleEntry>();
  for (const entry of value) {
    if (
      !entry ||
      !isDateKey(entry.effectiveDate) ||
      !Number.isFinite(entry.targetMinutes) ||
      entry.targetMinutes < 1 ||
      !projectStatuses.includes(entry.status)
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
const userRef = (uid: string) => doc(db, "users", uid);
const projectsRef = (uid: string) => collection(userRef(uid), "projects");
const logsRef = (uid: string) => collection(userRef(uid), "work_logs");
const activeSessionRef = (uid: string) =>
  doc(userRef(uid), "active_session", "current");
const profileRef = (uid: string) => doc(userRef(uid), "settings", "profile");

const PROFILE_TEXT_LIMITS = {
  displayName: 80,
  designation: 100,
  companyName: 120,
  reportFooter: 240,
  signatureLabel: 80,
} as const;

type EditableProfile = Pick<
  TrackerProfile,
  | "displayName"
  | "designation"
  | "companyName"
  | "reportFooter"
  | "signatureLabel"
  | "logoUrl"
  | "timezone"
>;

function cleanProfileText(
  value: unknown,
  field: keyof typeof PROFILE_TEXT_LIMITS,
): string {
  if (typeof value !== "string") return "";
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length > PROFILE_TEXT_LIMITS[field])
    throw new Error(
      `${field} must be ${PROFILE_TEXT_LIMITS[field]} characters or fewer.`,
    );
  if (/[<>]/.test(text))
    throw new Error(`${field} cannot contain HTML-like characters.`);
  return text;
}

function cleanLogoUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") throw new Error();
    if (url.toString().length > 500) throw new Error();
    return url.toString();
  } catch {
    throw new Error("Logo URL must be a valid HTTPS URL.");
  }
}

function readProfile(
  value: Record<string, unknown> | undefined,
): TrackerProfile {
  const timezone =
    typeof value?.timezone === "string" && value.timezone
      ? value.timezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dailyTargetMinutes = Number.isFinite(value?.dailyTargetMinutes)
    ? Math.max(1, Math.round(Number(value?.dailyTargetMinutes)))
    : 540;
  return {
    timezone,
    dailyTargetMinutes,
    displayName: cleanProfileText(value?.displayName, "displayName"),
    designation: cleanProfileText(value?.designation, "designation"),
    companyName: cleanProfileText(value?.companyName, "companyName"),
    reportFooter: cleanProfileText(value?.reportFooter, "reportFooter"),
    signatureLabel: cleanProfileText(value?.signatureLabel, "signatureLabel"),
    logoUrl: cleanLogoUrl(value?.logoUrl),
  };
}

type StoredSession = {
  projectId: ProjectId;
  startTime: number;
  segmentStartedAt: number;
  accumulatedSeconds: number;
  pausedAt?: number;
  dateString: string;
  revision: number;
};
type StoredLog = {
  id: string;
  projectId: ProjectId;
  startTime: number;
  endTime: number;
  durationMinutes: number;
  notes: string;
  details?: string;
  dateString: string;
  createdAt: number;
};
type TimerPayload = {
  baseRevision: number;
  session?: StoredSession;
  log?: StoredLog;
};
type LocalState = { session: ActiveSession | null; revision: number };
export type SyncState = {
  online: boolean;
  pending: number;
  failed: number;
  conflicts: number;
  syncing: boolean;
  fromCache: boolean;
  error?: string;
};
const local = new Map<string, LocalState>();
const state = new Map<string, SyncState>();
const syncListeners = new Map<string, Set<(value: SyncState) => void>>();
const activeListeners = new Map<
  string,
  Set<(value: ActiveSession | null) => void>
>();
const flushing = new Set<string>();
const online = () =>
  typeof navigator === "undefined" || navigator.onLine !== false;
const opId = (kind: string) =>
  `${kind}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

function currentState(uid: string): SyncState {
  return (
    state.get(uid) ?? {
      online: online(),
      pending: 0,
      failed: 0,
      conflicts: 0,
      syncing: false,
      fromCache: false,
    }
  );
}
function publishState(uid: string, patch: Partial<SyncState> = {}) {
  const next = { ...currentState(uid), online: online(), ...patch };
  state.set(uid, next);
  syncListeners.get(uid)?.forEach((listener) => listener(next));
}
function publishActive(uid: string) {
  activeListeners
    .get(uid)
    ?.forEach((listener) => listener(local.get(uid)?.session ?? null));
}
function withRevision(session: ActiveSession, revision: number): ActiveSession {
  return Object.assign(session, { revision }) as ActiveSession;
}
function revisionOf(value: unknown): number {
  const candidate = value as { revision?: unknown };
  return Number.isSafeInteger(candidate?.revision)
    ? Number(candidate.revision)
    : 0;
}
function serializeSession(
  session: ActiveSession,
  revision: number,
): StoredSession {
  return {
    projectId: session.projectId,
    startTime: session.startTime.toMillis(),
    segmentStartedAt: (
      session.segmentStartedAt ?? session.startTime
    ).toMillis(),
    accumulatedSeconds: Math.max(0, Number(session.accumulatedSeconds) || 0),
    pausedAt: session.pausedAt?.toMillis(),
    dateString: session.dateString,
    revision,
  };
}
function deserializeSession(value: StoredSession): ActiveSession {
  return withRevision(
    {
      projectId: value.projectId,
      startTime: Timestamp.fromMillis(value.startTime),
      segmentStartedAt: Timestamp.fromMillis(value.segmentStartedAt),
      accumulatedSeconds: value.accumulatedSeconds,
      ...(value.pausedAt
        ? {
            pausedAt: Timestamp.fromMillis(value.pausedAt),
            pauseReason: "manual" as const,
          }
        : {}),
      dateString: value.dateString,
    },
    value.revision,
  );
}
function elapsed(session: ActiveSession, now: Date): number {
  const accumulated = Math.max(0, Number(session.accumulatedSeconds) || 0);
  if (session.pausedAt) return accumulated;
  return (
    accumulated +
    Math.max(
      0,
      Math.floor(
        (now.getTime() -
          (session.segmentStartedAt ?? session.startTime).toMillis()) /
          1000,
      ),
    )
  );
}
function isConflict(error: unknown) {
  return /conflict|revision|already exists|active session/i.test(
    error instanceof Error ? error.message : String(error),
  );
}
function isNetwork(error: unknown) {
  return /network|offline|unavailable|deadline/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

export async function seedUserTracker(uid: string): Promise<void> {
  const profile = await getDoc(profileRef(uid));
  const projectSnapshot = await getDocs(query(projectsRef(uid), limit(1)));
  if (profile.exists() && !projectSnapshot.empty) return;
  const batch = writeBatch(db);
  if (!profile.exists())
    batch.set(profileRef(uid), {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dailyTargetMinutes: 540,
    } satisfies TrackerProfile);
  await batch.commit();
}
/** Private per-user profile. Firestore rules only permit the owner to read it. */
export async function getProfile(uid: string): Promise<TrackerProfile> {
  const snapshot = await getDoc(profileRef(uid));
  return readProfile(snapshot.exists() ? snapshot.data() : undefined);
}

/** Stores only bounded plain text and an optional HTTPS logo URL. */
export async function updateProfile(
  uid: string,
  input: Partial<EditableProfile>,
): Promise<TrackerProfile> {
  const current = await getProfile(uid);
  const next: TrackerProfile = {
    ...current,
    ...(input.timezone ? { timezone: input.timezone } : {}),
    displayName: cleanProfileText(
      input.displayName ?? current.displayName,
      "displayName",
    ),
    designation: cleanProfileText(
      input.designation ?? current.designation,
      "designation",
    ),
    companyName: cleanProfileText(
      input.companyName ?? current.companyName,
      "companyName",
    ),
    reportFooter: cleanProfileText(
      input.reportFooter ?? current.reportFooter,
      "reportFooter",
    ),
    signatureLabel: cleanProfileText(
      input.signatureLabel ?? current.signatureLabel,
      "signatureLabel",
    ),
    logoUrl: cleanLogoUrl(input.logoUrl ?? current.logoUrl),
  };
  await setDoc(profileRef(uid), next, { merge: true });
  return next;
}
export function subscribeToProjects(
  uid: string,
  callback: (projects: Project[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(projectsRef(uid), orderBy("sortOrder")),
    (snapshot) => {
      const projects = snapshot.docs.map((item) => {
        const value = item.data();
        if (
          typeof value.name !== "string" ||
          !value.name.trim() ||
          !Number.isFinite(value.targetMinutes)
        ) {
          throw new Error(`Project "${item.id}" has invalid configuration.`);
        }
        return {
          id: item.id,
          name: value.name.trim(),
          targetMinutes: Math.max(1, Math.round(value.targetMinutes)),
          active: value.active !== false,
          color:
            typeof value.color === "string" && value.color
              ? value.color
              : PROJECT_COLORS[0],
          sortOrder: Number.isFinite(value.sortOrder)
            ? value.sortOrder
            : Number.MAX_SAFE_INTEGER,
          description:
            typeof value.description === "string"
              ? value.description.slice(0, 1000)
              : "",
          clientName:
            typeof value.clientName === "string"
              ? value.clientName.slice(0, 120)
              : "",
          status: ([
            "planned",
            "active",
            "on_hold",
            "completed",
            "archived",
          ].includes(value.status)
            ? value.status
            : value.active === false
              ? "archived"
              : "active") as ProjectStatus,
          priority: (["low", "medium", "high"].includes(value.priority)
            ? value.priority
            : "medium") as Project["priority"],
          createdDate: isDateKey(value.createdDate) ? value.createdDate : "",
          startDate: typeof value.startDate === "string" ? value.startDate : "",
          deadlineDate:
            typeof value.deadlineDate === "string" ? value.deadlineDate : "",
          referenceUrl:
            typeof value.referenceUrl === "string" ? value.referenceUrl : "",
          targetSchedule: cleanProjectSchedule(value.targetSchedule),
        } satisfies Project;
      });
      callback(projects);
    },
  );
}
export async function createProject(
  uid: string,
  input: { name: string; targetMinutes: number },
): Promise<Project> {
  const name = input.name.trim();
  const targetMinutes = Math.round(Number(input.targetMinutes));
  if (!name) throw new Error("Project name is required.");
  if (!Number.isFinite(targetMinutes) || targetMinutes < 1)
    throw new Error("Daily target must be at least 1 minute.");
  const snapshot = await getDocs(query(projectsRef(uid)));
  const ids = snapshot.docs.map((entry) => entry.id);
  const id = createProjectId(name, ids);
  const sortOrder =
    snapshot.docs.reduce(
      (highest, entry) =>
        Number.isFinite(entry.data().sortOrder)
          ? Math.max(highest, entry.data().sortOrder)
          : highest,
      -1,
    ) + 1;
  const project: Project = {
    id,
    name,
    targetMinutes,
    active: true,
    color: PROJECT_COLORS[sortOrder % PROJECT_COLORS.length],
    sortOrder,
    createdDate: toDateString(new Date()),
    targetSchedule: [
      {
        effectiveDate: toDateString(new Date()),
        targetMinutes,
        status: "active",
      },
    ],
  };
  await setDoc(doc(projectsRef(uid), id), { ...project, id: undefined });
  return project;
}
export function subscribeToActiveSession(
  uid: string,
  callback: (session: ActiveSession | null) => void,
): Unsubscribe {
  const listeners = activeListeners.get(uid) ?? new Set();
  listeners.add(callback);
  activeListeners.set(uid, listeners);
  callback(local.get(uid)?.session ?? null);
  const off = onSnapshot(
    activeSessionRef(uid),
    { includeMetadataChanges: true },
    (snapshot) => {
      publishState(uid, { fromCache: snapshot.metadata.fromCache });
      // Keep an optimistic queued mutation visible until it has been reconciled.
      if (!local.has(uid) || !currentState(uid).pending) {
        local.set(uid, {
          session: snapshot.exists()
            ? withRevision(
                snapshot.data() as ActiveSession,
                revisionOf(snapshot.data()),
              )
            : null,
          revision: snapshot.exists() ? revisionOf(snapshot.data()) : 0,
        });
        publishActive(uid);
      }
    },
  );
  return () => {
    off();
    listeners.delete(callback);
    if (!listeners.size) activeListeners.delete(uid);
  };
}
export function subscribeToSyncState(
  uid: string,
  callback: (value: SyncState) => void,
): Unsubscribe {
  const listeners = syncListeners.get(uid) ?? new Set();
  listeners.add(callback);
  syncListeners.set(uid, listeners);
  callback(currentState(uid));
  void refreshState(uid);
  return () => {
    listeners.delete(callback);
    if (!listeners.size) syncListeners.delete(uid);
  };
}
async function refreshState(uid: string) {
  try {
    const commands = await listForUser(uid);
    publishState(uid, {
      pending: commands.filter(
        (c) => c.status === "pending" || c.status === "failed",
      ).length,
      failed: commands.filter((c) => c.status === "failed").length,
      conflicts: commands.filter((c) => c.status === "conflict").length,
    });
  } catch (error) {
    publishState(uid, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function applyCommand(
  uid: string,
  command: OutboxCommand,
): Promise<void> {
  const payload = command.payload as TimerPayload;
  await runTransaction(db, async (tx) => {
    const ref = activeSessionRef(uid);
    const snapshot = await tx.get(ref);
    const remote = snapshot.exists()
      ? (snapshot.data() as ActiveSession)
      : null;
    const remoteRevision = remote ? revisionOf(remote) : 0;
    if (command.type === "start") {
      if (remote)
        throw new Error("Conflict: another active session already exists.");
      if (!payload.session) throw new Error("Invalid start command.");
      const next = deserializeSession(payload.session);
      tx.set(ref, { ...next, revision: 1 });
      return;
    }
    if (command.type === "stop") {
      if (!payload.log) throw new Error("Invalid stop command.");
      const logRef = doc(logsRef(uid), payload.log.id);
      const existingLog = await tx.get(logRef);
      if (existingLog.exists() && !remote) return; // idempotent replay after commit.
      if (!remote)
        throw new Error("Conflict: remote session no longer exists.");
      if (remoteRevision !== payload.baseRevision)
        throw new Error("Conflict: remote session changed on another device.");
      const log = payload.log;
      tx.set(logRef, {
        ...log,
        startTime: Timestamp.fromMillis(log.startTime),
        endTime: Timestamp.fromMillis(log.endTime),
        createdAt: Timestamp.fromMillis(log.createdAt),
      });
      tx.delete(ref);
      return;
    }
    if (!remote) throw new Error("Conflict: remote session no longer exists.");
    if (remoteRevision !== payload.baseRevision)
      throw new Error("Conflict: remote session changed on another device.");
    if (!payload.session) throw new Error("Invalid timer command.");
    const next = deserializeSession(payload.session);
    tx.update(ref, {
      ...next,
      revision: remoteRevision + 1,
      pausedAt: next.pausedAt ?? deleteField(),
      pauseReason: next.pausedAt ? "manual" : deleteField(),
    });
  });
}
async function flush(uid: string) {
  if (flushing.has(uid) || !online()) return;
  flushing.add(uid);
  publishState(uid, { syncing: true, error: undefined });
  try {
    for (const command of await listReady(uid)) {
      if (!online()) break;
      try {
        await applyCommand(uid, command);
        await markSent(command.operationId);
      } catch (error) {
        await markFailed(
          command.operationId,
          error instanceof Error ? error.message : String(error),
          isConflict(error),
        );
        if (isNetwork(error)) break;
        if (isConflict(error)) break;
      }
    }
  } finally {
    flushing.delete(uid);
    await refreshState(uid);
    publishState(uid, { syncing: false });
  }
}
function enqueueMutation(
  uid: string,
  type: OutboxCommand["type"],
  payload: TimerPayload,
  createdAt: number,
) {
  const command = {
    operationId: opId(type),
    uid,
    entityId: "current",
    type,
    payload,
    createdAt,
  };
  return enqueue(command).then(async () => {
    await refreshState(uid);
    void flush(uid);
    return command.operationId;
  });
}
export function startSync(uid: string): Unsubscribe {
  const trigger = () => void flush(uid);
  window.addEventListener("online", trigger);
  window.addEventListener("visibilitychange", trigger);
  void refreshState(uid).then(trigger);
  return () => {
    window.removeEventListener("online", trigger);
    window.removeEventListener("visibilitychange", trigger);
  };
}
export async function retrySync(uid: string) {
  for (const command of await listForUser(uid))
    if (command.status === "failed") await retry(command.operationId);
  await refreshState(uid);
  await flush(uid);
}

export async function startSession(
  uid: string,
  projectId: ProjectId,
  now = new Date(),
): Promise<ActiveSession> {
  const existing = local.get(uid);
  if (existing?.session)
    throw new Error(
      "An active session already exists. Stop it before starting another.",
    );
  const session = withRevision(
    {
      projectId,
      startTime: Timestamp.fromDate(now),
      segmentStartedAt: Timestamp.fromDate(now),
      accumulatedSeconds: 0,
      dateString: toDateString(now),
    },
    1,
  );
  local.set(uid, { session, revision: 1 });
  publishActive(uid);
  await enqueueMutation(
    uid,
    "start",
    { baseRevision: 0, session: serializeSession(session, 1) },
    now.getTime(),
  );
  return session;
}
export async function pauseSession(
  uid: string,
  now = new Date(),
): Promise<ActiveSession> {
  const current = local.get(uid);
  if (!current?.session)
    throw new Error("There is no active session to pause.");
  if (current.session.pausedAt) return current.session;
  const session = withRevision(
    {
      ...current.session,
      accumulatedSeconds: elapsed(current.session, now),
      pausedAt: Timestamp.fromDate(now),
      pauseReason: "manual",
    },
    current.revision + 1,
  );
  local.set(uid, { session, revision: current.revision + 1 });
  publishActive(uid);
  await enqueueMutation(
    uid,
    "pause",
    {
      baseRevision: current.revision,
      session: serializeSession(session, current.revision + 1),
    },
    now.getTime(),
  );
  return session;
}
export async function resumeSession(
  uid: string,
  now = new Date(),
): Promise<ActiveSession> {
  const current = local.get(uid);
  if (!current?.session)
    throw new Error("There is no paused session to resume.");
  if (!current.session.pausedAt) return current.session;
  const session = withRevision(
    {
      ...current.session,
      segmentStartedAt: Timestamp.fromDate(now),
      pausedAt: undefined,
      pauseReason: undefined,
    },
    current.revision + 1,
  );
  local.set(uid, { session, revision: current.revision + 1 });
  publishActive(uid);
  await enqueueMutation(
    uid,
    "resume",
    {
      baseRevision: current.revision,
      session: serializeSession(session, current.revision + 1),
    },
    now.getTime(),
  );
  return session;
}
export async function stopSession(
  uid: string,
  notes: string,
  now = new Date(),
  details?: string,
): Promise<WorkLog> {
  const cleanNotes = notes.trim();
  if (!cleanNotes) throw new Error("A session note is required.");
  const current = local.get(uid);
  if (!current?.session) throw new Error("There is no active session to stop.");
  const operationId = opId("stop");
  const log: StoredLog = {
    id: operationId,
    projectId: current.session.projectId,
    startTime: current.session.startTime.toMillis(),
    endTime: now.getTime(),
    durationMinutes: Math.max(
      1,
      Math.round(elapsed(current.session, now) / 60),
    ),
    notes: cleanNotes,
    details: details?.trim() || undefined,
    dateString: current.session.dateString,
    createdAt: now.getTime(),
  };
  local.set(uid, { session: null, revision: current.revision });
  publishActive(uid);
  const command = {
    operationId,
    uid,
    entityId: "current",
    type: "stop" as const,
    payload: { baseRevision: current.revision, log },
    createdAt: now.getTime(),
  };
  await enqueue(command);
  await refreshState(uid);
  void flush(uid);
  return {
    ...log,
    startTime: Timestamp.fromMillis(log.startTime),
    endTime: Timestamp.fromMillis(log.endTime),
    createdAt: Timestamp.fromMillis(log.createdAt),
  };
}

export async function getWorkLogs(
  uid: string,
  startDate: string,
  endDate: string,
): Promise<WorkLog[]> {
  if (!startDate || !endDate) return [];
  const snapshot = await getDocs(
    query(
      logsRef(uid),
      where("dateString", ">=", startDate),
      where("dateString", "<=", endDate),
      orderBy("dateString", "asc"),
      orderBy("startTime", "desc"),
    ),
  );
  return snapshot.docs.map(
    (item) => ({ id: item.id, ...item.data() }) as WorkLog,
  );
}
export async function getRecentWorkLogs(
  uid: string,
  maxResults = 100,
): Promise<WorkLog[]> {
  const snapshot = await getDocs(
    query(logsRef(uid), orderBy("startTime", "desc"), limit(maxResults)),
  );
  return snapshot.docs.map(
    (item) => ({ id: item.id, ...item.data() }) as WorkLog,
  );
}

/** Update an owned completed work log. Timer/created timestamps are immutable. */
export async function updateWorkLog(
  uid: string,
  logId: string,
  input: Partial<
    Pick<
      WorkLog,
      | "projectId"
      | "notes"
      | "details"
      | "durationMinutes"
      | "startTime"
      | "endTime"
      | "dateString"
    >
  >,
): Promise<WorkLog> {
  const id = logId.trim();
  if (!id) throw new Error("A session id is required.");
  const ref = doc(logsRef(uid), id);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error("This session no longer exists.");
  const existing = { id, ...snapshot.data() } as WorkLog;
  const projectId = input.projectId ?? existing.projectId;
  const notes =
    typeof input.notes === "string" ? input.notes.trim() : existing.notes;
  if (!projectId) throw new Error("Select a project.");
  if (!notes) throw new Error("A session note is required.");
  const durationMinutes = Math.max(
    1,
    Math.round(Number(input.durationMinutes ?? existing.durationMinutes)),
  );
  if (!Number.isFinite(durationMinutes))
    throw new Error("Duration must be valid.");
  const startTime = input.startTime ?? existing.startTime;
  const endTime = input.endTime ?? existing.endTime;
  if (endTime.toMillis() < startTime.toMillis())
    throw new Error("End time must be after start time.");
  const data: Record<string, unknown> = {
    projectId,
    notes,
    durationMinutes,
    startTime,
    endTime,
    dateString: input.dateString ?? existing.dateString,
  };
  if (input.details !== undefined)
    data.details = input.details?.trim() || deleteField();
  await setDoc(ref, data, { merge: true });
  return { ...existing, ...data } as WorkLog;
}

/** Delete an owned completed work log. Firestore rules enforce ownership. */
export async function deleteWorkLog(uid: string, logId: string): Promise<void> {
  const id = logId.trim();
  if (!id) throw new Error("A session id is required.");
  const ref = doc(logsRef(uid), id);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) return;
  await deleteDoc(ref);
}
export async function updateProject(
  uid: string,
  project: Project,
): Promise<void> {
  const { id, ...data } = project;
  const status = data.status || (data.active ? "active" : "archived");
  await setDoc(
    doc(projectsRef(uid), id),
    { ...data, status, active: status === "active" },
    { merge: true },
  );
}

/** Archive is reversible and preserves every historic work log. */
export async function setProjectStatus(
  uid: string,
  project: Project,
  status: ProjectStatus,
): Promise<void> {
  await setDoc(
    doc(projectsRef(uid), project.id),
    { status, active: status === "active" },
    { merge: true },
  );
}

export async function reorderProjects(
  uid: string,
  orderedIds: string[],
): Promise<void> {
  const batch = writeBatch(db);
  orderedIds.forEach((id, sortOrder) =>
    batch.set(doc(projectsRef(uid), id), { sortOrder }, { merge: true }),
  );
  await batch.commit();
}
