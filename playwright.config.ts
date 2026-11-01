import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.REPOTRACE_E2E_STATE ??= mkdtempSync(join(tmpdir(), 'repotrace-browser-'));

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8788',
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && node scripts/e2e-server.mjs',
    url: 'http://127.0.0.1:8788/api/auth/status',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
