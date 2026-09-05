/**
 * Screenshot script: My Tickets page — all required viewports.
 *
 * Viewports captured per ui-spec §12:
 *   1. desktop.png   — 1280x800 (≥992px, 9-column table)
 *   2. tablet.png    — 834x1112 (768–991px, 4-column condensed table)
 *   3. mobile.png    — 375x812  (<768px, stacked card list)
 *
 * Flow:
 *   - Start API server + Vite dev server
 *   - Navigate to select-requester → select first requester → Continue
 *   - Land on /tickets (My Tickets page)
 *   - Mock GET /api/tickets to return sample tickets
 *   - Take screenshot at each viewport
 *
 * Output: artifacts/lab-02/screenshots/my-tickets/{desktop,tablet,mobile}.png
 */
import { spawn } from "child_process";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../../artifacts/lab-02/screenshots/my-tickets");
mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 375, height: 812 },
];

/** Sample tickets matching the GET /api/tickets response shape. */
const MOCK_TICKETS = {
  tickets: [
    {
      id: 1,
      ticketNumber: "TKT-2026-000001",
      createdAt: "2026-08-22T09:14:00.000Z",
      summary: "Laptop battery drains quickly",
      category: "Hardware",
      requestedPriority: "MEDIUM",
      itPriority: null,
      currentStatus: "NEW",
      ticketOwner: null,
      updatedAt: "2026-08-22T09:14:00.000Z",
    },
    {
      id: 2,
      ticketNumber: "TKT-2026-000002",
      createdAt: "2026-08-23T10:30:00.000Z",
      summary: "Cannot connect to campus Wi-Fi",
      category: "Network",
      requestedPriority: "HIGH",
      itPriority: null,
      currentStatus: "NEW",
      ticketOwner: null,
      updatedAt: "2026-08-23T11:00:00.000Z",
    },
    {
      id: 3,
      ticketNumber: "TKT-2026-000003",
      createdAt: "2026-08-24T14:20:00.000Z",
      summary: "Software installation request for development tools",
      category: "Software",
      requestedPriority: "LOW",
      itPriority: null,
      currentStatus: "NEW",
      ticketOwner: "John Smith",
      updatedAt: "2026-08-25T09:00:00.000Z",
    },
  ],
  pagination: { page: 1, pageSize: 10, totalItems: 3, totalPages: 1 },
  filterOptions: {
    categories: [
      { id: 2, name: "Hardware" },
      { id: 3, name: "Software" },
      { id: 4, name: "Network" },
    ],
    requestedPriorities: ["LOW", "MEDIUM", "HIGH"],
    currentStatuses: ["NEW"],
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

    // Mock GET /api/tickets to return sample data
    await page.route("**/api/tickets*", async (route) => {
      const url = route.request().url();
      if (url.includes("/api/tickets") && !url.includes("/api/tickets/")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_TICKETS),
        });
      } else {
        await route.fallback();
      }
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

    // Wait for My Tickets page to render with mock data
    await page.waitForSelector("h1", { timeout: 5000 });
    await page.waitForTimeout(1000); // Let API response render

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
