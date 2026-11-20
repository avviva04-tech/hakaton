import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { db, activityInclude } from '../database/db.ts';
import {
  authenticate,
  permit,
  scope,
  canRead,
  canEdit,
  publicUser,
  createSession,
  tokenHash,
} from '../middleware/auth.ts';
import { audit } from '../services/audit.ts';
import { refreshAnalysis } from '../services/analyzer.ts';
import { reportRows, reportHeaders, cells, csvCell } from '../services/reports.ts';
import { roles, statuses, sections } from '../../../shared/domain.ts';
import { seed } from '../../../prisma/seed.ts';
export const api = Router();
const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};
const id = (value: unknown) => z.string().min(1).max(100).parse(value);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/)
  .refine((v) => Number.isFinite(Date.parse(v)), 'Некоректна дата')
  .transform((v) => new Date(v));
const loginLimit = rateLimit({
  windowMs: 15 * 60000,
  limit: 50,
  message: { error: 'Забагато спроб входу. Спробуйте пізніше.' },
});
api.get('/health', async (_req, res) => {
  await db.$queryRaw`SELECT 1`;
  res.json({ status: 'ok' });
});
api.get('/auth/demo', async (_req, res) =>
  res.json({
    enabled: process.env.DEMO_MODE === 'true',
    users:
      process.env.DEMO_MODE === 'true'
        ? await db.user.findMany({ select: publicUser, where: { active: true } })
        : [],
  }),
);
api.post('/auth/login', loginLimit, async (req, res) => {
  const body = z.object({ email: z.email(), password: z.string().min(1).max(200) }).parse(req.body);
  const user = await db.user.findUnique({ where: { email: body.email } });
  if (!user || !user.active || !(await bcrypt.compare(body.password, user.passwordHash)))
    return fail(401, 'Неправильна пошта або пароль.');
  await createSession(user.id, res);
  await audit(user, 'Вхід до системи', user.id, null, { role: user.role });
  res.json(await db.user.findUnique({ where: { id: user.id }, select: publicUser }));
});
api.post('/auth/demo', loginLimit, async (req, res) => {
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
api.use(authenticate);
api.get('/auth/me', (req, res) => res.json(req.user));
api.post('/auth/logout', async (req, res) => {
  await db.session.deleteMany({ where: { id: tokenHash(req.cookies.monitor_session) } });
  res.clearCookie('monitor_session', { path: '/' });
  res.json({ ok: true });
});
api.get('/users', async (_req, res) =>
  res.json(await db.user.findMany({ select: publicUser, orderBy: { name: 'asc' } })),
);
const userSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email(),
  role: z.enum(Object.keys(roles) as [keyof typeof roles, ...Array<keyof typeof roles>]),
  department: z.string().trim().min(2).max(120),
  active: z.boolean().default(true),
  password: z.string().min(10).max(100).optional(),
});
api.post('/users', permit('ADMIN'), async (req, res) => {
  const { password, ...data } = userSchema.parse(req.body);
  if (!password) return fail(400, 'Вкажіть пароль від 10 символів.');
  const user = await db.user.create({
    data: { ...data, passwordHash: await bcrypt.hash(password, 12) },
    select: publicUser,
  });
  await audit(req.user, 'Створено користувача', user.id, null, user);
  res.status(201).json(user);
});
api.patch('/users/:id', permit('ADMIN'), async (req, res) => {
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
api.get('/programs', async (_req, res) =>
  res.json(await db.program.findMany({ orderBy: { year: 'desc' } })),
);
const programSchema = z.object({
  name: z.string().trim().min(3).max(200),
  description: z.string().max(2000),
  year: z.number().int().min(2020).max(2100),
  archived: z.boolean().default(false),
});
api.post('/programs', permit('ADMIN', 'COORDINATOR'), async (req, res) => {
  const item = await db.program.create({ data: programSchema.parse(req.body) });
  await audit(req.user, 'Створено програму', item.id, null, item);
  res.status(201).json(item);
});
api.patch('/programs/:id', permit('ADMIN', 'COORDINATOR'), async (req, res) => {
  const before = await db.program.findUniqueOrThrow({ where: { id: id(req.params.id) } });
  const item = await db.program.update({
    where: { id: before.id },
    data: programSchema.parse(req.body),
  });
  await audit(req.user, 'Змінено програму', item.id, before, item);
  res.json(item);
});
api.get('/activities', async (req, res) => {
  await refreshAnalysis();
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
    ...(q.status ? { status: q.status } : {}),
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
api.get('/activities/:id', async (req, res) => {
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
api.post('/activities', permit('ADMIN', 'COORDINATOR'), async (req, res) => {
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
api.patch('/activities/:id', permit('ADMIN', 'COORDINATOR'), async (req, res) => {
  const data = activitySchema.parse(req.body);
  await validateRelations(data);
  const before = await db.activity.findUniqueOrThrow({ where: { id: id(req.params.id) } });
  if (before.archived) return fail(400, 'Спочатку відновіть захід з архіву.');
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
api.post('/activities/:id/archive', permit('ADMIN', 'COORDINATOR'), async (req, res) => {
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
});
api.post('/activities/:id/progress', async (req, res) => {
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
  if (!canEdit(req, before)) return fail(403, 'Немає прав на оновлення цього заходу.');
  if (before.archived) return fail(400, 'Архівний захід не можна змінювати.');
  if (
    req.user.role === 'EXECUTOR' &&
    (['COMPLETED', 'REVISION'].includes(data.status) || before.status === 'COMPLETED')
  )
    return fail(403, 'Погодження та повернення на доопрацювання доступні координатору.');
  if (
    ['COMPLETED', 'REVIEW'].includes(data.status) &&
    (!data.result.trim() || data.current === null || !data.actualDate)
  )
    return fail(400, 'Вкажіть результат, значення індикатора та фактичну дату.');
  if (data.actualDate && (data.actualDate > new Date() || data.actualDate < before.startDate))
    return fail(400, 'Фактична дата має бути між початком заходу та сьогоднішньою датою.');
  const { comment, ...progress } = data;
  const a = await db.$transaction(async (tx) => {
    const item = await tx.activity.update({ where: { id: before.id }, data: progress });
    if (comment?.trim())
      await tx.comment.create({
        data: { activityId: before.id, text: comment, author: req.user.name },
      });
    await tx.auditLog.create({
      data: {
        userId: req.user.id,
        userName: req.user.name,
        action:
          data.status === 'COMPLETED'
            ? 'Погоджено виконання'
            : data.status === 'REVISION'
              ? 'Повернуто на доопрацювання'
              : 'Оновлено виконання',
        objectId: item.id,
        before: JSON.stringify(before),
        after: JSON.stringify(item),
      },
    });
    return item;
  });
  await refreshAnalysis();
  res.json(a);
});
api.post('/activities/:id/comments', async (req, res) => {
  const a = await db.activity.findUniqueOrThrow({ where: { id: id(req.params.id) } });
  if (!canEdit(req, a)) return fail(403, 'Немає прав на коментування.');
  const { text } = z.object({ text: z.string().trim().min(1).max(3000) }).parse(req.body);
  const c = await db.comment.create({ data: { activityId: a.id, text, author: req.user.name } });
  await audit(req.user, 'Додано коментар', a.id, null, c);
  res.status(201).json(c);
});
api.get('/risks', async (req, res) =>
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
          select: { id: true, title: true, status: true, code: true },
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
api.post('/risks', permit('ADMIN', 'COORDINATOR', 'ANALYST'), async (req, res) => {
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
api.post('/risks/:id/measurements', permit('ADMIN', 'COORDINATOR', 'ANALYST'), async (req, res) => {
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
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});
api.post('/evidence', upload.single('file'), async (req, res) => {
  const a = await db.activity.findUniqueOrThrow({ where: { id: id(req.body.activityId) } });
  if (!canEdit(req, a) || a.archived)
    return fail(403, 'Немає прав на завантаження до цього заходу.');
  if (!req.file) return fail(400, 'Оберіть документ.');
  const detected = await fileTypeFromBuffer(req.file.buffer);
  const ext = req.file.originalname.split('.').pop()?.toLowerCase();
  const allowed: Record<string, string[]> = {
    pdf: ['pdf'],
    docx: ['docx'],
    xlsx: ['xlsx'],
    png: ['png'],
    jpg: ['jpg', 'jpeg'],
  };
  if (!detected || !allowed[detected.ext]?.includes(ext ?? ''))
    return fail(400, 'Вміст і розширення мають відповідати PDF, DOCX, XLSX, PNG або JPG.');
  const name = Buffer.from(req.file.originalname, 'latin1')
    .toString('utf8')
    .replace(/[\\/\x00-\x1f]/g, '_')
    .slice(0, 200);
  const storagePath = `storage/evidence/${randomUUID()}.${detected.ext}`;
  await mkdir('storage/evidence', { recursive: true });
  await writeFile(storagePath, req.file.buffer, { flag: 'wx' });
  try {
    const evidence = await db.$transaction(async (tx) => {
      const previous = await tx.evidence.findFirst({
        where: { activityId: a.id, name },
        orderBy: { version: 'desc' },
      });
      const e = await tx.evidence.create({
        data: {
          activityId: a.id,
          name,
          storagePath,
          mime: detected.mime,
          size: req.file!.size,
          sha256: createHash('sha256').update(req.file!.buffer).digest('hex'),
          author: req.user.name,
          version: (previous?.version ?? 0) + 1,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: req.user.id,
          userName: req.user.name,
          action: 'Завантажено версію документа',
          objectId: a.id,
          before: 'null',
          after: JSON.stringify(e),
        },
      });
      return e;
    });
    await refreshAnalysis();
    res.status(201).json(evidence);
  } catch (error) {
    await unlink(storagePath);
    throw error;
  }
});
api.get('/evidence', async (req, res) =>
  res.json(
    await db.evidence.findMany({
      where: {
        activity: {
          ...scope(req),
          ...(req.query.programId ? { programId: id(req.query.programId) } : {}),
        },
      },
      include: { activity: { select: { id: true, code: true, title: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ),
);
api.get('/evidence/:id/download', async (req, res) => {
  const e = await db.evidence.findUniqueOrThrow({
    where: { id: id(req.params.id) },
    include: { activity: true },
  });
  if (!canRead(req, e.activity)) return fail(403, 'Доступ заборонено.');
  const buffer = await readFile(e.storagePath);
  if (createHash('sha256').update(buffer).digest('hex') !== e.sha256)
    return fail(409, 'Контрольна сума не збігається. Документ пошкоджено.');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(e.name)}`,
  );
  res.type(e.mime).send(buffer);
});
api.get('/flags', async (req, res) => {
  await refreshAnalysis();
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
api.patch('/flags/:id', permit('ADMIN', 'COORDINATOR', 'MANAGER'), async (req, res) => {
  const data = z.object({ status: z.enum(['OPEN', 'IN_REVIEW', 'ACKNOWLEDGED']) }).parse(req.body);
  const before = await db.riskFlag.findUniqueOrThrow({ where: { id: id(req.params.id) } });
  const f = await db.riskFlag.update({ where: { id: before.id }, data });
  await audit(req.user, 'Опрацьовано сигнал ризику', f.activityId, before, f);
  res.json(f);
});
api.get('/recommendations', async (req, res) => {
  await refreshAnalysis();
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
api.patch('/recommendations/:id', permit('ADMIN', 'COORDINATOR', 'MANAGER'), async (req, res) => {
  const data = z.object({ status: z.enum(['ACCEPTED', 'REJECTED', 'DEFERRED']) }).parse(req.body);
  const before = await db.recommendation.findUniqueOrThrow({ where: { id: id(req.params.id) } });
  const r = await db.recommendation.update({ where: { id: before.id }, data });
  await audit(req.user, 'Рішення щодо рекомендації', r.activityId, before, r);
  res.json(r);
});
api.get('/notifications', async (req, res) => {
  await refreshAnalysis();
  res.json(
    await db.notification.findMany({
      where: { userId: req.user.id, active: true },
      include: { activity: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  );
});
api.patch('/notifications/:id', async (req, res) => {
  const n = await db.notification.updateMany({
    where: { id: id(req.params.id), userId: req.user.id },
    data: { read: true },
  });
  res.json(n);
});
api.get('/audit', async (req, res) => {
  if (req.user.role !== 'ADMIN' && !req.query.objectId)
    return fail(403, 'Загальний журнал доступний адміністратору.');
  if (req.query.objectId && req.user.role === 'EXECUTOR') {
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
api.get('/dashboard', async (req, res) => {
  await refreshAnalysis();
  const where = {
    archived: false,
    ...scope(req),
    ...(req.query.programId ? { programId: id(req.query.programId) } : {}),
  };
  const [items, risks] = await Promise.all([
    db.activity.findMany({ where, include: activityInclude }),
    db.risk.findMany({
      where: {
        ...(req.query.programId ? { programId: id(req.query.programId) } : {}),
        ...(req.user.role === 'EXECUTOR'
          ? { activities: { some: { executorId: req.user.id } } }
          : {}),
      },
      include: { measurements: { orderBy: { date: 'asc' } } },
    }),
  ]);
  const now = new Date();
  const total = items.length,
    completed = items.filter((a) => a.status === 'COMPLETED').length;
  const monthly = Array.from({ length: 6 }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return {
      month: start.toLocaleDateString('uk-UA', { month: 'short' }),
      completed: items.filter(
        (a) =>
          a.status === 'COMPLETED' && a.actualDate && a.actualDate >= start && a.actualDate < end,
      ).length,
      planned: items.filter((a) => a.deadline >= start && a.deadline < end).length,
    };
  });
  res.json({
    total,
    completed,
    inProgress: items.filter((a) => a.status === 'IN_PROGRESS').length,
    overdue: items.filter((a) => a.status !== 'COMPLETED' && a.deadline < now).length,
    attention: items.filter((a) => a.flags.length).length,
    riskCount: risks.length,
    improved: risks.filter((r) =>
      r.direction === 'DOWN' ? r.current < r.baseline : r.current > r.baseline,
    ).length,
    progress: total ? Math.round((completed / total) * 100) : 0,
    monthly,
    statusDistribution: Object.entries(statuses).map(([key, name]) => ({
      name,
      value: items.filter((a) => a.status === key).length,
    })),
    sections: Object.entries(sections).map(([key, name]) => ({
      name,
      total: items.filter((a) => a.section === key).length,
      completed: items.filter((a) => a.section === key && a.status === 'COMPLETED').length,
    })),
    deadlines: items
      .filter((a) => a.status !== 'COMPLETED')
      .sort((a, b) => a.deadline.getTime() - b.deadline.getTime())
      .slice(0, 6),
    attentionItems: items.filter((a) => a.flags.length).slice(0, 5),
    risks,
    items,
  });
});
api.get('/reports', permit('ADMIN', 'COORDINATOR', 'MANAGER', 'ANALYST'), async (req, res) => {
  const q = z
    .object({
      year: z.coerce.number().int().min(2020).max(2100),
      half: z.coerce.number().int().min(1).max(2),
      programId: z.string().min(1),
      format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json'),
    })
    .parse(req.query);
  const rows = reportRows(
    await db.activity.findMany({
      where: { programId: q.programId, archived: false },
      include: { executor: true },
      orderBy: [{ section: 'asc' }, { code: 'asc' }],
    }),
    q.year,
    q.half,
  );
  if (q.format === 'json') {
    res.json(rows);
    return;
  }
  await audit(req.user, 'Сформовано звіт', q.programId, null, {
    year: q.year,
    half: q.half,
    format: q.format,
    count: rows.length,
  });
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="report-${q.year}-${q.half}.${q.format}"`,
  );
  if (q.format === 'csv') {
    res
      .type('text/csv; charset=utf-8')
      .send(
        '\uFEFF' +
          [reportHeaders, ...rows.map(cells)].map((row) => row.map(csvCell).join(';')).join('\r\n'),
      );
    return;
  }
  if (q.format === 'xlsx') {
    const book = new ExcelJS.Workbook();
    book.creator = 'Монітор доброчесності';
    for (const section of Object.keys(sections)) {
      const sheet = book.addWorksheet(`Розділ ${section}`);
      sheet.addRow(reportHeaders);
      rows.filter((r) => r.section === section).forEach((r) => sheet.addRow(cells(r)));
      sheet.columns.forEach((c, i) => {
        c.width = i === 2 || i === 6 ? 60 : 24;
      });
      sheet.getRow(1).font = { bold: true };
      sheet.eachRow((row) => {
        row.alignment = { wrapText: true, vertical: 'top' };
      });
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
    }
    res
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .send(Buffer.from(await book.xlsx.writeBuffer()));
    return;
  }
  const font = [
    'client/src/assets/DejaVuSans.ttf',
    'C:/Windows/Fonts/arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ].find(existsSync);
  if (!font)
    return fail(
      503,
      'Для PDF встановіть шрифт DejaVu Sans або Arial з підтримкою української мови.',
    );
  res.type('application/pdf');
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(res);
  doc
    .font(resolve(font))
    .fontSize(18)
    .text('Піврічний звіт про виконання антикорупційної програми');
  doc
    .fontSize(10)
    .text(`${q.half} півріччя ${q.year} року • Синтетичні демонстраційні дані`)
    .moveDown();
  for (const section of Object.keys(sections)) {
    doc
      .fontSize(13)
      .text(`РОЗДІЛ ${section}. ${sections[section as keyof typeof sections]}`)
      .moveDown();
    for (const row of rows.filter((r) => r.section === section)) {
      if (doc.y > 650) doc.addPage();
      doc
        .fontSize(11)
        .text(`${row.code}. ${row.title}`)
        .fontSize(9)
        .text(
          `Виконавець: ${row.executor}\nФактичний строк: ${row.actualDate}\nСтан: ${row.status}\n${row.result}`,
        )
        .moveDown();
    }
  }
  doc.end();
});
api.get('/settings', permit('ADMIN'), async (_req, res) =>
  res.json({
    staleDays: Number((await db.setting.findUnique({ where: { key: 'staleDays' } }))?.value ?? 30),
    demoMode: process.env.DEMO_MODE === 'true',
  }),
);
api.patch('/settings', permit('ADMIN'), async (req, res) => {
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
api.post('/demo/reset', permit('ADMIN'), async (req, res) => {
  if (process.env.DEMO_MODE !== 'true')
    return fail(403, 'Скидання доступне лише в демонстраційному режимі.');
  if (req.body.confirm !== 'СКИНУТИ') return fail(400, 'Введіть СКИНУТИ для підтвердження.');
  await audit(req.user, 'Скинуто демонстраційні дані', 'demo', null, { reset: true });
  await seed(true);
  res.clearCookie('monitor_session');
  res.json({ ok: true });
});
