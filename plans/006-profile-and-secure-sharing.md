# Plan 006: Add professional profile settings and secure report sharing

> **Executor instructions**: Follow this plan step by step. Do not expose
> secrets in source or reports. This is a design/implementation plan for the
> current React/Vite + Firebase app; verify the current code before editing.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH — report links and scheduled emails are security-sensitive
- **Depends on**: 002-reporting-ui-pdf-share.md, 005-offline-first-sync.md
- **Category**: direction / security / feature
- **Planned at**: commit `213435e`, 2026-09-04

## Why this matters

Reports currently identify only the project and generic “Submitted by
Developer” text. The app already stores a per-user profile document and
generates PDFs in the browser, but has no editable designation, company/client,
signature, or footer settings. Browser-only sharing cannot create a secure
read-only URL, password gate, or reliable scheduled delivery: those require a
server-side callable/HTTP function with authentication and controlled token
access. This plan separates the safe client settings work from the backend
sharing work and makes the trust boundary explicit.

## Current state (verified)

- `src/types/tracker.ts:69-72` defines `TrackerProfile` with only `timezone` and
  `dailyTargetMinutes`.
- `src/lib/tracker-service.ts` uses `users/{uid}/settings/profile` through
  `profileRef`, but exposes no profile read/update API to the UI.
- `src/App.tsx` derives `profileName` from Firebase Auth's display name and
  renders it in the header/sidebar; there is no profile form or designation.
- `src/lib/reports.ts:205-260` creates client-side PDFs and opens WhatsApp,
  email, or the Web Share API. The PDF currently hard-codes generic submitter
  and signature labels around lines 245–246.
- `firestore.rules` allows only the authenticated owner to read/write their
  `users/{userId}/settings/{settingId}` documents. Preserve this rule for
  private profile settings.
- `firebase.json` currently deploys Hosting/Firestore only; no Functions source
  directory exists. Scheduled delivery therefore cannot be implemented by
  changing only React code.

## Product/security decisions

1. Profile data is private to the owner and stored at
   `users/{uid}/settings/profile`. Store display name, designation,
   company/client, report footer, signature label, optional logo URL, and
   timezone. Do not store raw signature images or untrusted HTML.
2. PDF generation accepts a sanitized `ReportBranding` object and falls back to
   current generic labels when fields are empty. Long text must wrap and be
   length-limited before entering jsPDF.
3. A secure report link is a server-minted, random, revocable token that maps to
   a report snapshot/parameters. Never expose a user's UID or Firestore path as
   the secret. The public viewer may read only the specific shared snapshot.
4. Password protection requires server-side hashing (for example, scrypt or
   bcrypt) and rate limiting. Never hash or compare the password only in React;
   never store plaintext passwords.
5. Scheduled weekly/monthly reports require Cloud Scheduler + Cloud Functions
   (or an equivalent trusted service), an explicit recipient allowlist, pause,
   and unsubscribe controls. Email delivery credentials must be server-side.
6. “Share to WhatsApp/email” remains a client handoff: opening a compose URL
   cannot attach a PDF automatically. The secure-link flow shares the link;
   file attachment remains Web Share/download behavior.

## Scope

**In scope:**

- `src/types/tracker.ts`
- `src/lib/tracker-service.ts`
- `src/App.tsx`
- `src/lib/reports.ts`
- `src/components/ReportsView.tsx`
- profile/settings UI and styling files
- `functions/` (new Firebase Functions project) for share tokens and schedules
- `firestore.rules`, `firestore.indexes.json`, `firebase.json`
- tests for profile validation, report branding, token authorization, expiry,
  revocation, and schedule opt-out

**Out of scope:** arbitrary public Firestore reads, storing passwords in
Firestore, silently emailing/WhatsApping attachments, changing Google Auth,
or making report links permanent by default.

## Steps

### Step 1: Extend and validate the private profile contract

Add a typed `ReportBranding`/`TrackerProfile` shape with bounded string fields,
optional logo URL, and schedule preferences. Implement `getProfile` and
`updateProfile` in the service with client validation and an owner-only rules
test. Add a Settings/Profile form with associated labels/IDs, preview, save
state, and reset-to-auth-name behavior.

