# Plan 008: Add a dedicated Projects workspace

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — project lifecycle changes affect timer, reports, and historic logs
- **Depends on**: 004-project-lifecycle-integration.md
- **Planned at**: commit `9a21d20`, 2026-09-06

## Goal

Create a new **Projects** page where a user can create, organize, edit, archive,
and review every project without leaving the work-hours app. Existing work logs
must remain historically correct even when a project is renamed or archived.

## Verified current state

- `src/types/tracker.ts:6-13` defines a project with only `name`, daily target,
  `active`, color, and sort order.
- `src/lib/tracker-service.ts:323-355` subscribes to projects, while
  `:359-388` creates them and `:808-814` only performs a generic update.
- `src/App.tsx:850-905` only has Overview, Sessions, Reports, and Settings
  navigation; project management is an Add Project modal in Overview.
- `src/App.tsx:450-461` already computes daily progress from project metadata
  and completed work logs.
- `src/components/ReportsView.tsx:100-140` already groups report data by
  project, so a project detail page can reuse the same data/aggregation helpers.
- `firestore.rules` already gives the owner full access to
  `users/{uid}/projects/{projectId}`. No public-access rule is needed.

## Recommended feature set

### Phase A — essential project management

1. **Projects navigation and list**
   - Add a Projects item to sidebar/mobile navigation.
   - Responsive project cards/table with color, active/archived state, daily
     target, tracked hours today, and target progress.
   - Search and filters: Active, Archived, All.

2. **Project detail panel**
   - Name, description, client/company, status, daily target, color, priority,
     start date, optional target/deadline date, and private reference link.
   - Current timer shortcut: “Start session for this project”.
   - Today/this-week/this-month time totals, recent sessions, and quick report.

3. **Safe edit and archive**
   - Edit metadata from a modal/drawer with validation.
   - Archive instead of delete when work logs exist.
   - Archived projects are hidden from timer start options and daily-target sum,
     but remain visible in historic sessions/reports with their correct name.
   - Restore archive action.

4. **Project ordering**
   - Manual move up/down controls, persisted via `sortOrder`.
   - Do not introduce drag-and-drop before mobile usability is proven.

### Phase B — useful next capabilities

5. **Project notes and links**
   - A single project brief, scope/goal, key links, and client contact label.
   - Keep documents/attachments out of Firestore initially; use HTTPS reference
     links. Firebase Storage can be added later for uploads.

6. **Health and delivery signals**
   - Status: planned, active, on-hold, completed, archived.
   - Priority: low, medium, high.
   - Deadline badge and “at risk” indicator when target is behind and deadline
     is close. This must be informational—never auto-stop the timer.

7. **Project-specific reporting shortcut**
   - “View report” opens Reports with project and selected period prefilled.
   - Reuse existing PDF/share workflow rather than duplicate it.

### Phase C — defer until there is a genuine need

- Task lists/milestones (creates a second product; defer until project briefs
  and time tracking prove insufficient).
- File uploads (requires Firebase Storage rules, quotas, and privacy design).
- Shared team members/roles (requires multi-user permissions and server rules).

## Data model

Extend the existing `users/{uid}/projects/{projectId}` document; do not create
a second project collection:

```ts
{
  name: string,
  description: string,
  clientName: string,
  status: "planned" | "active" | "on_hold" | "completed" | "archived",
  priority: "low" | "medium" | "high",
  targetMinutes: number,
  color: string,
  startDate?: "YYYY-MM-DD",
  deadlineDate?: "YYYY-MM-DD",
  referenceUrl?: string,
  active: boolean,        // retain temporarily for backward compatibility
  archivedAt?: Timestamp,
  sortOrder: number,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

`status` becomes the source of truth after migration. Maintain `active` in
sync during the transition: only `status === "active"` is timer-selectable and
contributes to the daily target.

## Implementation steps

1. Extend `Project` types and add validation/sanitization helpers for bounded
   plain text, enum fields, dates, colors, and HTTPS URLs.
2. Update project create/read/update service methods; backfill missing old
   fields in memory with safe defaults. Add archive/restore/reorder functions.
3. Add a reusable `ProjectsView` component and a project edit/detail modal.
4. Add the Projects nav entry and route/view state in `App.tsx`.
5. Wire active/archived semantics into timer options, daily target aggregation,
   dashboard project progress, reports, and session project name lookup.
6. Build project detail aggregates from existing work-log helpers; avoid an
   unbounded Firestore read—use existing date range queries.
7. Add tests for legacy project migration, archive behavior, target calculation,
   ordering, and historic log/report preservation.
8. Run `npm run build`, verify desktop/mobile flows, then deploy Hosting and
   any required Firestore index/rules changes.

## Done criteria

- [ ] User can create, edit, search, archive, restore, and reorder projects.
- [ ] Project details persist across devices through Firestore.
- [ ] Archived projects cannot start new sessions and do not inflate targets.
- [ ] Historic sessions/PDFs retain the archived/renamed project identity.
- [ ] Project page shows day/week/month totals and recent work.
- [ ] All inputs have labels, ids/names, validation, loading, and error states.
- [ ] `npm run build` passes and production smoke test succeeds.

## Safety boundaries

- Do not hard-delete a project with work logs in Phase A.
- Do not mutate historic `work_logs.projectId` when a project changes.
- Do not add public Firestore access or client-side secrets.
- Stop and request a decision before implementing multi-user sharing or file
  uploads; both materially expand data access and billing scope.
