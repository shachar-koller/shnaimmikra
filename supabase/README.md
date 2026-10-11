# Supabase setup — Shnayim Mikra cloud sync + auth

This app is **offline-first**: without Supabase keys it works exactly as before
(localStorage only). Add keys to enable Google sign-in + cross-device sync.

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
| `VITE_SUPABASE_ANON_KEY` | Same page → `anon` `public` key |
| `VITE_AUTH_REDIRECT` (optional) | e.g. `https://your-app.vercel.app` — OAuth return URL. Defaults to `window.location.origin`. |

Never commit `.env` (already gitignored). Only the **anon** key goes in the
frontend — never the `service_role` key.

## 3. Enable providers

### Google (free, ~10 min) — the only provider
1. https://console.cloud.google.com → create OAuth client (Web):
   Authorized redirect URI = `https://<your-project-ref>.supabase.co/auth/v1/callback`.
2. Supabase Dashboard → Authentication → Providers → Google → enable,
   paste Client ID + Secret.
3. Authentication → URL Configuration → add your Site URL
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
- Merge rule on first login: checkmarks are **unioned** (OR) so nothing is lost;
  conflicting settings (calendar/commentary/theme) take the **server** value.

## 5. Testing RLS

1. Sign in to the app with Google on two different accounts.
2. In Supabase → Table Editor, confirm each user sees only their own rows
   (or query as that user — cross-user `select` must return 0 rows).
3. Try unauthenticated REST read with the anon key — must be denied by RLS.