**Verify:** `npm run build`; rules emulator/unit test proves another UID cannot
read or write the profile; invalid oversized/HTML-like fields are rejected.

### Step 2: Apply branding to PDF and report preview

Refactor `createProjectReportPdf(report, branding?)` so header, submitter,
designation, company/client, footer, and signature label use sanitized profile
values. Preserve the existing executive layout and generic fallback values.
Pass the loaded profile from `ReportsView`; ensure preview/download/share all
use the same branding snapshot.

**Verify:** generate a PDF with populated and empty branding; text extraction or
visual render confirms wrapping, fallback labels, and no raw HTML/oversized
text overflow.

### Step 3: Design and implement server-minted secure report links

Create a Functions endpoint/callable that accepts an authenticated UID,
report parameters, and optional expiry/password. Server-fetch the user's
authorized logs/profile, create an immutable report snapshot, generate a
cryptographically random token, store only a password hash and metadata, and
return a share URL. Add revoke/list-share actions. Public viewer validates
token, expiry, revocation, and password rate limits before returning only the
snapshot needed to render/download the report.

**Verify:** Functions tests cover owner authorization, invalid project/date
ranges, expiry, revocation, wrong-password throttling, and no UID/path leakage.
Firestore rules deny direct unauthenticated access to snapshots/tokens.

### Step 4: Add sharing controls and clear trust-boundary UX

In `ReportsView`, add “Create secure link”, expiry, password toggle, copy link,
revoke, and share-link buttons. Explain that PDF file sharing uses the device
share sheet/download, while secure-link sharing sends a URL. Show loading,
failure, and revoked/expired states without leaking report data in query-string
parameters.

**Verify:** authenticated user can create/copy/revoke their own link; another
authenticated user and logged-out user cannot manage it; expired/revoked links
show a generic error.

### Step 5: Add scheduled weekly/monthly delivery

Add a private schedule document under the user's settings with period,
recipients, timezone, send day/time, enabled flag, and last-run status. Validate
recipient count/domain/format and require explicit confirmation. Implement a
Cloud Scheduler-triggered function that queries enabled schedules, generates a
server-side snapshot/link, sends through a configured transactional email
provider, records delivery status, and honors pause/unsubscribe. Never place
provider keys in Vite env or client code.

**Verify:** emulator tests prove timezone-correct due dates, duplicate-run
idempotency, disabled schedules skipped, recipient validation, and failure
retry/backoff. Run one staging delivery with a test recipient only.

### Step 6: Deploy and document operations

Deploy Hosting, Firestore rules/indexes, and Functions only after emulator and
production smoke tests pass. Document token expiry/revocation, password reset
(revoke-and-reissue), email provider rotation, and data deletion behavior.

**Verify:** `npm run build`; `firebase emulators:exec` tests pass; deploy output
shows Hosting, Firestore, and Functions success; production smoke test covers
profile save, branded PDF, link creation/revocation, and a disabled schedule.

## Done criteria

- [ ] Profile name/designation/company/footer/signature settings persist per UID.
- [ ] Branded PDFs render safely with wrapping and generic fallbacks.
- [ ] Secure links are random, expiring, revocable, and server-authorized.
- [ ] Passwords are hashed server-side with rate limiting; no plaintext stored.
- [ ] Scheduled reports run in user timezone with idempotency and opt-out.
- [ ] Firestore rules expose no private profile/log/snapshot data publicly.
- [ ] Client WhatsApp/email behavior clearly distinguishes URL sharing from PDF
      attachment sharing.
- [ ] Build, emulator tests, and deployment smoke tests pass.

## STOP conditions

- A secure link is being implemented as a direct Firestore document URL or
  predictable UID-based token; stop and redesign the token boundary.
- No approved transactional email provider/credentials are available; implement
  profile and on-demand secure links, then stop before scheduled delivery.
- Firebase Functions billing/region requirements are not confirmed; stop before
  enabling Cloud Scheduler in production.
- Existing report APIs cannot accept branding without changing their public
  shape; preserve compatibility and report the required migration.

## Maintenance notes

Treat shared snapshots and token metadata as sensitive operational data. Add
periodic cleanup for expired snapshots, monitor failed schedules, and rotate
email credentials server-side. Any future report field added to the PDF must be
reviewed for personal-data leakage and included in the snapshot authorization
tests.
