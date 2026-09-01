/**
 * Screenshot script: Create Ticket page — all required states.
 *
 * States captured:
 *   1. desktop-empty.png   — Desktop initial empty form
 *   2. tablet-empty.png    — Tablet initial empty form
 *   3. mobile-empty.png    — Mobile initial empty form
 *   4. desktop-validation-error.png — Desktop: submit empty form, capture errors
 *   5. desktop-success.png — Desktop: mock 201 response with attachment failures
 *   6. desktop-attachment-error.png — Desktop: file rejected client-side (wrong type)
 *
 * Flow per viewport:
 *   - Start API server + Vite dev server
 *   - Navigate to select-requester → select first requester → Continue
 *   - Navigate to /tickets/new, wait for ref data
 *   - Take screenshot(s) based on viewport / state
 */
import { spawn } from "child_process";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
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

/** Navigate through the requester selection flow and land on /tickets/new. */
async function setupCreateTicketPage(page) {
  // Step 1: Navigate to select-requester
  await page.goto("http://127.0.0.1:5173/select-requester", { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(1500);

  // Step 2: Select first requester
  const select = page.locator("select");
  await select.waitFor({ state: "visible", timeout: 5000 });
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

  // Step 5: Wait for form to load
  await page.waitForSelector("h1", { timeout: 5000 });
  await page.waitForFunction(() => {
    const selects = document.querySelectorAll("select");
    return selects.length >= 2 && selects[0].options.length > 1;
  }, { timeout: 10000 });
  await page.waitForTimeout(500);
}

/** Fill all required fields with valid values. */
async function fillValidForm(page) {
  // Select Category (first real option)
  const catSelect = page.locator("select").first();
  const catOpts = await catSelect.locator("option").all();
  if (catOpts.length > 1) {
    const v = await catOpts[1].getAttribute("value");
    if (v) await catSelect.selectOption(v);
  }

  // Select Related System
  const rsSelect = page.locator("select").nth(1);
  const rsOpts = await rsSelect.locator("option").all();
  if (rsOpts.length > 1) {
    const v = await rsOpts[1].getAttribute("value");
    if (v) await rsSelect.selectOption(v);
  }

  // Select Priority
  await page.locator('button:has-text("Medium")').click();

  // Fill Summary
  await page.locator('#summary').fill("Laptop battery drains quickly");

  // Fill Description
  await page.locator('#description').fill("My laptop battery is draining much faster than usual. It used to last 6 hours but now barely reaches 2.");
}

async function run() {
  // Dynamically import playwright
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

  // ─── State 1-3: Empty form at Desktop / Tablet / Mobile ────────────
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await setupCreateTicketPage(page);
    await page.screenshot({ path: resolve(OUT_DIR, `${vp.name}-empty.png`), fullPage: true });
    console.log(`✅ ${vp.name}-empty (${vp.width}x${vp.height})`);
    await page.close();
  }

  // ─── State 4: Desktop — validation failure (submit empty form) ─────
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await setupCreateTicketPage(page);

    // Click Submit without filling any fields
    await page.locator('button:has-text("Submit Ticket")').click();
    await page.waitForTimeout(500); // Let validation messages render

    await page.screenshot({ path: resolve(OUT_DIR, "desktop-validation-error.png"), fullPage: true });
    console.log("✅ desktop-validation-error");
    await page.close();
  }

  // ─── State 5: Desktop — success (mock 201 with attachment failure) ─
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await setupCreateTicketPage(page);

    // Intercept POST /api/tickets to return 201 with attachment failure
    await page.route("**/api/tickets", async (route) => {
      const req = route.request();
      if (req.method() === "POST") {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            ticket: {
              id: 999,
              ticketNumber: "TKT-2026-000999",
              ticketDate: "2026-09-01T10:00:00.000Z",
              requester: { id: 1, fullName: "Test Requester" },
              category: { id: 2, name: "Hardware" },
              relatedSystem: { id: 4, name: "Corporate Laptop" },
              summary: "Laptop battery drains quickly",
              description: "My laptop battery is draining much faster than usual.",
              requestedPriority: "MEDIUM",
              itPriority: null,
              currentStatus: "NEW",
              ticketOwner: null,
              resolutionSummary: null,
            },
            attachments: [],
            attachmentFailures: [
              { originalFileName: "screenshot_large.png", reason: "UPLOAD_INTERRUPTED" },
            ],
          }),
        });
      } else {
        await route.fallback();
      }
    });

    await fillValidForm(page);
    await page.locator('button:has-text("Submit Ticket")').click();
    await page.waitForTimeout(1000); // Wait for success panel

    await page.screenshot({ path: resolve(OUT_DIR, "desktop-success.png"), fullPage: true });
    console.log("✅ desktop-success (with attachment failure)");
    await page.close();
  }

  // ─── State 6: Desktop — attachment error (wrong file type) ────────
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await setupCreateTicketPage(page);

    // Create a temporary .docx file on disk to trigger client-side rejection
    const tmpFile = resolve(OUT_DIR, "_tmp_test_upload.docx");
    writeFileSync(tmpFile, "PK\u0003\u0004fake-docx-content-for-screenshot");

    // Use setInputFiles to trigger the file input — client-side validation
    // will reject it as unsupported type
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(tmpFile);

    await page.waitForTimeout(500); // Let error render

    await page.screenshot({ path: resolve(OUT_DIR, "desktop-attachment-error.png"), fullPage: true });
    console.log("✅ desktop-attachment-error");

    // Cleanup temp file
    try { unlinkSync(tmpFile); } catch { /* ignore */ }

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
