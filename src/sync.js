import { cloudEnabled, supabase } from './auth.js';

// Converts a local parsha state { mikra1?, mikra2?, onkelos?, rashi? }
// to the snake_case row shape stored in Supabase.
function toRow(userId, year, parshaId, p) {
  return {
    user_id: userId,
    year,
    parsha_id: parshaId,
    mikra1: Boolean(p.mikra1),
    mikra2: Boolean(p.mikra2),
    onkelos: Boolean(p.onkelos),
    rashi: Boolean(p.rashi),
    updated_at: new Date().toISOString(),
  };
}

function fromRow(row) {
  const p = {};
  if (row.mikra1) p.mikra1 = true;
  if (row.mikra2) p.mikra2 = true;
  if (row.onkelos) p.onkelos = true;
  if (row.rashi) p.rashi = true;
  return p;
}

// 3-way/union merge: if a step is done locally OR in the cloud, it's done.
// Cloud wins on conflicts of profile preferences if present, else local.
export function mergeState(local, cloudRows = [], cloudProfile = null) {
  const merged = { ...(local.progress || {}) };
  for (const r of cloudRows) {
    const k = `${r.year}:${r.parsha_id}`;
    const curr = merged[k] || {};
    merged[k] = {
      ...(curr.mikra1 || r.mikra1 ? { mikra1: true } : {}),
      ...(curr.mikra2 || r.mikra2 ? { mikra2: true } : {}),
      ...(curr.onkelos || r.onkelos ? { onkelos: true } : {}),
      ...(curr.rashi || r.rashi ? { rashi: true } : {}),
    };
    // Clean up empty objects
    if (!merged[k].mikra1 && !merged[k].mikra2 && !merged[k].onkelos && !merged[k].rashi) {
      delete merged[k];
    }
  }
  return {
    progress: merged,
    israel: cloudProfile ? cloudProfile.israel === true : local.israel,
    commentary: cloudProfile ? (cloudProfile.commentary === 'rashi' ? 'rashi' : 'onkelos') : local.commentary,
  };
}

export async function pullCloud(userId, year) {
  const [{ data: profile }, { data: rows, error }] = await Promise.all([
    supabase.from('profiles').select('israel, commentary').eq('id', userId).maybeSingle(),
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
      const key = `${year}:${parshaId}`;
      if (timers.has(key)) clearTimeout(timers.get(key));
      if (onState) onState('syncing');
      timers.set(
        key,
        setTimeout(async () => {
          timers.delete(key);
          try {
            await pushProgress(userId, year, parshaId, p);
            if (onState) onState('ok');
          } catch {
            if (onState) onState('error');
          }
        }, 400),
      );
    },
    profile(userId, data, onState) {
      if (!cloudEnabled || !userId) return;
      const key = '__profile__';
      if (timers.has(key)) clearTimeout(timers.get(key));
      if (onState) onState('syncing');
      timers.set(
        key,
        setTimeout(async () => {
          timers.delete(key);
          try {
            await pushProfile(userId, data);
            if (onState) onState('ok');
          } catch {
            if (onState) onState('error');
          }
        }, 400),
      );
    },
  };
}
