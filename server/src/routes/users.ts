import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../database/db.ts';
import { permit, publicUser } from '../middleware/auth.ts';
import { audit } from '../services/audit.ts';
import { roles } from '../../../shared/domain.ts';
import { fail, id } from './validation.ts';

export const usersRouter = Router();
usersRouter.get('/users', async (req, res) =>
  res.json(
    await db.user.findMany({
      select: ['ADMIN', 'COORDINATOR'].includes(req.user.role)
        ? publicUser
        : { id: true, name: true, role: true, department: true, active: true },
      orderBy: { name: 'asc' },
    }),
  ),
);
const userSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email(),
  role: z.enum(Object.keys(roles) as [keyof typeof roles, ...Array<keyof typeof roles>]),
  department: z.string().trim().min(2).max(120),
  active: z.boolean().default(true),
  password: z.string().min(10).max(100).optional(),
});
usersRouter.post('/users', permit('ADMIN'), async (req, res) => {
  const { password, ...data } = userSchema.parse(req.body);
  if (!password) return fail(400, 'Вкажіть пароль від 10 символів.');
  const user = await db.user.create({
    data: { ...data, passwordHash: await bcrypt.hash(password, 12) },
    select: publicUser,
  });
  await audit(req.user, 'Створено користувача', user.id, null, user);
  res.status(201).json(user);
});
usersRouter.patch('/users/:id', permit('ADMIN'), async (req, res) => {
  const { password, ...data } = userSchema.parse(req.body);
  if (req.params.id === req.user.id && (!data.active || data.role !== 'ADMIN'))
    return fail(
      400,
      'Не можна вимкнути власний обліковий запис або зняти власні права адміністратора.',
    );
  const before = await db.user.findUniqueOrThrow({
    where: { id: id(req.params.id) },
    select: publicUser,
  });
  const user = await db.user.update({
    where: { id: before.id },
    data: { ...data, ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}) },
    select: publicUser,
  });
  await db.session.deleteMany({ where: { userId: user.id } });
  await audit(req.user, 'Змінено користувача', user.id, before, user);
  res.json(user);
});
