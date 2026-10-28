import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * Config for the one-off Labs 1–3 regression walkthrough (e2e/walkthrough/).
 * Identical to the main config (same globalSetup DB reset+seed, same web
 * servers, single worker) except testMatch is widened to pick up the
 * walkthrough spec, which is deliberately outside the automated suite.
 */
export default defineConfig({
  ...base,
  testMatch: "**/walkthrough/**/*.spec.ts",
});
