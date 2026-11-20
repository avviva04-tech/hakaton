import 'dotenv/config';
import { todayKey } from '../shared/dates.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { db } from '../server/src/database/db.ts';
const base = process.env.TEST_URL ?? 'http://localhost:3000';
async function request(path: string, cookie = '', method = 'GET', body?: unknown) {
  return fetch(`${base}/api${path}`, {
    method,
    headers: {
      Cookie: cookie,
      ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
}
async function login(userId: string) {
  const response = await request('/auth/demo', '', 'POST', { userId });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie')!.split(';')[0];
}
test('Наскрізний цикл: авторизація, права, захід, документи, ризики, звіти, аудит', async () => {
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/activities')).status, 401);
  assert.equal((await request('/auth/demo', '', 'POST', { userId: 'missing-user' })).status, 404);
  const coordinator = await login('user-2');
  const executor = await login('user-5');
  const manager = await login('user-3');
  const analyst = await login('user-4');
  const admin = await login('user-1');
  const demo = await (await request('/auth/demo')).json();
  assert.equal(demo.users.length, 12);
  for (const user of demo.users) assert.deepEqual(Object.keys(user).sort(), ['id', 'name', 'role']);
  const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(
      `${base}/api/health`,
      { headers: { Host: 'attacker.invalid' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(reboundStatus, 403);
  const roleCookies = {
    ADMIN: admin,
    COORDINATOR: coordinator,
    EXECUTOR: executor,
    MANAGER: manager,
    ANALYST: analyst,
  };
  const flagsForMatrix = await (await request('/flags', admin)).json();
  const recsForMatrix = await (await request('/recommendations', admin)).json();
  for (const [role, cookie] of Object.entries(roleCookies)) {
    const users = await (await request('/users', cookie)).json();
    assert.equal('email' in users[0], ['ADMIN', 'COORDINATOR'].includes(role));
    assert.equal((await request('/settings', cookie)).status, role === 'ADMIN' ? 200 : 403);
    assert.equal(
      (await request('/audit?objectId=user-1', cookie)).status,
      role === 'ADMIN' ? 200 : 403,
    );
    assert.equal((await request('/audit?objectId=activity-1', cookie)).status, 200);
    assert.equal(
      (await request('/activities', cookie, 'POST', {})).status,
      ['ADMIN', 'COORDINATOR'].includes(role) ? 400 : 403,
    );
    assert.equal(
      (await request('/reports?programId=program-demo&year=2026&half=2', cookie)).status,
      role === 'EXECUTOR' ? 403 : 200,
    );
    const decision = ['ADMIN', 'COORDINATOR', 'MANAGER'].includes(role);
    assert.equal(
      (await request(`/flags/${flagsForMatrix[0].id}`, cookie, 'PATCH', { status: 'OPEN' })).status,
      decision ? 200 : 403,
    );
    assert.equal(
      (
        await request(`/recommendations/${recsForMatrix[0].id}`, cookie, 'PATCH', {
          status: 'DEFERRED',
        })
      ).status,
      decision ? 200 : 403,
    );
  }
  assert.equal((await request('/settings', manager)).status, 403);
  assert.equal((await request('/audit', executor)).status, 403);
  assert.equal((await request('/activities/activity-2', executor)).status, 403);
  assert.equal((await request('/users/user-1', coordinator, 'PATCH', {})).status, 403);
  assert.equal((await request('/activities', analyst, 'POST', {})).status, 403);
  const before = await (await request('/dashboard?programId=program-demo', coordinator)).json();
  const snapshot = await db.riskFlag.findMany({ orderBy: { id: 'asc' } });
  for (const route of [
    '/activities',
    '/flags',
    '/recommendations',
    '/notifications',
    '/dashboard',
    '/calendar',
  ]) {
    assert.equal((await request(route, coordinator)).status, 200);
  }
  assert.deepEqual(await db.riskFlag.findMany({ orderBy: { id: 'asc' } }), snapshot);
  const today = todayKey();
  const data = {
    title: 'Тест повного циклу виконання',
    description: 'Перевірка створення та погодження результату',
    section: 'II',
    department: 'Управління закупівель',
    executorId: 'user-5',
    programId: 'program-demo',
    riskId: 'risk-1',
    startDate: today,
    deadline: today,
    indicator: 'Частка перевірених процедур',
    baseline: 0,
    target: 100,
    evidenceRequired: 'Демонстраційне зображення',
    continuous: false,
  };
  assert.equal((await request('/activities', executor, 'POST', data)).status, 403);
  assert.equal(
    (await request('/activities', coordinator, 'POST', { ...data, executorId: 'user-1' })).status,
    400,
  );
  const created = await request('/activities', coordinator, 'POST', data);
  assert.equal(created.status, 201);
  const a = await created.json();
  try {
    assert.equal(
      (
        await request(`/activities/${a.id}`, coordinator, 'PATCH', {
          ...data,
          title: 'Тест повного циклу — оновлено',
        })
      ).status,
      200,
    );
    const progress = {
      status: 'REVIEW',
      result: 'Перевірено всі процедури. Результат підтверджено.',
      current: 100,
      actualDate: today,
      comment: 'Готово до погодження',
    };
    for (const [role, cookie] of Object.entries(roleCookies)) {
      for (const status of ['OVERDUE', 'NOT_DUE', 'COMPLETED']) {
        assert.equal(
          (await request(`/activities/${a.id}/progress`, cookie, 'POST', { ...progress, status }))
            .status,
          403,
          `${role} → ${status}`,
        );
      }
    }
    assert.equal(
      (
        await request(`/activities/${a.id}/progress`, executor, 'POST', {
          ...progress,
          status: 'COMPLETED',
        })
      ).status,
      403,
    );
    assert.equal(
      (await request(`/activities/${a.id}/progress`, executor, 'POST', progress)).status,
      200,
    );
    assert.equal(
      (await request(`/activities/${a.id}/progress`, executor, 'POST', progress)).status,
      403,
    );
    assert.equal(
      (
        await request(`/activities/${a.id}/progress`, coordinator, 'POST', {
          ...progress,
          status: 'MANAGER_REVIEW',
        })
      ).status,
      400,
    );
    const reviewNotifications = await (await request('/notifications', coordinator)).json();
    assert.ok(
      reviewNotifications.some(
        (n: { activityId: string; kind: string }) => n.activityId === a.id && n.kind === 'REVIEW',
      ),
    );
    const badFile = new FormData();
    badFile.set('activityId', a.id);
    badFile.set('file', new Blob(['not a pdf']), 'fake.pdf');
    assert.equal((await request('/evidence', executor, 'POST', badFile)).status, 400);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII=',
      'base64',
    );
    for (const version of [1, 2]) {
      const file = new FormData();
      file.set('activityId', a.id);
      file.set('file', new Blob([png], { type: 'image/png' }), 'test.png');
      const response = await request('/evidence', executor, 'POST', file);
      assert.equal(response.status, 201);
      const e = await response.json();
      assert.equal(e.version, version);
      assert.equal(e.sha256.length, 64);
      const downloaded = await request(`/evidence/${e.id}/download`, executor);
      assert.equal(downloaded.status, 200);
      assert.equal((await downloaded.arrayBuffer()).byteLength, png.length);
    }
    assert.equal(
      (
        await request(`/activities/${a.id}/progress`, coordinator, 'POST', {
          ...progress,
          status: 'MANAGER_REVIEW',
        })
      ).status,
      200,
    );
    const decide = (status: string, comment: string, cookie = manager) =>
      request(`/activities/${a.id}/progress`, cookie, 'POST', { ...progress, status, comment });
    assert.equal((await decide('COMPLETED', 'Спроба координатора', coordinator)).status, 403);
    assert.equal((await decide('COMPLETED', '')).status, 400);
    assert.equal(
      (
        await request(`/activities/${a.id}/progress`, manager, 'POST', {
          ...progress,
          result: 'Підмінено',
          status: 'COMPLETED',
        })
      ).status,
      403,
    );
    const lockedFile = new FormData();
    lockedFile.set('activityId', a.id);
    lockedFile.set('file', new Blob([png], { type: 'image/png' }), 'locked.png');
    assert.equal((await request('/evidence', executor, 'POST', lockedFile)).status, 409);
    assert.equal((await decide('REVISION', 'Додайте пояснення до результату.')).status, 200);
    assert.equal((await decide('COMPLETED', 'Передчасне рішення')).status, 403);
    assert.equal(
      (await request(`/activities/${a.id}/progress`, executor, 'POST', progress)).status,
      200,
    );
    assert.equal(
      (
        await request(`/activities/${a.id}/progress`, coordinator, 'POST', {
          ...progress,
          status: 'MANAGER_REVIEW',
        })
      ).status,
      200,
    );
    assert.equal(
      (await decide('COMPLETED', 'Матеріали перевірено, результат схвалено.')).status,
      200,
    );
    assert.equal((await decide('COMPLETED', 'Повторне рішення')).status, 403);
    const after = await (await request('/dashboard?programId=program-demo', coordinator)).json();
    assert.equal(after.total, before.total + 1);
    assert.equal(after.completed, before.completed + 1);
    const flags = await (await request('/flags?programId=program-demo', coordinator)).json();
    assert.ok(
      flags.some(
        (f: { activityId: string; rule: string }) =>
          f.activityId === a.id && f.rule === 'RISK_REMEASURE',
      ),
    );
    assert.ok(
      !flags.some(
        (f: { activityId: string; rule: string }) =>
          f.activityId === a.id && f.rule === 'NO_EVIDENCE',
      ),
    );
    const again = await (await request('/flags?programId=program-demo', coordinator)).json();
    assert.equal(flags.length, again.length);
    const recommendations = await (
      await request('/recommendations?programId=program-demo', manager)
    ).json();
    const r = recommendations.find((r: { activityId: string }) => r.activityId === a.id);
    assert.ok(r);
    assert.equal(
      (await request(`/recommendations/${r.id}`, manager, 'PATCH', { status: 'ACCEPTED' })).status,
      200,
    );
    assert.equal(
      (await request(`/recommendations/${r.id}`, executor, 'PATCH', { status: 'ACCEPTED' })).status,
      403,
    );
    const audit = await (await request(`/audit?objectId=${a.id}`, coordinator)).json();
    assert.ok(audit.length >= 6);
    assert.ok(audit.some((x: { action: string }) => x.action === 'Схвалено керівником'));
    assert.ok(audit.some((x: { action: string }) => x.action === 'Не схвалено керівником'));
    const y = new Date().getFullYear(),
      half = new Date().getMonth() < 6 ? 1 : 2;
    for (const format of ['json', 'csv', 'xlsx', 'pdf']) {
      const response = await request(
        `/reports?programId=program-demo&year=${y}&half=${half}&format=${format}`,
        coordinator,
      );
      assert.equal(response.status, 200, `Формат ${format}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (format === 'json') {
        const row = JSON.parse(buffer.toString()).find(
          (row: { code: string }) => row.code === a.code,
        );
        assert.match(row.managerDecisions, /Не схвалено керівником/);
        assert.match(row.managerDecisions, /Матеріали перевірено, результат схвалено/);
      }
      assert.ok(buffer.length > 100);
      if (format === 'pdf') assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
      if (format === 'xlsx') assert.equal(buffer.subarray(0, 2).toString(), 'PK');
    }
    assert.equal(
      (await request(`/reports?programId=program-demo&year=${y}&half=${half}`, executor)).status,
      403,
    );
    assert.equal((await request('/settings', admin)).status, 200);
  } finally {
    await request(`/activities/${a.id}/archive`, coordinator, 'POST', { archived: true });
  }
  const final = await (await request('/dashboard?programId=program-demo', coordinator)).json();
  assert.equal(final.total, before.total);
  const repeated = await db.activity.findUniqueOrThrow({ where: { id: 'activity-1' } });
  await db.activity.update({ where: { id: repeated.id }, data: { deadlineChanges: 2 } });
  await request('/settings', admin, 'PATCH', { staleDays: 30 });
  await db.riskFlag.update({
    where: { activityId_rule: { activityId: repeated.id, rule: 'REPEATED_DELAY' } },
    data: { status: 'ACKNOWLEDGED' },
  });
  await db.recommendation.update({
    where: { activityId_rule: { activityId: repeated.id, rule: 'REPEATED_DELAY' } },
    data: { status: 'ACCEPTED', deadline: new Date('2020-01-01') },
  });
  await db.activity.update({ where: { id: repeated.id }, data: { deadlineChanges: 0 } });
  await request('/settings', admin, 'PATCH', { staleDays: 30 });
  await db.activity.update({ where: { id: repeated.id }, data: { deadlineChanges: 2 } });
  await request('/settings', admin, 'PATCH', { staleDays: 30 });
  const reactivated = await db.recommendation.findUniqueOrThrow({
    where: { activityId_rule: { activityId: repeated.id, rule: 'REPEATED_DELAY' } },
  });
  assert.equal(reactivated.status, 'PENDING');
  assert.ok(reactivated.deadline > new Date());
  assert.equal(
    (
      await db.riskFlag.findUniqueOrThrow({
        where: { activityId_rule: { activityId: repeated.id, rule: 'REPEATED_DELAY' } },
      })
    ).status,
    'OPEN',
  );
  const noticeActivity = await db.activity.findUniqueOrThrow({ where: { id: 'activity-2' } });
  await db.activity.update({
    where: { id: noticeActivity.id },
    data: { deadline: new Date(todayKey()) },
  });
  await request('/settings', admin, 'PATCH', { staleDays: 30 });
  await db.notification.updateMany({
    where: { activityId: noticeActivity.id, kind: 'DEADLINE' },
    data: { read: true },
  });
  await db.activity.update({
    where: { id: noticeActivity.id },
    data: { deadline: new Date(Date.parse(todayKey()) - 86400000) },
  });
  await request('/settings', admin, 'PATCH', { staleDays: 30 });
  const notice = await db.notification.findFirstOrThrow({
    where: { activityId: noticeActivity.id, kind: 'DEADLINE' },
  });
  assert.equal(notice.read, false);
  assert.match(notice.message, /прострочено/);
  assert.equal((await request('/auth/logout', executor, 'POST', {})).status, 200);
  assert.equal((await request('/auth/me', executor)).status, 401);
  await db.$disconnect();
});
