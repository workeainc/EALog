# Workhours reporting roadmap

Baseline: commit `213435e` (2026-09-04). This plan is based on the current React/Vite prototype and its Firebase service layer.

## Vetted findings

| Priority | Finding | Impact | Effort | Evidence |
|---|---|---:|---:|---|
| P0 | Reporting is a demo export, not a report product | Boss-ready per-project daily/weekly/monthly reports cannot be generated from authoritative data | L | `src/App.tsx:23` builds export rows from in-memory session labels and assigns synthetic `new Date()` values; `src/lib/reports.ts:78-100` only emits CSV |
| P0 | Tracker data and dashboard totals are disconnected | Firebase sessions can save successfully while progress cards remain seeded/static and inaccurate | M | `src/App.tsx:6-9,17` stores module-level projects/seed sessions; `src/App.tsx:15` subscribes to projects but mutates objects without React state; no aggregation from `work_logs` into `completed` |
| P1 | No report interaction surface | Users have no project selector, date-range controls, report preview, print/PDF action, or empty/loading/error states | M | `src/App.tsx:21-30` contains only Overview markup; Reports/Sessions nav links have no handlers or routes |
| P1 | Share workflow is absent and browser constraints are undefined | “Send via WhatsApp/email” is not implemented; a web app cannot silently attach a generated PDF to third-party apps | M | No `mailto`, WhatsApp URL, Web Share API, or blob/file sharing code under `src/` |
| P1 | Critical timer/report paths have no automated tests | Timezone boundaries, mandatory notes, range inclusion, and duplicate starts can regress before deployment | M | `package.json` has no test/lint scripts; no test files; mutation logic is concentrated in `src/lib/tracker-service.ts:71-112` |
| P2 | Deployment/auth configuration is incomplete | Hosting cannot be safely connected to a real Firebase project until environment and auth mode are supplied | S | `.firebaserc.example` contains a placeholder; `src/lib/firebase.ts:8-31` requires six Vite variables; `FIREBASE_SETUP.md` must stay aligned with anonymous auth |

## Recommended execution order

1. `001-reporting-data-contract.md` — establish authoritative query/aggregation model and fix dashboard/report data flow.
2. `002-reporting-ui-pdf-share.md` — build per-project report screen, PDF generation, and WhatsApp/email handoff on top of plan 001.
3. `003-verification-and-deployment.md` — add tests, Firebase environment checklist, preview verification, and deployment gates after the data contract is stable.
4. `004-project-lifecycle-integration.md` — make custom projects persistent and usable across timer, dashboard, sessions, and reports.
5. `005-offline-first-sync.md` — add persistent Firestore cache, durable timer outbox, reconnect replay, conflict protection, and PWA shell caching.
6. `006-profile-and-secure-sharing.md` — add professional profile branding, secure expiring report links, password protection, and scheduled delivery.
7. `007-advanced-project-reports.md` — deliver enriched project-wise daily/weekly/monthly PDFs and honest one-click WhatsApp/email sharing.
8. `008-projects-workspace.md` — add a dedicated Projects workspace with metadata, detail views, archive lifecycle, and project history.

Do not deploy before plans 001–003 pass their verification gates. PDF sharing should open a compose flow with a generated/downloaded report; automatic attachment is only possible with an explicitly authorized backend/integration and is out of scope for this client-only MVP.

## Current execution status

| Plan | Status | Note |
|---|---|---|
| 001 | PARTIAL | Range and aggregation helpers exist; Overview has not been switched to authoritative data. |
| 002 | PARTIAL | Reports/PDF/share UI exists; it still inherits the project lifecycle gap. |
| 003 | TODO | No automated test or rules-test infrastructure exists. |
| 004 | TODO | Required before deployment: custom projects currently remain only in local React state. |
| 005 | DONE | Offline cache, IndexedDB outbox, reconnect replay, conflict detection, sync status UI, and PWA shell deployed. |
| 006 | PARTIAL | Professional profile and branded PDF settings implemented/deployed; secure links and scheduled delivery remain pending trusted Functions/email-provider setup. |
| 007 | DONE | Project breakdown model, enriched branded PDF summary, and responsive report breakdown UI deployed. |
| 008 | TODO | Projects workspace plan ready for implementation. |
