import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
mkdirSync('.tools', { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'uk-UA' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const base = process.env.TEST_URL ?? 'http://127.0.0.1:3000';
const results = [];
try {
  await page.goto(base);
  await page.getByRole('button', { name: 'Координатор програми', exact: true }).click();
  await page.getByRole('heading', { name: 'Огляд програми', exact: true }).waitFor();
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ['/', '/activities', '/calendar']) {
      await page.goto(base + path);
      await page.locator('h1').waitFor();
      await page.getByText('Завантаження даних…', { exact: true }).waitFor({ state: 'hidden' });
      const metrics = await page.evaluate(() => ({ innerWidth, scrollWidth: document.documentElement.scrollWidth, mobile: matchMedia('(max-width:760px)').matches }));
      assert.equal(metrics.innerWidth, width);
      assert.ok(metrics.scrollWidth <= width, `Переповнення ${path} на ${width}: ${metrics.scrollWidth}`);
      assert.equal(await page.getByRole('alert').count(), 0);
      if (width === 390) assert.equal(metrics.mobile, true);
      results.push({ width, path, result: 'успішно' });
    }
    if (width === 390) await page.screenshot({ path: '.tools/mobile-verified.png', fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const path of ['/risks', '/flags', '/recommendations', '/evidence', '/reports', '/my', '/programs']) {
    await page.goto(base + path); await page.locator('h1').waitFor();
    await page.getByText('Завантаження даних…', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('alert').count(), 0); results.push({ path, result: 'успішно' });
  }
  await page.getByRole('combobox', { name: 'Перемкнути демонстраційний обліковий запис' }).selectOption('user-1');
  await page.getByRole('link', { name: 'Налаштування', exact: true }).waitFor();
  for (const path of ['/users', '/audit', '/settings']) { await page.goto(base + path); await page.locator('h1').waitFor(); await page.getByText('Завантаження даних…', { exact: true }).waitFor({ state: 'hidden' }); assert.equal(await page.getByRole('alert').count(), 0); results.push({ path, result: 'успішно' }); }
  await page.goto(base); await page.getByRole('heading', { name: 'Прогрес реалізації' }).waitFor();
  await page.screenshot({ path: '.tools/dashboard-verified.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ scenarios: results.length, javascriptErrors: errors, results }, null, 2));
} finally { await browser.close(); }
