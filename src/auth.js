import { createClient } from '@supabase/supabase-js';

// Offline-first: without env keys the app works exactly as before (localStorage).
// Only the anon public key is ever bundled (VITE_ prefix). Never use service_role here.
// Guarded so the module also imports under plain node (tests) where import.meta.env is undefined.
const env = import.meta.env ?? {};
const url = env.VITE_SUPABASE_URL ?? (typeof process !== 'undefined' ? process.env?.VITE_SUPABASE_URL : undefined);
const anonKey = env.VITE_SUPABASE_ANON_KEY ?? (typeof process !== 'undefined' ? process.env?.VITE_SUPABASE_ANON_KEY : undefined);

export const cloudEnabled = Boolean(url && anonKey);

export const supabase = cloudEnabled
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'shnaim-mikra-auth',
      },
    })
  : null;

const redirectTo = () =>
  env.VITE_AUTH_REDIRECT ?? (typeof process !== 'undefined' ? process.env?.VITE_AUTH_REDIRECT : undefined) ?? window.location.origin;

export async function signInWithGoogle() {
  if (!supabase) throw new Error('Cloud sync not configured');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectTo() },
  });
  if (error) throw error;
}



export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(cb) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}
