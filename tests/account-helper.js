import { expect } from '@playwright/test';

export async function mockAccount(page, { failDelete = false, delayedWrite = false, initialRows } = {}) {
  const userId = '11111111-1111-4111-8111-111111111111';
  const requests = [];
  let rows = initialRows || [{ year: 5786, parsha_id: 'Bereshit', mikra1: true, mikra2: true, rashi: true, onkelos: false }];
  await page.route('**/auth/v1/**', async route => {
    requests.push({ method: route.request().method(), url: route.request().url() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: userId, email: 'reader@example.com', app_metadata: {}, user_metadata: {}, aud: 'authenticated' }) });
  });
  await page.route('**/rest/v1/**', async route => {
    const request = route.request();
    requests.push({ method: request.method(), url: request.url() });
    const url = new URL(request.url());
    if (url.pathname.endsWith('/profiles')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(request.method() === 'GET' ? { israel: false, commentary: 'onkelos' } : {}) });
    } else if (request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
    } else if (request.method() === 'DELETE') {
      if (!failDelete) {
        const year = url.searchParams.get('year')?.slice(3);
        const parshaId = url.searchParams.get('parsha_id')?.slice(3);
        rows = rows.filter(row => (year && row.year !== Number(year)) || (parshaId && row.parsha_id !== parshaId));
      }
      await route.fulfill({ status: failDelete ? 500 : 204, body: failDelete ? JSON.stringify({ message: 'Test failure' }) : '' });
    } else {
      if (delayedWrite) await new Promise(resolve => setTimeout(resolve, 250));
      const incoming = request.postDataJSON();
      for (const row of Array.isArray(incoming) ? incoming : [incoming]) {
        const current = rows.find(r => r.year === row.year && r.parsha_id === row.parsha_id);
        if (current && request.headers().prefer?.includes('ignore-duplicates')) continue;
        rows = rows.filter(r => r !== current);
        rows.push({ ...current, ...row });
      }
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    }
  });
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ exp: 4102444800, sub: userId })).toString('base64url'), Buffer.from('test-signature').toString('base64url')].join('.');
  await page.evaluate(async token => {
    const { supabase } = await import('/src/auth.js');
    const { error } = await supabase.auth.setSession({ access_token: token, refresh_token: 'test-refresh' });
    if (error) throw error;
  }, token);
  await expect(page.locator('#announcement')).toContainText('Progress synced');
  return { requests, getRows: () => rows };
}

