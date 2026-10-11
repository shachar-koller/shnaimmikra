import { supabase, cloudEnabled } from './auth.js';

// Cloud sync layer. Merge rule (per user choice): checkmarks are unioned (OR)
// so no progress is ever lost; conflicting *settings* take the server value.

export const SYNC = { IDLE: 'idle', SYNCING: 'syncing', OK: 'ok', ERROR: 'error' };

const toRow = (userId, year, id, p) => ({
  user_id: userId,
  year,
  parsha_id: id,
  mikra1: !!p.mikra1,
  mikra2: !!p.mikra2,
  onkelos: !!p.onkelos,
  rashi: !!p.rashi,
});

const fromRows = rows => {
  const progress = {};
  for (const r of rows || []) {
    if (!r.mikra1 && !r.mikra2 && !r.onkelos && !r.rashi) continue;
    progress[`${r.year}:${r.parsha_id}`] = {
      mikra1: !!r.mikra1,
      mikra2: !!r.mikra2,
      ...(r.onkelos ? { onkelos: true } : {}),
      ...(r.rashi ? { rashi: true } : {}),
    };
  }
  return progress;
};

// First login on a device: union local + cloud checkmarks, server wins settings.
export function mergeState(local, cloudProgressRows, cloudProfile) {
  const cloudProgress = fromRows(cloudProgressRows);
  const merged = { ...cloudProgress };
  for (const [k, p] of Object.entries(local.progress || {})) {
    const c = merged[k];
    if (!c) merged[k] = { ...p };
    else {
      merged[k] = {
        mikra1: c.mikra1 || p.mikra1,
        mikra2: c.mikra2 || p.mikra2,
        onkelos: c.onkelos || p.onkelos,
        rashi: c.rashi || p.rashi,
      };
      if (!merged[k].mikra1 && !merged[k].mikra2 && !merged[k].onkelos && !merged[k].rashi) delete merged[k];
    }
  }
  return {
    progress: merged,
    israel: cloudProfile ? cloudProfile.israel === true : local.israel,
    commentary: cloudProfile ? (cloudProfile.commentary === 'rashi' ? 'rashi' : 'onkelos') : local.commentary,
    theme: cloudProfile ? (cloudProfile.theme ?? local.theme) : local.theme,
  };
}

export async function pullCloud(userId, year) {
  const [{ data: profile }, { data: rows, error }] = await Promise.all([
    supabase.from('profiles').select('israel, commentary, theme').eq('id', userId).maybeSingle(),
    supabase.from('progress').select('year, parsha_id, mikra1, mikra2, onkelos, rashi').eq('user_id', userId).eq('year', year),
  ]);
  if (error) throw error;
  return { profile, rows };
}

export async function pushProgress(userId, year, parshaId, p) {
  if (!cloudEnabled || !userId) return;
  const hasAny = Boolean(p.mikra1 || p.mikra2 || p.onkelos || p.rashi);
  if (!hasAny) {
    const { error } = await supabase.from('progress').delete().eq('user_id', userId).eq('year', year).eq('parsha_id', parshaId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from('progress').upsert(toRow(userId, year, parshaId, p), { onConflict: 'user_id,year,parsha_id' });
  if (error) throw error;
}

export async function pushAllProgress(userId, localProgress) {
  // Used once after first-login merge: upsert every local key.
  const rows = Object.entries(localProgress || {}).flatMap(([key, p]) => {
    const sep = key.indexOf(':');
    if (sep < 0) return [];
    const year = Number(key.slice(0, sep));
    const parsha_id = key.slice(sep + 1);
    if (!Number.isInteger(year) || !parsha_id) return [];
    return [toRow(userId, year, parsha_id, p)];
  });
  if (!rows.length) return;
  // Chunk to stay well under PostgREST limits.
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from('progress').upsert(rows.slice(i, i + 200), { onConflict: 'user_id,year,parsha_id' });
    if (error) throw error;
  }
}

export async function pushProfile(userId, data) {
  if (!cloudEnabled || !userId) return;
  const { error } = await supabase.from('profiles').upsert(
    {
      id: userId,
      israel: data.israel === true,
      commentary: data.commentary === 'rashi' ? 'rashi' : 'onkelos',
      theme: data.theme === 'dark' || data.theme === 'light' ? data.theme : null,
    },
    { onConflict: 'id' },
  );
  if (error) throw error;
}

// Debounced fire-and-forget writer for per-tap updates.
export function createPushQueue() {
  const timers = new Map();
  return {
    progress(userId, year, parshaId, p, onState) {
      if (!cloudEnabled || !userId) return;
      const k = `${year}:${parshaId}`;
      clearTimeout(timers.get(k));
      onState?.('syncing');
      timers.set(
        k,
        setTimeout(async () => {
          try {
            await pushProgress(userId, year, parshaId, p);
            onState?.('ok');
          } catch {
            onState?.('error');
          }
        }, 600),
      );
    },
    profile(userId, data, onState) {
      if (!cloudEnabled || !userId) return;
      clearTimeout(timers.get('__profile'));
      timers.set(
        '__profile',
        setTimeout(async () => {
          try {
            await pushProfile(userId, data);
            onState?.('ok');
          } catch {
            onState?.('error');
          }
        }, 600),
      );
    },
  };
}
