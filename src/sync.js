import { DOUBLE_PARSHIYOS } from './model.js';
import { splitDoubleProgress } from './progress.js';
import { READINGS, hasPending, pendingValues } from './storage.js';

// The adapter receives its client so sync remains independent of browser/auth setup.
export function createCloudAdapter(client) {
  async function pullAllProgress(userId) {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.from('progress')
        .select('year, parsha_id, mikra1, mikra2, onkelos, rashi')
        .eq('user_id', userId).order('year').order('parsha_id').range(offset, offset + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  }
  return {
    async pull(userId) {
      const [{ data: profile, error }, rows] = await Promise.all([
        client.from('profiles').select('israel, commentary').eq('id', userId).maybeSingle(),
        pullAllProgress(userId),
      ]);
      if (error) throw error;
      const progress = splitDoubleProgress(Object.fromEntries(rows.map(row => [
        `${row.year}:${row.parsha_id}`, Object.fromEntries(READINGS.map(field => [field, row[field] === true])),
      ])));
      // One-time legacy conversion, without overwriting individually edited records.
      const pairs = new Map(DOUBLE_PARSHIYOS.map(pair => [pair.join('-'), pair]));
      for (const row of rows.filter(row => pairs.has(row.parsha_id))) {
        const replacements = pairs.get(row.parsha_id).map(parsha_id => ({
          user_id: userId, year: row.year, parsha_id,
          ...Object.fromEntries(READINGS.map(field => [field, row[field] === true])),
        }));
        const { error: saveError } = await client.from('progress').upsert(replacements, {
          onConflict: 'user_id,year,parsha_id', ignoreDuplicates: true,
        });
        if (saveError) throw saveError;
        const { error: deleteError } = await client.from('progress').delete()
          .eq('user_id', userId).eq('year', row.year).eq('parsha_id', row.parsha_id);
        if (deleteError) throw deleteError;
      }
      return { progress, profile };
    },
    async writeProgress(userId, key, patch) {
      const sep = key.indexOf(':');
      // Only edited columns participate in ON CONFLICT UPDATE. Unrelated readings
      // made on another device are preserved. False values are deliberate writes.
      const { error } = await client.from('progress').upsert({
        user_id: userId, year: Number(key.slice(0, sep)), parsha_id: key.slice(sep + 1), ...patch,
      }, { onConflict: 'user_id,year,parsha_id' });
      if (error) throw error;
    },
    async writeProfile(userId, patch) {
      const { error } = await client.from('profiles').upsert({ id: userId, ...patch }, { onConflict: 'id' });
      if (error) throw error;
    },
    async clear(userId) {
      const { error } = await client.from('progress').delete().eq('user_id', userId);
      if (error) throw error;
    },
  };
}

export function createSyncEngine({ repository, cloud, userId, onState = () => {}, onData = () => {}, lock = (_name, work) => work() }) {
  let active = null, timer = null, stopped = false, retryDelay = 1000;
  function schedule(delay = 400) {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => { sync().catch(() => {}); }, delay);
  }
  async function drain() {
    for (;;) {
      if (stopped) return;
      const { pending } = repository.read(userId);
      if (pending.reset) {
        await cloud.clear(userId);
        repository.acknowledgeReset(userId, pending.reset);
        continue;
      }
      const first = Object.entries(pending.progress)[0];
      if (first) {
        const [key, fields] = first;
        await cloud.writeProgress(userId, key, pendingValues(fields));
        repository.acknowledge(userId, { progress: { [key]: fields } });
      } else if (Object.keys(pending.profile).length) {
        await cloud.writeProfile(userId, pendingValues(pending.profile));
        repository.acknowledge(userId, { profile: pending.profile });
      } else return;
    }
  }
  function sync() {
    if (stopped) return Promise.resolve();
    clearTimeout(timer);
    if (active) return active;
    onState('syncing');
    active = lock(`shnaim-sync:${userId}`, async () => {
      if (stopped) return;
      // Convert old combined cloud records before applying pending unchecks.
      let remote = await cloud.pull(userId);
      if (hasPending(repository.read(userId))) {
        await drain();
        if (stopped) return;
        remote = await cloud.pull(userId);
      }
      if (stopped) return;
      const record = repository.acceptRemote(userId, remote);
      onData(record.data);
      retryDelay = 1000;
      onState(hasPending(record) ? 'pending' : 'ok');
      if (hasPending(record)) schedule();
    }).catch(error => {
      if (!stopped) {
        onState('error');
        schedule(retryDelay);
        retryDelay = Math.min(retryDelay * 2, 60000);
      }
      throw error;
    }).finally(() => { active = null; });
    return active;
  }
  return {
    sync,
    changed() { onState('pending'); schedule(); },
    async clear() {
      clearTimeout(timer);
      if (active) await active.catch(() => {});
      if (stopped) throw new Error('Account changed');
      // Persist intent before touching the server, so a crash or storage failure
      // after deletion cannot cause old pending edits to recreate the data.
      repository.requestReset(userId);
      return sync();
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      if (active) await active.catch(() => {});
    },
  };
}
