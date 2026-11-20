import { test } from 'node:test';
import assert from 'node:assert/strict';
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
async function login(email: string) {
  const response = await request('/auth/login', '', 'POST', { email, password: 'Demo2026!' });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie')!.split(';')[0];
}
test('Наскрізний цикл: авторизація, права, захід, документи, ризики, звіти, аудит', async () => {
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/activities')).status, 401);
  assert.equal(
    (
      await request('/auth/login', '', 'POST', {
        email: 'coordinator@demo.local',
        password: 'wrong',
      })
    ).status,
    401,
  );
  const coordinator = await login('coordinator@demo.local');
  const executor = await login('executor1@demo.local');
  const manager = await login('manager@demo.local');
  const analyst = await login('analyst@demo.local');
  const admin = await login('admin@demo.local');
  assert.equal((await request('/settings', manager)).status, 403);
  assert.equal((await request('/audit', executor)).status, 403);
  assert.equal((await request('/activities/activity-2', executor)).status, 403);
  assert.equal((await request('/users/user-1', coordinator, 'PATCH', {})).status, 403);
  assert.equal((await request('/activities', analyst, 'POST', {})).status, 403);
  const before = await (await request('/dashboard?programId=program-demo', coordinator)).json();
  const today = new Date().toISOString().slice(0, 10);
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
          status: 'COMPLETED',
        })
      ).status,
      200,
    );
    const after = await (await request('/dashboard?programId=program-demo', coordinator)).json();
    assert.equal(after.total, before.total + 1);
    assert.equal(after.completed, before.completed + 1);
    const flags = await (await request('/flags?programId=program-demo', coordinator)).json();
    assert.ok(
      flags.some(
        (f: { activityId: string; rule: string }) =>
          f.activityId === a.id && f.rule === 'NO_RISK_CHANGE',
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
    assert.ok(audit.some((x: { action: string }) => x.action === 'Погоджено виконання'));
    const y = new Date().getFullYear(),
      half = new Date().getMonth() < 6 ? 1 : 2;
    for (const format of ['json', 'csv', 'xlsx', 'pdf']) {
      const response = await request(
        `/reports?programId=program-demo&year=${y}&half=${half}&format=${format}`,
        coordinator,
      );
      assert.equal(response.status, 200, `Формат ${format}`);
      const buffer = Buffer.from(await response.arrayBuffer());
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
  assert.equal((await request('/auth/logout', executor, 'POST', {})).status, 200);
  assert.equal((await request('/auth/me', executor)).status, 401);
});
