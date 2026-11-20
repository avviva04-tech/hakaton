import { Router } from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { db } from '../database/db.ts';
import { scope, canRead, canEdit } from '../middleware/auth.ts';
import { refreshAnalysis } from '../services/analyzer.ts';
import { fail, id } from './validation.ts';

export const evidenceRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});
evidenceRouter.post('/evidence', upload.single('file'), async (req, res) => {
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
  const storagePath = resolve(
    process.env.STORAGE_ROOT || 'storage/evidence',
    `${randomUUID()}.${detected.ext}`,
  );
  await mkdir(process.env.STORAGE_ROOT || 'storage/evidence', { recursive: true });
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
evidenceRouter.get('/evidence', async (req, res) =>
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
evidenceRouter.get('/evidence/:id/download', async (req, res) => {
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
