/**
 * Self-contained screenshot script: starts servers, takes screenshots, cleans up.
 */
import { execSync, spawn } from "child_process";
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../../artifacts/lab-02/screenshots/select-requester");
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
    await page.goto(`http://127.0.0.1:5173/select-requester`, { waitUntil: "networkidle", timeout: 15000 });
    // Wait for requesters to load
    await page.waitForTimeout(2000);
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
