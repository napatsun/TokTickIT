import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Lab 4 screenshot evidence (specification.md §10 Definition of Done; ui-spec.md
 * §8 "Screenshot evidence captured at desktop, tablet, and mobile widths for:
 * IT Staff Dashboard, Requester Dashboard, Actions Taken panel (view + create),
 * and the status transition control").
 *
 * Captures real screenshots from the running application (Vite + Express started
 * by playwright.config.ts, database freshly reset + seeded by globalSetup) into:
 *
 *   artifacts/lab-04/screenshots/staff-dashboard/      staff-dashboard-{1280,768,375}.png
 *   artifacts/lab-04/screenshots/requester-dashboard/  requester-dashboard-{1280,768,375}.png
 *   artifacts/lab-04/screenshots/actions-taken/        actions-taken-view-{1280,768,375}.png
 *                                                      actions-taken-create-{1280,768,375}.png
 *   artifacts/lab-04/screenshots/workflow-controls/    workflow-controls-{1280,768,375}.png
 *
 * Nothing here mutates the database: the Actions Taken create form is opened but
 * never submitted, and the workflow control is captured in its rendered state
 * without pressing a transition.
 */

const STAFF = { email: "alice.chen@toktickit.example.com", password: "Password123!" };
const REQUESTER = { email: "jennifer.anderson@example.com", password: "Password123!" };
const CHANGED_PASSWORD = "E2eChanged123";

/** Seeded IT Staff ticket with an Actions Taken entry (§7.6). */
const TICKET_WITH_ACTIONS = "TKT-2026-000006";

const ROOT = path.resolve("artifacts/lab-04/screenshots");
const STAFF_DASHBOARD_DIR = path.join(ROOT, "staff-dashboard");
const REQUESTER_DASHBOARD_DIR = path.join(ROOT, "requester-dashboard");
const ACTIONS_DIR = path.join(ROOT, "actions-taken");
const WORKFLOW_DIR = path.join(ROOT, "workflow-controls");

const VIEWPORTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

async function submitLogin(page: Page, email: string, password: string) {
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
}

/** Log in and settle wherever the role guard lands (BR-02 retry pattern). */
async function login(page: Page, account: { email: string; password: string }) {
  await page.goto("/login");
  await submitLogin(page, account.email, account.password);

  await Promise.race([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }).catch(() => {}),
    page.getByRole("alert").waitFor({ state: "visible", timeout: 15_000 }).catch(() => {}),
  ]);

  if (page.url().includes("/login")) {
    await submitLogin(page, account.email, CHANGED_PASSWORD);
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
  }

  if (page.url().includes("/change-password")) {
    await page.locator('input[name="newPassword"]').fill(CHANGED_PASSWORD);
    await page.locator('input[name="confirmPassword"]').fill(CHANGED_PASSWORD);
    await page.getByRole("button", { name: /save and continue/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/change-password"), {
      timeout: 15_000,
    });
  }
}

/**
 * The queue renders a table (≥992px, testid `queue-row`) AND stacked cards
 * (<992px, testid `queue-card`) into the same DOM; StaffQueuePage.module.css
 * hides one of the two per breakpoint. At tablet/mobile the row exists but is
 * display:none, which is why a `queue-row` locator timed out as "hidden, not
 * visible" at 375px (and would at 768px too — both are below the 992px cutoff).
 *
 * getByRole only resolves elements present in the accessibility tree, so the
 * breakpoint-hidden twin is excluded automatically at any width.
 */
async function openTicketWithActions(page: Page) {
  await expect(page).toHaveURL(/\/staff\/queue$/, { timeout: 15_000 });
  await page.getByLabel(/search by ticket number or summary/i).fill(TICKET_WITH_ACTIONS);
  const openButton = page.getByRole("button", {
    name: new RegExp(`Open ticket ${TICKET_WITH_ACTIONS}`, "i"),
  });
  await expect(openButton).toBeVisible({ timeout: 15_000 });
  await openButton.click();
  await expect(page).toHaveURL(/\/staff\/tickets\/\d+$/);
  await expect(page.getByTestId("actions-taken-panel")).toBeVisible({ timeout: 15_000 });
}

test.describe("Lab 4 screenshot evidence", () => {
  test.beforeAll(() => {
    execSync("npx tsx prisma/seed.ts", {
      cwd: path.resolve("server"),
      stdio: "inherit",
    });
    for (const dir of [STAFF_DASHBOARD_DIR, REQUESTER_DASHBOARD_DIR, ACTIONS_DIR, WORKFLOW_DIR]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  for (const viewport of VIEWPORTS) {
    test(`staff dashboard @ ${viewport.name}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await login(page, STAFF);
      await page.goto("/dashboard");
      await expect(page.getByTestId("staff-dashboard")).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("metric-cards").waitFor({ state: "visible" });
      await page.waitForTimeout(400); // let cards/recent list settle
      await page.screenshot({
        path: path.join(STAFF_DASHBOARD_DIR, `staff-dashboard-${viewport.name}.png`),
        fullPage: true,
      });
    });

    test(`requester dashboard @ ${viewport.name}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await login(page, REQUESTER);
      await page.goto("/dashboard");
      await expect(page.getByTestId("requester-dashboard")).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("metric-cards").waitFor({ state: "visible" });
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(REQUESTER_DASHBOARD_DIR, `requester-dashboard-${viewport.name}.png`),
        fullPage: true,
      });
    });

    test(`actions taken view + create + workflow control @ ${viewport.name}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await login(page, STAFF);
      await openTicketWithActions(page);
      await page.waitForTimeout(400);

      const panel = page.getByTestId("actions-taken-panel");

      // ─── View mode: the read-only table ────────────────────────────────
      await expect(panel.getByTestId("actions-taken-row").first()).toBeVisible();
      await page.screenshot({
        path: path.join(ACTIONS_DIR, `actions-taken-view-${viewport.name}.png`),
        fullPage: true,
      });

      // ─── Create mode: open the inline form (never submitted) ───────────
      await panel.getByTestId("add-action-button").click();
      await expect(page.getByTestId("actions-taken-form")).toBeVisible();
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(ACTIONS_DIR, `actions-taken-create-${viewport.name}.png`),
        fullPage: true,
      });

      // ─── Status transition control (§5) ────────────────────────────────
      const statusControl = page.getByTestId("status-control");
      await expect(statusControl).toBeVisible();
      await statusControl.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(WORKFLOW_DIR, `workflow-controls-${viewport.name}.png`),
        fullPage: true,
      });
    });
  }
});
