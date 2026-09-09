# Plan 010: Add a client-side encrypted Password Vault with flexible Excel import

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat a609c20..HEAD -- src/App.tsx src/lib/firebase.ts src/lib/offline-outbox.ts src/lib/tracker-service.ts src/types/tracker.ts firestore.rules firebase.json package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L (multi-day, security-sensitive)
- **Risk**: HIGH — a mistake can disclose credentials or make a vault unrecoverable
- **Depends on**: none
- **Category**: security, direction, tests
- **Planned at**: commit `a609c20`, 2026-09-09

## Why this matters

EA Log already provides owner-scoped Firebase work data, but its Notes, Tasks,
Projects, and browser cache are intentionally plain-text product data. Passwords
must not be added to those existing entities or imported as ordinary Records.
The Vault must encrypt credentials inside the browser before any write reaches
Firestore, and must keep the decryption key only in memory while the user has
explicitly unlocked it.

The product goal is a private personal vault that accepts arbitrary Excel/CSV
headers. The first worksheet row becomes field labels automatically, a sheet
becomes a category, and each row becomes a vault record. The user can reveal,
copy, search, edit, delete, and optionally associate records with EA Log
projects only after unlocking. The import source file and all interpreted cell
values must remain local until encrypted.

## Current state

- `src/lib/firebase.ts:1-43` initializes authenticated Firestore with
  `persistentLocalCache` and a multi-tab manager. This is suitable only if the
  cache holds ciphertext for Vault documents; it must never receive plaintext
  credentials.
- `firestore.rules:1-43` authorizes owner-only CRUD beneath
  `users/{userId}` for named collections. A new `vault_meta` document and
  `vault_items` collection require equally narrow owner-only rules.
- `src/App.tsx:131` has an in-memory string-union view model. Its navigation at
  `src/App.tsx:1230-1308` already adds first-class workspaces for Tasks and
  Notes, and should be the navigation pattern for `vault`.
- `src/lib/note-service.ts:1-109` is the current owner-scoped Firestore service
  pattern. Do not reuse it for secrets: `ProjectNote` deliberately stores
  `title` and `content` as plain text.
- `src/lib/offline-outbox.ts:1-44` stores timer commands as structured-cloneable
  payloads in IndexedDB. It must not be reused for raw Vault records. Firestore
  local persistence may cache only the encrypted Vault envelope.
- `src/types/tracker.ts:1-151` contains domain models for public work data.
  Vault wire types should live in a separate `src/types/vault.ts`, so a
  plaintext credential cannot accidentally flow through report, task, or note
  types.
- `package.json:1-26` has React, Firebase, jsPDF and Lucide but no workbook
  parser or password-KDF dependency. `npm audit --omit=dev --json` returned no
  high or critical production advisories on 2026-09-09.
- `README.md:1-23` establishes the available commands:
  `npm run build`, `npm test -- --run`, and `npm run test:rules`. Continue using
  Vitest and Firebase rules-unit-testing rather than adding a second test stack.

### Threat model and non-goals

This plan protects vault data at rest in Firestore and in Firebase's local
cache from anyone who does not know the Master Password, including a mistaken
Firestore export or another authenticated EA Log account. Firestore ownership
rules still protect document access.

It does **not** protect an already-unlocked browser from malware, malicious
extensions, screen sharing, physical device access, or an XSS flaw. A browser
app also cannot guarantee that the operating system clears copied credentials
from the clipboard. Do not claim otherwise in product copy.

This plan excludes a Chrome extension, automatic capture/autofill, shared
vaults, account recovery, password-change automation, and server-side
decryption. Those need separate threat models and, for sharing/recovery,
additional trusted backend design.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install dependencies | `npm install` | exit 0; lockfile updated only for approved dependencies |
| Build/typecheck | `npm run build` | exit 0 with no TypeScript errors |
| Unit tests | `npm test -- --run` | all Vitest suites pass |
| Firestore rules | `npm run test:rules` | all emulator rules tests pass; requires Java 21 |
| Dependency review | `npm audit --omit=dev` | no high/critical reachable production advisory |
| Deploy validation | `firebase deploy --only hosting,firestore:rules --project workhours-dashboard` | deploy completes only after all checks pass |

