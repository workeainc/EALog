import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  Bell,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Clock3,
  Download,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  Menu,
  Play,
  Plus,
  Pencil,
  Settings,
  Square,
  Timer,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import ReportsView from "./components/ReportsView";
import ProfileSettings from "./components/ProfileSettings";
import ProjectsView from "./components/ProjectsView";
import TodosView from "./components/TodosView";
import { summarizeNote } from "./lib/summarize";
import {
  aggregateReportRows,
  downloadCsv,
  getReportDateRange,
  normalizeReportLogs,
  type ReportLog,
} from "./lib/reports";
import {
  createProjectId,
  type Project,
  type Todo,
  type TodoPriority,
  type TrackerProfile,
} from "./types/tracker";
import {
  localDateKey,
  nextDateKey,
  scheduleProjectChange,
} from "./lib/project-schedule";
import { buildTodoDayStats, mergeTodoStreams } from "./lib/todos";

const DEMO_PROJECTS: Project[] = [
  {
    id: "alphapuls",
    name: "Alphapuls",
    targetMinutes: 240,
    active: true,
    color: "#7357ef",
    sortOrder: 0,
  },
  {
    id: "autoledger",
    name: "AutoLedger",
    targetMinutes: 60,
    active: true,
    color: "#e26f45",
    sortOrder: 1,
  },
  {
    id: "edubangla",
    name: "EduBangla",
    targetMinutes: 60,
    active: true,
    color: "#2ca876",
    sortOrder: 2,
  },
  {
    id: "streamedocs",
    name: "Streamedocs",
    targetMinutes: 60,
    active: true,
    color: "#3488e8",
    sortOrder: 3,
  },
  {
    id: "luvee",
    name: "Luveè",
    targetMinutes: 60,
    active: true,
    color: "#dc4f8c",
    sortOrder: 4,
  },
  {
    id: "versetile",
    name: "Versetile",
    targetMinutes: 60,
    active: true,
    color: "#c89b3c",
    sortOrder: 5,
  },
];
const demoDate = new Date();
const DEMO_LOGS: ReportLog[] = [
  ["alphapuls", 92, "API authentication logic module completed"],
  ["autoledger", 42, "Invoice workflow polish and QA"],
  ["edubangla", 55, "Lesson outline and content review"],
  ["streamedocs", 31, "Upload flow edge cases"],
].map(([projectId, durationMinutes, notes], index) => {
  const start = new Date(demoDate);
  start.setHours(9 + index * 2, 10, 0, 0);
  const end = new Date(start.getTime() + Number(durationMinutes) * 60_000);
  return {
    id: `demo-${index}`,
    projectId: String(projectId),
    startTime: start,
    endTime: end,
    durationMinutes: Number(durationMinutes),
    notes: String(notes),
    dateString: start.toISOString().slice(0, 10),
  };
});
const mins = (minutes: number) =>
  `${Math.floor(Math.max(0, minutes) / 60)}h ${Math.max(0, minutes) % 60 ? `${Math.max(0, minutes) % 60}m` : ""}`;
type View =
  "overview" | "projects" | "reports" | "sessions" | "todos" | "settings";
type SyncState = {
  online: boolean;
  pending: number;
  failed: number;
  conflicts: number;
  syncing: boolean;
  fromCache: boolean;
  error?: string;
};

