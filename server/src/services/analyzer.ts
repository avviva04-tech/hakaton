import type { Activity, Risk, RiskMeasurement } from '@prisma/client';
import { db } from '../database/db.ts';
import { reached } from '../../../shared/domain.ts';
import { dayKey, daysUntil, isOverdue } from '../../../shared/dates.ts';
type Input = Activity & {
  risk: Risk & { measurements?: Pick<RiskMeasurement, 'value' | 'date'>[] };
  evidence: unknown[];
};
export type Finding = {
  rule: string;
  title: string;
  reason: string;
  action: string;
  priority: string;
};
export function analyze(a: Input, now = new Date(), staleDays = 30): Finding[] {
  if (a.archived) return [];
  const findings: Finding[] = [];
  const add = (rule: string, title: string, reason: string, action: string, priority = 'HIGH') =>
    findings.push({ rule, title, reason, action, priority });
  const completed = a.status === 'COMPLETED';
  if (isOverdue(a.deadline, a.status, now))
    add(
      'OVERDUE',
      'Порушено контрольний строк',
      `Контрольний строк: ${a.deadline.toISOString().slice(0, 10)}. Захід не завершено.`,
      'Запросити пояснення та оновлений план виконання.',
      'CRITICAL',
    );
  if (['COMPLETED', 'REVIEW', 'MANAGER_REVIEW'].includes(a.status) && !a.evidence.length)
    add(
      'NO_EVIDENCE',
      'Відсутні підтвердні матеріали',
      'Результат подано без жодного документа.',
      'Запросити документальне підтвердження результату.',
    );
  if (completed && a.current === null)
    add(
      'NO_MEASUREMENT',
      'Виконання без вимірюваного результату',
      'Поточне значення індикатора заходу не внесено.',
      'Внести виміряне значення та джерело вимірювання.',
    );
  const measurements = [...(a.risk.measurements ?? [])].sort(
    (x, y) => x.date.getTime() - y.date.getTime(),
  );
  const before = measurements.filter((m) => m.date < a.startDate).at(-1);
  const after = a.actualDate
    ? measurements.filter((m) => m.date > a.actualDate!).at(-1)
    : undefined;
  const baseline = before?.value ?? a.risk.baseline;
  if (completed && !after)
    add(
      'RISK_REMEASURE',
      'Потрібне повторне вимірювання ризику',
      'Після фактичної дати виконання ризик ще не виміряно.',
      'Внести контрольне вимірювання ризику після виконання заходу.',
      'MEDIUM',
    );
  if (
    completed &&
    after &&
    (a.risk.direction === 'DOWN' ? after.value >= baseline : after.value <= baseline)
  )
    add(
      'NO_RISK_CHANGE',
      'Ризик не зменшився після виконання',
      `Показник ризику: ${baseline} → ${after.value}. Статус заходу не доводить ефективності.`,
      'Оцінити ефективність заходу та переглянути спосіб впливу на ризик.',
    );
  if (completed && a.current !== null && !reached(a.current, a.baseline, a.target))
    add(
      'TARGET_MISSED',
      'Цільове значення не досягнуто',
      `Поточне значення: ${a.current}; ціль: ${a.target}; початкове: ${a.baseline}.`,
      'Погодити додаткові дії для досягнення цільового показника.',
    );
  if (a.deadlineChanges >= 2)
    add(
      'REPEATED_DELAY',
      'Повторне перенесення строків',
      `Зафіксовано змін строку: ${a.deadlineChanges}. Це сигнал перегляду плану, а не висновок про винуватість.`,
      'Переглянути ресурси, залежності та реалістичність плану.',
      'MEDIUM',
    );
  if (!completed && now.getTime() - a.updatedAt.getTime() > staleDays * 86400000)
    add(
      'STALE',
      'Дані потребують актуалізації',
      `Останнє оновлення: ${a.updatedAt.toISOString().slice(0, 10)}; поріг: ${staleDays} днів.`,
      'Запросити актуальний стан виконання.',
      'MEDIUM',
    );
  if (completed && !a.result.trim())
    add(
      'NO_RESULT',
      'Не описано досягнутий результат',
      'Захід завершено без опису результату; відповідність меті неможливо перевірити.',
      'Додати опис результату та перевірити його відповідність меті.',
      'HIGH',
    );
  return findings;
}
export function createRefreshQueue(refresh: () => Promise<void>) {
  let running: Promise<void> | undefined;
  let pending = false;
  return function requestRefresh(): Promise<void> {
    pending = true;
    if (!running) {
      running = (async () => {
        try {
          while (pending) {
            pending = false;
            await refresh();
          }
        } finally {
          running = undefined;
        }
      })();
    }
    return running;
  };
}
export const refreshAnalysis = createRefreshQueue(refresh);

