import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../database/db.ts';
import { authenticate, publicUser, createSession, tokenHash } from '../middleware/auth.ts';
import { audit } from '../services/audit.ts';
import { fail, id } from './validation.ts';

export const authRouter = Router();
const loginLimit = rateLimit({
  windowMs: 15 * 60000,
  limit: 50,
  message: { error: 'Забагато спроб входу. Спробуйте пізніше.' },
});
authRouter.get('/health', async (_req, res) => {
  await db.$queryRaw`SELECT 1`;
  res.json({ status: 'ok' });
});
authRouter.get('/auth/demo', async (_req, res) =>
  res.json({
    enabled: process.env.DEMO_MODE === 'true',
    users:
      process.env.DEMO_MODE === 'true'
        ? (
            await db.user.findMany({
              select: { id: true, name: true, role: true },
              where: {
                active: true,
                id: { startsWith: 'user-' },
                email: { endsWith: '@demo.local' },
              },
            })
          ).filter((user) => /^user-\d+$/.test(user.id))
        : [],
  }),
);
authRouter.post('/auth/login', loginLimit, async (req, res) => {
  const body = z.object({ email: z.email(), password: z.string().min(1).max(200) }).parse(req.body);
  const user = await db.user.findUnique({ where: { email: body.email } });
  if (!user || !user.active || !(await bcrypt.compare(body.password, user.passwordHash)))
    return fail(401, 'Неправильна пошта або пароль.');
  await createSession(user.id, res);
  await audit(user, 'Вхід до системи', user.id, null, { role: user.role });
  res.json(await db.user.findUnique({ where: { id: user.id }, select: publicUser }));
});
authRouter.post('/auth/demo', loginLimit, async (req, res) => {
  if (process.env.DEMO_MODE !== 'true') return fail(403, 'Демонстраційний вхід вимкнено.');
  const user = await db.user.findUnique({ where: { id: id(req.body.userId) } });
  if (!user || !user.active || !/^user-\d+$/.test(user.id) || !user.email.endsWith('@demo.local'))
    return fail(404, 'Демонстраційний обліковий запис не знайдено.');
  if (req.cookies.monitor_session)
    await db.session.deleteMany({ where: { id: tokenHash(req.cookies.monitor_session) } });
  await createSession(user.id, res);
  await audit(user, 'Демонстраційний вхід', user.id, null, { role: user.role });
  res.json(await db.user.findUnique({ where: { id: user.id }, select: publicUser }));
});
authRouter.use('/auth', authenticate);
authRouter.get('/auth/me', (req, res) => res.json(req.user));
authRouter.post('/auth/logout', async (req, res) => {
  await db.session.deleteMany({ where: { id: tokenHash(req.cookies.monitor_session) } });
  res.clearCookie('monitor_session', { path: '/' });
  res.json({ ok: true });
});
