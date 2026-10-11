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

// ── Native Google (GIS): Google shows YOUR app, not supabase.co ──────────
// The redirect flow (signInWithGoogle above) starts at supabase.co/auth/…,
// so Google's consent screen names the Supabase project domain. Here the app
// talks to Google directly on your own domain and hands the ID token to
// Supabase via signInWithIdToken. Free; needs only the OAuth *client ID*
// (public) plus your domains in the client's Authorized JavaScript origins.
const googleClientId = env.VITE_GOOGLE_CLIENT_ID ?? (typeof process !== 'undefined' ? process.env?.VITE_GOOGLE_CLIENT_ID : undefined);

export const googleNativeEnabled = cloudEnabled && Boolean(googleClientId);

let gisPromise = null;
export function loadGis() {
  if (typeof window !== 'undefined' && window.google?.accounts?.id) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      let tries = 0;
      const tick = () => {
        if (typeof window !== 'undefined' && window.google?.accounts?.id) return resolve();
        if (++tries > 100) return reject(new Error('Google sign-in library failed to load. Check your connection.'));
        setTimeout(tick, 100);
      };
      tick();
    });
  }
  return gisPromise;
}

const randomNonce = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32) || 'shnaim-mikra-nonce';
};

async function sha256Hex(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Renders Google's official button into el; resolves with the session once
// Supabase verifies the ID token. Rejects on cancel/failure — caller falls
// back to the redirect flow.
export async function renderGoogleButton(el) {
  if (!supabase || !googleClientId) throw new Error('Google sign-in not configured');
  await loadGis();
  const nonce = randomNonce();
  const hashed = await sha256Hex(nonce);
  return new Promise((resolve, reject) => {
    try {
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        nonce: hashed,
        callback: async res => {
          if (!res?.credential) return reject(new Error('Google sign-in was cancelled'));
          const { data, error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: res.credential, nonce });
          if (error) reject(error);
          else resolve(data.session);
        },
      });
      window.google.accounts.id.renderButton(el, {
        theme: typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        width: Math.max((el && el.clientWidth) || 0, 280),
      });
    } catch (e) {
      reject(e);
    }
  });
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
