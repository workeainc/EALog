# Firebase setup and deployment

1. Create a Firebase project in the Firebase Console and register a **Web app**.
2. Enable **Authentication → Sign-in method → Anonymous**. The first version uses an anonymous Firebase identity so the tracker works immediately without a registration form; a Google sign-in flow can be added later without changing the Firestore schema.
3. Create a **Firestore Database** in production mode, choosing the region closest to your users.
4. Copy `.env.example` to `.env.local` and paste the Web app configuration values. Vite variables are public by design; Firebase API keys identify the project but do not grant database access. Firestore rules do.
5. Install dependencies in the app project:

   ```bash
   npm install firebase
   npm install -D firebase-tools
   ```

6. Copy `.firebaserc.example` to `.firebaserc`, replace `your-firebase-project-id`, then authenticate and deploy:

   ```bash
   npx firebase login
   npx firebase deploy --only firestore:rules,firestore:indexes
   npm run build
   npx firebase deploy --only hosting
   ```

`firebase.json` configures Firebase Hosting for a Vite single-page app: all routes return `index.html` and the client router handles them.

## Data paths

- `users/{uid}/projects/{projectId}` — six default target configs
- `users/{uid}/work_logs/{logId}` — completed sessions
- `users/{uid}/active_session/current` — exactly one recoverable in-progress session
- `users/{uid}/settings/profile` — timezone and 540-minute daily target

The app should call `seedUserTracker(user.uid)` immediately after authentication. The service module uses a transaction for start/stop, so two open tabs cannot create two simultaneous sessions.
