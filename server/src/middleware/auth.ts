import type { Request, Response, NextFunction } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../database/db.ts';
import type { Viewer, Role } from '../../../shared/domain.ts';
declare global { namespace Express { interface Request { user: Viewer } } }
export const publicUser = { id: true, name: true, email: true, role: true, department: true, active: true };
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export async function createSession(userId: string, res: Response) {
  const token = randomBytes(32).toString('hex');
  await db.session.create({ data: { id: tokenHash(token), userId, expiresAt: new Date(Date.now() + 8 * 3600000) } });
  res.cookie('monitor_session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', maxAge: 8 * 3600000, path: '/' });
}
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.monitor_session;
  const session = typeof token === 'string' ? await db.session.findUnique({ where: { id: tokenHash(token) }, include: { user: true } }) : null;
  if (!session || session.expiresAt < new Date() || !session.user.active) { res.status(401).json({ error: 'Увійдіть до системи.' }); return; }
  const { id, name, email, department, role } = session.user;
  req.user = { id, name, email, department, role: role as Role };
  next();
}
export function permit(...roles: Role[]) { return (req: Request, res: Response, next: NextFunction) => {
  if (!roles.includes(req.user.role)) { res.status(403).json({ error: 'Недостатньо прав для цієї дії.' }); return; } next();
}; }
export function scope(req: Request) { return req.user.role === 'EXECUTOR' ? { executorId: req.user.id } : {}; }
export function canRead(req: Request, a: { executorId: string }) { return req.user.role !== 'EXECUTOR' || a.executorId === req.user.id; }
export function canEdit(req: Request, a: { executorId: string }) { return ['ADMIN', 'COORDINATOR'].includes(req.user.role) || req.user.role === 'EXECUTOR' && a.executorId === req.user.id; }
