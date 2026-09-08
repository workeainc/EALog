# Plan 009: Add a project-linked daily Todo workspace

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 208539a..HEAD -- src/App.tsx src/components/ProjectsView.tsx src/lib/tracker-service.ts src/lib/offline-outbox.ts src/types/tracker.ts src/styles.css firestore.rules firestore.indexes.json`

## Status

- **Priority**: P1 (implemented 2026-09-09)
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `208539a`, 2026-09-09

## Why this matters

EA Log records completed work sessions but has no way to plan, complete, or review the work tasks that created those sessions. A separate Todo workspace should make the daily plan actionable while preserving the established rule that the timer stays only in Overview. Every task may be linked to a project, which makes task completion visible in that project's dashboard without duplicating task data into project documents.

## Product and data design

Use one owner-scoped collection, not a `projects/{projectId}/todos` subcollection:

```text
users/{uid}/todos/{todoId}
  title: string                         // 1–240 chars, plain text
  projectId: string | null              // null = personal / inbox task
  plannedDateString: "YYYY-MM-DD"      // immutable work-plan day
  status: "open" | "completed"
  priority: "low" | "medium" | "high"
  sortOrder: number
  completedAt: Timestamp | null
  completedDateString: "YYYY-MM-DD" | null
  createdAt: Timestamp
  updatedAt: Timestamp
  lastMutationId: string                // client-generated id for reconciliation
