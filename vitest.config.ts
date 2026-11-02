import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        compatibilityDate: '2026-10-30',
        d1Databases: ['DB', 'LEGACY_DB', 'WEBHOOK_V3_DB'],
        kvNamespaces: ['WEBHOOK_KEYS'],
      },
    }),
  ],
  test: { include: ['tests/**/*.test.ts'], fileParallelism: false },
});
