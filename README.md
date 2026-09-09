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

## Password Vault

Vault records are encrypted in the browser before they are sent to Firestore.
The Vault uses a Master Password-derived, non-exportable AES-GCM key; Firebase
receives only encrypted envelopes and cannot recover or read the passwords.
The Master Password is never stored. If it is forgotten, the Vault cannot be
recovered.

The Vault accepts local `.xlsx` and CSV files up to 5 MB. The first non-empty
row becomes dynamic field headers and every worksheet becomes a category. The
source workbook and its plaintext cells never upload to Firebase. For safety,
legacy `.xls`, macro-enabled, and formula-containing workbooks are rejected;
export values-only `.xlsx` or CSV first. Vault records remain locked after a
reload, manual lock, backgrounding the app, or five minutes of inactivity.
