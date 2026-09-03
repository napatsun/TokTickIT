/**
 * Screenshot script: Ticket Detail page — all required viewports.
 *
 * Viewports captured per ui-spec §12:
 *   1. desktop.png   — 1280x800 (≥992px, 3-column header grid)
 *   2. tablet.png    — 834x1112 (768–991px, 2-column header grid)
 *   3. mobile.png    — 375x812  (<768px, stacked single-column)
 *
 * Uses explicit wait pattern from specification.md §11 item 20:
 *   1. waitForLoadState('networkidle')
 *   2. waitForSelector('h1')
 *   3. waitForSelector('[class*="fieldGrid"]')
 *
 * Output: artifacts/lab-02/screenshots/ticket-detail/{desktop,tablet,mobile}.png
 */
import { spawn } from "child_process";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../../artifacts/lab-02/screenshots/ticket-detail");
mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 375, height: 812 },
];

/** Mock ticket detail response. */
const MOCK_TICKET_RESPONSE = {
  ticket: {
    id: 1,
    ticketNumber: "TKT-2026-000001",
    ticketDate: "2026-08-22T09:14:00.000Z",
    requester: { id: 1, fullName: "Alice Johnson" },
    category: { id: 2, name: "Hardware" },
    relatedSystem: { id: 1, name: "Corporate Laptop" },
    summary: "Laptop battery drains quickly after full charge",
    description:
      "My corporate laptop (Dell Latitude 5520) battery drains from 100% to 20% within 2 hours of normal use (browsing, email, light document editing). This started happening after the last Windows update on August 20th. I have tried recalibrating the battery and running the power troubleshooter but the issue persists. The laptop is only 8 months old.",
    requestedPriority: "MEDIUM",
    itPriority: null,
    currentStatus: "NEW",
    ticketOwner: null,
    resolutionSummary: null,
  },
  attachments: {
    active: [
      {
        id: 1,
        originalFileName: "battery-report.pdf",
        fileSizeBytes: 245760,
        mimeType: "application/pdf",
        uploadedAt: "2026-08-22T09:20:00.000Z",
      },
      {
        id: 2,
        originalFileName: "screenshot-power-settings.png",
        fileSizeBytes: 1048576,
        mimeType: "image/png",
        uploadedAt: "2026-08-22T09:22:00.000Z",
      },
    ],
    removed: [],
  },
};

function waitForPort(port, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      import("net").then(({ default: net }) => {
        const socket = net.createConnection(port, "127.0.0.1");
        socket.on("connect", () => { socket.destroy(); resolve(); });
        socket.on("error", () => {
          socket.destroy();
          if (Date.now() - start > timeoutMs) reject(new Error(`Port ${port} timeout`));
          else setTimeout(check, 300);
        });
      });
    };
    check();
  });
}

async function run() {
  const { chromium } = await import("@playwright/test");

  // Start API server
  console.log("Starting API server...");
  const apiProc = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: resolve(__dirname, "../../server"),
    stdio: "pipe",
    shell: true,
  });
  await waitForPort(3000);
  console.log("✅ API server on :3000");

  // Start Vite dev server
  console.log("Starting Vite dev server...");
  const viteProc = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", "5173"], {
    cwd: resolve(__dirname, "../../client"),
    stdio: "pipe",
    shell: true,
  });
  await waitForPort(5173);
  console.log("✅ Vite dev server on :5173");

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });

    // Mock GET /api/tickets/:ticketNumber
    await page.route("**/api/tickets/TKT-2026-000001", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_TICKET_RESPONSE),
      });
    });

    // Navigate to select-requester
    await page.goto("http://127.0.0.1:5173/select-requester", { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(1500);

    // Select first requester
    const select = page.locator("select");
    await select.waitFor({ state: "visible", timeout: 5000 });
    const options = await select.locator("option").all();
    if (options.length > 1) {
      const value = await options[1].getAttribute("value");
      if (value) await select.selectOption(value);
    }

    // Click Continue
    const continueBtn = page.locator("button", { hasText: "Continue" });
    await continueBtn.click();
    await page.waitForURL("**/tickets", { timeout: 5000 });

    // Navigate directly to ticket detail
    await page.goto("http://127.0.0.1:5173/tickets/TKT-2026-000001", {
      waitUntil: "networkidle",
      timeout: 15000,
    });

    // §11 item 20: Explicit wait pattern
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("h1", { timeout: 10000 });
    await page.waitForSelector('[class*="fieldGrid"]', { timeout: 10000 });

    // Take screenshot
    await page.screenshot({ path: resolve(OUT_DIR, `${vp.name}.png`), fullPage: true });
    console.log(`✅ ${vp.name}.png (${vp.width}x${vp.height})`);

    await page.close();
  }

  await browser.close();

  // Cleanup servers
  apiProc.kill("SIGTERM");
  viteProc.kill("SIGTERM");

  console.log("\nAll screenshots saved to:", OUT_DIR);
}

run().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
