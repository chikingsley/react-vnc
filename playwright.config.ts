import { defineConfig } from '@playwright/test';

const headless = process.env.PW_HEADLESS !== 'false';
const slowMo = Number(process.env.PW_SLOWMO_MS ?? '0');

export default defineConfig({
    testDir: './tests/e2e/specs',
    timeout: 60_000,
    expect: {
        timeout: 20_000,
    },
    globalSetup: './tests/e2e/global-setup.ts',
    globalTeardown: './tests/e2e/global-teardown.ts',
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 1 : undefined,
    use: {
        baseURL: 'http://127.0.0.1:4173',
        headless,
        trace: 'on-first-retry',
        video: 'retain-on-failure',
        launchOptions: slowMo > 0 ? { slowMo } : undefined,
    },
    webServer: {
        command: 'node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173',
        port: 4173,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
    },
});
