import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { db } from '../server/src/database/db.ts';
import { departments } from '../shared/domain.ts';
import { refreshAnalysis } from '../server/src/services/analyzer.ts';
import { todayKey } from '../shared/dates.ts';
import { resolve } from 'node:path';
const storageRoot = process.env.STORAGE_ROOT || 'storage/evidence';
const riskNames = [
  'Непрозорість закупівель',
  'Конфлікт інтересів під час добору',
  'Необґрунтовані фінансові витрати',
  'Недостатній контроль обліку майна',
  'Неповнота декларування інтересів',
  'Нерівний доступ постачальників',
  'Недотримання процедур погодження',
  'Непрозорий розподіл ресурсів',
  'Недостатня обізнаність працівників',
  'Несвоєчасний розгляд повідомлень',
  'Неповнота перевірки контрагентів',
  'Відсутність контролю виконання',
];
const titles = [
  'Оновити порядок перевірки закупівель',
  'Провести навчання з конфлікту інтересів',
  'Перевірити обґрунтованість витрат',
  'Звірити реєстр матеріальних цінностей',
  'Оновити декларації приватних інтересів',
  'Оприлюднити критерії добору постачальників',
  'Впровадити подвійне погодження рішень',
  'Переглянути порядок розподілу ресурсів',
  'Провести практикум із доброчесності',
  'Перевірити строки розгляду повідомлень',
  'Актуалізувати перевірку контрагентів',
  'Провести моніторинг виконання програми',
  'Затвердити контрольний перелік закупівель',
  'Перевірити декларації членів комісії',
  'Підготувати огляд бюджетних відхилень',
  'Запровадити вибіркову інвентаризацію',
  'Провести консультації з декларування',
  'Проаналізувати конкурентність процедур',
  'Оновити матрицю погодження',
  'Перевірити доступ до складського обліку',
  'Підготувати навчальні матеріали',
  'Протестувати канал повідомлень',
  'Переглянути перелік ознак ризику',
  'Провести оцінювання результатів програми',
  'Оновити політику закупівель',
  'Підготувати роз’яснення для комісій',
  'Узагальнити результати фінансового контролю',
  'Провести навчання відповідальних за майно',
  'Підготувати інформаційний бюлетень',
  'Перевірити виконання рекомендацій',
];
export async function seed(reset = false) {
  const existing = !reset && (await db.user.count()) > 0;
  if (existing && process.env.SYNC_DEMO_PASSWORD !== 'true') return;
  const password =
    process.env.DEMO_PASSWORD ||
    (process.env.DEMO_MODE === 'true' ? randomBytes(32).toString('base64url') : undefined);
  if (!password) throw new Error('Задайте DEMO_PASSWORD або виконайте npm run setup.');
  const hash = await bcrypt.hash(password, 12);
  if (existing) {
    const users = await db.user.findMany({
      where: { email: { endsWith: '@demo.local' } },
      select: { id: true },
    });
    const ids = users.filter((user) => /^user-\d+$/.test(user.id)).map((user) => user.id);
    await db.user.updateMany({ where: { id: { in: ids } }, data: { passwordHash: hash } });
    await db.session.deleteMany({ where: { userId: { in: ids } } });
    return;
  }
  await mkdir(storageRoot, { recursive: true });
  const now = new Date();
  const year = now.getFullYear();
  const date = (offset: number) => new Date(Date.parse(todayKey(now)) + offset * 86400000);
  await db.$transaction(
    async (tx) => {
      if (reset) {
        await tx.notification.deleteMany();
        await tx.recommendation.deleteMany();
        await tx.riskFlag.deleteMany();
        await tx.comment.deleteMany();
        await tx.evidence.deleteMany();
        await tx.activity.deleteMany();
        await tx.riskMeasurement.deleteMany();
        await tx.risk.deleteMany();
        await tx.program.deleteMany();
        await tx.session.deleteMany();
        await tx.user.deleteMany();
        await tx.setting.deleteMany();
      }
      const roleList = ['ADMIN', 'COORDINATOR', 'MANAGER', 'ANALYST', ...Array(8).fill('EXECUTOR')];
      const names = [
        'Адміністратор демо',
        'Координатор демо',
        'Керівник демо',
        'Аналітик демо',
        ...Array.from({ length: 8 }, (_, i) => `Демо-виконавець ${i + 1}`),
      ];
      for (let i = 0; i < roleList.length; i++)
        await tx.user.create({
          data: {
            id: `user-${i + 1}`,
            name: names[i],
            role: roleList[i],
            email: `${i < 4 ? ['admin', 'coordinator', 'manager', 'analyst'][i] : `executor${i - 3}`}@demo.local`,
            department: departments[i % 5],
            passwordHash: hash,
          },
        });
      await tx.program.create({
        data: {
          id: 'program-demo',
          name: `Антикорупційна програма ${year}–${year + 1}`,
          description: 'Синтетична демонстраційна програма установи «Обрій». Усі дані вигадані.',
          year,
        },
      });
      for (let i = 0; i < 12; i++) {
        const current = i % 3 === 0 ? 70 : 70 - ((i % 4) + 1) * 8;
        await tx.risk.create({
          data: {
            id: `risk-${i + 1}`,
            code: `Р-${String(i + 1).padStart(3, '0')}`,
            title: riskNames[i],
            description: `Демонстраційний ризик: ${riskNames[i].toLowerCase()}.`,
            causes: 'Недостатня формалізація процедур та контрольних механізмів.',
            consequences: 'Можливі необґрунтовані рішення та втрата довіри.',
            baseline: 70,
            current,
            target: 20,
            indicator: 'Частка процедур з виявленими недоліками, %',
            assessedAt: date(-2),
            programId: 'program-demo',
            measurements: {
              create: [0, 1, 2, 3].map((n) => ({
                value: 70 - ((70 - current) * n) / 3,
                note: 'Синтетичне контрольне вимірювання',
                author: 'Аналітик демо',
                date: date(-90 + n * 29),
              })),
            },
          },
        });
      }
      const states = [
        'COMPLETED',
        'IN_PROGRESS',
        'OVERDUE',
        'REVIEW',
        'NOT_STARTED',
        'REVISION',
        'NOT_DUE',
      ];
      for (let i = 0; i < 30; i++) {
        const state = states[i % 7];
        const completed = state === 'COMPLETED';
        const a = await tx.activity.create({
          data: {
            id: `activity-${i + 1}`,
            code: `З-${String(i + 1).padStart(3, '0')}`,
            title: titles[i],
            description:
              'Виконати контрольні дії, зафіксувати вимірюваний результат та надати підтвердні матеріали.',
            section: ['I', 'II', 'III'][i % 3],
            department: departments[i % 5],
            executorId: `user-${5 + (i % 8)}`,
            programId: 'program-demo',
            riskId: `risk-${(i % 12) + 1}`,
            startDate: date(state === 'NOT_DUE' ? 15 : -90),
            deadline: date(state === 'OVERDUE' ? -12 : state === 'NOT_DUE' ? 45 : (i % 6) * 5 + 2),
            status:
              state === 'OVERDUE' ? 'IN_PROGRESS' : state === 'NOT_DUE' ? 'NOT_STARTED' : state,
            indicator: 'Частка перевірених процедур, %',
            baseline: 0,
            target: 100,
            current: completed ? (i % 2 ? 65 : 100) : i % 3 === 0 ? null : 35,
            result: completed
              ? 'Проведено перевірку процедур. Результати зафіксовано в демонстраційному протоколі.'
              : '',
            actualDate: completed ? date(-i * 4 - 1) : null,
            continuous: i % 9 === 0,
            deadlineChanges: i % 8 === 0 ? 2 : 0,
            updatedAt: date(i % 5 === 0 ? -40 : -2),
            createdAt: date(-100),
          },
        });
        await tx.auditLog.create({
          data: {
            userId: 'user-2',
            userName: 'Координатор демо',
            action: 'Створено демонстраційний захід',
            objectId: a.id,
            before: 'null',
            after: JSON.stringify({ title: a.title, status: a.status }),
            createdAt: date(-90),
          },
        });
        if (i < 20 && i !== 7) {
          const buffer = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII=',
            'base64',
          );
          const storagePath = resolve(storageRoot, `seed-${i}.png`);
          await writeFile(storagePath, buffer);
          await tx.evidence.create({
            data: {
              activityId: a.id,
              name: `Демонстраційне підтвердження ${i + 1}.png`,
              storagePath,
              mime: 'image/png',
              size: buffer.length,
              sha256: createHash('sha256').update(buffer).digest('hex'),
              author: names[4 + (i % 8)],
              version: 1,
            },
          });
          if (i === 0)
            await tx.evidence.create({
              data: {
                activityId: a.id,
                name: 'Демонстраційне підтвердження 1.png',
                storagePath,
                mime: 'image/png',
                size: buffer.length,
                sha256: createHash('sha256').update(buffer).digest('hex'),
                author: names[4],
                version: 2,
              },
            });
        }
        if (i % 4 === 0)
          await tx.comment.create({
            data: {
              activityId: a.id,
              author: 'Координатор демо',
              text: 'Уточніть джерело вимірювання та додайте висновок щодо досягнення мети.',
            },
          });
      }
      await tx.setting.create({ data: { key: 'staleDays', value: '30' } });
    },
    { timeout: 60000 },
  );
  await refreshAnalysis();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await seed();
  console.log('Демонстраційну базу підготовлено.');
  await db.$disconnect();
}
