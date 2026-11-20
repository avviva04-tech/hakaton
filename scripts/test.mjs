import { spawn } from 'node:child_process';
import { testEnvironment } from './test-environment.mjs';

const test = await testEnvironment();
try {
  const args = process.argv.includes('--browser')
    ? ['scripts/verify-browser.mjs']
    : ['--test', 'tests/domain.test.ts', 'tests/api.test.ts'];
  const child = spawn(process.execPath, args, { env: test.env, stdio: 'inherit' });
  process.exitCode = await new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
} finally {
  await test.stop();
}
