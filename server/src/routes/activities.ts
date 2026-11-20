import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, activityInclude } from '../database/db.ts';
import { permit, scope, canRead, canEdit } from '../middleware/auth.ts';
import { audit } from '../services/audit.ts';
import { refreshAnalysis } from '../services/analyzer.ts';
import { statuses, canTransition } from '../../../shared/domain.ts';
import { dayKey, todayKey } from '../../../shared/dates.ts';
import { statusFilter } from '../services/dashboard.ts';
import { fail, id, isoDate } from './validation.ts';

export const activitiesRouter = Router();
activitiesRouter.get('/activities', async (req, res) => {
  const q = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(12),
      search: z.string().max(200).optional(),
      status: z.string().optional(),
      programId: z.string().optional(),
      executorId: z.string().optional(),
      department: z.string().optional(),
      section: z.string().optional(),
      riskId: z.string().optional(),
      sort: z.enum(['deadline', 'title', 'updatedAt']).default('deadline'),
      order: z.enum(['asc', 'desc']).default('asc'),
      archived: z.enum(['true', 'false']).default('false'),
      from: isoDate.optional(),
      to: isoDate.optional(),
    })
    .parse(req.query);
  const where = {
    archived: q.archived === 'true',
    ...(q.search
      ? { OR: [{ title: { contains: q.search } }, { code: { contains: q.search } }] }
      : {}),
    ...(q.status ? { AND: [statusFilter(q.status)] } : {}),
    ...(q.programId ? { programId: q.programId } : {}),
    ...(q.executorId ? { executorId: q.executorId } : {}),
    ...(q.department ? { department: q.department } : {}),
    ...(q.section ? { section: q.section } : {}),
    ...(q.riskId ? { riskId: q.riskId } : {}),
    ...(q.from || q.to ? { deadline: { gte: q.from, lte: q.to } } : {}),
    ...scope(req),
  };
  const [items, total] = await db.$transaction([
    db.activity.findMany({
      where,
      include: activityInclude,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { [q.sort]: q.order },
    }),
    db.activity.count({ where }),
  ]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
});
activitiesRouter.get('/activities/:id', async (req, res) => {
  const a = await db.activity.findUniqueOrThrow({
    where: { id: id(req.params.id) },
    include: activityInclude,
  });
  if (!canRead(req, a)) return fail(403, 'Доступ лише до власних заходів.');
  res.json(a);
});
const activitySchema = z
  .object({
    title: z.string().trim().min(5).max(300),
    description: z.string().trim().min(5).max(5000),
    section: z.enum(['I', 'II', 'III']),
    department: z.string().trim().min(2).max(150),
    executorId: z.string(),
    programId: z.string(),
    riskId: z.string(),
    startDate: isoDate,
    deadline: isoDate,
    indicator: z.string().trim().min(3).max(300),
    baseline: z.number().finite(),
    target: z.number().finite(),
    evidenceRequired: z.string().max(1000),
    continuous: z.boolean().default(false),
  })
  .refine((a) => a.deadline >= a.startDate, 'Контрольний строк не може бути раніше початку.');
