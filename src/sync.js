import { cloudEnabled, supabase } from './auth.js';
import { DOUBLE_PARSHIYOS } from './model.js';
import { splitDoubleProgress } from './progress.js';

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
  const merged = splitDoubleProgress(local.progress);
  const cloudProgress = splitDoubleProgress(Object.fromEntries(
    cloudRows.map(r => [`${r.year}:${r.parsha_id}`, fromRow(r)]),
  ));
  for (const [k, r] of Object.entries(cloudProgress)) {
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
    ...local,
    progress: merged,
    israel: cloudProfile ? cloudProfile.israel === true : local.israel,
    commentary: cloudProfile ? (cloudProfile.commentary === 'rashi' ? 'rashi' : 'onkelos') : local.commentary,
  };
}

export async function pullAllProgress(userId) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('progress')
      .select('year, parsha_id, mikra1, mikra2, onkelos, rashi')
      .eq('user_id', userId).order('year').order('parsha_id').range(offset, offset + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

export async function deleteAllProgress(userId) {
  const { error } = await supabase.from('progress').delete().eq('user_id', userId);
  if (error) throw error;
}

export async function pullCloud(userId) {
  const [{ data: profile, error }, rows] = await Promise.all([
    supabase.from('profiles').select('israel, commentary').eq('id', userId).maybeSingle(),
    pullAllProgress(userId),
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

export async function pushAllProgress(userId, localProgress, cloudRows = []) {
  // Used once after first-login merge: upsert every local key.
  const rows = Object.entries(splitDoubleProgress(localProgress)).flatMap(([key, p]) => {
    const sep = key.indexOf(':');
    if (sep < 0) return [];
    const year = Number(key.slice(0, sep));
    const parsha_id = key.slice(sep + 1);
    if (!Number.isInteger(year) || !parsha_id) return [];
    return [toRow(userId, year, parsha_id, p)];
  });
  // Chunk to stay well under PostgREST limits.
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from('progress').upsert(rows.slice(i, i + 200), { onConflict: 'user_id,year,parsha_id' });
    if (error) throw error;
  }
  // Remove old combined records only after their individual replacements save.
  // Otherwise a future sign-in could restore a checkmark that was unchecked.
  const doubles = new Set(DOUBLE_PARSHIYOS.map(names => names.join('-')));
  for (const row of cloudRows.filter(r => doubles.has(r.parsha_id))) {
    const { error } = await supabase.from('progress').delete()
      .eq('user_id', userId).eq('year', row.year).eq('parsha_id', row.parsha_id);
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
  const active = new Set();
  function run(key) {
    const pending = timers.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    timers.delete(key);
    const request = pending.write().then(
      () => pending.onState?.('ok'),
      () => pending.onState?.('error'),
    ).finally(() => active.delete(request));
    active.add(request);
  }
  function enqueue(key, write, onState) {
    if (timers.has(key)) clearTimeout(timers.get(key).timer);
    onState?.('syncing');
    timers.set(key, { write, onState, timer: setTimeout(() => run(key), 400) });
  }
  return {
    async flush() {
      for (const key of timers.keys()) run(key);
      await Promise.all([...active]);
    },
    async cancelProgress() {
      for (const [key, pending] of timers) {
        if (key === '__profile__') continue;
        clearTimeout(pending.timer);
        timers.delete(key);
      }
      // An in-flight write must finish before deletion, or it can restore a row.
      await Promise.all([...active]);
    },
    progress(userId, year, parshaId, p, onState) {
      if (!cloudEnabled || !userId) return;
      const key = `${year}:${parshaId}`;
      enqueue(key, () => pushProgress(userId, year, parshaId, p), onState);
    },
    profile(userId, data, onState) {
      if (!cloudEnabled || !userId) return;
      enqueue('__profile__', () => pushProfile(userId, data), onState);
    },
  };
}
