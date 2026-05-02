import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the ClaimClear visual end-to-end suite.
 *
 * The e2e tests run against the production-built SPA (served from
 * dist/public via e2e/serve-built.mjs) on port 5174 — deliberately
 * separate from the dev workflow on 5173. The dev server can't be
 * reused because its cartographer plugin currently mis-transforms a
 * couple of unrelated pages (insights.tsx, withdrawals.tsx); the
 * production build skips that plugin cleanly.
 *
 * Every `/api/*` request is stubbed via `page.route()` so the suite
 * doesn't depend on the API server, the database, or any seed data.
 *
 * Run via:
 *   pnpm --filter @workspace/claimclear test:e2e
 *
 * Browsers come from the local Playwright cache (chromium); see
 * `pnpm --filter @workspace/claimclear exec playwright install chromium`
 * if the binary is missing.
 */

const port = Number(process.env.E2E_PORT) || 5174;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
    actionTimeout: 5_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm run build && PORT=${port} node e2e/serve-built.mjs`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
