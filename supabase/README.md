# Supabase setup — Shnayim Mikra cloud sync + auth

Google sign-in is the recommended entry point, with cross-device progress sync.
Configure Supabase and Google for the full experience. **Continue without an
account** remains a secondary option; if sign-in is unavailable, visitors can
explicitly choose to keep progress in their browser.

## 1. Create the project (free tier is enough)

1. Go to https://supabase.com/dashboard → New project (free plan).
2. Note the **Project URL** and **anon public key** (Project Settings → API).
3. Open **SQL Editor** → paste + run `supabase/migrations/0001_auth_progress.sql`.
   That creates `profiles` + `progress` with Row Level Security so users can
   only read/write their **own** rows (`auth.uid() = user_id`). `anon` gets nothing.
4. Verify: Table Editor → `profiles` / `progress` → each should show
   “RLS enabled”, 4 policies each.

## 2. Wire the app

```bash
cp .env.example .env        # then fill in your values
npm install                 # picks up @supabase/supabase-js
npm run dev
```

Required vars (`VITE_` prefix = exposed to browser, safe for anon key):

| Var | Where |
|---|---|
| `VITE_SUPABASE_URL` | Dashboard → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Same page → `anon`/`publishable` key |
| `VITE_GOOGLE_CLIENT_ID` | Google Cloud → Credentials → Web client ID (for the direct Google button; falls back to redirect flow without it) |

Never commit `.env` (already gitignored). Only the **anon** key goes in the
frontend — never the `service_role` key.

## 3. Enable providers

### Google (free, ~10 min) — the only provider
1. https://console.cloud.google.com → create OAuth client (Web):
   - Authorized redirect URI = `https://<your-project-ref>.supabase.co/auth/v1/callback`
     (needed for the welcome screen's OAuth flow and the dialog fallback).
   - Authorized JavaScript origins = your app origins, e.g.
     `https://your-app.vercel.app` (+ `http://localhost:5173` for dev).
     This powers the direct Google button, whose consent screen shows YOUR
     app name instead of the `*.supabase.co` domain.
2. Supabase Dashboard → Authentication → Providers → Google → enable,
   paste Client ID + Secret (Supabase validates ID tokens against it).
3. Copy the **Client ID** (`….apps.googleusercontent.com`) into
   `VITE_GOOGLE_CLIENT_ID` in `.env` and in Vercel env vars, redeploy.
   The welcome screen always uses the Supabase redirect flow to preserve its
   custom button styling. Without this variable the account dialog also
   uses the redirect flow (works, but Google
   shows the `*.supabase.co` domain on the consent screen).
4. Authentication → URL Configuration → add your Site URL
   (`http://localhost:5173` for dev, your Vercel URL for prod) to Redirect URLs.

Sign-in is Google-only — no other providers are wired.

## 4. Permissions model (what the SQL enforces)

- RLS **enabled** on both tables; no permissive “true” policies.
- `authenticated` role: `SELECT/INSERT/UPDATE/DELETE` **only where
  `auth.uid() = id` (profiles) / `auth.uid() = user_id` (progress)**.
- `anon` role: **revoked all** — must sign in before any row access.
- `service_role` bypasses RLS (Supabase default) — keep that key server-side only.
- Profile auto-created on signup via `handle_new_user()` trigger
  (`security definer`, fixed `search_path = public`).
- Account storage is separate from guest storage. Guest progress is imported only
  after an explicit preview and confirmation in Settings.
- Sync sends durable, explicit per-field changes, including `false` for unchecks.
  Cloud refresh replaces cached progress, except for pending local operations.
  Different reading fields merge independently; the last server-received write
  wins when devices edit the same field. Empty reading rows remain in the database.
- Calendar and commentary choice sync with the account. Theme and the custom
  commentary label stay on the device and are included in JSON backups.
- Confirmed reset requests survive network failures and retry on reconnect. See
  [the root README](../README.md) for retry, import, and backup behavior.

## 5. Testing RLS

1. Sign in to the app with Google on two different accounts.
2. Query through the Data API with each user’s access token; cross-user `select`
   must return 0 rows. The privileged Dashboard Table Editor bypasses RLS and
   is not an ownership-isolation check.
3. Try unauthenticated REST read with the anon key — must be denied by RLS.
