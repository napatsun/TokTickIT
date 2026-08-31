/**
 * Screenshot script: Create Ticket page at 3 viewports.
 *
 * Flow: select-requester → select first requester → Continue → /tickets/new
 * Waits for ref data to load (categories/related-systems dropdowns populated)
 * before taking screenshots.
 */
import { spawn } from "child_process";
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../../artifacts/lab-02/screenshots/create-ticket");
mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 375, height: 812 },
];

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

  // Take screenshots
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });

    // Step 1: Navigate to select-requester
    await page.goto("http://127.0.0.1:5173/select-requester", { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(1500);

    // Step 2: Select first requester from dropdown
    const select = page.locator("select");
    await select.waitFor({ state: "visible", timeout: 5000 });
    // Get first real option value (skip placeholder)
    const options = await select.locator("option").all();
    if (options.length > 1) {
      const value = await options[1].getAttribute("value");
      if (value) await select.selectOption(value);
    }

    // Step 3: Click Continue
    const continueBtn = page.locator("button", { hasText: "Continue" });
    await continueBtn.click();
    await page.waitForURL("**/tickets", { timeout: 5000 });
    await page.waitForTimeout(500);

    // Step 4: Navigate to Create Ticket
    await page.goto("http://127.0.0.1:5173/tickets/new", { waitUntil: "networkidle", timeout: 15000 });

    // Step 5: Wait for form to load (ref data fetched, loading spinner gone)
    await page.waitForSelector("h1", { timeout: 5000 });
    // Wait for the select dropdowns to be populated (not just the placeholder option)
    await page.waitForFunction(() => {
      const selects = document.querySelectorAll("select");
      return selects.length >= 2 && selects[0].options.length > 1;
    }, { timeout: 10000 });
    await page.waitForTimeout(500);

    // Step 6: Screenshot
    await page.screenshot({ path: resolve(OUT_DIR, `${vp.name}.png`), fullPage: true });
    console.log(`✅ ${vp.name} (${vp.width}x${vp.height})`);
    await page.close();
  }

  await browser.close();

  // Cleanup
  apiProc.kill("SIGTERM");
  viteProc.kill("SIGTERM");
  console.log("Done. Screenshots saved to:", OUT_DIR);
}

run().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
