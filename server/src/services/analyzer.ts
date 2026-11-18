import type { Activity, Risk } from '@prisma/client';
import { db } from '../database/db.ts';
import { reached } from '../../../shared/domain.ts';
type Input = Activity & { risk: Risk; evidence: unknown[] };
export type Finding = { rule: string; title: string; reason: string; action: string; priority: string };
export function analyze(a: Input, now = new Date(), staleDays = 30): Finding[] {
  if (a.archived) return [];
  const findings: Finding[] = [];
  const add = (rule: string, title: string, reason: string, action: string, priority = 'HIGH') => findings.push({ rule, title, reason, action, priority });
  const completed = a.status === 'COMPLETED';
  if (!completed && a.deadline < now) add('OVERDUE', 'Порушено контрольний строк', `Контрольний строк: ${a.deadline.toISOString().slice(0, 10)}. Захід не завершено.`, 'Запросити пояснення та оновлений план виконання.', 'CRITICAL');
  if (['COMPLETED', 'REVIEW'].includes(a.status) && !a.evidence.length) add('NO_EVIDENCE', 'Відсутні підтвердні матеріали', 'Результат подано без жодного документа.', 'Запросити документальне підтвердження результату.');
  if (completed && a.current === null) add('NO_MEASUREMENT', 'Виконання без вимірюваного результату', 'Поточне значення індикатора заходу не внесено.', 'Внести виміряне значення та джерело вимірювання.');
  if (completed && (a.risk.direction === 'DOWN' ? a.risk.current >= a.risk.baseline : a.risk.current <= a.risk.baseline)) add('NO_RISK_CHANGE', 'Ризик не зменшився після виконання', `Показник ризику: ${a.risk.baseline} → ${a.risk.current}. Статус заходу не доводить ефективності.`, 'Оцінити ефективність заходу та переглянути спосіб впливу на ризик.');
  if (completed && a.current !== null && !reached(a.current, a.baseline, a.target)) add('TARGET_MISSED', 'Цільове значення не досягнуто', `Поточне значення: ${a.current}; ціль: ${a.target}; початкове: ${a.baseline}.`, 'Погодити додаткові дії для досягнення цільового показника.');
  if (a.deadlineChanges >= 2) add('REPEATED_DELAY', 'Повторне перенесення строків', `Зафіксовано змін строку: ${a.deadlineChanges}. Це сигнал перегляду плану, а не висновок про винуватість.`, 'Переглянути ресурси, залежності та реалістичність плану.', 'MEDIUM');
  if (!completed && now.getTime() - a.updatedAt.getTime() > staleDays * 86400000) add('STALE', 'Дані потребують актуалізації', `Останнє оновлення: ${a.updatedAt.toISOString().slice(0, 10)}; поріг: ${staleDays} днів.`, 'Запросити актуальний стан виконання.', 'MEDIUM');
  if (completed && !a.result.trim()) add('NO_RESULT', 'Не описано досягнутий результат', 'Захід завершено без опису результату; відповідність меті неможливо перевірити.', 'Додати опис результату та перевірити його відповідність меті.', 'HIGH');
  return findings;
}
let running: Promise<void> | undefined;
export function refreshAnalysis(): Promise<void> {
  if (running) return running;
  running = refresh().finally(() => { running = undefined; });
  return running;
}
async function refresh() {
  const now = new Date();
  const setting = await db.setting.findUnique({ where: { key: 'staleDays' } });
  const items = await db.activity.findMany({ include: { risk: true, evidence: true, executor: true } });
  const all = items.map(a => ({ a, findings: analyze(a, now, Number(setting?.value ?? 30)) }));
  for (const { a, findings } of all) {
    if (!a.archived && all.filter(b => b.a.riskId === a.riskId && b.findings.length > 0).length >= 2) findings.push({ rule: 'CLUSTER', title: 'Кілька проблемних заходів одного ризику', reason: `Ризик «${a.risk.title}» пов’язаний щонайменше з двома проблемними заходами.`, action: 'Провести спільний перегляд заходів для цього ризику.', priority: 'HIGH' });
    await db.$transaction(async tx => {
      await tx.riskFlag.updateMany({ where: { activityId: a.id, rule: { notIn: findings.map(f => f.rule) } }, data: { active: false } });
      await tx.recommendation.updateMany({ where: { activityId: a.id, rule: { notIn: findings.map(f => f.rule) } }, data: { active: false } });
      for (const f of findings) {
        await tx.riskFlag.upsert({ where: { activityId_rule: { activityId: a.id, rule: f.rule } }, create: { activityId: a.id, ...f }, update: { ...f, active: true } });
        const recommendation = { problem: f.title, basis: f.reason, action: f.action, priority: f.priority, responsible: a.executor.name };
        await tx.recommendation.upsert({ where: { activityId_rule: { activityId: a.id, rule: f.rule } }, create: { activityId: a.id, rule: f.rule, ...recommendation, deadline: new Date(now.getTime() + 7 * 86400000) }, update: { ...recommendation, active: true } });
      }
      const days = Math.ceil((a.deadline.getTime() - now.getTime()) / 86400000);
      const active = !a.archived && a.status !== 'COMPLETED' && days <= 7;
      await tx.notification.upsert({ where: { activityId_userId_kind: { activityId: a.id, userId: a.executorId, kind: 'DEADLINE' } }, create: { activityId: a.id, userId: a.executorId, kind: 'DEADLINE', active, message: `${a.code}: ${days < 0 ? 'строк прострочено' : 'наближається контрольний строк'} — ${a.deadline.toISOString().slice(0, 10)}` }, update: { active, message: `${a.code}: ${days < 0 ? 'строк прострочено' : 'наближається контрольний строк'} — ${a.deadline.toISOString().slice(0, 10)}` } });
    });
  }
}