export default function App() {
  const firebaseConfigured = Boolean(import.meta.env.VITE_FIREBASE_PROJECT_ID);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [projects, setProjects] = useState<Project[]>(
    firebaseConfigured ? [] : DEMO_PROJECTS,
  );
  const [selectedId, setSelectedId] = useState(DEMO_PROJECTS[0].id);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [accumulatedSeconds, setAccumulatedSeconds] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [recoveryGap, setRecoveryGap] = useState(false);
  const [targetReached, setTargetReached] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const targetAlertedRef = useRef(false);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");
  const [summary, setSummary] = useState("");
  const [todayLogs, setTodayLogs] = useState<ReportLog[]>(
    firebaseConfigured ? [] : DEMO_LOGS,
  );
  const [recentLogs, setRecentLogs] = useState<ReportLog[]>(
    firebaseConfigured ? [] : DEMO_LOGS,
  );
  const [weekLogs, setWeekLogs] = useState<ReportLog[]>(
    firebaseConfigured ? [] : DEMO_LOGS,
  );
  const [monthLogs, setMonthLogs] = useState<ReportLog[]>(
    firebaseConfigured ? [] : DEMO_LOGS,
  );
  const [todos, setTodos] = useState<Todo[]>([]);
  const [sessionFilter, setSessionFilter] = useState<"last2" | "custom">(
    "last2",
  );
  const [sessionFrom, setSessionFrom] = useState("");
  const [sessionTo, setSessionTo] = useState("");
  const [uid, setUid] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<{
    displayName: string;
    email: string;
    photoURL?: string | null;
  } | null>(null);
  const [tracker, setTracker] = useState<any>(null);
  const [profile, setProfile] = useState<TrackerProfile | null>(null);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [syncError, setSyncError] = useState("");
  const [dataLoading, setDataLoading] = useState(firebaseConfigured);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [view, setView] = useState<View>("overview");
  const [projectNavOpen, setProjectNavOpen] = useState(true);
  const [projectDashboardId, setProjectDashboardId] = useState<string | null>(
    null,
  );
  const [mobileNav, setMobileNav] = useState(false);
  const [activityPeriod, setActivityPeriod] = useState<
    "daily" | "weekly" | "monthly"
  >("weekly");
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectTarget, setNewProjectTarget] = useState("60");
  const [targetPreset, setTargetPreset] = useState("1h");
  const [addingProject, setAddingProject] = useState(false);
  const [addProjectError, setAddProjectError] = useState("");
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectSaveError, setProjectSaveError] = useState("");
  const [savingProject, setSavingProject] = useState(false);
  const [editingLog, setEditingLog] = useState<ReportLog | null>(null);
  const [editProjectId, setEditProjectId] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const refreshLogs = useCallback(
    async (service = tracker, userId = uid) => {
      if (!firebaseConfigured || !service || !userId) return;
      const today = getReportDateRange("today", new Date(), timezone);
      const week = getReportDateRange("week", new Date(), timezone);
      const month = getReportDateRange("month", new Date(), timezone);
      const [daily, weekly, monthly, recent] = await Promise.all([
        service.getWorkLogs(userId, today.from, today.to),
        service.getWorkLogs(userId, week.from, week.to),
        service.getWorkLogs(userId, month.from, month.to),
        service.getRecentWorkLogs(userId),
      ]);
      setTodayLogs(daily);
      setWeekLogs(weekly);
      setMonthLogs(monthly);
      setRecentLogs(recent);
    },
    [firebaseConfigured, tracker, uid, timezone],
  );

  useEffect(() => {
    if (!firebaseConfigured) return;
    let disposed = false;
    let offActive: () => void = () => {};
    let offProjects: () => void = () => {};
    const todoUnsubscribers: Array<() => void> = [];
    (async () => {
      try {
        const [{ auth }, service, todoService, authSdk] = await Promise.all([
          import("./lib/firebase"),
          import("./lib/tracker-service"),
          import("./lib/todo-service"),
          import("firebase/auth"),
        ]);
        // Restore the persisted browser session before deciding whether
        // a new Google sign-in is needed. Without this wait, a refresh
        // can briefly report currentUser as null and reopen the popup.
        await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
        let redirectResult: any = null;
        try {
          redirectResult = await authSdk.getRedirectResult(auth);
        } catch (redirectError: any) {
          // Safari standalone/PWA can clear the temporary redirect
          // state even though Firebase has already restored the user.
          // Continue with the persisted auth state in that case.
          if (redirectError?.code !== "auth/no-auth-event") throw redirectError;
        }
        await auth.authStateReady();
        let user = redirectResult?.user || auth.currentUser;
        if (!user) {
          // Wait briefly for Safari's storage-backed auth observer.
          // Reading currentUser synchronously here can race the
          // redirect callback and incorrectly show the login screen.
          user = await new Promise<any>((resolve) => {
            let settled = false;
            const finish = (value: any) => {
              if (settled) return;
              settled = true;
              unsubscribe();
              resolve(value || auth.currentUser || null);
            };
            const unsubscribe = authSdk.onAuthStateChanged(
              auth,
              (stateUser) => {
                if (stateUser) finish(stateUser);
              },
            );
            window.setTimeout(() => finish(null), 2500);
          });
        }
        const googleProvider = new authSdk.GoogleAuthProvider();
        if (!user) {
          setNeedsAuth(true);
          setDataLoading(false);
          setSyncError("Sign in with Google to open your synced workspace.");
          return;
        } else if (user.isAnonymous) {
          // Anonymous users are kept local and asked to sign in from
          // an explicit button click; never open a popup on startup
          // (Safari blocks those non-gesture popups).
          setNeedsAuth(true);
          setDataLoading(false);
          setSyncError("Sign in with Google to open your synced workspace.");
          return;
        }
        if (disposed) return;
        setAuthUser({
          displayName: user.displayName || user.email?.split("@")[0] || "Admin",
          email: user.email || "",
          photoURL: user.photoURL,
        });
        setUid(user.uid);
        setTracker(service);
        await service.seedUserTracker(user.uid);
        const loadedProfile = await service.getProfile(user.uid);
        if (!disposed) setProfile(loadedProfile);
        offProjects = service.subscribeToProjects(
          user.uid,
          (items: Project[]) => {
            if (disposed) return;
            setProjects(items);
            setSelectedId((current: string) =>
              items.some((project) => project.id === current)
                ? current
                : items.find((project) => project.active)?.id || "",
            );
          },
        );
        const todoFrom = new Date();
        todoFrom.setDate(todoFrom.getDate() - 90);
        const todoTo = new Date();
        todoTo.setDate(todoTo.getDate() + 60);
        const plannedTodos = new Map<string, Todo>();
        const overdueTodos = new Map<string, Todo>();
        const completedTodos = new Map<string, Todo>();
        const publishTodos = () => {
          if (!disposed)
            setTodos(
              mergeTodoStreams(
                [...plannedTodos.values()],
                [...overdueTodos.values()],
                [...completedTodos.values()],
              ),
            );
        };
        todoUnsubscribers.push(
          todoService.subscribeToTodosPlannedForRange(
            user.uid,
            localDateKey(todoFrom),
            localDateKey(todoTo),
            (items: Todo[]) => {
              plannedTodos.clear();
              items.forEach((item) => plannedTodos.set(item.id, item));
              publishTodos();
            },
          ),
        );
        todoUnsubscribers.push(
          todoService.subscribeToOpenOverdueTodos(
            user.uid,
            localDateKey(),
            (items: Todo[]) => {
              overdueTodos.clear();
              items.forEach((item) => overdueTodos.set(item.id, item));
              publishTodos();
            },
          ),
        );
        todoUnsubscribers.push(
          todoService.subscribeToTodosCompletedForRange(
            user.uid,
            localDateKey(todoFrom),
            localDateKey(todoTo),
            (items: Todo[]) => {
              completedTodos.clear();
              items.forEach((item) => completedTodos.set(item.id, item));
              publishTodos();
            },
          ),
        );
        offActive = service.subscribeToActiveSession(
          user.uid,
          (active: any) => {
            if (disposed) return;
            setRunning(Boolean(active));
            setPaused(Boolean(active?.pausedAt));
            setAccumulatedSeconds(
              Math.max(0, Number(active?.accumulatedSeconds) || 0),
            );
            setStartedAt(
              active
                ? (active.segmentStartedAt || active.startTime)
                    .toDate()
                    .getTime()
                : null,
            );
            if (active) {
              setSelectedId(active.projectId);
              // Never infer a power-cut/background gap from the
              // session start timestamp. That timestamp naturally
              // becomes older than five minutes during normal work
              // and would incorrectly pause every long session.
              setRecoveryGap(false);
            } else setRecoveryGap(false);
          },
        );
        await refreshLogs(service, user.uid);
        setDataLoading(false);
      } catch (error: any) {
        if (!disposed)
          setSyncError(error?.message || "Firebase sync could not start.");
        setDataLoading(false);
      }
    })();
    return () => {
      disposed = true;
      offActive();
      offProjects();
      todoUnsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [firebaseConfigured]);
  useEffect(() => {
    if (!firebaseConfigured || !uid || !tracker) {
      setSyncState(null);
      return;
    }
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      try {
        const { subscribeToSyncState, startSync } =
          await import("./lib/tracker-service");
        if (disposed) return;
        const offState = subscribeToSyncState(uid, setSyncState);
        const offSync = startSync(uid);
        cleanup = () => {
          offState();
          offSync();
        };
      } catch (error: any) {
        if (!disposed)
          setSyncError(error?.message || "Firebase sync could not start.");
      }
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [firebaseConfigured, uid, tracker]);
  useEffect(() => {
    if (!running || paused) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, paused]);

  const playTargetTone = useCallback(() => {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;
      if (!AudioContextClass) return;
      const context =
        audioContextRef.current ||
        (audioContextRef.current = new AudioContextClass());
      if (context.state === "suspended") void context.resume();
      [0, 0.22, 0.44].forEach((offset) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, context.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(
          0.18,
          context.currentTime + offset + 0.02,
        );
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          context.currentTime + offset + 0.16,
        );
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(context.currentTime + offset);
        oscillator.stop(context.currentTime + offset + 0.18);
      });
    } catch {
      // Audio is optional; the visual target notice still appears.
    }
  }, []);

  const selectedProject = projects.find((project) => project.id === selectedId);
  const elapsed = startedAt
    ? accumulatedSeconds +
      (paused ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000)))
    : accumulatedSeconds;
  useEffect(() => {
    const targetSeconds = (selectedProject?.targetMinutes || 0) * 60;
    if (
      !running ||
      !targetSeconds ||
      elapsed < targetSeconds ||
      targetAlertedRef.current
    )
      return;
    targetAlertedRef.current = true;
    setTargetReached(true);
    playTargetTone();
  }, [elapsed, running, selectedProject?.targetMinutes, playTargetTone]);
  const todayAggregate = useMemo(
    () => aggregateReportRows(normalizeReportLogs(todayLogs), timezone),
    [todayLogs, timezone],
  );
  const activeProjects = projects.filter((project) => project.active);
  const dailyTarget = activeProjects.reduce(
    (sum, project) => sum + project.targetMinutes,
    0,
  );
  const progress = useMemo(
    () =>
      activeProjects.map((project) => ({
        ...project,
        completed: todayAggregate.byProject[project.id] || 0,
      })),
    [activeProjects, todayAggregate.byProject],
  );
  const average = todayAggregate.sessionCount
    ? Math.round(todayAggregate.totalMinutes / todayAggregate.sessionCount)
    : 0;
  const todayTodoStats = useMemo(
    () => buildTodoDayStats(todos, localDateKey()),
    [todos],
  );
  const weekAggregate = useMemo(
    () => aggregateReportRows(normalizeReportLogs(weekLogs), timezone),
    [weekLogs, timezone],
  );
  const weekRange = getReportDateRange("week", new Date(), timezone);
  const dayKeys = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(`${weekRange.from}T12:00:00`);
    day.setDate(day.getDate() + index);
    return day.toISOString().slice(0, 10);
  });
  const maxDayMinutes = Math.max(
    60,
    ...dayKeys.map((key) => weekAggregate.byDay[key] || 0),
  );
  const sessionRows = useMemo(() => {
    const rows = normalizeReportLogs(recentLogs, timezone);
    if (sessionFilter === "custom" && sessionFrom && sessionTo)
      return rows.filter(
        (row) => row.date >= sessionFrom && row.date <= sessionTo,
      );
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const keys = new Set(
      [today, yesterday].map((date) =>
        date.toLocaleDateString("en-CA", { timeZone: timezone }),
      ),
    );
    return rows.filter((row) => keys.has(row.date));
  }, [recentLogs, timezone, sessionFilter, sessionFrom, sessionTo]);
  const activity = useMemo(() => {
    const logs =
      activityPeriod === "daily"
        ? todayLogs
        : activityPeriod === "weekly"
          ? weekLogs
          : monthLogs;
    const aggregate = aggregateReportRows(normalizeReportLogs(logs), timezone);
    if (activityPeriod === "daily")
      return {
        title: "Daily activity",
        subtitle: "Your completed time today",
        total: aggregate.totalMinutes,
        label: "today",
        points: [{ label: "Today", value: aggregate.totalMinutes }],
      };
    if (activityPeriod === "weekly")
      return {
        title: "Weekly activity",
        subtitle: "Your completed time this week",
        total: aggregate.totalMinutes,
        label: "this week",
        points: dayKeys.map((key) => ({
          label: new Date(`${key}T12:00:00`).toLocaleDateString(undefined, {
            weekday: "short",
          }),
          value: aggregate.byDay[key] || 0,
        })),
      };
    const buckets = [0, 0, 0, 0, 0];
    Object.entries(aggregate.byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([, value], index) => {
        buckets[Math.min(4, Math.floor(index / 7))] += value;
      });
    return {
      title: "Monthly activity",
      subtitle: "Your completed time this month",
      total: aggregate.totalMinutes,
      label: "this month",
      points: buckets.map((value, index) => ({
        label: `Week ${index + 1}`,
        value,
      })),
    };
  }, [activityPeriod, todayLogs, weekLogs, monthLogs, timezone, dayKeys]);
  const activityMax = Math.max(
    60,
    ...activity.points.map((point) => point.value),
  );

  const begin = async () => {
    if (!selectedProject)
      return setSyncError("Select an active project first.");
    try {
      setSyncError("");
      setTargetReached(false);
      targetAlertedRef.current = false;
      if (uid && tracker) await tracker.startSession(uid, selectedProject.id);
      else {
        setStartedAt(Date.now());
        setAccumulatedSeconds(0);
        setPaused(false);
        setTargetReached(false);
        targetAlertedRef.current = false;
        setNow(Date.now());
        setRunning(true);
      }
    } catch (error: any) {
      setSyncError(error?.message || "Could not start session.");
    }
  };
  const pause = async () => {
    try {
      if (uid && tracker) await tracker.pauseSession(uid);
      else {
        setAccumulatedSeconds(elapsed);
        setPaused(true);
      }
    } catch (error: any) {
      setSyncError(error?.message || "Could not pause session.");
    }
  };
  const resume = async () => {
    try {
      if (uid && tracker) await tracker.resumeSession(uid);
      else {
        setStartedAt(Date.now());
        setNow(Date.now());
        setPaused(false);
      }
      setRecoveryGap(false);
    } catch (error: any) {
      setSyncError(error?.message || "Could not resume session.");
    }
  };
  const finish = async () => {
    if (!note.trim()) return;
    const concise = summary.trim() || summarizeNote(note);
    try {
      setSyncError("");
      if (uid && tracker) {
        // The write is committed before stopSession resolves, but the
        // reporting queries/listeners may update on a later snapshot.
        // Add the returned log optimistically so every dashboard card
        // and the Sessions view update immediately; reconcile with
        // Firebase in the background to remove any stale duplicates.
        const savedLog = await tracker.stopSession(
          uid,
          concise,
          new Date(),
          note,
        );
        const reportLog = savedLog as ReportLog;
        setTodayLogs((logs) => [
          reportLog,
          ...logs.filter((item) => item.id !== reportLog.id),
        ]);
        setWeekLogs((logs) => [
          reportLog,
          ...logs.filter((item) => item.id !== reportLog.id),
        ]);
        setMonthLogs((logs) => [
          reportLog,
          ...logs.filter((item) => item.id !== reportLog.id),
        ]);
        setRecentLogs((logs) => [
          reportLog,
          ...logs.filter((item) => item.id !== reportLog.id),
        ]);
        setRunning(false);
        setPaused(false);
        setTargetReached(false);
        targetAlertedRef.current = false;
        setStartedAt(null);
        setAccumulatedSeconds(0);
        void refreshLogs();
      } else {
        const start = new Date(startedAt || Date.now());
        const end = new Date();
        const local: ReportLog = {
          id: `local-${end.getTime()}`,
          projectId: selectedId,
          startTime: start,
          endTime: end,
          durationMinutes: Math.max(1, Math.round(elapsed / 60)),
          notes: concise,
          dateString: end.toISOString().slice(0, 10),
        };
        setTodayLogs((logs) => [local, ...logs]);
        setRecentLogs((logs) => [local, ...logs]);
        setWeekLogs((logs) => [local, ...logs]);
        setRunning(false);
        setPaused(false);
        setTargetReached(false);
        targetAlertedRef.current = false;
        setStartedAt(null);
        setAccumulatedSeconds(0);
      }
      setNote("");
      setSummary("");
      setShowNote(false);
    } catch (error: any) {
      setSyncError(error?.message || "Could not save session.");
    }
  };
  const addProject = async () => {
    const name = newProjectName.trim();
    const targetMinutes = Math.round(Number(newProjectTarget));
    if (!name) return setAddProjectError("Project name is required.");
    if (!Number.isFinite(targetMinutes) || targetMinutes < 1)
      return setAddProjectError("Enter a daily target of at least 1 minute.");
    setAddingProject(true);
    setAddProjectError("");
    try {
      if (uid && tracker)
        await tracker.createProject(uid, { name, targetMinutes });
      else {
        const id = createProjectId(
          name,
          projects.map((project) => project.id),
        );
        setProjects((items) => [
          ...items,
          {
            id,
            name,
            targetMinutes,
            active: true,
            color: "#8b78e8",
            sortOrder: items.length,
          },
        ]);
        setSelectedId(id);
      }
      setNewProjectName("");
      setNewProjectTarget("60");
      setTargetPreset("1h");
      setShowAddProject(false);
    } catch (error: any) {
      setAddProjectError(error?.message || "Could not add project.");
    } finally {
      setAddingProject(false);
    }
  };
  const openEditLog = (row: ReturnType<typeof normalizeReportLogs>[number]) => {
    setEditingLog(row as ReportLog);
    setEditProjectId(row.projectId);
    setEditNotes(row.notes || "");
    setEditError("");
  };
  const saveEditLog = async () => {
    if (!editingLog?.id || !uid || !tracker) return;
    if (!editProjectId || !editNotes.trim()) {
      setEditError("Select a project and enter a note.");
      return;
    }
    setSavingEdit(true);
    setEditError("");
    try {
      const updated = await tracker.updateWorkLog(uid, editingLog.id, {
        projectId: editProjectId,
        notes: editNotes.trim(),
      });
      const replace = (logs: ReportLog[]) =>
        logs.map((item) =>
          item.id === updated.id ? { ...item, ...updated } : item,
        );
      setTodayLogs(replace);
      setWeekLogs(replace);
      setMonthLogs(replace);
      setRecentLogs(replace);
      setEditingLog(null);
      void refreshLogs();
    } catch (error: any) {
      setEditError(error?.message || "Could not update session.");
    } finally {
      setSavingEdit(false);
    }
  };
  const removeLog = async (
    row: ReturnType<typeof normalizeReportLogs>[number],
  ) => {
    if (!row.id || !uid || !tracker) return;
    if (!window.confirm("Delete this session permanently?")) return;
    try {
      await tracker.deleteWorkLog(uid, row.id);
      const remove = (logs: ReportLog[]) =>
        logs.filter((item) => item.id !== row.id);
      setTodayLogs(remove);
      setWeekLogs(remove);
      setMonthLogs(remove);
      setRecentLogs(remove);
      void refreshLogs();
    } catch (error: any) {
      setSyncError(error?.message || "Could not delete session.");
    }
  };
  const saveProjectDetails = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (!editingProject || !uid || !tracker) return;
    const form = new FormData(event.currentTarget);
    const targetMinutes = Math.round(Number(form.get("targetMinutes")));
    const status = String(form.get("status"));
    const effectiveDate = String(form.get("targetEffectiveDate") || "");
    const startDate = String(form.get("startDate") || "");
    if (!Number.isFinite(targetMinutes) || targetMinutes < 1) {
      setProjectSaveError("Enter a valid daily target.");
      return;
    }
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) ||
      effectiveDate < nextDateKey()
    ) {
      setProjectSaveError(
        "To protect past reports, plan changes must start tomorrow or later.",
      );
      return;
    }
    setSavingProject(true);
    setProjectSaveError("");
    try {
      const earliestLogDate = normalizeReportLogs(recentLogs, timezone)
        .filter((row) => row.projectId === editingProject.id)
        .sort((a, b) => a.date.localeCompare(b.date))[0]?.date;
      const baselineDate =
        startDate ||
        editingProject.startDate ||
        editingProject.createdDate ||
        earliestLogDate ||
        localDateKey();
      const targetSchedule = scheduleProjectChange(editingProject, {
        effectiveDate,
        targetMinutes,
        status: status as NonNullable<Project["status"]>,
        baselineDate,
      });
      await tracker.updateProject(uid, {
        ...editingProject,
        name: String(form.get("name") || "").trim() || editingProject.name,
        targetMinutes,
        description: String(form.get("description") || "").trim(),
        clientName: String(form.get("clientName") || "").trim(),
        status: status as Project["status"],
        priority: String(form.get("priority")) as Project["priority"],
        startDate,
        deadlineDate: String(form.get("deadlineDate") || ""),
        referenceUrl: String(form.get("referenceUrl") || "").trim(),
        active: status === "active",
        targetSchedule,
      });
      setEditingProject(null);
    } catch (error: any) {
      setProjectSaveError(error?.message || "Could not save project.");
    } finally {
      setSavingProject(false);
    }
  };
  const changeProjectStatus = async (
    project: Project,
    status: NonNullable<Project["status"]>,
  ) => {
    if (!uid || !tracker) return;
    if (
      status === "archived" &&
      !window.confirm(
        `Archive ${project.name}? Historic sessions and reports will remain available.`,
      )
    )
      return;
    try {
      const earliestLogDate = normalizeReportLogs(recentLogs, timezone)
        .filter((row) => row.projectId === project.id)
        .sort((a, b) => a.date.localeCompare(b.date))[0]?.date;
      await tracker.updateProject(uid, {
        ...project,
        status,
        active: status === "active",
        targetSchedule: scheduleProjectChange(project, {
          effectiveDate: nextDateKey(),
          targetMinutes: project.targetMinutes,
          status,
          baselineDate:
            project.startDate ||
            project.createdDate ||
            earliestLogDate ||
            localDateKey(),
        }),
      });
    } catch (error: any) {
      setSyncError(error?.message || "Could not update project status.");
    }
  };
  const moveProject = async (project: Project, direction: -1 | 1) => {
    if (!uid || !tracker) return;
    const index = projects.findIndex((item) => item.id === project.id);
    const ordered = [...projects];
    if (!ordered[index + direction]) return;
    [ordered[index], ordered[index + direction]] = [
      ordered[index + direction],
      ordered[index],
    ];
    try {
      await tracker.reorderProjects(
        uid,
        ordered.map((item) => item.id),
      );
    } catch (error: any) {
      setSyncError(error?.message || "Could not reorder projects.");
    }
  };
  const projectName = (id: string) =>
    projects.find((project) => project.id === id)?.name || id;
  const createTodo = async (input: {
    title: string;
    projectId: string | null;
    plannedDateString: string;
    priority: TodoPriority;
  }) => {
    if (uid) return (await import("./lib/todo-service")).createTodo(uid, input);
    const todo: Todo = {
      id: crypto.randomUUID(),
      ...input,
      status: "open",
      sortOrder: Date.now(),
      completedAt: null,
      completedDateString: null,
      createdAt: null,
      updatedAt: null,
      lastMutationId: crypto.randomUUID(),
    };
    setTodos((items) => [...items, todo]);
  };
  const toggleTodo = async (todo: Todo, complete: boolean) => {
    if (uid)
      return (await import("./lib/todo-service")).toggleTodoComplete(
        uid,
        todo.id,
        complete,
      );
    setTodos((items) =>
      items.map((item) =>
        item.id === todo.id
          ? {
              ...item,
              status: complete ? "completed" : "open",
              completedDateString: complete ? localDateKey() : null,
            }
          : item,
      ),
    );
  };
  const moveTodo = async (todo: Todo, plannedDateString: string) => {
    if (uid)
      return (await import("./lib/todo-service")).updateTodo(uid, todo.id, {
        plannedDateString,
      });
    setTodos((items) =>
      items.map((item) =>
        item.id === todo.id ? { ...item, plannedDateString } : item,
      ),
    );
  };
  const removeTodo = async (todo: Todo) => {
    if (!window.confirm(`Delete “${todo.title}”?`)) return;
    if (uid)
      return (await import("./lib/todo-service")).deleteTodo(uid, todo.id);
    setTodos((items) => items.filter((item) => item.id !== todo.id));
  };
  const projectColor = (id: string) =>
    projects.find((project) => project.id === id)?.color || "#8b78e8";
  const signIn = async () => {
    setAuthLoading(true);
    try {
      const [{ auth }, authSdk] = await Promise.all([
        import("./lib/firebase"),
        import("firebase/auth"),
      ]);
      await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
      const provider = new authSdk.GoogleAuthProvider();
      // Use the user-gesture popup on every device. iOS Safari/PWA
      // frequently loses redirect sessionStorage and then returns to the
      // app without the auth result (or shows redirect_uri_mismatch).
      // A popup started directly by the tap preserves that state. If a
      // browser blocks it, fall back to redirect as a last resort.
      let result;
      try {
        result = await authSdk.signInWithPopup(auth, provider);
      } catch (popupError: any) {
        if (popupError?.code !== "auth/popup-blocked") throw popupError;
        await authSdk.signInWithRedirect(auth, provider);
        return;
      }
      setAuthUser({
        displayName:
          result.user.displayName ||
          result.user.email?.split("@")[0] ||
          "Admin",
        email: result.user.email || "",
        photoURL: result.user.photoURL,
      });
      setNeedsAuth(false);
      setSyncError("");
      window.location.reload();
    } catch (error: any) {
      setSyncError(
        error?.code === "auth/popup-blocked"
          ? "Safari blocked the sign-in popup. Open this site in Safari (not an in-app browser) and tap again."
          : error?.message || "Could not sign in.",
      );
    } finally {
      setAuthLoading(false);
    }
  };
  const profileName = profile?.displayName || authUser?.displayName || "Admin";
  const firstName = profileName.trim().split(/\s+/)[0] || "there";
  const initials = profileName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="app-shell">
      {dataLoading && (
        <div
          className="data-loader"
          role="status"
          aria-label="Loading your workspace"
        >
          <div className="heartbeat-loader">
            <span />
            <span />
            <span />
          </div>
          <span>Loading your workspace…</span>
        </div>
      )}
      <aside className={mobileNav ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <div className="brand-mark">
            <Activity size={18} />
          </div>
          <span>
            work<span>hours</span>
          </span>
          <button className="mobile-close" onClick={() => setMobileNav(false)}>
            <X size={20} />
          </button>
        </div>
        <div className="workspace">
          <div className="avatar">{initials}</div>
          <div>
            <b>{profileName}</b>
            <small>{authUser?.email || "Personal tracking"}</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <nav>
          <a
            className={view === "overview" ? "active" : ""}
            onClick={() => {
              setView("overview");
              setMobileNav(false);
            }}
          >
            <LayoutDashboard size={18} />
            Overview
          </a>
          <a
            className={view === "sessions" ? "active" : ""}
            onClick={() => {
              setView("sessions");
              setMobileNav(false);
            }}
          >
            <Clock3 size={18} />
            Sessions
          </a>
          <a
            className={view === "todos" ? "active" : ""}
            onClick={() => {
              setView("todos");
              setMobileNav(false);
            }}
          >
            <ListTodo size={18} />
            Tasks
          </a>
          <div className={`sidebar-projects ${projectNavOpen ? "open" : ""}`}>
            <button
              className={view === "projects" ? "active" : ""}
              onClick={() => {
                setProjectNavOpen((open) => !open);
                setView("projects");
                setProjectDashboardId(null);
              }}
            >
              <span>
                <FolderKanban size={18} /> Projects
              </span>
              <ChevronDown size={15} />
            </button>
            {projectNavOpen && (
              <div className="sidebar-project-list">
                {projects
                  .filter((project) => project.active)
                  .map((project) => (
                    <button
                      key={project.id}
                      className={
                        view === "projects" && projectDashboardId === project.id
                          ? "active"
                          : ""
                      }
                      onClick={() => {
                        setProjectDashboardId(project.id);
                        setView("projects");
                        setMobileNav(false);
                      }}
                    >
                      <i style={{ background: project.color }} />
                      {project.name}
                    </button>
                  ))}
                {!projects.filter((project) => project.active).length && (
                  <small>No active projects</small>
                )}
              </div>
            )}
          </div>
          <a
            className={view === "reports" ? "active" : ""}
            onClick={() => {
              setView("reports");
              setMobileNav(false);
            }}
          >
            <BarChart3 size={18} />
            Reports
          </a>
        </nav>
        <div className="nav-bottom">
          <a
            className={view === "settings" ? "active" : ""}
            onClick={() => {
              setView("settings");
              setMobileNav(false);
            }}
          >
            <Settings size={18} />
            Settings
          </a>
          <a>
            <CircleHelp size={18} />
            Help center
          </a>
        </div>
      </aside>
      <main className="main">
        <header>
          <button className="menu-button" onClick={() => setMobileNav(true)}>
            <Menu />
          </button>
          <div>
            <p className="eyebrow">
              {new Date().toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
            <h1>
              Good morning, {firstName} <span>✦</span>
            </h1>
          </div>
          <div className="header-actions">
            <button className="icon-btn">
              <Bell size={19} />
              <i />
            </button>
            <div className="profile">
              <div className="avatar">{initials}</div>
              <span className="profile-name">{profileName}</span>
              <ChevronDown size={15} />
            </div>
          </div>
        </header>
        {view === "projects" ? (
          <ProjectsView
            projects={projects}
            logs={monthLogs}
            todos={todos}
            selectedProjectId={projectDashboardId}
            onSelectProject={setProjectDashboardId}
            onEdit={(project) => {
              setProjectSaveError("");
              setEditingProject(project);
            }}
            onStatus={changeProjectStatus}
          />
        ) : view === "todos" ? (
          <TodosView
            todos={todos}
            projects={projects}
            defaultProjectId={selectedId}
            onCreate={createTodo}
            onToggle={toggleTodo}
            onMove={moveTodo}
            onDelete={removeTodo}
          />
        ) : view === "reports" ? (
          <ReportsView
            projects={projects}
            uid={uid}
            tracker={tracker}
            demoLogs={recentLogs}
            branding={profile}
          />
        ) : view === "settings" ? (
          <ProfileSettings
            profile={profile}
            authName={
              authUser?.displayName || authUser?.email?.split("@")[0] || ""
            }
            onSave={async (input) => {
              if (!uid || !tracker)
                throw new Error("Sign in to save your profile.");
              const next = await tracker.updateProfile(uid, input);
              setProfile(next);
            }}
          />
        ) : view === "sessions" ? (
          <>
            <SessionsCard
              title="All sessions"
              rows={sessionRows}
              projectName={projectName}
              projectColor={projectColor}
              filterable
              filter={sessionFilter}
              setFilter={setSessionFilter}
              from={sessionFrom}
              to={sessionTo}
              setFrom={setSessionFrom}
              setTo={setSessionTo}
              back={() => setView("overview")}
              onEdit={openEditLog}
              onDelete={removeLog}
            />
          </>
        ) : (
          <>
            <section className="hero-row">
              <div>
                <h2>Today at a glance</h2>
                <p className="muted">
                  Welcome back, {firstName}. Keep your momentum going.
                  {firebaseConfigured && !syncError
                    ? " Synced securely to Firebase."
                    : ""}
                </p>
              </div>
              <button
                className="outline-btn"
                onClick={() =>
                  downloadCsv(
                    "workhours-today-report",
                    normalizeReportLogs(todayLogs),
                  )
                }
              >
                <Download size={16} /> Export CSV
              </button>
            </section>
            {syncError && (
              <div className="sync-warning">
                {syncError}
                {needsAuth && (
                  <button
                    className="outline-btn auth-retry"
                    onClick={signIn}
                    disabled={authLoading}
                  >
                    {authLoading ? "Opening Google…" : "Sign in with Google"}
                  </button>
                )}
              </div>
            )}
            {firebaseConfigured && uid && syncState && (
              <div className="sync-warning" role="status">
                {!syncState.online
                  ? "Offline — changes are saved locally and will sync when you reconnect."
                  : syncState.syncing
                    ? "Syncing your workspace…"
                    : syncState.conflicts
                      ? `${syncState.conflicts} sync conflict${syncState.conflicts === 1 ? "" : "s"} need${syncState.conflicts === 1 ? "s" : ""} attention.`
                      : syncState.failed
                        ? `${syncState.failed} change${syncState.failed === 1 ? "" : "s"} failed to sync; retry when online.`
                        : syncState.pending
                          ? `${syncState.pending} change${syncState.pending === 1 ? "" : "s"} waiting to sync.`
                          : syncState.fromCache
                            ? "Showing cached workspace data."
                            : "Workspace synced. Backups are up to date."}
              </div>
            )}
            <section className="stats-grid">
              <div className="stat-card accent">
                <div className="stat-icon">
                  <Timer size={19} />
                </div>
                <div>
                  <span>Total tracked</span>
                  <strong>{mins(todayAggregate.totalMinutes)}</strong>
                  <small>
                    <TrendingUp size={13} /> Completed sessions only
                  </small>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon orange">
                  <CalendarDays size={19} />
                </div>
                <div>
                  <span>Daily target</span>
                  <strong>
                    {mins(dailyTarget)}{" "}
                    <em>/ {mins(todayAggregate.totalMinutes)}</em>
                  </strong>
                  <div className="mini-track">
                    <i
                      style={{
                        width: `${dailyTarget ? Math.min(100, (todayAggregate.totalMinutes / dailyTarget) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
              <button
                className="stat-card todo-stat-card"
                onClick={() => setView("todos")}
              >
                <div className="stat-icon purple">
                  <ListTodo size={19} />
                </div>
                <div>
                  <span>Today’s tasks</span>
                  <strong>
                    {todayTodoStats.completedFromPlan}/{todayTodoStats.planned}
                  </strong>
                  <small>
                    {todayTodoStats.open
                      ? `${todayTodoStats.open} remaining`
                      : todayTodoStats.planned
                        ? "All completed"
                        : "Plan your day"}
                  </small>
                </div>
              </button>
              <div className="stat-card">
                <div className="stat-icon green">
                  <BarChart3 size={19} />
                </div>
                <div>
                  <span>Sessions</span>
                  <strong>{todayAggregate.sessionCount}</strong>
                  <small>
                    Across {Object.keys(todayAggregate.byProject).length}{" "}
                    project
                    {Object.keys(todayAggregate.byProject).length === 1
                      ? ""
                      : "s"}
                  </small>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon blue">
                  <Clock3 size={19} />
                </div>
                <div>
                  <span>Avg. session</span>
                  <strong>{mins(average)}</strong>
                  <small>Completed sessions only</small>
                </div>
              </div>
            </section>
            <section className="work-grid">
              <div className="timer-card">
                <div className="card-heading">
                  <div>
                    <h3>Focus timer</h3>
                    <p className="muted">Track time as you work</p>
                  </div>
                  <span
                    className={
                      running
                        ? paused
                          ? "ready-pill"
                          : "live-pill"
                        : "ready-pill"
                    }
                  >
                    <i />{" "}
                    {running ? (paused ? "Paused" : "Recording") : "Ready"}
                  </span>
                </div>
                <label className="field-label">Working on</label>
                <div className="select-wrap">
                  <select
                    id="working-project"
                    name="working-project"
                    value={selectedId}
                    onChange={(event) => setSelectedId(event.target.value)}
                    disabled={running}
                  >
                    {activeProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={17} />
                </div>
                <div className="timer-display">
                  {String(Math.floor(elapsed / 3600)).padStart(2, "0")}:
                  {String(Math.floor(elapsed / 60) % 60).padStart(2, "0")}:
                  {String(elapsed % 60).padStart(2, "0")}
                </div>
                {running && (
                  <div className="timer-inline-actions">
                    {paused ? (
                      <button className="start-btn" onClick={resume}>
                        <Play size={16} fill="currentColor" /> Resume session
                      </button>
                    ) : (
                      <button className="pause-btn" onClick={pause}>
                        Ⅱ Pause session
                      </button>
                    )}
                    <button
                      className="stop-btn"
                      onClick={() => setShowNote(true)}
                    >
                      <Square size={15} fill="currentColor" /> End session
                    </button>
                  </div>
                )}
                {!running && (
                  <button
                    className="start-btn"
                    disabled={!selectedProject}
                    onClick={begin}
                  >
                    <Play size={17} fill="currentColor" /> Start session
                  </button>
                )}
                <p className="timer-hint">
                  <Clock3 size={14} />{" "}
                  {paused
                    ? "Timer paused - no time is counted"
                    : "Timer continues if you switch tabs"}
                </p>
                {targetReached && running && (
                  <div className="target-reached" role="status">
                    <Bell size={14} /> Daily target reached — overtime is still
                    being counted.
                  </div>
                )}
                {recoveryGap && (
                  <div className="timer-recovery">
                    <b>Inactive gap detected.</b>
                    <span>
                      This gap is excluded. Resume only when you are working.
                    </span>
                    <button className="start-btn" onClick={resume}>
                      Resume now
                    </button>
                  </div>
                )}
              </div>
              <div className="chart-card">
                <div className="card-heading">
                  <div>
                    <h3>{activity.title}</h3>
                    <p className="muted">{activity.subtitle}</p>
                  </div>
                  <div className="activity-tabs">
                    {(["daily", "weekly", "monthly"] as const).map((period) => (
                      <button
                        key={period}
                        className={activityPeriod === period ? "selected" : ""}
                        onClick={() => setActivityPeriod(period)}
                      >
                        {period[0].toUpperCase() + period.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="chart">
                  <div className="y-axis">
                    <span>{mins(activityMax)}</span>
                    <span>0h</span>
                  </div>
                  <div className="bars">
                    {activity.points.map((point) => (
                      <div className="bar-col" key={point.label}>
                        <div
                          className="bar"
                          style={{
                            height: `${Math.round((point.value / activityMax) * 100)}%`,
                          }}
                        >
                          <i />
                        </div>
                        <span>{point.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="chart-legend">
                  <span>
                    <i className="dot purple" />
                    Tracked hours
                  </span>
                  <b>
                    {mins(activity.total)} <small>{activity.label}</small>
                  </b>
                </div>
              </div>
            </section>
            <section className="projects-card">
              <div className="card-heading">
                <div>
                  <h3>Project progress</h3>
                  <p className="muted">Daily target completion</p>
                </div>
                <button
                  className="add-btn"
                  onClick={() => {
                    setAddProjectError("");
                    setShowAddProject(true);
                  }}
                >
                  <Plus size={16} /> Add project
                </button>
              </div>
              <div className="project-list">
                {progress.map((project) => (
                  <div className="project-row" key={project.id}>
                    <div className="project-name">
                      <i
                        style={{
                          background: project.color,
                        }}
                      />
                      <b>{project.name}</b>
                    </div>
                    <div className="progress-line">
                      <div>
                        <i
                          style={{
                            width: `${Math.min(100, (project.completed / project.targetMinutes) * 100)}%`,
                            background: project.color,
                          }}
                        />
                      </div>
                      <span>
                        {mins(project.completed)}{" "}
                        <em>/ {mins(project.targetMinutes)}</em>
                      </span>
                    </div>
                    <strong className="percent">
                      {Math.round(
                        (project.completed / project.targetMinutes) * 100,
                      )}
                      %
                    </strong>
                  </div>
                ))}
              </div>
            </section>
            <SessionsCard
              title="Recent sessions"
              rows={sessionRows.slice(0, 4)}
              projectName={projectName}
              projectColor={projectColor}
              viewAll={() => setView("sessions")}
              onEdit={openEditLog}
              onDelete={removeLog}
            />
          </>
        )}
      </main>
      {editingLog && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="note-modal edit-session-modal"
            onSubmit={(event) => {
              event.preventDefault();
              void saveEditLog();
            }}
          >
            <button
              className="modal-close"
              type="button"
              disabled={savingEdit}
              onClick={() => setEditingLog(null)}
              aria-label="Close edit session"
            >
              <X size={18} />
            </button>
            <div className="modal-icon">
              <Pencil size={20} />
            </div>
            <h3>Edit session</h3>
            <p>
              Correct the project or report summary for this completed session.
            </p>
            <label className="modal-field" htmlFor="edit-session-project">
              PROJECT
              <select
                id="edit-session-project"
                name="edit-session-project"
                value={editProjectId}
                onChange={(event) => setEditProjectId(event.target.value)}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="modal-field" htmlFor="edit-session-note">
              REPORT SUMMARY
              <textarea
                id="edit-session-note"
                name="edit-session-note"
                value={editNotes}
                onChange={(event) => setEditNotes(event.target.value)}
                maxLength={500}
                required
              />
            </label>
            {editError && <p className="sync-warning">{editError}</p>}
            <div className="modal-actions">
              <button
                className="outline-btn"
                type="button"
                disabled={savingEdit}
                onClick={() => setEditingLog(null)}
              >
                Cancel
              </button>
              <button className="start-btn" type="submit" disabled={savingEdit}>
                {savingEdit ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      )}
      {editingProject && (
        <div className="modal-backdrop">
          <form
            className="note-modal project-editor-modal"
            onSubmit={saveProjectDetails}
          >
            <button
              className="modal-close"
              type="button"
              onClick={() => setEditingProject(null)}
              disabled={savingProject}
            >
              <X size={18} />
            </button>
            <div className="modal-icon">
              <FolderKanban size={20} />
            </div>
            <h3>Manage project</h3>
            <p>Update its details, lifecycle, and daily target.</p>
            <div className="project-editor-grid">
              <label className="modal-field">
                PROJECT NAME
                <input
                  name="name"
                  defaultValue={editingProject.name}
                  required
                  maxLength={80}
                />
              </label>
              <label className="modal-field">
                CLIENT / COMPANY
                <input
                  name="clientName"
                  defaultValue={editingProject.clientName}
                  maxLength={120}
                />
              </label>
              <label className="modal-field">
                DAILY TARGET (MINUTES)
                <input
                  name="targetMinutes"
                  type="number"
                  min="1"
                  defaultValue={editingProject.targetMinutes}
                  required
                />
              </label>
              <label className="modal-field">
                STATUS
                <select
                  name="status"
                  defaultValue={
                    editingProject.status ||
                    (editingProject.active ? "active" : "archived")
                  }
                >
                  <option value="planned">Planned</option>
                  <option value="active">Active</option>
                  <option value="on_hold">On hold</option>
                  <option value="completed">Completed</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
              <label className="modal-field">
                PLAN CHANGE STARTS
                <input
                  name="targetEffectiveDate"
                  type="date"
                  defaultValue={nextDateKey()}
                  min={nextDateKey()}
                  required
                />
                <small>
                  Target and status apply from this date onward. Past reports
                  stay unchanged.
                </small>
              </label>
              <label className="modal-field">
                PRIORITY
                <select
                  name="priority"
                  defaultValue={editingProject.priority || "medium"}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="modal-field">
                START DATE
                <input
                  name="startDate"
                  type="date"
                  defaultValue={editingProject.startDate}
                />
              </label>
              <label className="modal-field">
                DEADLINE
                <input
                  name="deadlineDate"
                  type="date"
                  defaultValue={editingProject.deadlineDate}
                />
              </label>
              <label className="modal-field">
                REFERENCE LINK
                <input
                  name="referenceUrl"
                  type="url"
                  defaultValue={editingProject.referenceUrl}
                  placeholder="https://..."
                />
              </label>
              <label className="modal-field project-editor-wide">
                DESCRIPTION
                <textarea
                  name="description"
                  defaultValue={editingProject.description}
                  maxLength={1000}
                />
              </label>
            </div>
            {projectSaveError && (
              <p className="sync-warning">{projectSaveError}</p>
            )}
            <div className="modal-actions">
              <button
                className="outline-btn"
                type="button"
                disabled={savingProject}
                onClick={() => setEditingProject(null)}
              >
                Cancel
              </button>
              <button
                className="start-btn"
                type="submit"
                disabled={savingProject}
              >
                {savingProject ? "Saving…" : "Save project"}
              </button>
            </div>
          </form>
        </div>
      )}
      {showAddProject && (
        <div className="modal-backdrop">
          <div className="note-modal add-project-modal">
            <button
              className="modal-close"
              onClick={() => !addingProject && setShowAddProject(false)}
            >
              <X size={18} />
            </button>
            <div className="modal-icon">
              <Plus size={20} />
            </div>
            <h3>Add project</h3>
            <p>Create a project with its daily target.</p>
            <label className="modal-field">
              PROJECT NAME
              <input
                id="project-name"
                name="project-name"
                autoFocus
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder="e.g. Client Portal"
              />
            </label>
            <label className="modal-field">DAILY TARGET</label>
            <div className="target-presets">
              {["1h", "2h", "3h", "4h"].map((preset) => (
                <button
                  type="button"
                  className={targetPreset === preset ? "selected" : ""}
                  key={preset}
                  onClick={() => {
                    setTargetPreset(preset);
                    setNewProjectTarget(String(Number(preset[0]) * 60));
                  }}
                >
                  {preset}
                </button>
              ))}
              <button
                type="button"
                className={targetPreset === "custom" ? "selected" : ""}
                onClick={() => setTargetPreset("custom")}
              >
                Custom hours
              </button>
            </div>
            <label className="modal-field">
              {targetPreset === "custom"
                ? "CUSTOM TARGET (MINUTES)"
                : "TARGET MINUTES"}
              <input
                id="project-target"
                name="project-target"
                type="number"
                min="1"
                value={newProjectTarget}
                onChange={(event) => {
                  setNewProjectTarget(event.target.value);
                  setTargetPreset("custom");
                }}
              />
            </label>
            {addProjectError && (
              <p className="sync-warning">{addProjectError}</p>
            )}
            <div className="modal-actions">
              <button
                className="outline-btn"
                disabled={addingProject}
                onClick={() => setShowAddProject(false)}
              >
                Cancel
              </button>
              <button
                className="start-btn"
                disabled={addingProject || !newProjectName.trim()}
                onClick={addProject}
              >
                {addingProject ? "Adding…" : "Add project"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showNote && (
        <div className="modal-backdrop">
          <div className="note-modal">
            <button className="modal-close" onClick={() => setShowNote(false)}>
              <X size={18} />
            </button>
            <div className="modal-icon">
              <Clock3 size={20} />
            </div>
            <h3>What did you work on?</h3>
            <p>
              Add detailed notes. We’ll create a concise 1–2 line summary for
              your report.
            </p>
            <textarea
              id="session-notes"
              name="session-notes"
              autoFocus
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setSummary("");
              }}
              placeholder="Describe everything you worked on..."
            />
            <button
              className="summary-btn"
              disabled={!note.trim()}
              onClick={() => setSummary(summarizeNote(note))}
            >
              ✨ Generate smart summary
            </button>
            {summary && (
              <label className="summary-box">
                <span>REPORT SUMMARY (editable)</span>
                <textarea
                  id="report-summary"
                  name="report-summary"
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                />
              </label>
            )}
            <div className="modal-actions">
              <button
                className="outline-btn"
                onClick={() => setShowNote(false)}
              >
                Cancel
              </button>
              <button
                className="start-btn"
                disabled={!note.trim()}
                onClick={finish}
              >
                Save session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MonthlyMap({
  rows,
}: {
  rows: ReturnType<typeof normalizeReportLogs>;
}) {
  const days = new Date(
    new Date().getFullYear(),
    new Date().getMonth() + 1,
    0,
  ).getDate();
  const byDay = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.date] = (acc[row.date] || 0) + row.durationMinutes;
    return acc;
  }, {});
  const month = new Date().toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const max = Math.max(60, ...Object.values(byDay));
  return (
    <section className="sessions-card monthly-map">
      <div className="card-heading">
        <div>
          <h3>{month} activity map</h3>
          <p className="muted">Completed work per day</p>
        </div>
        <span className="muted">
          {mins(Object.values(byDay).reduce((a, b) => a + b, 0))} total
        </span>
      </div>
      <div className="monthly-bars">
        {Array.from({ length: days }, (_, i) => {
          const key = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
          const value = byDay[key] || 0;
          return (
            <div
              className="month-day"
              key={key}
              title={`${key}: ${mins(value)}`}
            >
              <div
                className="month-bar"
                style={{
                  height: `${value ? Math.max(8, (value / max) * 100) : 3}%`,
                }}
              />
              <span>{i + 1}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SessionsCard({
  title,
  rows,
  projectName,
  projectColor,
  viewAll,
  back,
  filterable,
  filter,
  setFilter,
  from,
  to,
  setFrom,
  setTo,
  onEdit,
  onDelete,
}: {
  title: string;
  rows: ReturnType<typeof normalizeReportLogs>;
  projectName: (id: string) => string;
  projectColor: (id: string) => string;
  viewAll?: () => void;
  back?: () => void;
  filterable?: boolean;
  filter?: "last2" | "custom";
  setFilter?: (value: "last2" | "custom") => void;
  from?: string;
  to?: string;
  setFrom?: (value: string) => void;
  setTo?: (value: string) => void;
  onEdit?: (row: ReturnType<typeof normalizeReportLogs>[number]) => void;
  onDelete?: (row: ReturnType<typeof normalizeReportLogs>[number]) => void;
}) {
  const totalMinutes = rows.reduce((sum, row) => sum + row.durationMinutes, 0);
  const projectCount = new Set(rows.map((row) => row.projectId)).size;
  return (
    <section className={`sessions-card${back ? " full-sessions" : ""}`}>
      <div className="card-heading">
        <div>
          <h3>{title}</h3>
          <p className="muted">Your logged work sessions and notes.</p>
        </div>
        {viewAll ? (
          <button className="text-btn" onClick={viewAll}>
            View all <span>→</span>
          </button>
        ) : back ? (
          <button className="outline-btn" onClick={back}>
            Back to overview
          </button>
        ) : null}
      </div>
      {filterable && (
        <div className="session-filters">
          <div className="activity-tabs">
            <button
              className={filter === "last2" ? "selected" : ""}
              onClick={() => setFilter?.("last2")}
            >
              Last 2 days
            </button>
            <button
              className={filter === "custom" ? "selected" : ""}
              onClick={() => setFilter?.("custom")}
            >
              Specific range
            </button>
          </div>
          {filter === "custom" && (
            <>
              <label>
                From{" "}
                <input
                  id="session-filter-from"
                  name="session-filter-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom?.(e.target.value)}
                />
              </label>
              <label>
                To{" "}
                <input
                  id="session-filter-to"
                  name="session-filter-to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo?.(e.target.value)}
                />
              </label>
            </>
          )}
        </div>
      )}
      <div className="session-summary-grid">
        <div>
          <span>Total tracked</span>
          <strong>{mins(totalMinutes)}</strong>
        </div>
        <div>
          <span>Sessions</span>
          <strong>{rows.length}</strong>
        </div>
        <div>
          <span>Projects</span>
          <strong>{projectCount}</strong>
        </div>
        <div>
          <span>Avg. session</span>
          <strong>
            {mins(rows.length ? Math.round(totalMinutes / rows.length) : 0)}
          </strong>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>PROJECT</th>
              <th>TIME</th>
              <th>DURATION</th>
              <th>NOTE</th>
              {(onEdit || onDelete) && <th>ACTIONS</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr key={`${row.date}-${index}`}>
                  <td>
                    <div className="project-name">
                      <i
                        style={{
                          background: projectColor(row.projectId),
                        }}
                      />
                      <b>{projectName(row.projectId)}</b>
                    </div>
                  </td>
                  <td>
                    {row.startTime.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    –{" "}
                    {row.endTime.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td>
                    <b>{mins(row.durationMinutes)}</b>
                  </td>
                  <td className="note-cell">{row.notes || "—"}</td>
                  {(onEdit || onDelete) && (
                    <td className="session-actions">
                      {onEdit && (
                        <button
                          className="text-btn"
                          onClick={() => onEdit(row)}
                        >
                          Edit
                        </button>
                      )}
                      {onDelete && (
                        <button
                          className="text-btn danger-text"
                          onClick={() => onDelete(row)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={onEdit || onDelete ? 5 : 4} className="note-cell">
                  No completed sessions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
