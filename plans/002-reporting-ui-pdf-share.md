# Plan 002 — boss-ready project reports and sharing

## Goal

Provide a strong Reports screen where a user selects one project (or all projects) and a daily, weekly, monthly, or custom period, previews a polished summary, downloads a PDF, and opens WhatsApp or email compose with the report summary.

## Depends on

Plan 001’s typed aggregate and real Firestore rows. Do not build a second data-fetching path.

## Scope

In scope: report route/view components, PDF adapter, share helpers, report styles, and tests. Out of scope: server-side email/WhatsApp APIs, silent attachment uploads, CRM integrations, and automatic sending.

## UX contract

- Filters: Project (`All projects` plus six configured projects), Period (`Daily`, `Weekly`, `Monthly`, `Custom`), date/date range.
- Preview header: “Workhours report”, project name, exact period, generated-at timestamp, and total tracked time vs target when a project is selected.
- Body: KPI summary, target completion, session count, a day-by-day table, and full notes. Long notes wrap; no content is truncated in PDF.
- Actions: `Download PDF`, `Open WhatsApp`, `Open email`, and `Copy summary`. Disable actions while loading; show an empty state when no logs match.

## Ordered implementation steps

1. Add a Reports view and navigation state/route. Reuse plan 001 filters and aggregation; show loading, error, and empty states.
2. Create a print-safe report template component with stable semantic markup and CSS `@media print`. Add page-break rules so each project section remains readable.
3. Add a PDF adapter using a maintained browser-compatible library (for example `jspdf` + `jspdf-autotable`, or a print-to-PDF flow if bundle size is preferred). Keep the adapter behind `generateProjectReportPdf(report)` so the data model is library-independent.
4. Implement `openWhatsApp(report)` using a URL-encoded concise summary and `window.open` to the WhatsApp web/app compose URL. Implement `openEmail(report)` using a URL-encoded `mailto:` subject/body. Never include credentials or raw Firestore paths.
5. Prefer `navigator.share({title,text,files})` when file sharing is supported; otherwise download the PDF first, open the compose URL, and show a clear note that the user must attach the downloaded PDF. This limitation is expected in a client-only app.
6. Add one-click copy of the full plain-text summary as a fallback for browsers blocking popups or unsupported share APIs.
7. Add unit tests for URL encoding, long notes, empty reports, and project-specific filtering. Add one browser smoke test or manual checklist for PDF readability at desktop and mobile widths.

## Verification gates

- Daily, weekly, monthly, and custom filters show only the selected project’s logs.
- PDF contains project, date range, total minutes, each session’s start/end/duration, and notes; a multi-page report has no clipped rows.
- WhatsApp/email buttons open compose destinations with encoded subject/body and do not send automatically.
- `npm run build` exits 0 and report tests pass.

## Risks / escape hatches

If PDF libraries push the bundle over an agreed limit, use a lazy-loaded PDF chunk or print-to-PDF and report the measured bundle size. If a browser blocks `window.open`, retain the visible downloadable PDF and copy-summary fallback; do not attempt an unauthorised external integration.