export function addClusters<T extends Input>(all: { a: T; findings: Finding[] }[]) {
  const counts = new Map<string, number>();
  for (const { a, findings } of all) {
    if (!a.archived && findings.some((f) => f.rule !== 'CLUSTER'))
      counts.set(a.riskId, (counts.get(a.riskId) ?? 0) + 1);
  }
  return all.map(({ a, findings }) => {
    const own = findings.filter((f) => f.rule !== 'CLUSTER');
    if (!a.archived && own.length && (counts.get(a.riskId) ?? 0) >= 2)
      own.push({
        rule: 'CLUSTER',
        title: 'Кілька проблемних заходів одного ризику',
        reason: `Ризик «${a.risk.title}» пов’язаний щонайменше з двома проблемними заходами.`,
        action: 'Провести спільний перегляд заходів для цього ризику.',
        priority: 'HIGH',
      });
    return { a, findings: own };
  });
}
async function refresh() {
  const now = new Date();
  const setting = await db.setting.findUnique({ where: { key: 'staleDays' } });
  const items = await db.activity.findMany({
    include: {
      risk: { include: { measurements: true } },
      evidence: true,
      executor: true,
      flags: true,
      recommendations: true,
      notifications: true,
    },
  });
  const all = addClusters(
    items.map((a) => ({ a, findings: analyze(a, now, Number(setting?.value ?? 30)) })),
  );
  for (const { a, findings } of all) {
    await db.$transaction(async (tx) => {
      await tx.riskFlag.updateMany({
        where: { activityId: a.id, rule: { notIn: findings.map((f) => f.rule) } },
        data: { active: false },
      });
      await tx.recommendation.updateMany({
        where: { activityId: a.id, rule: { notIn: findings.map((f) => f.rule) } },
        data: { active: false },
      });
      for (const f of findings) {
        await tx.riskFlag.upsert({
          where: { activityId_rule: { activityId: a.id, rule: f.rule } },
          create: { activityId: a.id, ...f },
          update: {
            ...f,
            active: true,
            ...(a.flags.some((old) => old.rule === f.rule && !old.active)
              ? { status: 'OPEN', detectedAt: now }
              : {}),
          },
        });
        const recommendation = {
          problem: f.title,
          basis: f.reason,
          action: f.action,
          priority: f.priority,
          responsible: a.executor.name,
        };
        await tx.recommendation.upsert({
          where: { activityId_rule: { activityId: a.id, rule: f.rule } },
          create: {
            activityId: a.id,
            rule: f.rule,
            ...recommendation,
            deadline: new Date(now.getTime() + 7 * 86400000),
          },
          update: {
            ...recommendation,
            active: true,
            ...(a.recommendations.some((old) => old.rule === f.rule && !old.active)
              ? {
                  status: 'PENDING',
                  deadline: new Date(now.getTime() + 7 * 86400000),
                  createdAt: now,
                }
              : {}),
          },
        });
      }
      const days = daysUntil(a.deadline, now);
      const active = !a.archived && a.status !== 'COMPLETED' && days <= 7;
      const message = `${a.code}: ${days < 0 ? 'строк прострочено' : 'наближається контрольний строк'} — ${dayKey(a.deadline)}`;
      const previous = a.notifications.find(
        (n) => n.userId === a.executorId && n.kind === 'DEADLINE',
      );
      await tx.notification.upsert({
        where: {
          activityId_userId_kind: { activityId: a.id, userId: a.executorId, kind: 'DEADLINE' },
        },
        create: {
          activityId: a.id,
          userId: a.executorId,
          kind: 'DEADLINE',
          active,
          message,
        },
        update: {
          active,
          ...(previous && (previous.message !== message || (!previous.active && active))
            ? { read: false, createdAt: now }
            : {}),
          message,
        },
      });
    });
  }
}
