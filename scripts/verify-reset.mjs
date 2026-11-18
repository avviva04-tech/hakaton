import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
mkdirSync('.tools', { recursive: true });
const probe = createServer();
await new Promise(resolvePort => probe.listen(0, '127.0.0.1', resolvePort));
const port = probe.address().port;
await new Promise(resolveClose => probe.close(resolveClose));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATABASE_URL: `file:${resolve('.tools/reset-test.db').replaceAll('\\', '/')}`, PORT: String(port), DEMO_MODE: 'true' };
for (const args of [['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], ['prisma/seed.ts']]) {
  const r = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const server = spawn(process.execPath, ['server/src/index.ts', '--production'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
server.stderr.pipe(process.stderr);
let ready;
try {
  await new Promise((resolveReady, reject) => {
    ready = setTimeout(() => reject(new Error('Тестовий сервер не запустився.')), 20000);
    server.stdout.on('data', data => { if (data.toString().includes(`localhost:${port}`)) resolveReady(); });
    server.on('exit', code => reject(new Error(`Сервер завершився: ${code}`)));
  });
  const login = await fetch(`${base}/api/auth/demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'user-1' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  const before = await (await fetch(`${base}/api/audit`, { headers })).json();
  const rejected = await fetch(`${base}/api/demo/reset`, { method: 'POST', headers, body: JSON.stringify({ confirm: 'НІ' }) }); assert.equal(rejected.status, 400);
  const reset = await fetch(`${base}/api/demo/reset`, { method: 'POST', headers, body: JSON.stringify({ confirm: 'СКИНУТИ' }) }); assert.equal(reset.status, 200);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers })).status, 401);
  const again = await fetch(`${base}/api/auth/demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'user-1' }) });
  headers.Cookie = again.headers.get('set-cookie').split(';')[0];
  const dashboard = await (await fetch(`${base}/api/dashboard?programId=program-demo`, { headers })).json();
  assert.equal(dashboard.total, 30); assert.equal(dashboard.riskCount, 12);
  const evidence = await (await fetch(`${base}/api/evidence`, { headers })).json(); assert.equal(evidence.length, 20);
  const audit = await (await fetch(`${base}/api/audit`, { headers })).json();
  assert.ok(audit.length > before.length); assert.ok(audit.some(a => a.action === 'Скинуто демонстраційні дані'));
  console.log('Скидання перевірено: 30 заходів, 12 ризиків, 20 матеріалів; аудит збережено, стару сесію відкликано.');
} finally { clearTimeout(ready); server.kill(); }
