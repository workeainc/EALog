# Plan 003 — verification and Firebase deployment gates

## Goal

Make the tracker safe to deploy, reproducible for another developer, and verifiable against Firebase rules and auth configuration.

## Current evidence

- `package.json` exposes only `dev`, `build`, and `preview`; there are no test/lint scripts.
- `src/lib/firebase.ts:8-31` fails fast when required Vite config is absent.
- `.firebaserc.example` still uses a placeholder project ID.
- `firestore.rules` scopes user subcollections by authenticated UID; this must be tested rather than assumed.

## Ordered implementation steps

1. Add a test runner and scripts (`test`, `test:watch`, optionally `lint`) without changing runtime behavior. Keep tests deterministic and avoid real Firebase network calls.
2. Add emulator/rules tests for unauthenticated denial, cross-user denial, owner access, and active-session/work-log writes. Use the Firebase Emulator Suite in CI or a documented local command.
3. Add a typed environment validation message and document the exact six public Vite variables. Keep `.env.local` ignored and never commit values.
4. Align `FIREBASE_SETUP.md` with the implemented auth method (Anonymous for the current client flow) and list the required Firestore composite index deployment.
5. Configure CI to run install, typecheck/build, unit tests, and rules tests on every change. Cache dependencies only after the commands are stable.
6. Deployment checklist: create/select Firebase project, enable Anonymous Auth, create Firestore, copy Web app config to `.env.local`, set `.firebaserc`, run `npm run build`, deploy rules/indexes, deploy hosting, then test a real session start/stop and report download.

## Verification gates

- Clean checkout with documented Node/npm versions can run the full verification command successfully.
- Rules tests prove a user cannot read or write another user’s `users/{uid}` subtree.
- Hosting preview serves the SPA fallback and PWA manifest; refresh on the root URL remains functional.
- Production smoke test confirms auth, active-session recovery after refresh, mandatory note enforcement, and a per-project PDF report.

## Risks / escape hatches

Do not deploy with placeholder `.firebaserc` or missing env values. If Anonymous Auth is not acceptable for the business, stop before deployment and choose Google or Email/Password; update the auth UX and threat model first.

