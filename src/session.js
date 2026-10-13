import { cloudEnabled, supabase, getSession, onAuthChange, signOut } from './auth.js';
import { createRepository, emptyData, storageKey, hasPending } from './storage.js';
import { createCloudAdapter, createSyncEngine } from './sync.js';

export function createSessionController() {
  const repository = createRepository(localStorage);
  const listeners = new Set();
  let user = null, data = emptyData(), status = 'local', storageOK = true;
  let engine = null, chain = Promise.resolve(), initialized = false, ready = !cloudEnabled;
  const lock = (name, work) => navigator.locks ? navigator.locks.request(name, work) : Promise.resolve().then(work);
  const snapshot = () => ({ user, data, status, storageOK, ready });
  const emit = (refresh = false, accountChanged = false) => {
    for (const listener of listeners) listener(snapshot(), { refresh, accountChanged });
  };
  function load() {
    try { data = repository.read(user?.id).data; storageOK = true; }
    catch { data = emptyData(); storageOK = false; }
  }
  load();
  function mutate(work) {
    try {
      const record = work(user?.id);
      data = record.data;
      storageOK = true;
      if (hasPending(record)) engine?.changed();
      emit();
      return data;
    } catch (error) {
      storageOK = false;
      emit();
      throw error;
    }
  }
  async function activate(session) {
    const next = session?.user || null;
    if (initialized && (next?.id || null) === (user?.id || null)) return;
    initialized = true;
    await engine?.stop();
    engine = null;
    user = next;
    ready = true;
    load();
    status = user ? 'pending' : 'local';
    emit(true, true);
    if (!user || !cloudEnabled) return;
    const owner = user.id;
    engine = createSyncEngine({
      repository, cloud: createCloudAdapter(supabase), userId: owner, lock,
      onState(value) { if (user?.id === owner) { status = value; emit(); } },
      onData(value) {
        if (user?.id !== owner) return;
        const changed = JSON.stringify(data) !== JSON.stringify(value);
        data = value; storageOK = true; emit(changed);
      },
    });
    await engine.sync().catch(() => {});
  }
  function enqueueSession(session) {
    chain = chain.catch(() => {}).then(() => activate(session));
    return chain;
  }
  const retry = () => engine?.sync().catch(() => {});
  return {
    snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    reading(key, patch) { return mutate(owner => repository.reading(owner, key, patch)); },
    settings(patch) { return mutate(owner => repository.settings(owner, patch)); },
    async refresh() { await chain; if (engine) await engine.sync(); return data; },
    async clear() {
      await chain;
      if (engine) await engine.clear();
      else mutate(owner => repository.clear(owner));
    },
    async logout() {
      await chain;
      // Pending changes are already durable and belong only to this account.
      // A network failure must not discard them or prevent a local sign-out.
      await engine?.sync().catch(() => {});
      await signOut();
      await enqueueSession(null);
    },
    guestData() { return repository.read(null).data; },
    importData(imported, owner, settings = true) {
      if ((user?.id || null) !== owner) throw new Error('The account changed. Open the preview again.');
      return mutate(id => repository.importData(id, imported, settings));
    },
    start() {
      if (cloudEnabled) {
        chain = getSession().then(activate).catch(() => { ready = true; status = 'error'; emit(true); });
        onAuthChange(session => {
          // Supabase calls must run outside its auth callback.
          setTimeout(() => enqueueSession(session), 0);
        });
      }
      window.addEventListener('online', retry);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') retry();
      });
      window.addEventListener('storage', event => {
        if (event.key === storageKey(user?.id)) {
          load(); emit(true); retry();
        }
      });
      // Also reconcile two devices left open without a focus or network event.
      setInterval(() => { if (document.visibilityState === 'visible') retry(); }, 60000);
    },
  };
}
