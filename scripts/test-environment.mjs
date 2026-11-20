import { spawn, spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

export async function testEnvironment() {
  mkdirSync('.tools', { recursive: true });
  const directory = mkdtempSync(resolve('.tools/test-'));
  const probe = createServer();
  await new Promise((resolvePort) => probe.listen(0, '127.0.0.1', resolvePort));
  const port = probe.address().port;
  await new Promise((resolveClose) => probe.close(resolveClose));
  const env = {
    ...process.env,
    DATABASE_URL: `file:${join(directory, 'test.db').replaceAll('\\', '/')}`,
    PORT: String(port),
    DEMO_MODE: 'true',
    COOKIE_SECURE: 'false',
    DEMO_PASSWORD: randomBytes(24).toString('base64url'),
    STORAGE_ROOT: join(directory, 'evidence'),
    TEST_URL: `http://127.0.0.1:${port}`,
  };
  for (const args of [
    ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'],
    ['prisma/seed.ts'],
  ]) {
    const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Не вдалося підготувати тимчасову базу.');
  }
  const server = spawn(process.execPath, ['server/src/index.ts', '--production'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.pipe(process.stderr);
  let timeout;
  try {
    await new Promise((ready, reject) => {
      timeout = setTimeout(
        () => reject(new Error('Тестовий сервер не запустився за 90 секунд.')),
        90000,
      );
      server.stdout.on('data', (data) => {
        if (data.toString().includes(`localhost:${port}`)) ready();
      });
      server.once('error', reject);
      server.once('exit', (code) => reject(new Error(`Сервер завершився: ${code}`)));
    });
  } catch (error) {
    server.kill();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  return {
    env,
    base: env.TEST_URL,
    directory,
    stop: () =>
      new Promise((done) => {
        server.once('exit', done);
        server.kill();
      }),
  };
}
