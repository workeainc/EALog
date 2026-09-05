# Plan 005: Add offline-first timer and conflict-safe Firebase sync

> **Executor instructions**: Implement this plan step by step. Run every
> verification gate before continuing. This plan is based on commit `213435e`;
> compare the current code before editing because later auth/report changes may
> have moved the cited lines.

## Status

- **Priority**: P0
- **Effort**: L (multi-day, including device/browser testing)
- **Risk**: HIGH — timer records must not be lost or double-counted
- **Depends on**: none (but preserve existing auth/report behavior)
- **Category**: correctness / architecture
- **Planned at**: commit `213435e`, 2026-09-04

## Why this matters

The app currently assumes a live Firestore connection. Every timer mutation in
`src/lib/tracker-service.ts` uses `runTransaction`; Firestore transactions
cannot complete while offline, so a Bangladesh power cut or temporary network
loss can prevent start/pause/resume/stop from being recorded. There is also no
outbox, retry status, or conflict policy for two browsers editing the same
active session. The result must be a timer that keeps calculating locally,
queues durable writes, syncs after reconnection, and never creates duplicate
work logs.

## Current state (verified)

- `src/lib/firebase.ts` calls `getFirestore(firebaseApp)` with no persistent
  local cache configuration.
- `src/lib/tracker-service.ts:203-232` starts a session with a Firestore
  transaction; `:239-286` pauses/resumes with transactions; `:290-336` stops
  with a transaction that writes a log and deletes the active session.
- `src/lib/tracker-service.ts:120-201` uses `onSnapshot` for projects and the
  active session, but does not expose metadata (`hasPendingWrites` or
  `fromCache`) and has no online/offline state.
- `src/App.tsx:470-565` calls those service methods directly and has no queued,
  pending, failed, or retry UI state.
- `src/main.tsx` only mounts React; there is no service worker registration.
- `public/manifest.webmanifest` makes the app installable but does not make
  assets/data available offline by itself.
- `firestore.rules` scopes all documents to the authenticated UID. Keep that
  ownership model unchanged; offline queueing must not weaken rules.

## Commands you will need

| Purpose | Command | Expected result |
|---|---|---|
| Typecheck/build | `npm run build` | exit 0, TypeScript and Vite build succeed |
| Local app | `npm run dev -- --host 127.0.0.1` | Vite serves the app |
| Firebase deploy (only after approval) | `firebase deploy --only hosting,firestore` | hosting and rules/indexes deploy successfully |

There is currently no test script. Add a lightweight unit-test setup only if
it can be done without changing the production bundle; otherwise create pure
TypeScript tests for the outbox/reducer functions and document the command.

## Scope

**In scope (only these files unless a new test/worker file is required):**

- `src/lib/firebase.ts`
- `src/lib/tracker-service.ts`
- `src/App.tsx`
- `src/main.tsx`
- `public/sw.js` (new) and `public/manifest.webmanifest` if needed
- `src/lib/offline-outbox.ts` (new pure queue/state module)
- `src/lib/offline-outbox.test.ts` (new)
- `plans/README.md` status row

**Out of scope:** redesigning reports/PDFs, changing auth providers, changing
Firestore security ownership, automatic power-cut inference from elapsed time,
or adding a server/backend function. A device being off cannot be detected in
real time; recovery should be explicit and conservative.

## Required design

1. Configure Firestore persistent IndexedDB cache using the SDK's supported
   `persistentLocalCache`/multi-tab manager API, with a safe fallback to the
   default Firestore instance when IndexedDB is unavailable (private browsing,
   storage quota, or unsupported browser).
2. Introduce a per-user durable outbox in IndexedDB (not localStorage) for
   timer commands. Each command needs a stable `operationId`, UID, entity ID,
   type, payload, createdAt, attempt count, and status. Retrying the same
   operation must be idempotent.
3. Replace transaction-only timer mutations with an offline-capable command
   path. Use deterministic document IDs or an operation ledger so a retried
   stop cannot create two logs. Preserve the existing `active_session/current`
   shape and `WorkLog` fields for report compatibility.
4. Use Firestore server reconciliation when online. For an active session,
   last-write-wins is unsafe: reject a start if another active session exists;
   pause/resume/stop commands must include a `baseRevision` (or equivalent)
   and surface a conflict instead of silently overwriting a newer remote state.
5. Expose sync state (`online`, `offline`, `pending`, `failed`, conflict) from
   the service to React. Add a compact banner/status beside the timer with
   “Offline — saving on this device”, “Syncing…”, and retry/conflict actions.
6. Keep timer display local and continuous while offline. On reconnect, flush
   commands in order; do not recalculate historical elapsed time from the
   wall-clock gap unless the user explicitly resumes.
