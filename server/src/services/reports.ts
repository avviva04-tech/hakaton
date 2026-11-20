import { displayStatus } from '../../../shared/dates.ts';
import type { Activity } from '@prisma/client';
import { statuses, sections } from '../../../shared/domain.ts';
export function reportRows(
  items: (Activity & { executor: { name: string } })[],
  year: number,
  half: number,
) {
  const start = new Date(Date.UTC(year, half === 1 ? 0 : 6, 1));
  const end = new Date(Date.UTC(year, half === 1 ? 6 : 12, 0, 23, 59, 59, 999));
  return items
    .filter((a) => a.createdAt <= end && (a.continuous || !a.actualDate || a.actualDate >= start))
    .map((a) => ({
      section: a.section,
      sectionName: sections[a.section as keyof typeof sections],
      code: a.code,
      title: a.title,
      executor: a.executor.name,
      actualDate: a.continuous
        ? end.toISOString().slice(0, 10)
        : a.actualDate && a.actualDate <= end
          ? a.actualDate.toISOString().slice(0, 10)
          : '—',
      status:
        a.startDate > end
          ? statuses.NOT_DUE
          : a.status === 'COMPLETED' && a.actualDate && a.actualDate > end
            ? 'У процесі (на кінець періоду)'
            : statuses[displayStatus(a, end.toISOString().slice(0, 10)) as keyof typeof statuses],
      result:
        a.actualDate && a.actualDate > end
          ? 'На кінець звітного періоду результат ще не зафіксовано.'
          : a.result || 'Результат не внесено; необхідно надати пояснення причин невиконання.',
    }));
}
export const reportHeaders = [
  'Розділ',
  'Код',
  'Назва заходу',
  'Виконавець',
  'Фактичний строк виконання',
  'Стан виконання',
  'Опис результату або причини невиконання',
];
export function cells(row: ReturnType<typeof reportRows>[number]) {
  return [row.section, row.code, row.title, row.executor, row.actualDate, row.status, row.result];
}
export function csvCell(value: string) {
  const safe = /^[=+@\-\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
