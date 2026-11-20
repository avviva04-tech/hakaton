import { Router } from 'express';
import { z } from 'zod';
import { db } from '../database/db.ts';
import { permit } from '../middleware/auth.ts';
import { audit } from '../services/audit.ts';
import { id } from './validation.ts';

export const programsRouter = Router();
programsRouter.get('/programs', async (_req, res) =>
  res.json(await db.program.findMany({ orderBy: { year: 'desc' } })),
);
const programSchema = z.object({
  name: z.string().trim().min(3).max(200),
  description: z.string().max(2000),
  year: z.number().int().min(2020).max(2100),
  archived: z.boolean().default(false),
});
programsRouter.post('/programs', permit('ADMIN', 'COORDINATOR'), async (req, res) => {
  const item = await db.program.create({ data: programSchema.parse(req.body) });
  await audit(req.user, 'Створено програму', item.id, null, item);
  res.status(201).json(item);
});
programsRouter.patch('/programs/:id', permit('ADMIN', 'COORDINATOR'), async (req, res) => {
  const before = await db.program.findUniqueOrThrow({ where: { id: id(req.params.id) } });
  const item = await db.program.update({
    where: { id: before.id },
    data: programSchema.parse(req.body),
  });
  await audit(req.user, 'Змінено програму', item.id, before, item);
  res.json(item);
});
