import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: '2026-10-30',
        d1Databases: ['DB', 'LEGACY_DB'],
        kvNamespaces: ['TOKEN_KEYS'],
      },
    }),
  ],
  test: { include: ['tests/**/*.test.ts'], fileParallelism: false },
});