## Scope

**In scope**:

- `src/types/vault.ts` — encrypted envelope, metadata, decrypted in-memory
  record, category, import-preview, and lock-state types.
- `src/lib/vault-crypto.ts` — Web Crypto-only encryption/decryption and
  Master Password key derivation boundary.
- `src/lib/vault-service.ts` — owner-scoped encrypted Firestore persistence.
- `src/lib/vault-import.ts` — local-only Excel/CSV parsing, header normalization,
  duplicate detection, and import preview.
- `src/components/VaultView.tsx` — unlocked and locked Vault UI.
- `src/components/VaultUnlockModal.tsx` and `src/components/VaultImportModal.tsx`
  if small focused components make the security boundary clearer.
- `src/App.tsx`, `src/styles.css`, `src/types/tracker.ts` only where navigation,
  state, and project linking must be wired.
- `firestore.rules`, `firebase.json`, `package.json`, `README.md`, and new
  `src/lib/*.test.ts` / `tests/firestore.rules.test.ts` cases.

**Out of scope**:

- `src/lib/note-service.ts`, `src/lib/todo-service.ts`, work logs, reports, or
  profile settings. Never place credential fields in these documents.
- Any Firebase Cloud Function or Firebase Storage upload of the source Excel
  file. The workbook must not leave the browser in plaintext.
- Chrome extension, autofill, popup capture, auto-save from web pages, sharing,
  emergency recovery, and scheduled password reminders.
- CSV/Excel formula evaluation, macro execution, or support for password-
  protected/encrypted workbooks in v1.

## Git workflow

- Branch: `feature/encrypted-password-vault`
- Commit style: Conventional-like feature commits, matching recent history, for
  example `feat: add focused note reader actions`.
- Make distinct commits for crypto/data model, Vault UI/import, and rules/tests.
- Do not deploy, push, or open a pull request unless the operator explicitly
  authorizes those actions after review.

## Steps

### Step 1: Freeze the Vault contract and choose a maintained KDF dependency

1. Add `src/types/vault.ts`. Keep two strictly separate models:
   - `VaultRecord`: decrypted, memory-only values such as category, arbitrary
     `fields: Record<string, string>`, optional `projectId`, and timestamps.
   - `VaultEnvelope`: Firestore-safe ciphertext only: schema version, base64
     IV, base64 ciphertext, and server timestamps. It must not expose site
     name, email, username, password, category, project ID, headers, or notes.
2. Add a single `VaultMeta` document at
   `users/{uid}/vault_meta/default`. It may contain the schema version,
   base64 random salt, KDF algorithm/version/parameters, and an encrypted
   verifier envelope. It must not contain the Master Password, a derived key,
   a recovery key, imported headers, or an unencrypted record count.
3. Before coding, select an actively maintained browser-compatible Argon2id
   implementation that can run locally without a remote service. Record its
   exact package/version, license, bundle impact, and supported browser matrix
   in `README.md`. Do not downgrade silently to a fast hash, plain SHA-256, or
   a constant low-cost PBKDF2 value. If the selected Argon2id package is too
   large or unreliable on the supported iPhone PWA, stop and present a choice
   between a reviewed PBKDF2 fallback with documented parameters and changing
   the product requirement.
4. Add explicit constants for import limits: accepted `.xlsx`, `.xls`, and
   `.csv`; a conservative local file-size cap; max sheets; max data rows per
   sheet; max columns; max cell text length. Reject blanks/oversized inputs
   before creating any Firestore write.

**Verify**: `npm run build` exits 0. `rg -n "password|masterPassword|secret" src/types/vault.ts` finds type/property names only; no default credential values, logs, or example secrets.

