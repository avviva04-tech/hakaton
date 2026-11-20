import type { Prisma } from '@prisma/client';
import { db } from '../database/db.ts';
import { statuses, sections } from '../../../shared/domain.ts';
import { todayKey } from '../../../shared/dates.ts';

export function statusFilter(status: string, now = new Date()): Prisma.ActivityWhereInput {
  const today = new Date(todayKey(now));
  if (status === 'OVERDUE') return { status: { not: 'COMPLETED' }, deadline: { lt: today } };
  if (status === 'NOT_DUE')
    return { status: 'NOT_STARTED', startDate: { gt: today }, deadline: { gte: today } };
  if (status === 'COMPLETED') return { status };
  return {
    status,
    deadline: { gte: today },
    ...(status === 'NOT_STARTED' ? { startDate: { lte: today } } : {}),
  };
}

export const calendarSelect = {
  id: true,
  code: true,
  title: true,
  startDate: true,
  deadline: true,
  status: true,
  department: true,
  executorId: true,
  executor: { select: { name: true } },
} satisfies Prisma.ActivitySelect;

export async function dashboard(
  where: Prisma.ActivityWhereInput,
  riskWhere: Prisma.RiskWhereInput,
) {
  const now = new Date();
  const count = (extra: Prisma.ActivityWhereInput = {}) =>
    db.activity.count({ where: { AND: [where, extra] } });
  const [
    total,
    completed,
    inProgress,
    overdue,
    attention,
    riskCount,
    improved,
    deadlines,
    attentionItems,
    risks,
    distribution,
    sectionGroups,
    monthly,
  ] = await Promise.all([
    count(),
    count({ status: 'COMPLETED' }),
    count(statusFilter('IN_PROGRESS', now)),
    count(statusFilter('OVERDUE', now)),
    count({ flags: { some: { active: true } } }),
    db.risk.count({ where: riskWhere }),
    db.risk.count({
      where: {
        AND: [
          riskWhere,
          {
            OR: [
              { direction: 'DOWN', current: { lt: db.risk.fields.baseline } },
              { direction: 'UP', current: { gt: db.risk.fields.baseline } },
            ],
          },
        ],
      },
    }),
    db.activity.findMany({
      where: { AND: [where, { status: { not: 'COMPLETED' } }] },
      select: calendarSelect,
      orderBy: { deadline: 'asc' },
      take: 6,
    }),
    db.activity.findMany({
      where: { AND: [where, { flags: { some: { active: true } } }] },
      select: {
        ...calendarSelect,
        flags: { where: { active: true }, select: { title: true, priority: true } },
      },
      orderBy: { deadline: 'asc' },
      take: 5,
    }),
    db.risk.findMany({
      where: riskWhere,
      take: 12,
      orderBy: { code: 'asc' },
      include: { measurements: { orderBy: { date: 'desc' }, take: 12 } },
    }),
    Promise.all(
      Object.entries(statuses).map(async ([key, name]) => ({
        name,
        value: await count(statusFilter(key, now)),
      })),
    ),
    db.activity.groupBy({ by: ['section', 'status'], where, _count: true }),
    Promise.all(
      Array.from({ length: 6 }, async (_, i) => {
        const [year, month] = todayKey(now).split('-').map(Number);
        const start = new Date(Date.UTC(year, month - 6 + i, 1));
        const end = new Date(Date.UTC(year, month - 5 + i, 1));
        const [completed, planned] = await Promise.all([
          count({ status: 'COMPLETED', actualDate: { gte: start, lt: end } }),
          count({ deadline: { gte: start, lt: end } }),
        ]);
        return {
          month: start.toLocaleDateString('uk-UA', { month: 'short', timeZone: 'UTC' }),
          completed,
          planned,
        };
      }),
    ),
  ]);
  return {
    total,
    completed,
    inProgress,
    overdue,
    attention,
    riskCount,
    improved,
    progress: total ? Math.round((completed / total) * 100) : 0,
    deadlines,
    attentionItems,
    risks: risks.map((r) => ({ ...r, measurements: r.measurements.reverse() })),
    monthly,
    statusDistribution: distribution,
    sections: Object.entries(sections).map(([key, name]) => ({
      name,
      total: sectionGroups.filter((g) => g.section === key).reduce((sum, g) => sum + g._count, 0),
      completed:
        sectionGroups.find((g) => g.section === key && g.status === 'COMPLETED')?._count ?? 0,
    })),
  };
}
