import { Router } from 'express';
import { z } from 'zod';
import { db } from '../database/db.ts';
import { permit } from '../middleware/auth.ts';
import { audit } from '../services/audit.ts';
import { refreshAnalysis } from '../services/analyzer.ts';
import { seed } from '../../../prisma/seed.ts';
import { fail } from './validation.ts';

export const settingsRouter = Router();
settingsRouter.get('/settings', permit('ADMIN'), async (_req, res) =>
  res.json({
    staleDays: Number((await db.setting.findUnique({ where: { key: 'staleDays' } }))?.value ?? 30),
    demoMode: process.env.DEMO_MODE === 'true',
  }),
);
settingsRouter.patch('/settings', permit('ADMIN'), async (req, res) => {
  const data = z.object({ staleDays: z.number().int().min(7).max(180) }).parse(req.body);
  const before = await db.setting.findUnique({ where: { key: 'staleDays' } });
  await db.setting.upsert({
    where: { key: 'staleDays' },
    create: { key: 'staleDays', value: String(data.staleDays) },
    update: { value: String(data.staleDays) },
  });
  await audit(req.user, 'Змінено налаштування', 'settings', before, data);
  await refreshAnalysis();
  res.json(data);
});
settingsRouter.post('/demo/reset', permit('ADMIN'), async (req, res) => {
  if (process.env.DEMO_MODE !== 'true')
    return fail(403, 'Скидання доступне лише в демонстраційному режимі.');
  if (req.body.confirm !== 'СКИНУТИ') return fail(400, 'Введіть СКИНУТИ для підтвердження.');
  await audit(req.user, 'Скинуто демонстраційні дані', 'demo', null, { reset: true });
  await seed(true);
  res.clearCookie('monitor_session');
  res.json({ ok: true });
});
