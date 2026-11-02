// Optional integration check against the local Supabase stack only.
// Run: node tests/aliyah-cloud.integration.js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { createCloudAdapter } from '../src/sync.js';
import { readingCount, wholeReadingPatch } from '../src/readings.js';

const config = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const url = config.API_URL;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'This test only runs against a local database');
const client = key => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const admin = client(config.SERVICE_ROLE_KEY);
const users = [];
async function login() {
  const email = `aliyah-${crypto.randomUUID()}@example.invalid`;
  const password = crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  const device = client(config.ANON_KEY);
  const { error: loginError } = await device.auth.signInWithPassword({ email, password });
  if (loginError) throw loginError;
  return { device, id: data.user.id, email, password };
}
try {
  const account = await login();
  const other = await login();
  const second = client(config.ANON_KEY);
  const { error } = await second.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw error;
  const a = createCloudAdapter(account.device), b = createCloudAdapter(second);
  const key = '5787:Noach';
  const { error: seedError } = await account.device.from('progress').insert({
    user_id: account.id, year: 5787, parsha_id: 'Noach', ...wholeReadingPatch('mikra1', true),
  });
  if (seedError) throw seedError;
  await Promise.all([
    a.writeProgress(account.id, key, { mikra1_4: false }),
    b.writeProgress(account.id, key, { mikra1_5: false }),
  ]);
  await b.writeProgress(account.id, key, { mikra2_7: true });
  let remote = (await a.pull(account.id)).progress[key];
  assert.equal(readingCount(remote, 'mikra1'), 5);
  assert.equal(readingCount(remote, 'mikra2'), 1);
  // Rewriting one field leaves the second device's work checked.
  await a.writeProgress(account.id, key, { mikra1_4: true });
  remote = (await b.pull(account.id)).progress[key];
  assert.equal(readingCount(remote, 'mikra1'), 6);
  assert.equal(remote.mikra1_5, false, 'A write preserves the other device’s edit to the same reading');
  assert.equal(readingCount(remote, 'mikra2'), 1);
  await b.writeProgress(account.id, key, wholeReadingPatch('mikra2', false));
  remote = (await a.pull(account.id)).progress[key];
  assert.equal(readingCount(remote, 'mikra2'), 0);
  const { data: hidden, error: hiddenError } = await other.device.from('progress').select('*').eq('user_id', account.id);
  assert.equal(hiddenError, null);
  assert.deepEqual(hidden, []);
  const { error: denied } = await other.device.from('progress').upsert({ user_id: account.id, year: 5787, parsha_id: 'Noach', mikra1_1: false });
  assert.ok(denied, 'Another account must not edit a cell');
  await a.clear(account.id);
  assert.deepEqual((await a.pull(account.id)).progress, {});
  // Every setting round-trips through its own column, and writes stay sparse.
  const settings = { israel: true, commentary: 'rashi', theme: 'midnight', peirushName: 'Ramban', followDevice: true, lightTheme: 'forest', darkTheme: 'midnight', textSize: 'larger', glass: 35, naming: 'hebrew', confetti: false, vibration: false, reminderDays: [1, 4], reminderTime: '18:30' };
  await a.writeProfile(account.id, settings);
  assert.deepEqual((await b.pull(account.id)).profile, settings);
  await b.writeProfile(account.id, { theme: 'parchment' });
  assert.deepEqual((await a.pull(account.id)).profile, { ...settings, theme: 'parchment' });
  await a.writeProfile(account.id, { reminderDays: [] });
  assert.deepEqual((await b.pull(account.id)).profile.reminderDays, []);
  const { data: hiddenProfile } = await other.device.from('profiles').select('theme').eq('id', account.id);
  assert.deepEqual(hiddenProfile, []);
  await assert.rejects(a.writeProfile(account.id, { glass: 101 }));
  console.log('Local Supabase: concurrent aliyah writes, bulk clear, account isolation, reset, and account settings passed.');
} finally {
  for (const id of users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw error;
  }
}