### Step 2: Build and test the zero-knowledge crypto boundary

1. Implement `src/lib/vault-crypto.ts` using browser Web Crypto for encryption:
   use a fresh cryptographically random salt for a new vault and a fresh 96-bit
   random AES-GCM IV for every encrypted document. Derive an AES-256-GCM key
   only from the current Master Password and the stored salt/KDF parameters.
2. Bind each envelope with additional authenticated data that includes the
   authenticated user ID, vault schema version, and immutable vault record ID.
   This prevents a ciphertext copied between users or records from decrypting
   as a valid record.
3. Create the Vault only after the user enters and confirms a sufficiently long
   Master Password. Store an encrypted random verifier payload, not the
   Master Password. Unlock must first decrypt and validate this verifier before
   reading records.
4. Keep the derived CryptoKey in React/module memory only. Never put it, the
   Master Password, decrypted records, raw import text, or a JSON serialization
   of them in localStorage, sessionStorage, IndexedDB, URL parameters,
   analytics, error reports, console logs, state persisted by a service worker,
   or Firestore.
5. Implement a `lockVault()` function that drops all decrypted records and key
   references. Call it on manual Lock, logout, user switch, browser inactivity,
   and a configurable short visibility/inactivity timeout. The UI must require
   unlocking after a reload.
6. Do not try to zeroize JavaScript strings; document that browser memory cannot
   give a hard zeroization guarantee. Minimize their lifetime instead.
7. Add Vitest coverage for round-trip encryption, random IV non-reuse, wrong
   Master Password rejection, AAD/user/record swap rejection, corrupted
   envelope rejection, and the absence of sensitive plaintext in serialized
   envelopes.

**Verify**: `npm test -- --run` passes new crypto tests. A test must assert that
the serialized envelope does not contain a known fixture site, email, username,
password, category, project ID, or note text.

### Step 3: Add encrypted persistence and Firestore ownership rules

1. Implement `src/lib/vault-service.ts` with collection helpers for:
   - `users/{uid}/vault_meta/default`
   - `users/{uid}/vault_items/{itemId}`
2. Write only `VaultEnvelope` values to `vault_items`. Use document IDs created
   with `crypto.randomUUID()`; never derive them from website, category, email,
   or project names. Use server timestamps only for sync ordering.
3. Subscribe to encrypted envelopes with Firestore metadata changes, decrypt
   only after a successful unlock, and surface local pending writes without
   exposing encrypted field errors as misleading data-loss alerts.
4. Read all encrypted items after unlock and perform search, category filter,
   sorting, duplicate detection, and project linking in memory. Firestore cannot
   safely query fields that are intentionally encrypted.
5. Add `vault_meta` and `vault_items` matches to `firestore.rules` with the same
   authenticated-owner predicate used for `projects`, `todos`, and `notes`.
   Do not add broad wildcard access.
6. Extend `tests/firestore.rules.test.ts` to prove owner read/write succeeds;
   another authenticated account and an unauthenticated client cannot read or
   write both the metadata document and an item document.

**Verify**: `npm run test:rules` exits 0. `rg -n "vault_items|vault_meta" firestore.rules tests/firestore.rules.test.ts` shows owner-only rule and positive/negative coverage.

### Step 4: Build the locked/unlocked Vault workspace

1. Add `"vault"` to the `View` union in `src/App.tsx` and add a separate
   **Vault** navigation item with a lock icon. It must not be nested under
   Notes or Projects, because those data models are plaintext work data.
2. Create a locked state with three explicit paths: Create vault, Unlock vault,
   and Forget this device's cached encrypted data. Explain that the Master
   Password is never stored and cannot be recovered by EA Log.
3. Build an unlocked view with category chips, search, item list, and a detail
   reader. Search result labels must be rendered from in-memory decrypted data
   only. Keep passwords hidden by default; display a short transient reveal
   only after an intentional eye-button action.
