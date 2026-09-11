import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bell,
  CalendarDays,
  Cloud,
  ChevronDown,
  CircleHelp,
  Clock3,
  Download,
  Flame,
  FolderKanban,
  LayoutDashboard,
  KeyRound,
  Landmark,
  ListTodo,
  StickyNote,
  Menu,
  Play,
  Plus,
  Pencil,
  Palmtree,
  Settings,
  Search,
  Square,
  Sparkles,
  Target,
  Timer,
  Trophy,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import ReportsView from "./components/ReportsView";
import ProfileSettings from "./components/ProfileSettings";
import ProjectsView from "./components/ProjectsView";
import TodosView from "./components/TodosView";
import NotesView from "./components/NotesView";
import VaultView from "./components/VaultView";
import DisciplineView from "./components/DisciplineView";
import FinanceView from "./components/FinanceView";
import AppModeControl from "./components/AppModeControl";
import { effectiveAppMode, saveAppMode, subscribeToAppMode, WORKDAY_MODE } from "./lib/mode-service";
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
  type ProjectNote,
  type TodoPriority,
  type TrackerProfile,
  type Routine,
  type RoutineLog,
  type AppModeState,
  type FinanceAccount,
  type FinanceTransaction,
  type FinanceAsset,
  type FinanceGoal,
  type RecurringFinanceItem,
  type FinanceBudget,
} from "./types/tracker";
import {
  localDateKey,
  nextDateKey,
  scheduleProjectChange,
} from "./lib/project-schedule";
import { buildTodoDayStats, mergeTodoStreams, sortTodos } from "./lib/todos";

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
  "overview" | "projects" | "reports" | "sessions" | "todos" | "notes" | "vault" | "discipline" | "finance" | "settings";

const NAVIGATION_VIEWS: View[] = [
  "overview", "projects", "reports", "sessions", "todos", "notes", "vault", "discipline", "finance", "settings",
];

