# Plan 007: Deliver project-wise executive reports and sharing

> **Executor instructions**: Read this entire plan before editing. Implement
> only the listed files, preserve the current profile branding and Firebase
> ownership model, and run every verification gate.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — PDF layout and browser share behavior vary by device
- **Depends on**: 001-reporting-data-contract.md, 002-reporting-ui-pdf-share.md, 006-profile-and-secure-sharing.md (profile branding portion)
- **Category**: feature
- **Planned at**: commit `213435e`, 2026-09-04

## Why this matters

The Reports screen already filters by project and Daily/Weekly/Monthly/Custom
period, aggregates sessions, previews PDFs, downloads them, and uses the Web
Share API where available. The PDF generator already has branded header/footer
support from the professional profile work. The remaining product gap is a
polished, boss-ready report flow: complete project-wise summaries, clear notes
and totals, consistent period labels, and one-click sharing that accurately
explains when the browser attaches a file versus opening WhatsApp/email.

## Current state (verified)

- `src/components/ReportsView.tsx:31-170` loads a date range through
  `tracker.getWorkLogs`, filters `projectId`, computes target completion, and
  calls preview/download/share helpers.
- `src/components/ReportsView.tsx:174-406` renders one selected report with
  KPI cards, day-by-day totals, notes table, PDF actions, and copy-summary.
- `src/lib/reports.ts:60-140` provides timezone-aware date ranges and
  `aggregateReportRows`; `:177-204` formats text summaries and opens WhatsApp
  or `mailto:`; `:223-280` generates, downloads, and shares A4 PDFs.
- `src/lib/reports.ts:213-221` sanitizes profile branding and bounds plain text;
  preserve this boundary for all new report fields.
- `src/types/tracker.ts:74-88` defines `ReportBranding` and report filter types.
- `src/App.tsx:879-887` passes projects, UID, tracker, demo logs, and branding
  into `ReportsView`.
- `firestore.indexes.json` already contains the required
  `work_logs(dateString ASC, startTime DESC)` index. Do not add a second
  overlapping index without evidence.

## Product decisions

1. “All projects” is an overview only; the PDF must clearly list each project
   with its own total, session count, target, and completion percentage. A
   selected project generates a focused report.
2. Daily, weekly, monthly, and custom periods use the existing local-timezone
   boundaries. Never use the browser UTC date to label a Bangladesh workday.
3. Notes use the saved concise summary (`notes`); the original long detail may
   be included only when explicitly enabled and must be safely wrapped/truncated.
4. WhatsApp/email buttons must not claim that a browser attached a PDF when it
   only opened a compose URL. Use Web Share with `files` when supported;
   otherwise download the PDF, copy/open the compose flow, and explain the
   manual attachment step.
5. PDF layout remains A4 and executive-styled: branded header, report period,
   project summary cards, totals, target progress, deliverable notes, and
   signature/footer. Long notes must paginate instead of overflow.

## Scope

**In scope:**

- `src/lib/reports.ts`
- `src/components/ReportsView.tsx`
- `src/App.tsx` only if report props/state need adjustment
- `src/styles.css`
- `src/types/tracker.ts` only for additive report types
- `src/lib/reports.test.ts` and/or `src/components/ReportsView.test.tsx` (new)
- `plans/README.md` status row

**Out of scope:** Cloud Functions secure links/passwords/schedules (plan 006),
Firestore rules/index changes unless a failing query proves one is missing,
automatic email sending, changing timer behavior, or adding a new chart library.

## Steps

### Step 1: Establish a single report view model

Add pure helpers that build a report model from normalized logs and projects:
project rows, daily totals, session counts, target minutes, completion, and
summary text. Ensure “all projects” has deterministic project ordering and
empty projects are represented intentionally (not silently omitted).

**Verify:** unit tests cover today/week/month/custom timezone boundaries,
project filtering, empty data, target percentages over 100%, and long notes.

### Step 2: Upgrade the Reports UI

Keep the existing project/period/date controls, but add a project summary grid
for the all-projects view and make the selected project card visibly distinct.
Show total tracked, target, completion, sessions, days worked, and notes in a
compact responsive layout. Add explicit loading, stale-cache, empty, and query
error states. Keep all inputs labelled with stable `id`/`name` attributes.

**Verify:** `npm run build`; manually switch every period and project, confirm
totals match the session table and no duplicate fetch occurs on rerender.

### Step 3: Produce the enriched PDF

Refactor `createProjectReportPdf` to consume the shared report model and
branding. Add an executive summary section, per-project totals for the all-
projects report, target progress, day-by-day breakdown, and wrapped notes. Use
the existing `ensureSpace` pagination pattern; never draw text outside the page.
Use safe plain-text sanitization and bounded lengths for every user-controlled
field. Keep filename generation deterministic and filesystem-safe.

**Verify:** generate daily, weekly, monthly, custom, selected-project, and
all-project PDFs; preview and download each. Render/extract PDF text and verify
headers, totals, notes, page breaks, branding fallback, and no raw markup.

### Step 4: Make sharing genuinely one-click and honest

Create one share controller that first tries `navigator.share({ files: [pdf] })`
when `navigator.canShare` permits it. For unsupported browsers, download the
PDF, copy a concise report summary, and open WhatsApp or `mailto:` with a body
that includes the report period and says “PDF downloaded — attach the file”.
Handle cancellation separately from errors and show a retry/download action.

**Verify:** test desktop Chrome, mobile Safari/PWA, and a browser with Web Share
disabled. Confirm no popup is opened without a user gesture and no UI falsely
claims an attachment was sent.

### Step 5: Add regression tests and deploy

Add pure tests for model/aggregation/PDF input and mocked tests for share
fallback decisions. Run typecheck/build and any available tests. Deploy Hosting
only after smoke-testing report generation against production data; do not
deploy Functions or change Firestore rules in this plan.

**Verify:** `npm run build` exits 0; test command exits 0; `firebase deploy
--only hosting --project workhours-dashboard` completes; production smoke test
covers each period, project filter, preview, download, WhatsApp, and email.

## Done criteria

- [ ] Project-wise daily/weekly/monthly/custom reports show correct totals.
- [ ] All-project reports include deterministic per-project breakdowns.
- [ ] PDFs contain branded header/footer, notes summary, totals, target progress,
      and safe pagination.
- [ ] Preview and download produce identical PDF content.
- [ ] Web Share attaches a PDF only when supported; fallback instructions are
      accurate for WhatsApp/email.
- [ ] Timezone boundaries and over-target percentages are tested.
- [ ] `npm run build` and tests pass; Hosting deploy succeeds.

## STOP conditions

- A report query needs a new Firestore index not present in
  `firestore.indexes.json`; stop and report the exact query/index instead of
  deploying an unverified index.
- PDF content would expose original long-form notes or profile data without an
  explicit user-facing choice; stop and add the consent/control first.
- Browser APIs cannot attach files in the tested target; keep the honest
  download-plus-compose fallback and do not claim automatic attachment.
- Branding changes would break the existing `ReportsView` or profile settings
  contract; preserve compatibility and report the migration needed.

## Maintenance notes

Keep aggregation and PDF input pure so future secure-link/server rendering can
reuse the same model. Any new report field must be added to PDF text-extraction
tests and reviewed for privacy. If a real email/WhatsApp integration is later
added, it belongs behind the trusted server boundary in plan 006, not in the
client share helper.
