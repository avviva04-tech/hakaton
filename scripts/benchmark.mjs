import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { testEnvironment } from './test-environment.mjs';

const test = await testEnvironment();
const db = new PrismaClient({ datasources: { db: { url: test.env.DATABASE_URL } } });
try {
  const template = await db.activity.findUniqueOrThrow({ where: { id: 'activity-1' } });
  for (let batch = 0; batch < 10; batch++) {
    await db.activity.createMany({
      data: Array.from({ length: 97 }, (_, i) => ({
        ...template,
        id: `load-${batch}-${i}`,
        code: `Н-${batch}-${i}`,
        status: 'IN_PROGRESS',
      })),
    });
  }
  const login = await fetch(`${test.base}/api/auth/demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'user-2' }),
  });
  const headers = { Cookie: login.headers.get('set-cookie').split(';')[0] };
  await fetch(`${test.base}/api/activities`, { headers });
  const start = performance.now();
  const response = await fetch(`${test.base}/api/activities`, { headers });
  const activities = await response.json();
  const elapsed = performance.now() - start;
  const panel = await (await fetch(`${test.base}/api/dashboard`, { headers })).text();
  assert.equal(activities.total, 1000);
  assert.ok(elapsed < 300, `Реєстр: ${elapsed.toFixed(1)} мс ≥ 300 мс`);
  assert.ok(Buffer.byteLength(panel) < 100000);
  assert.equal('items' in JSON.parse(panel), false);
  console.log(
    `1000 заходів: GET /activities ${elapsed.toFixed(1)} мс; /dashboard ${Buffer.byteLength(panel)} байтів.`,
  );
} finally {
  await db.$disconnect();
  await test.stop();
}
