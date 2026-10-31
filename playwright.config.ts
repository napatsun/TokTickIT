import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the TokTickIT end-to-end suite (repo-root `e2e/`).
 *
 *   npm install          # once, at the repo root
 *   npm run test:e2e     # starts the API + Vite dev servers automatically
 *
 * Not fully parallel: E2E-02/E2E-03 deliberately complete the mandatory
 * first-login password change, so `globalSetup` re-seeds the database and
 * workers are serialised.
 */
export default defineConfig({
  testDir: "./e2e",
  // Lab 3 regression flows plus the Lab 4 Actions Taken flow (E2E-01/E2E-05).
  testMatch: "**/lab-{03,04}/**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],

  globalSetup: "./playwright.global-setup.ts",

  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      command: "npx tsx src/index.ts",
      cwd: "./server",
      url: "http://localhost:3000/api/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "npm run dev",
      cwd: "./client",
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