function viewFromLocation(): View {
  if (typeof window === "undefined") return "overview";
  const value = window.location.hash.replace(/^#/, "") as View;
  return NAVIGATION_VIEWS.includes(value) ? value : "overview";
}

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
  // The active-session document is the sole authority for the project being
  // timed.  `selectedId` is only the next project chosen while idle.
  const [activeSessionProjectId, setActiveSessionProjectId] = useState<string | null>(null);
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
  const [sessionTodoIds, setSessionTodoIds] = useState<string[]>([]);
  const [notedSessionTodoIds, setNotedSessionTodoIds] = useState<string[]>([]);
  const [finishProjectId, setFinishProjectId] = useState<string | null>(null);
  const [finishingSession, setFinishingSession] = useState(false);
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
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [notesProjectId, setNotesProjectId] = useState<string | null>(null);
  const [notesFocusId, setNotesFocusId] = useState<string | null>(null);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routineLogs, setRoutineLogs] = useState<RoutineLog[]>([]);
  const [dueRoutine, setDueRoutine] = useState<Routine | null>(null);
  const [routineWarning, setRoutineWarning] = useState<Routine | null>(null);
  const [appMode, setAppMode] = useState<AppModeState>(WORKDAY_MODE);
  const [financeAccounts, setFinanceAccounts] = useState<FinanceAccount[]>([]);
  const [financeTransactions, setFinanceTransactions] = useState<FinanceTransaction[]>([]);
  const [financeAssets, setFinanceAssets] = useState<FinanceAsset[]>([]);
  const [financeGoals, setFinanceGoals] = useState<FinanceGoal[]>([]);
  const [recurringFinanceItems, setRecurringFinanceItems] = useState<RecurringFinanceItem[]>([]);
  const [financeBudgets, setFinanceBudgets] = useState<FinanceBudget[]>([]);
  const activeAppMode = effectiveAppMode(appMode, localDateKey(new Date(now)), now);
  const vacationActive = activeAppMode === "vacation";
  const [sessionFilter, setSessionFilter] = useState<
    "last2" | "last7" | "last30" | "custom"
  >(
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
  const [view, setView] = useState<View>(viewFromLocation);
  const [projectNavOpen, setProjectNavOpen] = useState(true);
  const [projectDashboardId, setProjectDashboardId] = useState<string | null>(
    null,
  );
  const [mobileNav, setMobileNav] = useState(false);
  const [activityPeriod, setActivityPeriod] = useState<
    "daily" | "weekly" | "monthly"
  >("weekly");

  // Keep every primary workspace page addressable in the installed app too.
  // This gives the device back gesture/browser Back a real page history rather
  // than leaving users stranded on a detail page.
  useEffect(() => {
    const restoreLocationView = () => {
      setView(viewFromLocation());
      setMobileNav(false);
    };

    window.addEventListener("popstate", restoreLocationView);
    window.addEventListener("hashchange", restoreLocationView);
    return () => {
      window.removeEventListener("popstate", restoreLocationView);
      window.removeEventListener("hashchange", restoreLocationView);
    };
  }, []);

  useEffect(() => {
    const hash = view === "overview" ? "" : `#${view}`;
    if (window.location.hash === hash) return;
    window.history.pushState(
      { eaLogView: view },
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
    );
  }, [view]);

  useEffect(() => {
    if (!uid || !routines.length) return;
    const toMinutes = (time: string) => { const [hour, minute] = time.split(":").map(Number); return hour * 60 + minute; };
    const check = async () => {
      const now = new Date(); const today = localDateKey(now); const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const vacation = effectiveAppMode(appMode, today) === "vacation";
      const applicable = routines.filter((routine) => routine.active && routine.repeatDays.includes(now.getDay()) && (!routine.effectiveDate || routine.effectiveDate <= today) && (!routine.endDate || routine.endDate >= today) && (!vacation || !appMode.relaxedDiscipline || !/focus block|deep work|work session/i.test(routine.name)));
      const logFor = (routine: Routine) => routineLogs.find((log) => log.routineId === routine.id && log.dateString === today);
      for (const routine of applicable) {
        const log = logFor(routine); const scheduled = toMinutes(routine.time);
        if (log?.status === "completed" || log?.status === "skipped" || log?.status === "missed") continue;
        const snoozedUntil = log?.status === "snoozed" && log.snoozedUntil ? Date.parse(log.snoozedUntil) : NaN;
        const dueAt = Number.isFinite(snoozedUntil) ? new Date(snoozedUntil).getHours() * 60 + new Date(snoozedUntil).getMinutes() : scheduled;
        if (nowMinutes > scheduled + routine.windowMinutes) {
          const { logRoutine } = await import("./lib/routine-service");
          await logRoutine(uid, routine.id, today, "missed");
          continue;
        }
        if (nowMinutes >= dueAt && !dueRoutine) {
          if ((routine.priority === "critical" || routine.priority === "high" || routine.sessionBehavior === "pause") && running && !paused && tracker) await tracker.pauseSession(uid);
          setRoutineWarning(null); setDueRoutine(routine); return;
        }
        if (nowMinutes >= scheduled - routine.reminderMinutes && nowMinutes < scheduled && !routineWarning && !dueRoutine) setRoutineWarning(routine);
      }
    };
    void check(); const interval = window.setInterval(() => void check(), 30000); return () => window.clearInterval(interval);
  }, [uid, routines, routineLogs, running, paused, tracker, dueRoutine, routineWarning, appMode]);
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

  useEffect(() => {
    if (!firebaseConfigured) return;
    let disposed = false;
    let offActive: () => void = () => {};
    let offProjects: () => void = () => {};
    let offLogs: () => void = () => {};
    let offNotes: () => void = () => {};
    let offRoutines: () => void = () => {};
    let offRoutineLogs: () => void = () => {};
    let offAppMode: () => void = () => {};
    let offFinanceAccounts: () => void = () => {};
    let offFinanceTransactions: () => void = () => {};
    let offFinanceAssets: () => void = () => {};
    let offFinanceGoals: () => void = () => {};
    let offRecurringFinance: () => void = () => {};
    let offFinanceBudgets: () => void = () => {};
    const todoUnsubscribers: Array<() => void> = [];
    (async () => {
      try {
        const [{ auth }, service, todoService, noteService, routineService, financeService, authSdk] = await Promise.all([
          import("./lib/firebase"),
          import("./lib/tracker-service"),
          import("./lib/todo-service"),
          import("./lib/note-service"),
          import("./lib/routine-service"),
          import("./lib/finance-service"),
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
        offLogs = service.subscribeToWorkLogs(
          user.uid,
          (items: ReportLog[]) => {
            if (disposed) return;
            const now = new Date();
            const todayRange = getReportDateRange("today", now, timezone);
            const weekRange = getReportDateRange("week", now, timezone);
            const monthRange = getReportDateRange("month", now, timezone);
            const inRange = (log: ReportLog, from: string, to: string) => {
              const key = log.dateString || "";
              return key >= from && key <= to;
            };
            // One listener is the source of truth. Every derived dashboard
            // slice gets a fresh array, so React recalculates progress,
            // sessions and charts immediately for local and remote writes.
            setRecentLogs(items);
            setTodayLogs(
              items.filter((log) => inRange(log, todayRange.from, todayRange.to)),
            );
            setWeekLogs(
              items.filter((log) => inRange(log, weekRange.from, weekRange.to)),
            );
            setMonthLogs(
              items.filter((log) => inRange(log, monthRange.from, monthRange.to)),
            );
          },
        );
        offNotes = noteService.subscribeToNotes(user.uid, setNotes);
        offRoutines = routineService.subscribeToRoutines(user.uid, setRoutines);
        offRoutineLogs = routineService.subscribeToRoutineLogs(user.uid, setRoutineLogs);
        offAppMode = subscribeToAppMode(user.uid, setAppMode);
        offFinanceAccounts = financeService.subscribeToFinanceAccounts(user.uid, setFinanceAccounts);
        offFinanceTransactions = financeService.subscribeToFinanceTransactions(user.uid, setFinanceTransactions);
        offFinanceAssets = financeService.subscribeToFinanceAssets(user.uid, setFinanceAssets);
        offFinanceGoals = financeService.subscribeToFinanceGoals(user.uid, setFinanceGoals);
        offRecurringFinance = financeService.subscribeToRecurringFinanceItems(user.uid, setRecurringFinanceItems);
        offFinanceBudgets = financeService.subscribeToFinanceBudgets(user.uid, setFinanceBudgets);
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
            setActiveSessionProjectId(active?.projectId || null);
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
            } else {
              setRecoveryGap(false);
            }
          },
        );
        // Listener setup succeeded. Do not keep a stale operation error
        // (for example from an older PWA bundle) on an otherwise synced app.
        setSyncError("");
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
      offLogs();
      offNotes();
      offRoutines();
      offRoutineLogs();
      offAppMode();
      offFinanceAccounts();
      offFinanceTransactions();
      offFinanceAssets();
      offFinanceGoals();
      offRecurringFinance();
      offFinanceBudgets();
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
  const timerProjectId = activeSessionProjectId || selectedId;
  const timerProject = projects.find((project) => project.id === timerProjectId);
  const finishProject = projects.find((project) => project.id === (finishProjectId || timerProjectId));
  const sessionOpenTodos = useMemo(
    () => sortTodos(todos.filter((todo) => todo.status === "open" && todo.projectId === (finishProjectId || timerProjectId))),
    [todos, finishProjectId, timerProjectId],
  );
  const elapsed = startedAt
    ? accumulatedSeconds +
      (paused ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000)))
    : accumulatedSeconds;
  useEffect(() => {
    const targetSeconds = (timerProject?.targetMinutes || 0) * 60;
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
  }, [elapsed, running, timerProject?.targetMinutes, playTargetTone]);
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
        todoStats: buildTodoDayStats(
          todos.filter(
            (todo) =>
              todo.projectId === project.id &&
              todo.plannedDateString === localDateKey(),
          ),
          localDateKey(),
        ),
      })),
    [activeProjects, todayAggregate.byProject, todos],
  );
  const average = todayAggregate.sessionCount
    ? Math.round(todayAggregate.totalMinutes / todayAggregate.sessionCount)
    : 0;
  const todayTodoStats = useMemo(
    () => buildTodoDayStats(todos, localDateKey()),
    [todos],
  );
  const todayFocusTodos = useMemo(
    () =>
      sortTodos(
        todos.filter(
          (todo) =>
            todo.status === "open" && todo.plannedDateString === localDateKey(),
        ),
      ).slice(0, 3),
    [todos],
  );
  const overdueTodos = useMemo(
    () =>
      todos.filter(
        (todo) =>
          todo.status === "open" && todo.plannedDateString < localDateKey(),
      ),
    [todos],
  );
  const dailyProgressPercent = dailyTarget
    ? Math.min(100, (todayAggregate.totalMinutes / dailyTarget) * 100)
    : 0;
  const dailyProgressLabel =
    dailyProgressPercent >= 100
      ? "Target achieved"
      : dailyProgressPercent >= 60
        ? "On track"
        : dailyProgressPercent >= 30
          ? "In progress"
          : "Just getting started";
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
    const days = sessionFilter === "last7" ? 7 : sessionFilter === "last30" ? 30 : 2;
    const today = new Date();
    const keys = new Set(
      Array.from({ length: days }, (_, index) => {
        const date = new Date(today);
        date.setDate(today.getDate() - index);
        return date.toLocaleDateString("en-CA", { timeZone: timezone });
      }),
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
    if (vacationActive) {
      setSyncError("Vacation mode is active. Work tracking resumes after your vacation.");
      return;
    }
    if (activeAppMode === "break") {
      setSyncError("End your break before starting a work session.");
      return;
    }
    if (!selectedProject)
      return setSyncError("Select an active project first.");
    try {
      setSyncError("");
      setTargetReached(false);
      targetAlertedRef.current = false;
      if (uid && tracker) {
        await tracker.startSession(uid, selectedProject.id);
      }
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
    if (vacationActive || activeAppMode === "break") {
      setSyncError(vacationActive ? "Vacation mode is active. Work tracking is unavailable." : "End your break before resuming work.");
      return;
    }
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
  const startBreak = async (minutes: number, reason: string) => {
    if (vacationActive) throw new Error("Vacation mode is active.");
    if (running && !paused) await pause();
    const next: AppModeState = {
      mode: "break",
      breakStartedAt: new Date().toISOString(),
      breakExpectedEndAt: new Date(Date.now() + minutes * 60_000).toISOString(),
      breakReason: reason || "Recovery break",
    };
    setAppMode(next);
    if (uid) await saveAppMode(uid, next);
  };
  const resumeWorkMode = async () => {
    setAppMode(WORKDAY_MODE);
    if (uid) await saveAppMode(uid, WORKDAY_MODE);
  };
  const planVacation = async (startDate: string, endDate: string, reason: string, relaxedDiscipline: boolean) => {
    if (endDate < startDate) throw new Error("Vacation end date must be after its start date.");
    if (startDate <= localDateKey() && localDateKey() <= endDate && running && !paused) await pause();
    const next: AppModeState = { mode: "vacation", vacationStartDate: startDate, vacationEndDate: endDate, vacationReason: reason, relaxedDiscipline };
    setAppMode(next);
    if (uid) await saveAppMode(uid, next);
  };
  const openFinishModal = (projectId: string) => {
    setSessionTodoIds([]);
    setNotedSessionTodoIds([]);
    // Freeze the timer's visible project for this save flow. A Firebase
    // snapshot arriving behind the modal must not switch the checklist.
    setFinishProjectId(projectId);
    setShowNote(true);
  };
  const closeFinishModal = () => {
    if (finishingSession) return;
    setShowNote(false);
    setSessionTodoIds([]);
    setNotedSessionTodoIds([]);
    setFinishProjectId(null);
  };
  const finish = async () => {
    if (!note.trim()) return;
    const concise = summary.trim() || summarizeNote(note);
    const tasksToComplete = sessionOpenTodos.filter((todo) =>
      sessionTodoIds.includes(todo.id),
    );
    try {
      setFinishingSession(true);
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
      } else {
        const start = new Date(startedAt || Date.now());
        const end = new Date();
        const local: ReportLog = {
          id: `local-${end.getTime()}`,
          projectId: timerProjectId,
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
      if (tasksToComplete.length) {
        const completionResults = await Promise.allSettled(
          tasksToComplete.map((todo) => toggleTodo(todo, true)),
        );
        const failedCount = completionResults.filter(
          (result) => result.status === "rejected",
        ).length;
        if (failedCount) {
          setSyncError(
            `Session was saved, but ${failedCount} selected task${
              failedCount === 1 ? "" : "s"
            } could not be completed. Please retry from Tasks.`,
          );
        }
      }
      setNote("");
      setSummary("");
      setSessionTodoIds([]);
      setNotedSessionTodoIds([]);
      setFinishProjectId(null);
      setShowNote(false);
    } catch (error: any) {
      setSyncError(error?.message || "Could not save session.");
    } finally {
      setFinishingSession(false);
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
      if (uid && tracker) {
        const created = await tracker.createProject(uid, { name, targetMinutes });
        // Do not wait for a later remote snapshot before the new project is
        // usable.  The listener reconciles this optimistic entry by id.
        setProjects((items) => [
          ...items.filter((project) => project.id !== created.id),
          created,
        ].sort((a, b) => a.sortOrder - b.sortOrder));
        setSelectedId(created.id);
      } else {
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
  const updateTodo = async (
    todo: Todo,
    patch: {
      title: string;
      projectId: string | null;
      priority: TodoPriority;
      plannedDateString: string;
    },
  ) => {
    if (uid)
      return (await import("./lib/todo-service")).updateTodo(
        uid,
        todo.id,
        patch,
      );
    setTodos((items) =>
      items.map((item) => (item.id === todo.id ? { ...item, ...patch } : item)),
    );
  };
  const removeTodo = async (todo: Todo) => {
    if (!window.confirm(`Delete “${todo.title}”?`)) return;
    if (uid)
      return (await import("./lib/todo-service")).deleteTodo(uid, todo.id);
    setTodos((items) => items.filter((item) => item.id !== todo.id));
  };
  const createNote = async (input: { projectId: string; title: string; content: string; type: any; pinned: boolean }) => {
    if (uid) return (await import("./lib/note-service")).createNote(uid, input);
  };
  const updateNote = async (note: ProjectNote, patch: any) => {
    if (uid) return (await import("./lib/note-service")).updateNote(uid, note.id, patch);
  };
  const deleteNote = async (note: ProjectNote) => {
    if (!window.confirm(`Delete “${note.title}”?`)) return;
    if (uid) return (await import("./lib/note-service")).deleteNote(uid, note.id);
  };
  const convertNote = async (note: ProjectNote, input: { title: string; priority: TodoPriority; plannedDateString: string; sourceText: string }) => {
    if (uid) return (await import("./lib/note-service")).convertNoteToTask(uid, note, input).then(() => undefined);
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
  const syncNeedsAttention = Boolean(
    firebaseConfigured && uid && syncState && (
      !syncState.online || syncState.syncing || syncState.conflicts ||
      syncState.failed || syncState.pending || syncState.fromCache
    ),
  );

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
      {mobileNav && (
        <button
          type="button"
          className="mobile-nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
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
          <a className={view === "notes" ? "active" : ""} onClick={() => { setNotesProjectId(null); setNotesFocusId(null); setView("notes"); setMobileNav(false); }}>
            <StickyNote size={18} />
            Notes
          </a>
          <a className={view === "vault" ? "active" : ""} onClick={() => { setView("vault"); setMobileNav(false); }}>
            <KeyRound size={18} />
            Vault
          </a>
          <a className={view === "discipline" ? "active" : ""} onClick={() => { setView("discipline"); setMobileNav(false); }}>
            <Sparkles size={18} />
            Discipline
          </a>
          <a className={view === "finance" ? "active" : ""} onClick={() => { setView("finance"); setMobileNav(false); }}>
            <Landmark size={18} />
            Finance
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
        {view !== "overview" && (
          <div className="mobile-page-navigation" aria-label="Page navigation">
            <button type="button" onClick={() => setMobileNav(true)}>
              <Menu size={18} />
              Menu
            </button>
            <button type="button" onClick={() => setView("overview")}>
              <ArrowLeft size={18} />
              Overview
            </button>
          </div>
        )}
        {["sessions", "projects", "todos", "notes", "vault"].includes(view) && <div className="app-mode-global">
          <AppModeControl
            mode={activeAppMode}
            state={appMode}
            onStartBreak={startBreak}
            onResumeWork={resumeWorkMode}
            onPlanVacation={planVacation}
            onEndVacation={resumeWorkMode}
          />
        </div>}
        {view !== "sessions" && view !== "projects" && view !== "todos" && view !== "notes" && view !== "vault" && <header>
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
            <AppModeControl
              mode={activeAppMode}
              state={appMode}
              onStartBreak={startBreak}
              onResumeWork={resumeWorkMode}
              onPlanVacation={planVacation}
              onEndVacation={resumeWorkMode}
            />
            {firebaseConfigured && uid && syncState && !syncNeedsAttention && (
              <span className="sync-status-icon" title="Workspace synced" aria-label="Workspace synced">
                <Cloud size={17} />
              </span>
            )}
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
        </header>}
        {vacationActive && !["discipline", "reports", "notes", "settings"].includes(view) ? (
          <VacationModePanel
            state={appMode}
            routines={routines}
            logs={routineLogs}
            onOpenDiscipline={() => setView("discipline")}
            onEndVacation={resumeWorkMode}
          />
        ) : view === "projects" ? (
          <ProjectsView
            projects={projects}
            logs={monthLogs}
            todos={todos}
            notes={notes}
            financeTransactions={financeTransactions}
            selectedProjectId={projectDashboardId}
            onSelectProject={setProjectDashboardId}
            onEdit={(project) => {
              setProjectSaveError("");
              setEditingProject(project);
            }}
            onCreate={() => {
              setAddProjectError("");
              setShowAddProject(true);
            }}
            onStatus={changeProjectStatus}
            onOpenNotes={(projectId) => { setNotesProjectId(projectId); setNotesFocusId(null); setView("notes"); }}
          />
        ) : view === "todos" ? (
          <TodosView
            todos={todos}
            projects={projects}
            defaultProjectId={selectedId}
            onCreate={createTodo}
            onToggle={toggleTodo}
            onMove={moveTodo}
            onUpdate={updateTodo}
            onDelete={removeTodo}
            onOpenNote={(noteId) => { setNotesProjectId(null); setNotesFocusId(noteId); setView("notes"); }}
          />
        ) : view === "notes" ? (
          <NotesView notes={notes} todos={todos} projects={projects} initialProjectId={notesProjectId} initialNoteId={notesFocusId} onCreate={createNote} onUpdate={updateNote} onDelete={deleteNote} onConvert={convertNote} />
        ) : view === "vault" ? (
          uid ? <VaultView uid={uid} projects={projects} /> : null
        ) : view === "discipline" ? (
          uid ? <DisciplineView uid={uid} routines={routines} logs={routineLogs} /> : null
        ) : view === "finance" ? (
          uid ? <FinanceView accounts={financeAccounts} transactions={financeTransactions} assets={financeAssets} goals={financeGoals} recurring={recurringFinanceItems} budgets={financeBudgets} projects={projects} workLogs={recentLogs} onAccount={async input => { const service = await import("./lib/finance-service"); await service.createFinanceAccount(uid, input); }} onArchiveAccount={async id => { const service = await import("./lib/finance-service"); await service.archiveFinanceAccount(uid, id); }} onRestoreAccount={async id => { const service = await import("./lib/finance-service"); await service.restoreFinanceAccount(uid, id); }} onTransaction={async input => { const service = await import("./lib/finance-service"); await service.createFinanceTransaction(uid, input); }} onReverse={async item => { const service = await import("./lib/finance-service"); await service.reverseFinanceTransaction(uid, item); }} onAsset={async input => { const service = await import("./lib/finance-service"); await service.createFinanceAsset(uid, input); }} onGoal={async input => { const service = await import("./lib/finance-service"); await service.createFinanceGoal(uid, input); }} onRecurring={async input => { const service = await import("./lib/finance-service"); await service.createRecurringFinanceItem(uid, input); }} onPostRecurring={async item => { const service = await import("./lib/finance-service"); await service.postRecurringFinanceItem(uid, item, localDateKey()); }} onBudget={async input => { const service = await import("./lib/finance-service"); await service.saveFinanceBudget(uid, input); }} /> : null
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
            {firebaseConfigured && uid && syncState && syncNeedsAttention && (
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
            <section className="overview-kpi-grid">
              <OverviewKpi icon={<Timer size={19} />} label="Total tracked" value={mins(todayAggregate.totalMinutes)} detail="Completed sessions today" tone="blue" />
              <OverviewKpi icon={<Target size={19} />} label="Daily target" value={mins(dailyTarget)} detail={`${Math.round(dailyProgressPercent)}% complete`} tone="purple" progress={dailyProgressPercent} />
              <button className="overview-kpi overview-kpi-button" onClick={() => setView("todos")}>
                <span className="overview-kpi-icon green"><ListTodo size={19} /></span><span><small>Today’s tasks</small><strong>{todayTodoStats.completedFromPlan} / {todayTodoStats.planned}</strong><em>{todayTodoStats.open ? `${todayTodoStats.open} remaining` : todayTodoStats.planned ? "All completed" : "Plan your day"}</em></span>
              </button>
              <OverviewKpi icon={<BarChart3 size={19} />} label="Sessions" value={String(todayAggregate.sessionCount)} detail="Completed today" tone="pink" />
              <OverviewKpi icon={<Clock3 size={19} />} label="Avg. session" value={mins(average)} detail="Completed sessions only" tone="indigo" />
            </section>
            <section className="overview-layout">
              <div className="overview-main-column">
                <div className="overview-focus-grid">
                  <section className="overview-card focus-card">
                    <div className="overview-card-head"><div><span className="overview-title-icon flame"><Flame size={17} /></span><h3>Today’s focus</h3></div><button className="text-btn" onClick={() => setView("todos")}>View all tasks →</button></div>
                    <div className="focus-list">
                      {todayFocusTodos.length ? todayFocusTodos.map((todo, index) => (
                        <div className="focus-row" key={todo.id}>
                          <span className="focus-number">{index + 1}</span>
                          <button className="focus-check" onClick={() => void toggleTodo(todo, true)} aria-label={`Complete ${todo.title}`} />
                          <div><b>{todo.title}</b><small><i style={{ background: projectColor(todo.projectId || "") }} />{projectName(todo.projectId || "Personal")} <em className={`priority-${todo.priority}`}>{todo.priority}</em></small></div>
                        </div>
                      )) : <div className="overview-empty"><ListTodo size={20} /><span>No tasks planned for today.</span><button className="text-btn" onClick={() => setView("todos")}>Plan tasks →</button></div>}
                    </div>
                    <div className="focus-footer"><span>{todayTodoStats.open} remaining</span><button className="text-btn" onClick={() => setView("todos")}>Open Tasks →</button></div>
                  </section>
                  <section className="overview-card progress-hero-card">
                    <div className="overview-card-head"><div><span className="overview-title-icon target"><Target size={17} /></span><h3>Today’s progress</h3></div><span className={`progress-status ${dailyProgressPercent >= 100 ? "complete" : ""}`}>{dailyProgressLabel}</span></div>
                    <div className="progress-hero-value"><strong>{mins(todayAggregate.totalMinutes)}</strong><span>/ {mins(dailyTarget)}</span></div>
                    <p>tracked time</p><div className="overview-progress-track"><i style={{ width: `${dailyProgressPercent}%` }} /></div><div className="progress-hero-foot"><b>{Math.round(dailyProgressPercent)}%</b><span>{dailyTarget > todayAggregate.totalMinutes ? `${mins(dailyTarget - todayAggregate.totalMinutes)} remaining` : "Daily goal completed"}</span></div>
                    <div className="progress-cheer"><Trophy size={19} /><div><b>{dailyProgressPercent >= 100 ? "Great work!" : "Keep your momentum"}</b><span>{dailyProgressPercent >= 100 ? "You have reached today’s target." : "Every focused session moves the day forward."}</span></div></div>
                  </section>
                </div>
                <section className="overview-work-grid">
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
                    value={running ? activeSessionProjectId || selectedId : selectedId}
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
                      onClick={() => {
                        // Never derive a completed session from a visual
                        // selector.  The active-session document is the
                        // authoritative project identity for this timer.
                        openFinishModal(activeSessionProjectId || selectedId);
                      }}
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
                <div className="overview-bottom-grid">
                <section className="overview-card overview-projects-card">
              <div className="card-heading">
                <div>
                  <div className="overview-card-title"><span className="overview-title-icon target"><Target size={17} /></span><div><h3>Today’s projects</h3><p className="muted">Time and task completion by project</p></div></div>
                </div>
                <button className="text-btn" onClick={() => { setProjectDashboardId(null); setView("projects"); }}>View all projects →</button>
              </div>
              <div className="overview-project-list">
                {progress.map((project) => (
                  <button className="overview-project-row" key={project.id} onClick={() => { setProjectDashboardId(project.id); setView("projects"); }}>
                    <i className="project-row-dot" style={{ background: project.color }} />
                    <div className="overview-project-name"><b>{project.name}</b><span>{mins(project.completed)} / {mins(project.targetMinutes)}</span></div>
                    <div className="overview-project-progress"><div><i style={{ width: `${Math.min(100, (project.completed / project.targetMinutes) * 100)}%`, background: project.color }} /></div><small>{Math.round((project.completed / project.targetMinutes) * 100)}%</small></div>
                    <div className="overview-project-tasks"><span>Tasks</span><b>{project.todoStats.completedFromPlan} / {project.todoStats.planned}</b><em>{project.todoStats.planned ? "Today" : "No tasks"}</em></div>
                  </button>
                ))}
              </div>
            </section>
                <OverviewRecentSessions rows={sessionRows.slice(0, 4)} projectName={projectName} projectColor={projectColor} onViewAll={() => setView("sessions")} />
                </div>
              </div>
              <aside className="overview-aside">
                <OverviewCalendar todos={todos} onOpenTasks={() => setView("todos")} />
                <section className="overview-card attention-card"><div className="overview-card-head"><div><span className="overview-title-icon warning"><Bell size={17} /></span><h3>Needs attention</h3></div></div>{overdueTodos.length ? <><div className="attention-line"><b>{overdueTodos.length} overdue task{overdueTodos.length === 1 ? "" : "s"}</b><button className="text-btn" onClick={() => setView("todos")}>View all →</button></div>{overdueTodos.slice(0, 2).map((todo) => <div className="attention-task" key={todo.id}><i /><span>{todo.title}<small>{projectName(todo.projectId || "Personal")} · planned {todo.plannedDateString}</small></span></div>)}</> : <div className="overview-empty attention-clear"><Trophy size={20} /><span>All clear — no overdue tasks.</span></div>}{progress.some((project) => project.completed < project.targetMinutes) && <div className="attention-pace"><b>Daily pace</b><span>{progress.filter((project) => project.completed < project.targetMinutes).length} project{progress.filter((project) => project.completed < project.targetMinutes).length === 1 ? " needs" : "s need"} more focused time today.</span></div>}</section>
                <OverviewTaskTimeline todos={todos} projectName={projectName} onOpenTasks={() => setView("todos")} />
              </aside>
            </section>
          </>
        )}
      </main>
      {routineWarning && uid && <div className="modal-backdrop routine-due-modal"><section className="note-modal"><div className="modal-icon"><Bell size={20}/></div><span className="eyebrow">UPCOMING ROUTINE</span><h3>{routineWarning.name}</h3><p>Your {routineWarning.time} commitment starts soon. Wrap up or pause your current focus session before it is due.</p><div className="routine-due-actions"><button className="outline-btn" onClick={() => setRoutineWarning(null)}>Continue working</button><button className="start-btn" onClick={async () => { if (uid && running && !paused && tracker) await tracker.pauseSession(uid); setRoutineWarning(null); }}>Pause now</button></div></section></div>}
      {dueRoutine && uid && <div className="modal-backdrop routine-due-modal"><section className="note-modal"><div className="modal-icon"><Sparkles size={20}/></div><span className="eyebrow">SCHEDULED ROUTINE</span><h3>{dueRoutine.name}</h3><p>It is {dueRoutine.time}. {(dueRoutine.priority === "critical" || dueRoutine.priority === "high" || dueRoutine.sessionBehavior === "pause") && running ? "Your active work session was paused." : "Take this time for your commitment."}</p><div className="routine-due-actions"><button className="outline-btn" onClick={async () => { const { logRoutine } = await import("./lib/routine-service"); await logRoutine(uid, dueRoutine.id, localDateKey(), "snoozed", { snoozedUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString() }); setDueRoutine(null); }}>Snooze 10 min</button><button className="outline-btn" onClick={async () => { if (dueRoutine.priority === "critical") { const reason = window.prompt("Why are you skipping this critical routine?"); if (!reason?.trim()) return; const { logRoutine } = await import("./lib/routine-service"); await logRoutine(uid, dueRoutine.id, localDateKey(), "skipped", { skippedReason: reason.trim() }); } else { const { logRoutine } = await import("./lib/routine-service"); await logRoutine(uid, dueRoutine.id, localDateKey(), "skipped"); } setDueRoutine(null); }}>Skip</button><button className="start-btn" onClick={async () => { const { logRoutine } = await import("./lib/routine-service"); await logRoutine(uid, dueRoutine.id, localDateKey(), "completed"); setDueRoutine(null); }}>Complete routine</button></div></section></div>}
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
          <div className="note-modal session-finish-modal">
            <button
              className="modal-close"
              onClick={closeFinishModal}
              disabled={finishingSession}
              aria-label="Close end session dialog"
            >
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
            <section className="session-todo-completion" aria-label="Project tasks">
                <div className="session-todo-heading">
                  <div>
                    <span>OPEN TASKS FOR {finishProject?.name || "THIS PROJECT"}</span>
                    <p>{sessionOpenTodos.length ? "Tick completed work to update your Todo list when this session is saved." : "No open tasks are linked to this project yet."}</p>
                  </div>
                  <b>{sessionOpenTodos.length}</b>
                </div>
                <div className="session-todo-list">
                  {sessionOpenTodos.map((todo) => {
                    const checked = sessionTodoIds.includes(todo.id);
                    return (
                      <label key={todo.id} className={checked ? "selected" : ""}>
                        <input
                          type="checkbox"
                          name="completed-session-todos"
                          checked={checked}
                          disabled={finishingSession}
                          onChange={() => {
                            if (checked) {
                              setSessionTodoIds((ids) =>
                                ids.filter((id) => id !== todo.id),
                              );
                              return;
                            }
                            setSessionTodoIds((ids) => [...ids, todo.id]);
                            // Add the task once, without overwriting any
                            // detailed work note the user has already typed.
                            if (!notedSessionTodoIds.includes(todo.id)) {
                              setNote((current) =>
                                current.trim()
                                  ? `${current.trim()}\n• ${todo.title}`
                                  : `Completed: ${todo.title}`,
                              );
                              setSummary("");
                              setNotedSessionTodoIds((ids) => [
                                ...ids,
                                todo.id,
                              ]);
                            }
                          }}
                        />
                        <span>{todo.title}</span>
                        <small>{todo.priority}</small>
                      </label>
                    );
                  })}
                </div>
                {!sessionOpenTodos.length && <p className="session-todo-empty">Create project-linked tasks from Tasks to complete them with a session.</p>}
              </section>
            <div className="modal-actions">
              <button
                className="outline-btn"
                onClick={closeFinishModal}
                disabled={finishingSession}
              >
                Cancel
              </button>
              <button
                className="start-btn"
                disabled={!note.trim() || finishingSession}
                onClick={finish}
              >
                {finishingSession ? "Saving…" : "Save session"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function VacationModePanel({ state, routines, logs, onOpenDiscipline, onEndVacation }: { state: AppModeState; routines: Routine[]; logs: RoutineLog[]; onOpenDiscipline: () => void; onEndVacation: () => Promise<void> }) {
  const today = localDateKey();
  const todayDay = new Date(`${today}T12:00:00`).getDay();
  const todayRoutines = routines.filter((routine) => routine.active && routine.repeatDays.includes(todayDay) && (!routine.effectiveDate || routine.effectiveDate <= today) && (!routine.endDate || routine.endDate >= today));
  const completed = todayRoutines.filter((routine) => logs.find((log) => log.id === `${routine.id}-${today}`)?.status === "completed").length;
  const days = state.vacationStartDate && state.vacationEndDate ? Math.max(1, Math.floor((new Date(`${state.vacationEndDate}T12:00:00`).getTime() - new Date(`${state.vacationStartDate}T12:00:00`).getTime()) / 86_400_000) + 1) : 1;
  const currentDay = state.vacationStartDate ? Math.max(1, Math.floor((new Date(`${today}T12:00:00`).getTime() - new Date(`${state.vacationStartDate}T12:00:00`).getTime()) / 86_400_000) + 1) : 1;
  return <section className="vacation-mode-panel"><div className="vacation-mark"><Palmtree size={31} /></div><span className="eyebrow">VACATION MODE</span><h2>You’re off work.</h2><p>{state.vacationStartDate} – {state.vacationEndDate} · Day {Math.min(currentDay, days)} of {days}</p>{state.vacationReason && <small>{state.vacationReason}</small>}<div className="vacation-mode-stats"><article><b>Work tracking</b><span>Paused</span></article><article><b>Tasks & projects</b><span>On hold</span></article><article><b>Personal routines</b><span>{completed} / {todayRoutines.length} complete</span></article></div><p className="vacation-reassurance">No daily target or overdue-task pressure while you are away. Your personal discipline remains available.</p><div><button className="outline-btn" onClick={onOpenDiscipline}>View today’s discipline</button><button className="start-btn" onClick={() => void onEndVacation()}>End vacation</button></div></section>;
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

function OverviewKpi({
  icon,
  label,
  value,
  detail,
  tone,
  progress,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: string;
  progress?: number;
}) {
  return (
    <div className="overview-kpi">
      <span className={`overview-kpi-icon ${tone}`}>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        {progress !== undefined ? (
          <div className="overview-kpi-progress">
            <i style={{ width: `${progress}%` }} />
            <em>{detail}</em>
          </div>
        ) : (
          <em>{detail}</em>
        )}
      </div>
    </div>
  );
}

function OverviewCalendar({
  todos,
  onOpenTasks,
}: {
  todos: Todo[];
  onOpenTasks: () => void;
}) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const keyFor = (day: number) =>
    localDateKey(new Date(year, month, day, 12, 0, 0));
  return (
    <section className="overview-card overview-calendar-card">
      <div className="overview-card-head">
        <div>
          <span className="overview-title-icon calendar"><CalendarDays size={17} /></span>
          <h3>Calendar</h3>
        </div>
      </div>
      <h4>
        {now.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
      </h4>
      <div className="overview-calendar-weekdays">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="overview-calendar-grid">
        {Array.from({ length: offset + days }, (_, index) => {
          if (index < offset) return <span key={`blank-${index}`} />;
          const day = index - offset + 1;
          const key = keyFor(day);
          const planned = todos.some((todo) => todo.plannedDateString === key);
          const completed = todos.some(
            (todo) => todo.completedDateString === key,
          );
          const overdue = todos.some(
            (todo) => todo.status === "open" && todo.plannedDateString === key && key < localDateKey(),
          );
          return (
            <button
              key={key}
              type="button"
              className={key === localDateKey() ? "today" : ""}
              onClick={onOpenTasks}
              aria-label={`Open tasks for ${key}`}
            >
              <b>{day}</b>
              <i>
                {planned && <span className="planned" />}
                {completed && <span className="completed" />}
                {overdue && <span className="overdue" />}
              </i>
            </button>
          );
        })}
      </div>
      <div className="overview-calendar-legend">
        <span><i className="planned" /> Planned</span>
        <span><i className="completed" /> Completed</span>
        <span><i className="overdue" /> Overdue</span>
      </div>
      <button className="overview-calendar-open" onClick={onOpenTasks}>
        View tasks →
      </button>
    </section>
  );
}

function OverviewRecentSessions({
  rows,
  projectName,
  projectColor,
  onViewAll,
}: {
  rows: ReturnType<typeof normalizeReportLogs>;
  projectName: (id: string) => string;
  projectColor: (id: string) => string;
  onViewAll: () => void;
}) {
  const time = (value: Date) =>
    value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <section className="overview-card overview-recent-card">
      <div className="overview-card-head">
        <div>
          <span className="overview-title-icon sessions"><Clock3 size={17} /></span>
          <h3>Recent sessions</h3>
        </div>
        <button className="text-btn" onClick={onViewAll}>View all →</button>
      </div>
      <div className="overview-recent-list">
        {rows.length ? rows.map((row, index) => (
          <button className="overview-recent-row" key={`${row.id || row.date}-${index}`} onClick={onViewAll}>
            <i style={{ background: projectColor(row.projectId) }} />
            <span>
              <b>{projectName(row.projectId)}</b>
              <small>{time(row.startTime)} – {time(row.endTime)} · {mins(row.durationMinutes)}</small>
              <em>{row.notes || "No session note"}</em>
            </span>
          </button>
        )) : <div className="overview-empty"><Clock3 size={20} /><span>No completed sessions yet.</span></div>}
      </div>
    </section>
  );
}

function OverviewTaskTimeline({
  todos,
  projectName,
  onOpenTasks,
}: {
  todos: Todo[];
  projectName: (id: string) => string;
  onOpenTasks: () => void;
}) {
  const today = localDateKey();
  const items = sortTodos(
    todos.filter((todo) => todo.plannedDateString === today),
  ).slice(0, 5);
  return (
    <section className="overview-card task-timeline-card">
      <div className="overview-card-head">
        <div>
          <span className="overview-title-icon timeline"><ListTodo size={17} /></span>
          <h3>Today’s timeline</h3>
        </div>
        <button className="text-btn" onClick={onOpenTasks}>Tasks →</button>
      </div>
      {items.length ? (
        <div className="task-timeline-list">
          {items.map((todo) => (
            <button key={todo.id} className={`task-timeline-row ${todo.status === "completed" ? "done" : ""}`} onClick={onOpenTasks}>
              <i />
              <span>
                <b>{todo.title}</b>
                <small>{projectName(todo.projectId || "Personal")} · {todo.status === "completed" ? "Completed" : "Planned today"}</small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="overview-empty"><ListTodo size={20} /><span>No timeline items today.</span></div>
      )}
    </section>
  );
}

function SessionsCard({
  title, rows, projectName, projectColor, viewAll, back, filterable,
  filter, setFilter, from, to, setFrom, setTo, onEdit, onDelete,
}: {
  title: string; rows: ReturnType<typeof normalizeReportLogs>;
  projectName: (id: string) => string; projectColor: (id: string) => string;
  viewAll?: () => void; back?: () => void; filterable?: boolean;
  filter?: "last2" | "last7" | "last30" | "custom";
  setFilter?: (value: "last2" | "last7" | "last30" | "custom") => void;
  from?: string; to?: string; setFrom?: (value: string) => void; setTo?: (value: string) => void;
  onEdit?: (row: ReturnType<typeof normalizeReportLogs>[number]) => void;
  onDelete?: (row: ReturnType<typeof normalizeReportLogs>[number]) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const totalMinutes = rows.reduce((sum, row) => sum + row.durationMinutes, 0);
  const projectCount = new Set(rows.map((row) => row.projectId)).size;
  const searchedRows = rows.filter((row) => {
    const query = search.trim().toLowerCase();
    return !query || `${projectName(row.projectId)} ${row.notes || ""}`.toLowerCase().includes(query);
  });
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(searchedRows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = searchedRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const selectFilter = (value: "last2" | "last7" | "last30" | "custom") => { setPage(0); setFilter?.(value); };
  const time = (value: Date) => value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <section className={`sessions-card session-workspace${back ? " full-sessions" : ""}`}>
      <div className="session-page-heading">
        <div><span className="session-heading-icon"><Clock3 size={21} /></span><div><h2>{title}</h2><p>Review your work history, session notes, and productivity.</p></div></div>
        {viewAll ? <button className="text-btn" onClick={viewAll}>View all →</button> : back ? <button className="outline-btn" onClick={back}>← Back to overview</button> : null}
      </div>
      {filterable && <div className="session-range-bar">
        <div className="session-range-tabs">
          {([ ["last2", "Last 2 days"], ["last7", "Last 7 days"], ["last30", "Last 30 days"], ["custom", "Custom range"] ] as const).map(([value, label]) => <button key={value} className={filter === value ? "selected" : ""} onClick={() => selectFilter(value)}><CalendarDays size={14} />{label}</button>)}
        </div>
        {filter === "custom" && <div className="session-date-range"><label>From<input id="session-filter-from" name="session-filter-from" type="date" value={from} onChange={(e) => { setPage(0); setFrom?.(e.target.value); }} /></label><label>To<input id="session-filter-to" name="session-filter-to" type="date" value={to} onChange={(e) => { setPage(0); setTo?.(e.target.value); }} /></label></div>}
      </div>}
      <div className="session-kpi-grid">
        <SessionKpi icon={<Timer size={19} />} label="Total tracked time" value={mins(totalMinutes)} tone="blue" />
        <SessionKpi icon={<CalendarDays size={19} />} label="Total sessions" value={String(rows.length)} tone="purple" />
        <SessionKpi icon={<FolderKanban size={19} />} label="Projects worked on" value={String(projectCount)} tone="green" />
        <SessionKpi icon={<Activity size={19} />} label="Avg. session duration" value={mins(rows.length ? Math.round(totalMinutes / rows.length) : 0)} tone="pink" />
      </div>
      <section className="session-history-card">
        <div className="session-history-head"><div><ListTodo size={18} /><h3>Sessions</h3></div><label className="session-search"><Search size={15} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search sessions…" /></label></div>
        <div className="session-table-wrap"><table className="session-history-table"><thead><tr><th>#</th><th>PROJECT</th><th>START – END</th><th>DURATION</th><th>NOTE / SUMMARY</th><th>ACTIONS</th></tr></thead><tbody>{visibleRows.length ? visibleRows.map((row, index) => <tr key={`${row.id || row.date}-${index}`}><td>{currentPage * pageSize + index + 1}</td><td><div className="session-project-cell"><i style={{ background: projectColor(row.projectId) }} /><span><b>{projectName(row.projectId)}</b><small>Work session</small></span></div></td><td><div className="session-time-cell"><b>{new Date(`${row.date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</b><small>{time(row.startTime)} – {time(row.endTime)}</small></div></td><td><b className="session-duration">{mins(row.durationMinutes)}</b></td><td><div className="session-note-cell"><b>{row.notes || "Untitled session"}</b><small>{row.notes || "No session note added."}</small></div></td><td className="session-icon-actions">{onEdit && <button className="icon-btn" title="Edit session" aria-label="Edit session" onClick={() => onEdit(row)}><Pencil size={14} /></button>}{onDelete && <button className="icon-btn danger" title="Delete session" aria-label="Delete session" onClick={() => onDelete(row)}><Trash2 size={14} /></button>}</td></tr>) : <tr><td colSpan={6} className="session-empty-cell">No sessions match this period or search.</td></tr>}</tbody></table></div>
        <div className="session-pagination"><span>{searchedRows.length ? `Showing ${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, searchedRows.length)} of ${searchedRows.length} sessions` : "No sessions"}</span><div><button className="icon-btn" disabled={!currentPage} onClick={() => setPage((value) => Math.max(0, value - 1))}>‹</button><b>{currentPage + 1}</b><span>/ {pageCount}</span><button className="icon-btn" disabled={currentPage >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>›</button></div></div>
      </section>
    </section>
  );
}

function SessionKpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return <article className="session-kpi"><span className={`session-kpi-icon ${tone}`}>{icon}</span><div><small>{label}</small><strong>{value}</strong><em>Selected period</em></div></article>;
}
