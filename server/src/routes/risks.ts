import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../database/db.ts';
import { permit, scope } from '../middleware/auth.ts';
import { audit } from '../services/audit.ts';
import { refreshAnalysis } from '../services/analyzer.ts';
import { id } from './validation.ts';

export const risksRouter = Router();
risksRouter.get('/risks', async (req, res) =>
  res.json(
    await db.risk.findMany({
      where: {
        ...(req.query.programId ? { programId: id(req.query.programId) } : {}),
        ...(req.user.role === 'EXECUTOR'
          ? { activities: { some: { executorId: req.user.id } } }
          : {}),
      },
      include: {
        measurements: { orderBy: { date: 'asc' } },
        activities: {
          where: { archived: false, ...scope(req) },
          select: {
            id: true,
            title: true,
            status: true,
            code: true,
            startDate: true,
            deadline: true,
          },
        },
      },
      orderBy: { code: 'asc' },
    }),
  ),
);
const riskSchema = z.object({
  title: z.string().trim().min(5).max(300),
  description: z.string().max(3000),
  causes: z.string().max(2000),
  consequences: z.string().max(2000),
  baseline: z.number().finite(),
  current: z.number().finite(),
  target: z.number().finite(),
  direction: z.enum(['UP', 'DOWN']),
  indicator: z.string().min(3).max(300),
  programId: z.string(),
});
risksRouter.post('/risks', permit('ADMIN', 'COORDINATOR', 'ANALYST'), async (req, res) => {
  const data = riskSchema.parse(req.body);
  const risk = await db.risk.create({
    data: {
      ...data,
      code: `Р-${randomUUID().slice(0, 8).toUpperCase()}`,
      assessedAt: new Date(),
      measurements: {
        create: { value: data.current, note: 'Початкова оцінка', author: req.user.name },
      },
    },
  });
  await audit(req.user, 'Створено ризик', risk.id, null, risk);
  res.status(201).json(risk);
});
risksRouter.post(
  '/risks/:id/measurements',
  permit('ADMIN', 'COORDINATOR', 'ANALYST'),
  async (req, res) => {
    const data = z
      .object({ value: z.number().finite(), note: z.string().trim().min(5).max(2000) })
      .parse(req.body);
    const before = await db.risk.findUniqueOrThrow({ where: { id: id(req.params.id) } });
    const risk = await db.risk.update({
      where: { id: before.id },
      data: {
        current: data.value,
        assessedAt: new Date(),
        measurements: { create: { ...data, author: req.user.name } },
      },
    });
    await audit(req.user, 'Оновлено вимірювання ризику', risk.id, before, risk);
    await refreshAnalysis();
    res.json(risk);
  },
);
