#!/usr/bin/env node
/**
 * screenshot-states-v3.mjs
 *
 * Captures My Tickets empty-state and error-state screenshots.
 * Mocks both /api/dev-requesters AND /api/tickets,
 * then selects a requester via UI interaction to land on My Tickets.
 */
import { chromium } from "playwright";
import { spawn } from "child_process";
import { mkdirSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CLIENT = resolve(__dirname, "..");
const OUT_DIR = resolve(ROOT, "artifacts/lab-02/screenshots/my-tickets");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

function startProc(cmd, args, cwd) {
  return new Promise((r) => {
    const p = spawn(cmd, args, { cwd, stdio: "ignore", shell: true });
    setTimeout(() => r(p), 4000);
  });
}

const REQUESTERS = [
  { id: 1, fullName: "Alice Test", email: "alice@test.com" },
  { id: 2, fullName: "Bob Test", email: "bob@test.com" },
];

const EMPTY_BODY = JSON.stringify({
  tickets: [],
  pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 },
  filterOptions: { categories: [], requestedPriorities: [], currentStatuses: [] },
});

const ERROR_BODY = JSON.stringify({
  error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
});

async function capture({ filename, ticketsBody, ticketsStatus }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // Mock ALL API endpoints
  await page.route("**/api/**", (route) => {
    const url = route.request().url();
    if (url.includes("/api/tickets")) {
      route.fulfill({ status: ticketsStatus, contentType: "application/json", body: ticketsBody });
    } else if (url.includes("/api/dev-requesters")) {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ requesters: REQUESTERS }) });
    } else if (url.includes("/api/categories")) {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ categories: [] }) });
    } else if (url.includes("/api/related-systems")) {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ relatedSystems: [] }) });
    } else {
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
  });

  // Go to select-requester page
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // Select requester from dropdown
  const select = await page.locator("select");
  await select.selectOption("1");

  // Click Continue
  const continueBtn = page.locator("button", { hasText: "Continue" });
  await continueBtn.click();

  // Wait for My Tickets to load
  await page.waitForTimeout(3000);

  // Verify we're on the right page
  const text = await page.textContent("body");
  const url = page.url();
  console.log(`[${filename}] URL: ${url}`);
  console.log(`[${filename}] text: ${text.substring(0, 300)}`);

  await page.screenshot({ path: resolve(OUT_DIR, filename), fullPage: true });
  await browser.close();
  console.log(`✅ Saved: ${filename}`);
}

async function main() {
  console.log("Starting servers...");
  const apiProc = await startProc("npx", ["tsx", "src/index.ts"], resolve(ROOT, "server"));
  const viteProc = await startProc("npx", ["vite", "--port", "5173"], CLIENT);
  await new Promise((r) => setTimeout(r, 3000));

  try {
    await capture({ filename: "desktop-empty.png", ticketsBody: EMPTY_BODY, ticketsStatus: 200 });
    await capture({ filename: "desktop-error.png", ticketsBody: ERROR_BODY, ticketsStatus: 500 });
  } finally {
    console.log("Shutting down...");
    apiProc.kill("SIGTERM");
    viteProc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 1000));
    process.exit(0);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
