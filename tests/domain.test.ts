import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../server/src/services/analyzer.ts';
import { reportRows, csvCell } from '../server/src/services/reports.ts';
import { reached } from '../shared/domain.ts';
const now = new Date('2026-11-18T12:00:00Z');
const activity = {
  id: 'test', code: 'Т-1', title: 'Тестовий захід', description: 'Опис', section: 'II', department: 'Тест', executorId: 'test', programId: 'test', riskId: 'test',
  startDate: new Date('2026-01-01'), deadline: new Date('2026-11-01'), status: 'COMPLETED', indicator: 'Частка', baseline: 0, target: 100, current: 100,
  result: 'Результат перевірено', actualDate: new Date('2026-10-01'), evidenceRequired: 'Документ', continuous: false, archived: false, deadlineChanges: 0,
  createdAt: new Date('2026-01-01'), updatedAt: now, evidence: [{}], executor: { name: 'Демо-виконавець' },
  risk: { id: 'test', code: 'Р-1', title: 'Ризик', description: '', causes: '', consequences: '', baseline: 50, current: 50, target: 10, direction: 'DOWN', indicator: 'Частка', assessedAt: now, programId: 'test' }
};
test('Виконання заходу не означає покращення ризику', () => {
  assert.deepEqual(analyze(activity, now).map(f => f.rule), ['NO_RISK_CHANGE']);
  assert.equal(analyze({ ...activity, risk: { ...activity.risk, current: 25 } }, now).length, 0);
});
test('Правила виявляють прострочення, повторні перенесення та неактуальні дані', () => {
  const rules = analyze({ ...activity, status: 'IN_PROGRESS', updatedAt: new Date('2026-09-01'), deadlineChanges: 2 }, now).map(f => f.rule);
  assert.deepEqual(rules, ['OVERDUE', 'REPEATED_DELAY', 'STALE']);
  assert.equal(analyze({ ...activity, archived: true }, now).length, 0);
});
test('Вимірювання, підтвердження та досягнення цілі перевіряються окремо', () => {
  const findings = analyze({ ...activity, current: null, evidence: [], result: '' }, now);
  for (const rule of ['NO_EVIDENCE', 'NO_MEASUREMENT', 'NO_RISK_CHANGE', 'NO_RESULT']) assert.ok(findings.some(f => f.rule === rule));
  assert.ok(analyze({ ...activity, current: 50 }, now).some(f => f.rule === 'TARGET_MISSED'));
  assert.ok(reached(10, 80, 20)); assert.ok(!reached(null, 0, 100));
});
test('Постійні заходи звітуються кінцем відповідного півріччя', () => {
  const rows = reportRows([{ ...activity, continuous: true }], 2026, 1);
  assert.equal(rows[0].actualDate, '2026-06-30');
  assert.equal(reportRows([{ ...activity, continuous: true }], 2026, 2)[0].actualDate, '2026-12-31');
});
test('Майбутній початок відображається як строк, що не настав', () => {
  assert.equal(reportRows([{ ...activity, status: 'NOT_STARTED', startDate: new Date('2026-09-01') }], 2026, 1)[0].status, 'Строк виконання не настав');
});
test('CSV нейтралізує формули та екранує лапки', () => {
  assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"');
  assert.equal(csvCell('Текст "цитата"'), '"Текст ""цитата"""');
});
