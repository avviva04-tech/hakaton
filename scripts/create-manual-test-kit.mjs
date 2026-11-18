import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import archiver from 'archiver';
import { fileTypeFromBuffer } from 'file-type';

const root = resolve('test-files');
const folders = ['01_Червоний_рівень', '02_Жовтий_рівень', '03_Успішне_виконання', '04_Погодження', '05_Ризик_не_зменшився', '06_Формати_документів', '07_Версії/Версія_1', '07_Версії/Версія_2', '08_Помилкові_файли'];
for (const folder of folders) await mkdir(resolve(root, folder), { recursive: true });
const date = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const generated = [];
async function save(path, buffer, expectation = 'Прийняти') { await writeFile(resolve(root, path), buffer); generated.push({ path, expectation }); }
async function pdf(path, title, lines) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 }); const chunks = [];
  const done = new Promise((resolveDone, reject) => { doc.on('data', c => chunks.push(c)); doc.on('end', () => resolveDone(Buffer.concat(chunks))); doc.on('error', reject); });
  doc.font('C:/Windows/Fonts/arial.ttf').fontSize(10).fillColor('#527080').text('СИНТЕТИЧНИЙ ТЕСТОВИЙ ДОКУМЕНТ • НЕ ДЛЯ ОФІЦІЙНОГО ПОДАННЯ');
  doc.moveDown(2).fillColor('#152b40').fontSize(20).text(title).moveDown();
  doc.fontSize(11).text(`Дата підготовки: ${date(0)}\nУстанова: Навчальний центр «Тестова доброчесність»`).moveDown();
  for (const line of lines) doc.text(line, { paragraphGap: 12 });
  doc.moveDown().fontSize(9).fillColor('#68788a').text('Вміст цього файла не визначає колір сигналу автоматично. Сигнали розраховуються з полів заходу та ризику.');
  doc.end(); await save(path, await done);
}
await pdf('01_Червоний_рівень/Пояснення_прострочення.pdf', 'Пояснення порушення контрольного строку', ['Заходом передбачалася перевірка 100 процедур закупівель. На контрольну дату перевірено лише 35.', 'Причина: затримка надання тестових матеріалів. Захід не завершений.', 'Запропонована дія: погодити оновлений план, призначити відповідального та новий контрольний строк.']);
await pdf('02_Жовтий_рівень/Оновлений_план.pdf', 'План після повторного перенесення строку', ['Початковий строк було змінено двічі. Поточний прогрес — 35 зі 100.', 'Потрібно переглянути ресурси та залежності. Цей документ не означає погодження завершення заходу.']);
await pdf('03_Успішне_виконання/Акт_виконання.pdf', 'Акт завершення тестової перевірки', ['Перевірено 100 зі 100 процедур. Ціль індикатора заходу досягнута.', 'За окремим вимірюванням частка процедур з недоліками знизилася з 70% до 20%.', 'Висновок: подати результат координатору для погодження. Вимірювання ризику необхідно окремо внести до реєстру ризиків.']);
await pdf('04_Погодження/Матеріали_на_погодження.pdf', 'Матеріали для перевірки координатором', ['Виконавець повідомляє про перевірку 100 процедур. Результат подається на погодження.', 'Координатор може погодити виконання або повернути матеріали з коментарем: «Уточніть джерело вимірювання».']);
await pdf('05_Ризик_не_зменшився/Формально_виконаний_захід.pdf', 'Виконано захід, але показник ризику незмінний', ['Навчання проведено, участь взяли 100 зі 100 запланованих осіб.', 'Індикатор заходу: 0 → 100, ціль 100. Індикатор ризику: 70 → 70, ціль 20.', 'Висновок: факт виконання не підтверджує зниження ризику. Потрібне оцінювання ефективності.']);
await pdf('06_Формати_документів/Звичайний_документ.pdf', 'Перевірка формату PDF', ['Це коректний PDF із українським текстом. Очікування: файл приймається, має SHA-256 та доступний для скачування.']);
await pdf('07_Версії/Версія_1/Протокол_перевірки.pdf', 'Протокол перевірки — редакція 1', ['Перевірено 60 зі 100 процедур. Це перша версія документа.']);
await pdf('07_Версії/Версія_2/Протокол_перевірки.pdf', 'Протокол перевірки — редакція 2', ['Перевірено 100 зі 100 процедур. Це друга версія; попередня має залишитися доступною.']);

