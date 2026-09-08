# EALog

EA Log is a responsive work-hours tracker for project sessions, daily targets,
reports, and branded PDF exports.

## Development

```bash
npm install
npm run dev
```

Create `.env.local` from `.env.example` for Firebase-backed authentication and
Firestore sync.

## Production build

```bash
npm run build
```

## Tests

```bash
# Todo calculations, dates, and stream-merging behaviour
npm test -- --run

# Firestore ownership rules (requires Java 21 for the local Firestore Emulator)
npm run test:rules
```

The rules test starts and stops its own local emulator. It never reads or writes
the production Firebase project.
