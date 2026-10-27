import { defineConfig, devices } from '@playwright/test';

const port = 4173;
const protectedPort = 4174;
const ownerKey = 'ACCEPTANCEKEY23456789';

process.env.SIMPLEBOT_AUTH_ACCEPTANCE_URL = `http://127.0.0.1:${String(protectedPort)}`;
process.env.SIMPLEBOT_AUTH_ACCEPTANCE_OWNER_KEY = ownerKey;

export default defineConfig({
  testDir: './acceptance',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  workers: 1,
  outputDir: '/tmp/simplebot-playwright-results',
  use: {
    baseURL: `http://127.0.0.1:${String(port)}`,
    trace: 'retain-on-failure',
  },
  // Keep WebKit limited to engine-specific regressions; Chromium owns the suite.
  projects: [
    {
      name: 'chromium',
      use: devices['Desktop Chrome'],
      testIgnore: /\.webkit\.spec\.ts$/u,
    },
    {
      name: 'webkit',
      use: devices['Desktop Safari'],
      testMatch: /\.webkit\.spec\.ts$/u,
    },
  ],
  webServer: [
    {
      command: 'node --import tsx server/scripts/acceptance.ts',
      url: `http://127.0.0.1:${String(port)}/api/health`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: { AUTH_ENABLED: 'false', PORT: String(port) },
    },
    {
      command: 'node --import tsx server/scripts/acceptance.ts',
      url: `http://127.0.0.1:${String(protectedPort)}/api/health`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        ACCEPTANCE_OWNER_KEY: ownerKey,
        AUTH_ENABLED: 'true',
        PORT: String(protectedPort),
      },
    },
  ],
});
