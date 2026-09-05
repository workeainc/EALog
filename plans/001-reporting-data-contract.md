# Plan 001 — authoritative per-project reporting data

## Goal

Make Firestore `work_logs` the sole source of truth for dashboard totals and reports. Support daily, weekly, monthly, and custom ranges with correct local-date boundaries and project aggregation.

## Scope

In scope: `src/App.tsx`, `src/lib/tracker-service.ts`, `src/lib/reports.ts`, `src/types/tracker.ts`, and new tests under `src/**/*.test.*`. Out of scope: PDF rendering and share links (plan 002), Firebase deployment (plan 003), redesigning the visual theme.

## Current evidence

- `src/App.tsx:6-9` defines module-level seeded projects and sessions.
- `src/App.tsx:15-17` subscribes to Firebase but never derives completed minutes from logs; mutating `projects` does not trigger React rendering.
- `src/lib/tracker-service.ts:114-124` can query logs by `dateString`, but there is no range-aware subscription/query abstraction.
- `src/lib/reports.ts:58-70` has useful normalization/filter/aggregation primitives, but callers do not pass real Firestore rows.

## Ordered implementation steps

1. Define a `ReportPeriod`/`ReportFilters` contract (`from`, `to`, `projectId | all`, timezone/date key) in `src/types/tracker.ts` or a dedicated `src/lib/report-types.ts`. Preserve `dateString` as the local work-day key; document whether custom ranges include both endpoints.
2. Add a service function that queries `work_logs` for an inclusive date-key range and returns typed `WorkLog[]`. Handle the Firestore composite-index error with a documented index requirement; do not fall back to unbounded reads.
3. Add a pure aggregation function returning: total minutes, per-project minutes, per-day totals, session count, and normalized rows. Use a `Map` keyed by project ID and explicit timezone conversion. Empty ranges must return zeroes, not throw.
4. Replace module-level seeded session/project totals in `App.tsx` with React state populated from the service. Keep a clearly labelled demo mode only when Firebase is not configured; never mix demo rows with real rows.
5. Add a report-period selector model: Today, This week (Monday–Sunday), This month, and Custom. Store dates as `YYYY-MM-DD` inputs and calculate boundaries in one tested helper.
6. Update dashboard cards and project progress to consume the same aggregate object used by reports. Active elapsed time may be displayed separately, but must not be double-counted until stop.

## Verification gates

- `npm run build` exits 0.
- Unit tests cover: midnight end-date inclusion, month boundary, DST/timezone-safe date key, aggregation of two sessions for one project, empty result, and active-session exclusion.
- In a Firebase emulator or configured project, create two logs for one project and one for another; selecting Today shows exact per-project totals and changing to a range changes all cards consistently.
- No displayed report value comes from `seedSessions` when Firebase is configured.

## Risks / escape hatches

If the existing Firestore index cannot support the intended ordered query, stop and report the exact index definition rather than removing ordering or fetching every user log. If the product requires a user-selected timezone instead of browser timezone, pause and add that decision to the data contract before implementation.

