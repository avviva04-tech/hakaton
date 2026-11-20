import 'dotenv/config';
import '../../shared/validation.ts';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { api } from './routes/api.ts';
import { refreshAnalysis } from './services/analyzer.ts';
import { db } from './database/db.ts';
const app = express();
const port = Number(process.env.PORT || 3000);
const allowedHosts = new Set([
  `localhost:${port}`,
  `127.0.0.1:${port}`,
  ...(process.env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
]);
app.use((req, res, next) => {
  if (!allowedHosts.has((req.headers.host ?? '').toLowerCase())) {
    res.status(403).json({ error: 'Неприпустимий заголовок Host.' });
    return;
  }
  next();
});
app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: process.argv.includes('--production')
      ? { directives: { 'upgrade-insecure-requests': null } }
      : false,
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(
  '/api',
  (req, res, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== `${req.protocol}://${req.headers.host}`
    ) {
      res.status(403).json({ error: 'Запит з іншого джерела заборонено.' });
      return;
    }
    next();
  },
  api,
);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Маршрут не знайдено.' }));
if (process.argv.includes('--production')) {
  app.use(express.static(resolve('dist/client')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/client/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.use(
  (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: 'Перевірте заповнення полів.',
        details: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      res.status(error.code === 'P2025' ? 404 : 409).json({
        error:
          error.code === 'P2025'
            ? 'Запис не знайдено.'
            : 'Запис конфліктує з наявними даними або зв’язками.',
      });
      return;
    }
    const e = error as { status?: number; message?: string; code?: string };
    if (e.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'Максимальний розмір документа — 10 МБ.' });
      return;
    }
    if (!e.status || e.status >= 500) console.error(error);
    res.status(e.status ?? 500).json({
      error:
        e.status && e.status < 500 ? e.message : 'Не вдалося виконати операцію. Спробуйте ще раз.',
    });
  },
);
await db.$transaction([
  db.activity.updateMany({ where: { status: 'OVERDUE' }, data: { status: 'IN_PROGRESS' } }),
  db.activity.updateMany({ where: { status: 'NOT_DUE' }, data: { status: 'NOT_STARTED' } }),
]);
await refreshAnalysis();
app
  .listen(port, '127.0.0.1', () => console.log(`Монітор доброчесності: http://localhost:${port}`))
  .on('error', (error) => {
    console.error('Не вдалося запустити сервер:', error.message);
    process.exit(1);
  });
setInterval(() => void refreshAnalysis().catch(console.error), 60000).unref();
