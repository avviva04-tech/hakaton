import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, addClusters, createRefreshQueue } from '../server/src/services/analyzer.ts';
import { dayKey, todayKey, isOverdue, displayStatus } from '../shared/dates.ts';
import { canTransition } from '../shared/domain.ts';
import { reportRows, csvCell } from '../server/src/services/reports.ts';
import { reached } from '../shared/domain.ts';
const now = new Date('2026-11-18T12:00:00Z');
const activity = {
  id: 'test',
  code: 'Т-1',
  title: 'Тестовий захід',
  description: 'Опис',
  section: 'II',
  department: 'Тест',
  executorId: 'test',
  programId: 'test',
  riskId: 'test',
  startDate: new Date('2026-01-01'),
  deadline: new Date('2026-11-01'),
  status: 'COMPLETED',
  indicator: 'Частка',
  baseline: 0,
  target: 100,
  current: 100,
  result: 'Результат перевірено',
  actualDate: new Date('2026-10-01'),
  evidenceRequired: 'Документ',
  continuous: false,
  archived: false,
  deadlineChanges: 0,
  createdAt: new Date('2026-01-01'),
  updatedAt: now,
  evidence: [{}],
  executor: { name: 'Демо-виконавець' },
  risk: {
    id: 'test',
    code: 'Р-1',
    title: 'Ризик',
    description: '',
    causes: '',
    consequences: '',
    baseline: 50,
    current: 50,
    target: 10,
    direction: 'DOWN',
    indicator: 'Частка',
    measurements: [{ value: 50, date: now }],
    assessedAt: now,
    programId: 'test',
  },
};
test('Виконання заходу не означає покращення ризику', () => {
  assert.deepEqual(
    analyze(activity, now).map((f) => f.rule),
    ['NO_RISK_CHANGE'],
  );
  assert.equal(
    analyze(
      {
        ...activity,
        risk: { ...activity.risk, current: 25, measurements: [{ value: 25, date: now }] },
      },
      now,
    ).length,
    0,
  );
});
test('Правила виявляють прострочення, повторні перенесення та неактуальні дані', () => {
  const rules = analyze(
    { ...activity, status: 'IN_PROGRESS', updatedAt: new Date('2026-09-01'), deadlineChanges: 2 },
    now,
  ).map((f) => f.rule);
  assert.deepEqual(rules, ['OVERDUE', 'REPEATED_DELAY', 'STALE']);
  assert.equal(analyze({ ...activity, archived: true }, now).length, 0);
});
test('Вимірювання, підтвердження та досягнення цілі перевіряються окремо', () => {
  const findings = analyze({ ...activity, current: null, evidence: [], result: '' }, now);
  for (const rule of ['NO_EVIDENCE', 'NO_MEASUREMENT', 'NO_RISK_CHANGE', 'NO_RESULT'])
    assert.ok(findings.some((f) => f.rule === rule));
  assert.ok(analyze({ ...activity, current: 50 }, now).some((f) => f.rule === 'TARGET_MISSED'));
  assert.ok(reached(10, 80, 20));
  assert.ok(!reached(null, 0, 100));
});
test('Постійні заходи звітуються кінцем відповідного півріччя', () => {
  const rows = reportRows([{ ...activity, continuous: true }], 2026, 1);
  assert.equal(rows[0].actualDate, '2026-06-30');
  assert.equal(
    reportRows([{ ...activity, continuous: true }], 2026, 2)[0].actualDate,
    '2026-12-31',
  );
});
test('Майбутній початок відображається як строк, що не настав', () => {
  assert.equal(
    reportRows(
      [{ ...activity, status: 'NOT_STARTED', startDate: new Date('2026-09-01') }],
      2026,
      1,
    )[0].status,
    'Строк виконання не настав',
  );
});
test('CSV нейтралізує формули та екранує лапки', () => {
  assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"');
  assert.equal(csvCell('Текст "цитата"'), '"Текст ""цитата"""');
});

