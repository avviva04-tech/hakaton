import assert from 'node:assert/strict';
import { testEnvironment } from './test-environment.mjs';
const test = await testEnvironment();
const base = test.base;
try {
  const login = await fetch(`${base}/api/auth/demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'user-1' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  const before = await (await fetch(`${base}/api/audit`, { headers })).json();
  const rejected = await fetch(`${base}/api/demo/reset`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirm: 'НІ' }),
  });
  assert.equal(rejected.status, 400);
  const reset = await fetch(`${base}/api/demo/reset`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirm: 'СКИНУТИ' }),
  });
  assert.equal(reset.status, 200);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers })).status, 401);
  const again = await fetch(`${base}/api/auth/demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'user-1' }),
  });
  headers.Cookie = again.headers.get('set-cookie').split(';')[0];
  const dashboard = await (
    await fetch(`${base}/api/dashboard?programId=program-demo`, { headers })
  ).json();
  assert.equal(dashboard.total, 30);
  assert.equal(dashboard.riskCount, 12);
  const evidence = await (await fetch(`${base}/api/evidence`, { headers })).json();
  assert.equal(evidence.length, 20);
  const audit = await (await fetch(`${base}/api/audit`, { headers })).json();
  assert.ok(audit.length > before.length);
  assert.ok(audit.some((a) => a.action === 'Скинуто демонстраційні дані'));
  console.log(
    'Скидання перевірено: 30 заходів, 12 ризиків, 20 матеріалів; аудит збережено, стару сесію відкликано.',
  );
} finally {
  await test.stop();
}
