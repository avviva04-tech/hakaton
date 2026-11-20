import { existsSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (!existsSync('.env')) copyFileSync('.env.example', '.env');
for (const args of [
  ['node_modules/prisma/build/index.js', 'generate'],
  ['node_modules/prisma/build/index.js', 'db', 'push'],
  ['prisma/seed.ts'],
]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