4. The new-record form starts with useful common fields (`Site name`, `URL`,
   `Username / email`, `Password`, `Notes`, optional Project) but supports
   arbitrary extra fields. Store labels and values inside the encrypted record.
5. Add copy buttons for username and password. Show a neutral notice that the
   system clipboard can persist data and EA Log cannot reliably erase it; do
   not claim clipboard auto-clear. Never log copied values.
6. Place destructive actions behind an explicit confirmation that names the
   record only after it has been decrypted. Add a separate destructive Reset
   Vault action that requires Master Password confirmation and clearly says it
   permanently deletes all encrypted records and cannot recover a forgotten
   Master Password.
7. Make the mobile PWA usable: lock button always accessible, touch targets at
   least 44px, password never auto-reveals when returning from background.

**Verify**: `npm run build` exits 0. Manual browser check: reload shows locked
Vault; wrong password gives a generic unlock failure; successful unlock shows
only that user's decrypted items; manual Lock removes values from the rendered
DOM and requires re-unlock.

### Step 5: Add automatic-header Excel/CSV import without plaintext upload

1. Use the approved workbook parser only inside `src/lib/vault-import.ts`.
   Accept local file picker input; do not use a server upload endpoint or
   Firebase Storage.
2. For every non-empty worksheet, treat the first non-empty row as headers.
   Normalize blank/duplicate headers into deterministic display labels such as
   `Column 3` and `Email (2)`, preserving original order. Do not require fixed
   schema or force a user to map columns before seeing the preview.
3. Treat the worksheet name as the default category. The preview lets the user
   rename it, skip a sheet, and mark an optional column as the password field
   only for UI masking. Column names and their values remain encrypted; the
   marker is not a Firestore plaintext field.
4. Read values, not formulas. Reject workbook macros, unsupported formula
   evaluation, malformed sheets, header-only sheets, and rows exceeding the
   limits from Step 1. Surface safe errors without echoing sensitive cell data.
5. Show a local-only preview with detected headers, record counts, duplicate
   candidates, and the first few rows with sensitive columns masked. The
   default duplicate key should be an in-memory normalized tuple of site/URL
   plus username/email when those headers exist; otherwise require user choice
   (import all, skip identical records, or update selected existing records).
6. Encrypt every accepted record before calling `vault-service.ts`. Batch
   writes within Firestore limits, report per-batch progress, and make retry
   idempotent with a locally generated import operation ID inside encrypted
   payload—not an unencrypted site/email key.
7. On cancellation, discard parsed workbook values and preview state. Do not
   place them in the timer offline outbox. Firestore's encrypted local cache
   handles offline delivery after encryption.
8. Add tests for dynamic header generation, blank/duplicate header handling,
   multiple sheets/categories, CSV/XLSX limits, formula/macro rejection,
   duplicate preview, cancellation cleanup, and a fixture that proves no raw
   password is passed to `vault-service.ts`.

**Verify**: `npm test -- --run` passes. Manual check with a disposable local
fixture: imported sheet headers appear as fields; browser DevTools Firestore
network/cache inspection shows only ciphertext/IV/KDF metadata, never fixture
cell text.

### Step 6: Harden delivery and document operator expectations

1. Add conservative Firebase Hosting response headers in `firebase.json`,
   especially a tested Content Security Policy appropriate for Firebase Auth,
   Firestore, Hosting assets, and the existing PWA. Do not add `unsafe-eval`.
   If the current Firebase SDK or report libraries require an exception, stop
   and document the exact resource and safer alternative rather than weakening
   the policy broadly.
2. Validate all user-entered vault URLs before rendering clickable links:
   allow `https:` and optionally `http:` only; never render arbitrary schemes.
3. Update `README.md` with the threat model, no-recovery warning, supported
   import files/limits, offline behavior (encrypted cache only), lock behavior,
   and the fact that extensions/autofill are future separate work.
