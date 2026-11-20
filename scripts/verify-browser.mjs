import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
mkdirSync('.tools', { recursive: true });
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL ?? 'msedge',
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: 'ru-RU',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const base = process.env.TEST_URL ?? 'http://127.0.0.1:3000';
const results = [];
try {
  await page.route('**/api/auth/demo', (route) =>
    route.fulfill({ json: { enabled: false, users: [] } }),
  );
  await page.goto(base);
  await page.getByLabel('Електронна пошта').fill('12312313e');
  await page.getByRole('button', { name: 'Увійти', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Введіть коректну електронну адресу' }).waitFor();
  assert.equal(await page.locator('form').evaluate((form) => form.noValidate), true);
  await page.unroute('**/api/auth/demo');
  await page.goto(base);
  await page.getByRole('button', { name: 'Координатор програми', exact: true }).click();
  await page.getByRole('heading', { name: 'Огляд програми', exact: true }).waitFor();
  results.push({
    scenario: 'Українська валідація за російської локалі браузера',
    result: 'успішно',
  });
  await page.goto(base + '/activities/activity-1');
  await page.getByRole('button', { name: 'Підтвердні матеріали', exact: true }).click();
  await page.getByRole('button', { name: 'Обрати файл', exact: true }).waitFor();
  await page.getByText('Файл не вибрано', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Завантажити', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Оберіть файл для завантаження.' }).waitFor();
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'Перевірка.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII=',
        'base64',
      ),
    });
  await page.locator('.file-picker').getByText('Перевірка.png', { exact: true }).waitFor();
  const uploaded = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/evidence') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Завантажити', exact: true }).click();
  assert.equal((await uploaded).status(), 201);
  await page.getByText('Файл не вибрано', { exact: true }).waitFor();
  results.push({
    scenario: 'Український вибір файлу, обов’язковість, завантаження та очищення',
    result: 'успішно',
  });
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ['/', '/activities', '/calendar']) {
      await page.goto(base + path);
      await page.locator('h1').waitFor();
      await page.getByText('Завантаження даних…', { exact: true }).waitFor({ state: 'hidden' });
      const metrics = await page.evaluate(() => ({
        innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        mobile: matchMedia('(max-width:760px)').matches,
      }));
      assert.equal(metrics.innerWidth, width);
      assert.ok(
        metrics.scrollWidth <= width,
        `Переповнення ${path} на ${width}: ${metrics.scrollWidth}`,
      );
      assert.equal(await page.getByRole('alert').count(), 0);
      if (width === 390) assert.equal(metrics.mobile, true);
      results.push({ width, path, result: 'успішно' });
    }
    if (width === 390)
      await page.screenshot({ path: '.tools/mobile-verified.png', fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const path of [
    '/risks',
    '/flags',
    '/recommendations',
    '/evidence',
    '/reports',
    '/my',
    '/programs',
  ]) {
    await page.goto(base + path);
    await page.locator('h1').waitFor();
    await page.getByText('Завантаження даних…', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('alert').count(), 0);
    results.push({ path, result: 'успішно' });
  }
  await page
    .getByRole('combobox', { name: 'Перемкнути демонстраційний обліковий запис' })
    .selectOption('user-1');
  await page.getByRole('link', { name: 'Налаштування', exact: true }).waitFor();
  for (const path of ['/users', '/audit', '/settings']) {
    await page.goto(base + path);
    await page.locator('h1').waitFor();
    await page.getByText('Завантаження даних…', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('alert').count(), 0);
    results.push({ path, result: 'успішно' });
  }
  await page.goto(base);
  await page.getByRole('heading', { name: 'Прогрес реалізації' }).waitFor();
  // Дочекатися завершення анімації графіків перед знімком для документації.
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '.tools/dashboard-verified.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ scenarios: results.length, javascriptErrors: errors, results }, null, 2),
  );
} finally {
  await browser.close();
}