7. Register a cache-first service worker for app shell assets only. Never cache
   authenticated Firestore responses in the service worker; Firestore's own
   IndexedDB persistence is the data cache.

## Steps

### Step 1: Add persistent Firestore cache and connectivity primitives

Update `src/lib/firebase.ts` to initialize Firestore with persistent local
cache and a safe fallback. Add a small connectivity utility that combines
`navigator.onLine`, `window` online/offline events, and Firestore snapshot
metadata. Do not log user notes or auth tokens.

**Verify:** `npm run build` exits 0; in a supported browser, refreshing after
loading the app with DevTools “Offline” still renders the cached shell.

### Step 2: Implement the durable outbox and pure reducer

Create `src/lib/offline-outbox.ts` with IndexedDB schema/versioning, enqueue,
list-ready, mark-sent, mark-failed, retry, and clear-user operations. Commands
must be ordered by creation time and keyed by `operationId`. Add pure tests for
ordering, retry idempotency, duplicate operation IDs, and per-user isolation.

**Verify:** run the chosen test command; all outbox tests pass. `npm run build`
still exits 0.

### Step 3: Refactor timer writes to command-based idempotent operations

In `src/lib/tracker-service.ts`, preserve the exported method names used by
`App.tsx`, but route start/pause/resume/stop through the outbox. Use
deterministic IDs for a stop log (for example, `sessionId + stopOperationId`)
and a single atomic server-side write/delete when online. Include a revision or
updatedAt precondition in every active-session mutation. If offline, update the
local optimistic state and enqueue; if a precondition fails after reconnect,
mark a conflict and leave the remote record untouched.

**Verify:** unit tests cover offline start → pause → resume → stop, replaying
the same queue twice, and a remote revision conflict. `npm run build` exits 0.

### Step 4: Add reconnect flusher and snapshot metadata

Start a single flusher per authenticated UID. Flush sequentially on app start,
online events, visibility regain, and a bounded retry backoff. Subscribe with
`includeMetadataChanges: true` and publish pending/from-cache metadata to the
UI. Ensure every listener and event handler is removed on unmount/sign-out.

**Verify:** with DevTools Offline, create and stop a session; reload; restore
network; confirm exactly one Firestore work log appears and the outbox becomes
empty. Repeat in two tabs and confirm no duplicate log.

### Step 5: Wire offline/sync/conflict UX into `src/App.tsx`

Show the sync status near the Focus timer and a non-blocking conflict message
with “Retry” and “Keep remote session” actions. Disable only operations that
cannot be safely queued (for example, starting a second session); do not block
the timer display or note entry offline. Keep existing mandatory-note and
summary behavior unchanged.

**Verify:** manually test offline start, pause, resume, stop, refresh while
offline, reconnect, and sign-out/sign-in. No uncaught console errors and no
duplicate sessions/logs.

### Step 6: Add service worker shell caching and deploy

Create `public/sw.js` with install/activate/fetch handlers that cache the
versioned static shell and use network-first navigation fallback to
`/index.html`. Register it from `src/main.tsx`; update the manifest only if
needed. Do not intercept Firestore/Auth requests. Deploy hosting and Firestore
rules/indexes only after all verification gates pass.

**Verify:** `npm run build`; install the PWA, enable Offline, close/reopen it,
and verify the shell opens with the last local timer state. Then deploy and
repeat once against production.

## Done criteria

- [ ] `npm run build` exits 0.
- [ ] Offline timer start/pause/resume/stop survives refresh and queues durable
      operations without losing notes.
- [ ] Reconnect flushes in order and creates exactly one log per stop.
- [ ] Two-device/tab revision conflicts are surfaced, never silently merged.
- [ ] UI communicates offline/pending/syncing/failed/conflict state.
- [ ] PWA shell opens offline; service worker never handles Auth/Firestore API
      requests.
- [ ] Firestore rules remain UID-scoped and no secrets are added to source.

## STOP conditions

- The installed Firebase SDK does not expose the persistent cache API used by
  the plan; stop and verify the exact SDK version before changing imports.
- Firestore rules reject the chosen idempotent/revision write shape; stop and
  report the required rule change instead of broadening access.
- IndexedDB is unavailable in the target Safari/PWA mode; stop and document a
  local-only fallback rather than silently using lossy localStorage.
- Any replay test produces duplicate work logs or changes existing report field
  semantics.

## Maintenance notes

The outbox schema is a client migration surface: future timer commands must be
backward compatible and versioned. Keep report aggregation based on completed
`work_logs`, not optimistic active-session seconds. Review every new mutation for
stable operation IDs, revision checks, and explicit behavior when a user signs
out with pending commands.
