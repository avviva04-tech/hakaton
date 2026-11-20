import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';
let content = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
const existing = parse(content);
const defaults = {
  DATABASE_URL: 'file:./monitor.db',
  PORT: '3000',
  DEMO_MODE: 'true',
  COOKIE_SECURE: 'false',
  DEMO_PASSWORD: randomBytes(24).toString('base64url'),
};
for (const [key, value] of Object.entries(defaults)) {
  if (existing[key]) continue;
  const line = new RegExp(`^${key}=.*$`, 'm');
  content = line.test(content)
    ? content.replace(line, `${key}=${value}`)
    : `${content.trimEnd()}\n${key}=${value}\n`;
}
writeFileSync('.env', content, { mode: 0o600 });
if (!existing.DEMO_PASSWORD) console.log('Випадковий демопароль збережено лише у локальному .env.');
for (const args of [
  ['node_modules/prisma/build/index.js', 'generate'],
  ['node_modules/prisma/build/index.js', 'db', 'push'],
  ['prisma/seed.ts'],
]) {
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: { ...process.env, SYNC_DEMO_PASSWORD: existing.DEMO_PASSWORD ? 'false' : 'true' },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