4. Add a short manual QA checklist for desktop Chrome, iPhone Safari/PWA, and
   an offline-to-online encrypted import retry. Confirm it does not reopen
   Google Auth automatically on startup.

**Verify**: `npm run build && npm test -- --run && npm run test:rules && npm audit --omit=dev` all exit 0. Use browser DevTools to confirm the CSP has no blocked application resources and no Vault credential appears in console/network output.

## Test plan

- Model unit tests in `src/lib/vault-crypto.test.ts`: valid round trip, wrong
  password, random IV per write, AAD swap, corrupt ciphertext, locked state.
- Parser tests in `src/lib/vault-import.test.ts`: dynamic headers, blank and
  repeated headers, multiple sheets, limits, safe rejection, no fixed-column
  assumption, and no raw import persistence.
- Service tests in `src/lib/vault-service.test.ts`: encrypted payload shape,
  owner-scoped path, metadata handling, pending write mapping, and no plaintext
  fields in outgoing documents. Mock Firestore at the boundary; do not mock
  crypto behavior covered by crypto tests.
- Rules tests in `tests/firestore.rules.test.ts`: owner/non-owner/unauthenticated
  access to `vault_meta` and `vault_items`.
- Manual tests: create/unlock/lock/reload; password hide/reveal/copy warning;
  dynamic import; offline import while Firestore cache is active; another Google
  account cannot read the vault; invalid Master Password gives no record detail.

## Done criteria

- [ ] The only Firestore Vault paths are `users/{uid}/vault_meta/default` and
  `users/{uid}/vault_items/{randomId}`, with owner-only rules coverage.
- [ ] A repository search for plaintext Vault document keys such as
  `siteName`, `password`, `username`, `email`, `category`, and `fields` finds
  only decrypted in-memory types/UI or tests—not a Firestore `setDoc` payload.
- [ ] Master Passwords, keys, plaintext records, and source workbook contents
  are absent from Firestore, IndexedDB, localStorage, sessionStorage, logs,
  URLs, analytics, and service-worker caches.
- [ ] Every envelope uses authenticated encryption with a fresh IV and binds to
  its owner/record context; wrong passwords and swapped/corrupted ciphertext
  cannot produce a record.
- [ ] Excel/CSV headers create fields automatically without a fixed schema;
  imported plaintext is previewed and encrypted locally only.
- [ ] `npm run build`, `npm test -- --run`, `npm run test:rules`, and
  `npm audit --omit=dev` pass.
- [ ] No files outside the Scope section are modified, except lockfile changes
  required by the reviewed KDF/parser dependencies and the plan status row.

## STOP conditions

Stop and report rather than improvising if:

- The selected Argon2id implementation cannot be made reliable in the iPhone
  PWA within a safe bundle/performance budget.
- A required library sends workbook contents or Master Password material to a
  remote endpoint, needs `unsafe-eval`, or has unresolved high/critical
  production advisories.
- Existing Firebase persistent cache cannot be shown to hold only encrypted
  envelopes for Vault paths.
- The requested UX requires cross-device recovery without a Master Password.
  That is a separate key-recovery product decision, not a client-side patch.
- A change needs a backend, Chrome extension, broad CSP relaxation, or any
  scope item listed as out of scope.
- Rules tests cannot run because the emulator/Java environment is unavailable.

## Maintenance notes

- Treat every new Vault export, report, sharing feature, browser integration,
  AI feature, and telemetry SDK as a fresh security review: decrypted fields
  must never enter those paths by default.
- A future Chrome extension must communicate with the Vault only through an
  explicitly designed unlock/session protocol. It must not read a Master
  Password from the EA Log web page or persist decrypted credentials.
- If project linking is later used for filtering outside the unlocked Vault,
  revisit the threat model. Keeping `projectId` encrypted trades Firestore-side
  filtering for privacy and is the intended v1 behavior.
- The Master Password reset action is irreversible. Review the confirmation UX
  especially carefully on mobile before release.
