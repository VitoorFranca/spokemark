import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'tests/ui', testMatch: /.*\.spec\.mjs/, workers: 1, timeout: 120_000, reporter: 'list' });