async function validateRelations(data: z.infer<typeof activitySchema>) {
  const [risk, user, program] = await Promise.all([
    db.risk.findUnique({ where: { id: data.riskId } }),
    db.user.findUnique({ where: { id: data.executorId } }),
    db.program.findUnique({ where: { id: data.programId } }),
  ]);
  if (
    !risk ||
    risk.programId !== data.programId ||
    !user ||
    !user.active ||
    user.role !== 'EXECUTOR' ||
    !program ||
    program.archived
  )
    fail(400, 'Перевірте активну програму, ризик цієї програми та активного виконавця.');
}
activitiesRouter.post('/activities', permit('ADMIN', 'COORDINATOR'), async (req, res) => {
  const data = activitySchema.parse(req.body);
  await validateRelations(data);
  const item = await db.$transaction(async (tx) => {
    const a = await tx.activity.create({
      data: { ...data, code: `З-${randomUUID().slice(0, 8).toUpperCase()}` },
    });
    await tx.auditLog.create({
      data: {
        userId: req.user.id,
        userName: req.user.name,
        action: 'Створено захід',
        objectId: a.id,
        before: 'null',
        after: JSON.stringify(a),
      },
    });
    return a;
  });
  await refreshAnalysis();
  res.status(201).json(item);
});
activitiesRouter.patch('/activities/:id', permit('ADMIN', 'COORDINATOR'), async (req, res) => {
  const data = activitySchema.parse(req.body);
  await validateRelations(data);
  const before = await db.activity.findUniqueOrThrow({ where: { id: id(req.params.id) } });
  if (before.archived) return fail(400, 'Спочатку відновіть захід з архіву.');
  if (['MANAGER_REVIEW', 'COMPLETED'].includes(before.status))
    return fail(409, 'Спочатку поверніть результат на доопрацювання.');
  const a = await db.activity.update({
    where: { id: before.id },
    data: {
      ...data,
      deadlineChanges: { increment: data.deadline.getTime() !== before.deadline.getTime() ? 1 : 0 },
    },
  });
  await audit(req.user, 'Відредаговано захід / строки / призначення', a.id, before, a);
  await refreshAnalysis();
  res.json(a);
});
activitiesRouter.post(
  '/activities/:id/archive',
  permit('ADMIN', 'COORDINATOR'),
  async (req, res) => {
    const { archived } = z.object({ archived: z.boolean() }).parse(req.body);
    const a = await db.activity.update({ where: { id: id(req.params.id) }, data: { archived } });
    await audit(
      req.user,
      archived ? 'Архівовано захід' : 'Відновлено захід',
      a.id,
      { archived: !archived },
      { archived },
    );
    await refreshAnalysis();
    res.json(a);
  },
);
activitiesRouter.post('/activities/:id/progress', async (req, res) => {
  const data = z
    .object({
      status: z.enum(
        Object.keys(statuses) as [keyof typeof statuses, ...Array<keyof typeof statuses>],
      ),
      result: z.string().max(10000),
      current: z.number().finite().nullable(),
      actualDate: isoDate.nullable(),
      comment: z.string().max(3000).optional(),
    })
    .parse(req.body);
  const before = await db.activity.findUniqueOrThrow({ where: { id: id(req.params.id) } });
  if (!canEdit(req, before) && req.user.role !== 'MANAGER')
    return fail(403, 'Немає прав на оновлення цього заходу.');
  if (before.archived) return fail(400, 'Архівний захід не можна змінювати.');
  if (!canTransition(req.user.role, before.status, data.status))
    return fail(403, 'Цей перехід статусу недоступний для вашої ролі.');
  if (
    ((req.user.role === 'EXECUTOR' && before.status === 'REVIEW') || req.user.role === 'MANAGER') &&
    (data.result !== before.result ||
      data.current !== before.current ||
      (data.actualDate ? dayKey(data.actualDate) : null) !==
        (before.actualDate ? dayKey(before.actualDate) : null))
  )
    return fail(403, 'Спочатку відкличте результат з погодження без зміни його даних.');
  if (req.user.role === 'MANAGER' && !data.comment?.trim())
    return fail(400, 'Додайте обґрунтування рішення керівника для звіту.');
  if (before.status === 'COMPLETED' && data.status === 'REVISION' && !data.comment?.trim())
    return fail(400, 'Поясніть причину повернення виконаного заходу на доопрацювання.');
  if (
    ['COMPLETED', 'MANAGER_REVIEW'].includes(data.status) &&
    !(await db.evidence.count({ where: { activityId: before.id } }))
  )
    return fail(400, 'Для погодження завантажте хоча б один підтвердний документ.');
  if (
    ['COMPLETED', 'REVIEW', 'MANAGER_REVIEW'].includes(data.status) &&
    (!data.result.trim() || data.current === null || !data.actualDate)
  )
    return fail(400, 'Вкажіть результат, значення індикатора та фактичну дату.');
  if (
    data.actualDate &&
    (dayKey(data.actualDate) > todayKey() || dayKey(data.actualDate) < dayKey(before.startDate))
  )
    return fail(400, 'Фактична дата має бути між початком заходу та сьогоднішньою датою.');
  const { comment, ...progress } = data;
  const a = await db.$transaction(async (tx) => {
    const item = await tx.activity.update({
      where: { id: before.id, updatedAt: before.updatedAt },
      data: progress,
    });
    if (before.status !== data.status) {
      await tx.notification.updateMany({
        where: {
          activityId: before.id,
          kind: { in: ['REVIEW', 'REVISION', 'MANAGER_REVIEW', 'COMPLETED'] },
        },
        data: { active: false },
      });
    }
    if (
      before.status !== data.status &&
      ['REVIEW', 'REVISION', 'MANAGER_REVIEW', 'COMPLETED'].includes(data.status)
    ) {
      const recipients = ['REVIEW', 'MANAGER_REVIEW'].includes(data.status)
        ? await tx.user.findMany({
            where: {
              active: true,
              role: {
                in: data.status === 'MANAGER_REVIEW' ? ['MANAGER'] : ['ADMIN', 'COORDINATOR'],
              },
            },
            select: { id: true },
          })
        : [{ id: before.executorId }];
      for (const recipient of recipients) {
        const message = `${before.code}: ${statuses[data.status]}`;
        await tx.notification.upsert({
          where: {
            activityId_userId_kind: {
              activityId: before.id,
              userId: recipient.id,
              kind: data.status,
            },
          },
          create: { activityId: before.id, userId: recipient.id, kind: data.status, message },
          update: { message, active: true, read: false, createdAt: new Date() },
        });
      }
    }
    if (comment?.trim())
      await tx.comment.create({
        data: { activityId: before.id, text: comment, author: req.user.name },
      });
    await tx.auditLog.create({
      data: {
        userId: req.user.id,
        userName: req.user.name,
        action:
          req.user.role === 'MANAGER'
            ? data.status === 'COMPLETED'
              ? 'Схвалено керівником'
              : 'Не схвалено керівником'
            : data.status === 'MANAGER_REVIEW'
              ? 'Передано на розгляд керівника'
              : data.status === 'COMPLETED'
                ? 'Погоджено виконання'
                : data.status === 'REVISION'
                  ? 'Повернуто на доопрацювання'
                  : 'Оновлено виконання',
        objectId: item.id,
        before: JSON.stringify(before),
        after: JSON.stringify({
          ...item,
          decisionNote: comment?.trim() || '',
          decisionRole: req.user.role,
        }),
      },
    });
    return item;
  });
  await refreshAnalysis();
  res.json(a);
});
activitiesRouter.post('/activities/:id/comments', async (req, res) => {
  const a = await db.activity.findUniqueOrThrow({ where: { id: id(req.params.id) } });
  if (!canEdit(req, a)) return fail(403, 'Немає прав на коментування.');
  const { text } = z.object({ text: z.string().trim().min(1).max(3000) }).parse(req.body);
  const c = await db.comment.create({ data: { activityId: a.id, text, author: req.user.name } });
  await audit(req.user, 'Додано коментар', a.id, null, c);
  res.status(201).json(c);
});
