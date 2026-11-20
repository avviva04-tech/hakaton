import { Router } from 'express';
import { z } from 'zod';
import { db } from '../database/db.ts';
import { permit, scope, canRead } from '../middleware/auth.ts';
import { audit } from '../services/audit.ts';
import { dashboard, calendarSelect } from '../services/dashboard.ts';
import { fail, id, isoDate } from './validation.ts';

export const analysisRouter = Router();
analysisRouter.get('/flags', async (req, res) => {
  res.json(
    await db.riskFlag.findMany({
      where: {
        active: true,
        activity: {
          ...scope(req),
          ...(req.query.programId ? { programId: id(req.query.programId) } : {}),
        },
      },
      include: { activity: { select: { id: true, code: true, title: true } } },
      orderBy: { detectedAt: 'desc' },
    }),
  );
});
analysisRouter.patch('/flags/:id', permit('ADMIN', 'COORDINATOR', 'MANAGER'), async (req, res) => {
  const data = z.object({ status: z.enum(['OPEN', 'IN_REVIEW', 'ACKNOWLEDGED']) }).parse(req.body);
  const before = await db.riskFlag.findUniqueOrThrow({ where: { id: id(req.params.id) } });
  const f = await db.riskFlag.update({ where: { id: before.id }, data });
  await audit(req.user, 'Опрацьовано сигнал ризику', f.activityId, before, f);
  res.json(f);
});
analysisRouter.get('/recommendations', async (req, res) => {
  res.json(
    await db.recommendation.findMany({
      where: {
        active: true,
        activity: {
          ...scope(req),
          ...(req.query.programId ? { programId: id(req.query.programId) } : {}),
        },
      },
      include: { activity: { select: { id: true, code: true, title: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  );
});
analysisRouter.patch(
  '/recommendations/:id',
  permit('ADMIN', 'COORDINATOR', 'MANAGER'),
  async (req, res) => {
    const data = z.object({ status: z.enum(['ACCEPTED', 'REJECTED', 'DEFERRED']) }).parse(req.body);
    const before = await db.recommendation.findUniqueOrThrow({ where: { id: id(req.params.id) } });
    const r = await db.recommendation.update({ where: { id: before.id }, data });
    await audit(req.user, 'Рішення щодо рекомендації', r.activityId, before, r);
    res.json(r);
  },
);
analysisRouter.get('/notifications', async (req, res) => {
  res.json(
    await db.notification.findMany({
      where: { userId: req.user.id, active: true },
      include: { activity: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  );
});
analysisRouter.patch('/notifications/:id', async (req, res) => {
  const n = await db.notification.updateMany({
    where: { id: id(req.params.id), userId: req.user.id },
    data: { read: true },
  });
  res.json(n);
});
analysisRouter.get('/audit', async (req, res) => {
  if (req.user.role !== 'ADMIN' && !req.query.objectId)
    return fail(403, 'Загальний журнал доступний адміністратору.');
  if (req.query.objectId && req.user.role !== 'ADMIN') {
    const a = await db.activity.findUnique({ where: { id: id(req.query.objectId) } });
    if (!a || !canRead(req, a)) return fail(403, 'Доступ заборонено.');
  }
  res.json(
    await db.auditLog.findMany({
      where: req.query.objectId ? { objectId: id(req.query.objectId) } : {},
      orderBy: { createdAt: 'desc' },
      take: 300,
    }),
  );
});
analysisRouter.get('/dashboard', async (req, res) => {
  const program = req.query.programId ? { programId: id(req.query.programId) } : {};
  res.json(
    await dashboard(
      { archived: false, ...scope(req), ...program },
      {
        ...program,
        ...(req.user.role === 'EXECUTOR'
          ? { activities: { some: { executorId: req.user.id } } }
          : {}),
      },
    ),
  );
});
analysisRouter.get('/calendar', async (req, res) => {
  const q = z
    .object({ programId: z.string().optional(), from: isoDate.optional(), to: isoDate.optional() })
    .parse(req.query);
  res.json({
    items: await db.activity.findMany({
      where: {
        archived: false,
        ...scope(req),
        ...(q.programId ? { programId: q.programId } : {}),
        ...(q.from || q.to ? { deadline: { gte: q.from, lte: q.to } } : {}),
      },
      select: calendarSelect,
      orderBy: { deadline: 'asc' },
    }),
  });
});