const cases = [
  ['ТЕСТ-01 Червоний — прострочення', date(-14), date(-1), 'У процесі', 35, 70, 'Критичний: OVERDUE'],
  ['ТЕСТ-02 Жовтий — зміна строків', date(-14), date(7), 'У процесі', 35, 70, 'Середній: REPEATED_DELAY після двох змін строку'],
  ['ТЕСТ-03 Успішне виконання', date(-14), date(7), 'Виконано', 100, 20, 'Без сигналів за ізольованого ризику й наявності документа'],
  ['ТЕСТ-04 На погодженні', date(-14), date(7), 'На погодженні', 100, 70, 'Статус «На погодженні», документ наявний'],
  ['ТЕСТ-05 Ризик без покращення', date(-14), date(7), 'Виконано', 100, 70, 'Високий: NO_RISK_CHANGE'],
  ['ТЕСТ-06 Ціль не досягнуто', date(-14), date(7), 'Виконано', 60, 20, 'Високий: TARGET_MISSED'],
  ['ТЕСТ-07 Немає документа', date(-14), date(7), 'На погодженні', 100, 70, 'Високий: NO_EVIDENCE'],
  ['ТЕСТ-08 Майбутній захід', date(10), date(30), 'Строк виконання не настав', 0, 70, 'Майбутній строк у календарі'],
  ['ТЕСТ-09 Нагадування', date(-14), date(2), 'У процесі', 35, 70, 'Сповіщення виконавцю'],
  ['ТЕСТ-10 Постійний захід', date(-14), date(7), 'У процесі', 35, 70, 'У звіті дата 30.06 або 31.12'],
];
const headers = ['Назва', 'Початок', 'Строк', 'Кінцевий статус сценарію', 'Поточне значення заходу', 'Поточне значення ризику', 'Очікування'];
const book = new ExcelJS.Workbook();
const sheet = book.addWorksheet('Сценарії'); sheet.addRow(headers); cases.forEach(row => sheet.addRow(row)); sheet.getRow(1).font = { bold: true }; sheet.columns.forEach((column, i) => { column.width = i === 0 || i === 6 ? 55 : 24; }); sheet.eachRow(row => row.alignment = { wrapText: true, vertical: 'top' });
await save('06_Формати_документів/Дані_для_перевірки.xlsx', Buffer.from(await book.xlsx.writeBuffer()));
await save('Дані_заходів.csv', '\uFEFF' + [headers, ...cases].map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(';')).join('\r\n'), 'Довідник для ручного введення; не імпортується і не завантажується як підтвердження');

const xml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const docxPath = '06_Формати_документів/Протокол_комісії.docx';
const zip = archiver('zip'); const out = createWriteStream(resolve(root, docxPath));
const finished = new Promise((r, j) => { out.on('close', r); out.on('error', j); zip.on('error', j); }); zip.pipe(out);
zip.append('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>', { name: '[Content_Types].xml' });
zip.append('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>', { name: '_rels/.rels' });
zip.append('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + ['ТЕСТОВИЙ ПРОТОКОЛ КОМІСІЇ', 'Усі відомості синтетичні.', 'Предмет: перевірка 100 процедур. Виявлено 20 процедур із недоліками.', 'Індикатор виконання: 100%. Індикатор ризику: 20%.', 'Рішення: передати матеріали координатору на погодження.'].map(t => `<w:p><w:r><w:t>${xml(t)}</w:t></w:r></w:p>`).join('') + '<w:sectPr/></w:body></w:document>', { name: 'word/document.xml' });
await zip.finalize(); await finished; generated.push({ path: docxPath, expectation: 'Прийняти' });
await save('08_Помилкові_файли/Текст_під_виглядом_PDF.pdf', 'Це звичайний текст, а не PDF. Очікується відхилення.', 'Відхилити: невідповідний вміст');
await save('08_Помилкові_файли/Порожній_документ.pdf', Buffer.alloc(0), 'Відхилити: порожній файл');
await save('08_Помилкові_файли/Недозволений_формат.txt', 'Звичайний текстовий файл. Формат TXT не дозволений для підтвердних матеріалів.', 'Відхилити: недозволений формат');
const large = Buffer.alloc(11 * 1024 * 1024, 32); const validPdf = await readFile(resolve(root, '06_Формати_документів/Звичайний_документ.pdf')); validPdf.copy(large);
await save('08_Помилкові_файли/Понад_ліміт_11МБ.pdf', large, 'Відхилити: понад 10 МБ');
await save('08_Помилкові_файли/PDF_з_розширенням_JPG.jpg', validPdf, 'Відхилити: PDF-вміст із розширенням JPG');
// PNG/JPG створюються локальним PowerShell-скриптом; включаємо їх до каталогу після генерації.
for (const path of ['06_Формати_документів/Фото_підтвердження.png', '06_Формати_документів/Фото_підтвердження.jpg']) {
  try { await readFile(resolve(root, path)); generated.push({ path, expectation: 'Прийняти' }); } catch { /* Створити зображення перед запуском генератора. */ }
}
const manifest = [];
for (const item of generated) { const buffer = await readFile(resolve(root, item.path)); const type = await fileTypeFromBuffer(buffer); manifest.push({ ...item, bytes: buffer.length, detected: type?.ext ?? 'не визначено', sha256: createHash('sha256').update(buffer).digest('hex') }); }
await writeFile(resolve(root, 'Каталог_файлів.json'), JSON.stringify(manifest, null, 2));
console.log(`Підготовлено ${manifest.length} файлів. Дата сценаріїв: ${date(0)}.`);