```

`plannedDateString` answers “what did I intend to do that day?” and `completedDateString` answers “when was it actually completed?” Never overwrite `plannedDateString` during completion. An open task from an earlier date is shown under **Overdue**, and only an explicit **Move to today** action changes its plan date. This prevents hidden rescheduling from inflating daily completion statistics.

Firestore remains the source of truth. Do not embed task arrays or completion counters in project documents: that would create duplicated data and cross-device drift. All completion statistics must be derived from Todo documents returned for the visible date/range.

## Current state

- `src/App.tsx:118` defines the page union (`overview`, `projects`, `reports`, `sessions`, `settings`) and `src/App.tsx:952-1024` renders the shared sidebar. Add `todos` as a top-level sibling, not inside the Projects dropdown.
- `src/App.tsx:202-216` refreshes log ranges by calling the tracker service. The new Todo view needs an independent listener/query lifecycle; do not add task data to the work-log state variables.
- `src/lib/tracker-service.ts:82-87` centralizes user-scoped Firestore references. `src/lib/tracker-service.ts:766-790` is the existing typed query pattern. Match these service-layer conventions.
- `src/lib/offline-outbox.ts` is intentionally timer-specific (`start`, `pause`, `resume`, `stop`). Firebase's persistent Firestore cache already queues ordinary `setDoc` Todo writes. Do not force Todos into this timer state machine.
- `src/components/ProjectsView.tsx:288-355` presents Project dashboard activity-by-day and an inline drill-down. Add a sibling **Tasks** card and reuse the same selected-day drill-down interaction for task completion statistics.
- `firestore.rules:11-33` permits only owner-scoped collections. Add an equally owner-only `/users/{userId}/todos/{todoId}` rule.
- UI conventions: reusable panel class names live in `src/styles.css`; edit flows use `modal-backdrop`, `note-modal`, `modal-field`, and `sync-warning` in `src/App.tsx:1447-1729`. Use Lucide icons already installed; do not add a component library.
- There is no test framework in `package.json`; `npm run build` is the verified gate. This plan establishes a lightweight Vitest test baseline for pure Todo/date aggregation logic before UI integration.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install dependencies | `npm install` | exit 0 |
| Unit tests | `npm test -- --run` | exit 0; all Todo tests pass |
| Production build | `npm run build` | exit 0; Vite may print only the existing large-chunk warning |
| Firestore rules/index deploy | `firebase deploy --only firestore:rules,firestore:indexes --project workhours-dashboard` | deploy succeeds |
| Hosting deploy | `firebase deploy --only hosting --project workhours-dashboard` | deploy succeeds |

## Scope

**In scope**

- `src/types/tracker.ts` — Todo types and explicit status/priority unions.
- `src/lib/todos.ts` — pure date grouping, ordering, and statistics helpers plus unit tests.
- `src/lib/tracker-service.ts` — Todo references, validation, CRUD, and scoped subscriptions/queries.
- `src/components/TodosView.tsx` — new responsive Todo workspace.
- `src/components/ProjectsView.tsx` — project/day task summary and drill-down; no timer controls.
- `src/App.tsx`, `src/styles.css` — navigation, state wiring, quick access card, and styling.
- `firestore.rules`, `firestore.indexes.json`, `package.json`, and new test configuration/files.

**Out of scope**

- Recurring tasks, subtasks, reminders/notifications, assignment to other users, calendar integrations, AI task generation, and adding Todo contents to PDF reports.
- Any change to active-session or timer outbox logic.
- Automatic rollover of incomplete tasks; rescheduling must be an explicit user action.
- Secure sharing/scheduled reports, which remain separate planned work.

## Git workflow

- Branch: `advisor/009-smart-project-todos`.
- Commit logical units with existing Conventional Commit style, e.g. `feat: add project-linked todo data`.
- Do not push or deploy until all verification gates pass and the operator asks for deployment.

## Steps

### Step 1: Establish Todo types, validation, and pure statistics

1. Add `TodoStatus`, `TodoPriority`, and `Todo` types to `src/types/tracker.ts`. Avoid `any`; all dates must use local `YYYY-MM-DD` keys, consistent with `WorkLog.dateString`.
2. Create `src/lib/todos.ts` with pure helpers only:
   - `todoDateKey(date)` using the browser local calendar, not `toISOString()`.
   - `sortTodos` (open tasks first, then priority, then sort order).
   - `buildTodoDayStats(todos, date)` returning planned, completed, open, overdue, completion percentage, and project breakdown.
   - `buildProjectTodoStats(todos, projectId, from, to)` returning day-by-day planned/completed/open counts.
3. Add Vitest and a `test` script. Write `src/lib/todos.test.ts` for empty lists, completion on a later day, overdue open tasks, project filtering, and local date boundaries.

**Verify**: `npm test -- --run` exits 0 with the new helper tests passing.

### Step 2: Add the owner-scoped Firestore Todo contract

1. Add `todosRef(uid)` beside `projectsRef` and `logsRef` in `src/lib/tracker-service.ts`.
2. Add service functions with input validation and no UI behavior:
   - `createTodo(uid, input)`; require title and planned date; permit `projectId: null`.
   - `updateTodo(uid, todoId, patch)`; allow title, priority, project, plan date, and sort order only.
   - `toggleTodoComplete(uid, todo, completed, now)`; set/clear `completedAt` and `completedDateString`; retain planned date.
   - `deleteTodo(uid, todoId)`.
   - `subscribeToTodosForRange(uid, from, to, callback)` and `subscribeToProjectTodos(uid, projectId, from, to, callback)`. Unsubscribe all listeners on view/user changes.
3. Use Firestore `serverTimestamp()` for audit timestamps and a generated `lastMutationId` for each write. Render the optimistic Firestore local snapshot immediately; when `snapshot.metadata.hasPendingWrites` is true, label only that task as **Syncing**, never as failed.
4. Add `/users/{userId}/todos/{todoId}` owner-only rules to `firestore.rules`.
5. Add exactly the indexes required by the queries to `firestore.indexes.json`:
   - `plannedDateString ASC`, `sortOrder ASC`
   - `projectId ASC`, `plannedDateString ASC`, `sortOrder ASC`
   Add a completion-date composite index only if a real query needs it; do not pre-create speculative indexes.

**Verify**: `npm run build` exits 0. Deploy rules and indexes to the configured Firebase project and create/update a Todo from two authenticated browser sessions; only the owning user can read it.

### Step 3: Build the Todo workspace

1. Add `todos` to the App view union and a **Tasks** sidebar item using `ListTodo` from `lucide-react`. It must work with the existing mobile sidebar behavior.
2. Create `src/components/TodosView.tsx` with this desktop/mobile layout:
   - Header: **Today, 9 Sep 2026**, today completion ring (`3 of 5 complete`), and remaining count.
   - Quick-add row: title, project selector (default to the currently selected timer project when active), priority, and **Add task**. Selecting “Personal / Inbox” stores `projectId: null`.
   - Main list: group Today tasks by project with the project color/name; one checkbox per task; completed tasks collapse under a clearly labeled **Completed** section.
   - Right/secondary section: **Overdue** (open tasks before today) and **Upcoming** (next 7 planned days). Provide only explicit actions: Complete, Edit, Move to today, Delete.
   - Date navigation: previous / today / next buttons. The page must support viewing a past day's plan without permitting hidden date changes.
3. Add accessible labels, keyboard focus states, empty states, and a visible offline/sync pending indicator using the existing sync visual language.

**Verify**: `npm test -- --run && npm run build` both exit 0. On mobile width, quick add and checkbox actions remain usable without horizontal scrolling.

### Step 4: Link Todo information into Overview and Projects without duplicating controls

1. In `src/App.tsx`, fetch/subscribe to the minimum Todo date range needed for Overview and the selected Projects view. Keep Todo listener state separate from work-log state. Do not alter timer start/pause/end controls.
2. Add a compact Overview **Today’s tasks** card: completion count, next 3 open tasks, and a **View all tasks** action that opens the Todo workspace. It must not become a second full Todo editor.
3. Extend `ProjectsView` props with project Todo data. In an individual project dashboard, add a **Today’s tasks** card showing planned/completed/open totals and the current project's tasks for the selected day.
4. When the user opens an **Activity by day** row, the existing session drill-down must add a **Tasks** subsection for that same day: planned count, completed count, and task titles/statuses. If there were no tasks planned that day, say so explicitly rather than presenting zero as an error.
5. Add a small monthly project task statistic beside the existing time pacing card: `completed / planned` and percentage. It must be task completion, never inferred from tracked minutes.

**Verify**: create tasks for two projects and one Inbox task. Confirm Todo workspace grouping, Overview count, and each project dashboard only display its own tasks. Complete a task on a later day and confirm the old day retains it as planned while today's statistic records the completion.

### Step 5: Handle offline and cross-device behavior deliberately

1. Test while offline: add, complete, edit, move, and delete a task. Confirm the UI shows pending state and remains usable.
2. Restore connectivity and confirm queued writes reach Firestore and the second browser receives the final state.
3. If two devices edit the same Todo offline, retain Firestore last-write-wins behavior but display a non-blocking “updated from another device” notice when a task's `lastMutationId` differs from a pending local action. Do not silently merge title text.
4. Document this conflict rule in a short developer comment next to the service mutation code.

**Verify**: run the offline scenario above; after reconnect, the task list agrees in both browsers and `npm run build` exits 0.

## Test plan

- `src/lib/todos.test.ts`: date creation, open/completed ordering, completed-on-later-date logic, overdue grouping, per-project daily counts, and percentage zero-denominator behavior.
- Service tests or Firebase Emulator tests (if emulator setup is added): owner isolation, input length validation, completion toggles preserve `plannedDateString`, and Todo range query ordering.
- Manual mobile verification: Safari/PWA quick add, check/uncheck, project selector, offline queue and reconnect.

## Done criteria

- [ ] Todo documents have the exact owner-scoped contract above; no task arrays/counters are persisted on Project documents.
- [ ] A user can create, edit, complete, uncomplete, move, and delete a task from the Todo workspace.
- [ ] Today, overdue, upcoming, and project groups are correct across local date boundaries.
- [ ] Overview and selected Project dashboard show derived Todo statistics; timer controls remain exclusively in Overview.
- [ ] Project day drill-down contains both session and Todo details for that date.
- [ ] Offline writes reconcile successfully and cross-device state converges.
- [ ] `npm test -- --run` and `npm run build` exit 0.
- [ ] Firestore rules/indexes are deployed and owner access is verified.
- [ ] No files outside scope changed; `plans/README.md` row is marked DONE only after all gates pass.

## STOP conditions

- The authenticated Firebase project does not have Firestore persistence enabled or the current user cannot write a direct Todo document.
- A required Todo query needs an index that is not declared in `firestore.indexes.json`; add the exact index only after confirming the query shape, then redeploy indexes.
- Existing work-log date keys are found to use a different timezone convention from `todoDateKey`; stop and unify the date contract before implementing statistics.
- Implementing a reliable cross-device conflict warning requires a server-side arbiter beyond Firestore metadata; report this rather than claiming a merge guarantee.

## Maintenance notes

- Recurrence, reminders, calendar sync, subtasks, and report inclusion are intentionally deferred because each changes the Todo data contract.
- Any future PDF/report task summary must use `plannedDateString` for planned work and `completedDateString` for actual completions; never treat one as the other.
- Reviewers should scrutinize timestamp/local-date handling and ensure all project statistics derive from Todo queries rather than denormalized counters.