test('CLUSTER не зачіпає здорові заходи та не залежить від порядку', () => {
  const finding = analyze({ ...activity, status: 'IN_PROGRESS' }, now);
  const entries = [
    { a: { ...activity, id: 'a' }, findings: finding },
    { a: { ...activity, id: 'b' }, findings: finding },
    { a: { ...activity, id: 'healthy' }, findings: [] },
  ];
  for (const input of [entries, [...entries].reverse()]) {
    assert.deepEqual(
      addClusters(input)
        .filter((x) => x.findings.some((f) => f.rule === 'CLUSTER'))
        .map((x) => x.a.id)
        .sort(),
      ['a', 'b'],
    );
  }
  assert.equal(
    entries[0].findings.some((f) => f.rule === 'CLUSTER'),
    false,
  );
});

test('Строки порівнюються календарними днями Києва', () => {
  const midnight = new Date('2026-11-19T22:30:00Z');
  assert.equal(todayKey(midnight), '2026-11-20');
  assert.equal(isOverdue('2026-11-20', 'IN_PROGRESS', midnight), false);
  assert.equal(isOverdue('2026-11-19', 'IN_PROGRESS', midnight), true);
  assert.equal(isOverdue('2026-11-19', 'COMPLETED', midnight), false);
  assert.ok(dayKey('2026-11-20') <= todayKey(midnight));
  assert.equal(
    displayStatus(
      { status: 'NOT_STARTED', startDate: '2026-11-21', deadline: '2026-11-25' },
      midnight,
    ),
    'NOT_DUE',
  );
  assert.equal(todayKey('2026-03-28T22:30:00Z'), '2026-03-29');
});

test('Матриця переходів усіх ролей', () => {
  const expected: Record<string, string[]> = {
    EXECUTOR: [
      'NOT_STARTED:IN_PROGRESS',
      'NOT_STARTED:REVIEW',
      'IN_PROGRESS:REVIEW',
      'REVISION:IN_PROGRESS',
      'REVISION:REVIEW',
      'REVIEW:IN_PROGRESS',
    ],
    COORDINATOR: [
      'NOT_STARTED:IN_PROGRESS',
      'IN_PROGRESS:NOT_STARTED',
      'REVIEW:MANAGER_REVIEW',
      'REVIEW:REVISION',
      'COMPLETED:REVISION',
    ],
    MANAGER: ['MANAGER_REVIEW:COMPLETED', 'MANAGER_REVIEW:REVISION'],
  };
  for (const role of ['EXECUTOR', 'COORDINATOR', 'ADMIN', 'MANAGER', 'ANALYST']) {
    for (const from of [
      'NOT_STARTED',
      'IN_PROGRESS',
      'REVIEW',
      'MANAGER_REVIEW',
      'REVISION',
      'COMPLETED',
    ]) {
      for (const to of [
        'NOT_STARTED',
        'IN_PROGRESS',
        'REVIEW',
        'MANAGER_REVIEW',
        'REVISION',
        'COMPLETED',
        'OVERDUE',
        'NOT_DUE',
      ]) {
        if (from === to) continue;
        assert.equal(
          canTransition(role, from, to),
          (expected[role === 'ADMIN' ? 'COORDINATOR' : role] ?? []).includes(`${from}:${to}`),
          `${role}: ${from} → ${to}`,
        );
      }
    }
  }
  assert.equal(canTransition('EXECUTOR', 'REVIEW', 'REVIEW'), false);
  assert.equal(canTransition('ADMIN', 'COMPLETED', 'COMPLETED'), false);
});

test('Оцінка ефекту чекає нового вимірювання та враховує історичну базу', () => {
  const risk = { ...activity.risk, measurements: [] };
  assert.ok(analyze({ ...activity, risk }, now).some((f) => f.rule === 'RISK_REMEASURE'));
  const measured = {
    ...risk,
    measurements: [
      { date: new Date('2025-12-01'), value: 30 },
      { date: new Date('2026-10-02'), value: 40 },
    ],
  };
  assert.ok(analyze({ ...activity, risk: measured }, now).some((f) => f.rule === 'NO_RISK_CHANGE'));
});

test('Мутація під час перерахунку очікує наступного проходу', async () => {
  const releases: (() => void)[] = [];
  let passes = 0;
  const refresh = createRefreshQueue(async () => {
    passes++;
    await new Promise<void>((resolve) => releases.push(resolve));
  });
  const first = refresh();
  const second = refresh();
  let finished = false;
  void second.then(() => {
    finished = true;
  });
  releases.shift()!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(passes, 2);
  assert.equal(finished, false);
  releases.shift()!();
  await Promise.all([first, second]);
  assert.equal(finished, true);
});
