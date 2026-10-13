# Shnayim Mikra

A weekly reading tracker built with vanilla JavaScript, Vite, Hebcal, and Supabase. Google sign-in is the recommended way to use the app: progress saves to your account and follows you across devices. Guest access is available as a secondary option.

## Run locally

Use Node.js 22 or newer:

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. `npm run build` creates the production app in `dist/`; `npm run preview` serves that build. The service worker caches the app after a production visit, so it can reopen offline.

For Google sign-in and account sync, copy `.env.example` to `.env` and follow [Supabase setup](supabase/README.md). No new database migration is needed for the storage and sync changes. Never put a service-role key in frontend environment variables.

## Progress and accounts

- New visitors see a welcome screen with **Continue with Google** as the primary action and **Continue without an account** as a secondary option. Returning signed-in users go straight to their tracker; an explicit guest choice is remembered in this browser. Signing out returns to the welcome screen.
- Guest progress stays in the original `shnaim-mikra-v1` browser-storage record. Existing progress is preserved, including migration of combined parshiyos.
- Each account has its own `shnaim-mikra-v2:account:<user-id>` record. Signing out leaves account progress separate from guest progress. Account caches and pending changes stay associated with their original account.
- Signing in never automatically uploads guest or another account's cache. Use **Settings → Import guest progress** to preview and explicitly add guest checkmarks to the current account.
- Reading changes and their pending sync operations are saved together before sending. Unchecking is an explicit `false` change, not the absence of a record.
- Only changed reading fields are sent. Changes to different readings on different devices are preserved. If two devices edit the same field, the last write received by the server wins. A genuinely pending offline edit can therefore supersede a newer online edit when it reconnects; old cached checkmarks by themselves are never uploaded.
- Failed operations survive reloads. Sync retries with backoff, on reconnect, on returning to the app, and every minute while visible. Settings shows the sync state and offers **Sync now**.
- Reset requests are also durable: once confirmed and saved locally, a failed cloud deletion retries when connected. Stale caches on other devices are replaced on their next refresh. Explicit edits made after a reset request remain pending.
- Browser storage and Web Locks coordinate tabs on the same origin where available. This is account separation, not encryption against someone with access to your browser profile.

Calendar dates use the browser's local date. Israel and Diaspora have separate schedules; Simchas Torah belongs to the cycle ending that day. An open app refreshes after the local date changes.

## Backups

Settings offers the existing readable text export and a versioned JSON backup. JSON includes reading progress for all locally known cycles, calendar, theme, and the custom commentary label. It excludes authentication tokens, account identifiers, and sync internals.

**Restore JSON backup** validates the file and shows a preview before importing. Restore adds checked readings without clearing existing ones and restores the backup's settings. Guest import only adds readings. Both work offline; account imports sync later. If an export cannot reach the cloud, it exports cached progress and pending edits and says so. An empty cache on a new device cannot include cloud-only history while offline.

## Source layout

- `src/main.js`: startup and service-worker registration.
- `src/ui.js`: existing dashboard and dialogs.
- `src/model.js`, `src/names.js`, `src/progress.js`: calendar, display names, completion, legacy conversion, and text export.
- `src/storage.js`: guest/account storage and durable pending operations.
- `src/sync.js`: Supabase adapter and serialized retrying synchronization.
- `src/session.js`: authentication, account switching, and refresh lifecycle.
- `src/backup.js`: portable backup format, validation, and preview summary.

Existing checks remain available with `npm test` and `npm run test:ui`. There is no CI configuration. Browser checks use Playwright (`npx playwright install chromium` if needed).
