# Plan 004: Make every project work through the entire tracker lifecycle

> **Executor instructions**: Follow this plan in order. Do not retain local-only project state as a second source of truth once Firebase is configured. Run every verification command. If a stop condition occurs, report it rather than altering Firestore rules or deploying.
>
> **Drift check**: `git diff --stat 213435e..HEAD -- src/App.tsx src/types/tracker.ts src/lib/tracker-service.ts src/components/ReportsView.tsx src/lib/reports.ts package.json`.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: MED — changes the project identity/model used by timers and persisted logs.
- **Depends on**: `plans/001-reporting-data-contract.md`
- **Category**: bug / architecture
- **Planned at**: commit `213435e`, 2026-09-04

## Why this matters

The current Add project modal gives the appearance of success but creates only a React-memory object. It disappears after refresh, is omitted from the timer selector, cannot be selected by `startSession`, and is not reliably included in reports or Firebase data. This plan makes a newly added project behave exactly like the six seeded projects: it persists, is selectable, records sessions, contributes to dashboard progress, appears in session history, and is available in project reports.

## Current state

- `src/App.tsx:6-12` defines a UI-only `Project` type and the fixed six-project `projects` array.
- `src/App.tsx:15` stores `projectItems` separately from that fixed array.
- `src/App.tsx:17` subscribes to Firebase projects but only mutates the fixed module-level objects; it never calls `setProjectItems`.
- `src/App.tsx:20` finds the selected project in `projects`, not `projectItems`.
- `src/App.tsx:22` adds the modal value with `setProjectItems(...)` only; it does not call a Firebase service.
- `src/App.tsx:30` renders the timer `<select>` from `projects`, so a custom project cannot be chosen.
- `src/types/tracker.ts:3-9` restricts `ProjectId` to six literal values, making persisted custom project IDs impossible to type safely.
- `src/lib/tracker-service.ts:138-141` has an update helper but no explicit `createProject`; the existing `subscribeToProjects` callback already supplies the authoritative project collection.
- `src/App.tsx:19,29,31` still calculate cards/progress/charts from seeded constants rather than completed Firestore logs.

Use the existing Firestore shape: `users/{uid}/projects/{projectId}`. Keep the `Project` document fields `name`, `targetMinutes`, `active`, `color`, and `sortOrder`; do not introduce a new collection.

## Commands

| Purpose | Command | Expected success |
|---|---|---|
| Build/typecheck | `npm run build` | Exit 0 |
| Dev smoke test | `npm run dev -- --host 127.0.0.1` | Vite serves app |
| Search static sources | `rg "projects\.map|projects\.find|seedSessions" src/App.tsx` | Any remaining occurrence is explicitly demo-only |

## Scope

**In scope**:

- `src/App.tsx` (split state/data wiring as needed)
- `src/types/tracker.ts`
- `src/lib/tracker-service.ts`
- `src/lib/reports.ts` only if type changes require it
- `src/components/ReportsView.tsx`
- `src/components/` new components for project or session views if needed
- `src/**/*.test.ts` or `src/**/*.test.tsx` and `package.json` if establishing tests

**Out of scope**:

- Firestore security-rule policy changes; current owner-only rule already permits project docs.
- Firebase deployment, Cloud Functions, user login UI, or external sharing integrations.
- Deleting existing user projects/logs.

## Steps

### 1. Replace the closed project-ID type with a safe custom-project identity

In `src/types/tracker.ts`, change `ProjectId` from the six-item literal union to a branded/validated string-compatible type or plain `string`. Keep default IDs as constants for seeding if useful. Update `Project`, `WorkLog`, and `ActiveSession` so a generated custom document ID is legal.

Add a `createProjectId(name)` helper that normalizes to a stable lowercase slug and handles duplicate names using a collision-safe suffix. It must never create an empty document ID.

**Verify**: `npm run build` exits 0.

### 2. Establish one authoritative project state in the app

Replace the local `Project` shape in `src/App.tsx` with the shared tracker `Project` type. Maintain `projects` React state initially seeded only in demo mode; in Firebase mode, call `setProjects` in `subscribeToProjects`.

The timer select, active-session restoration, `begin`, project progress list, session color lookup, and ReportsView props must all read this same state. Do not mutate module-level arrays in snapshots.

**Verify**: in Firebase mode, edit an existing project document target in Firestore and confirm the active UI updates without refresh.

### 3. Persist newly added projects and make modal state robust

Add `createProject(uid, input)` to `src/lib/tracker-service.ts`. It must:

- Write `users/{uid}/projects/{id}` with validated `name`, `targetMinutes`, `active: true`, a selected deterministic color, and a `sortOrder` after the current highest value.
- Reject a duplicate ID with a user-friendly error instead of overwriting.
- Return the typed project.

Change `addProject` to call this service when Firebase is configured. The snapshot listener should update UI; do not append a second optimistic duplicate. In no-Firebase demo mode, use the same generated shape locally. Disable the add button while saving and show the resulting error in the modal.

**Verify**: add “Client Portal” with 3h; refresh; confirm it remains. Add a duplicate name; confirm no duplicate is created and a clear error appears.

### 4. Wire work logs into dashboard and session history

Use `getReportDateRange('today')`, `getWorkLogs`, `normalizeReportLogs`, and `aggregateReportRows` to fetch current-day logs after auth and after a successful stop. Compute:

- Today's tracked total
- Per-project completed minutes
- Session count and average duration (zero-safe)
- Weekly chart buckets from a Monday-Sunday range

Do not count an active timer until it is stopped. In Firebase mode, `Sessions` must query/display all available recent logs, with pagination or a sane explicit limit. In demo mode, retain clearly marked fixture sessions only.

**Verify**: create a custom project, record/stop one session with a note, and confirm it appears in Recent Sessions, All Sessions, project progress, and Reports with the same project ID/name.

### 5. Make target totals and report target logic exact

Derive the dashboard daily target from active persisted projects instead of hardcoding `9h`. For a single-project report, use that project’s target. For all-project report, sum active project targets. Use the displayed reporting period to label whether target is daily/weekly/monthly; do not present a daily target as the complete monthly target.

**Verify**: adding a 2h project increases dashboard daily target by exactly 2h; All projects daily report reflects it.

### 6. Add regression tests

Install/configure Vitest only if no test framework exists. Add tests for:

- Custom slug generation and duplicate normalization.
- A custom project ID is accepted in a start/stop session flow.
- Aggregation includes a custom project.
- Total target includes all active projects.
- A Firebase snapshot replaces state rather than mutating a fixed array.

Mock Firebase service boundaries; do not run a live network call in unit tests.

**Verify**: `npm run test` exits 0 and `npm run build` exits 0.

## Done criteria

- [ ] A project added through the modal survives refresh when Firebase is configured.
- [ ] The new project is immediately selectable in Focus timer.
- [ ] New project sessions appear in Overview, All Sessions, and Reports.
- [ ] Dashboard progress and targets use real project/work-log data in Firebase mode.
- [ ] No custom project code path relies on the old six-value `ProjectId` union.
- [ ] `npm run build` and `npm run test` both exit 0.

## STOP conditions

- Existing production projects use document IDs that cannot be represented by the proposed new ID type.
- The Firestore project snapshot includes unexpected/malformed documents; add validation/report the sample shape rather than trusting it.
- The feature requires a Firestore rules change or deployment to validate; stop before changing external state.

## Maintenance notes

Project document IDs are referenced by historical work logs. Do not rename a document ID; rename the display `name` only or add an explicit migration. Any future archive/delete feature must preserve report readability for historical logs.
