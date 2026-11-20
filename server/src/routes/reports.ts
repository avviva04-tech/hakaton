import { Router } from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { db } from '../database/db.ts';
import { permit } from '../middleware/auth.ts';
import { audit } from '../services/audit.ts';
import { reportRows, reportHeaders, cells, csvCell } from '../services/reports.ts';
import { sections } from '../../../shared/domain.ts';
import { fail } from './validation.ts';

export const reportsRouter = Router();
reportsRouter.get(
  '/reports',
  permit('ADMIN', 'COORDINATOR', 'MANAGER', 'ANALYST'),
  async (req, res) => {
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
            [reportHeaders, ...rows.map(cells)]
              .map((row) => row.map(csvCell).join(';'))
              .join('\r\n'),
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
  },
);
