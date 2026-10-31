import { test, expect, type Page } from "@playwright/test";

/**
 * Lab 4 end-to-end duplicate-submission protection flow (tests.md §3, E2E-05 / AC-11, FR-15).
 *
 *   E2E-05  Rapid double-click on Create Action (`action-save-button`) and
 *           Status Change (`workflow-transition-*`) in a real browser produces
 *           a single network mutation and a single persisted row / transition.
 */

const STAFF = { email: "alice.chen@toktickit.example.com", password: "Password123!" };
const CHANGED_PASSWORD = "E2eChanged123";
const TARGET_TICKET = "TKT-2026-000007";

async function submitLogin(page: Page, email: string, password: string) {
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
}

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
    await page.waitForURL((url) => !url.pathname.startsWith("/change-password"), { timeout: 15_000 });
  }
}

test.describe("E2E-05 — rapid double-click duplicate-submission protection (FR-15, AC-11)", () => {
  test("rapid double-click on Create Action and Status Change produces a single write and row", async ({
    page,
  }) => {
    await login(page, STAFF);
    await expect(page).toHaveURL(/\/staff\/queue$/, { timeout: 15_000 });

    await page.getByLabel(/search by ticket number or summary/i).fill(TARGET_TICKET);
    const row = page.getByTestId("queue-row").filter({ hasText: TARGET_TICKET });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row
      .getByRole("button", { name: new RegExp(`Open ticket ${TARGET_TICKET}`, "i") })
      .click();
    await expect(page).toHaveURL(/\/staff\/tickets\/\d+$/);

    // ─── 1. Rapid double-click on Create Action ─────────────────────────
    const panel = page.getByTestId("actions-taken-panel");
    await expect(panel).toBeVisible();
    const initialRowCount = await panel.getByTestId("actions-taken-row").count();

    await panel.getByTestId("add-action-button").click();
    const form = page.getByTestId("actions-taken-form");
    await expect(form).toBeVisible();

    const uniqueText = `Double-click idempotency check ${Date.now()}`;
    await form.getByLabel(/action description/i).fill(uniqueText);
    await form.getByLabel(/^result/i).fill("Verified single row persisted on rapid double-click.");

    let postActionCalls = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/api\/tickets\/\d+\/actions$/.test(req.url())) {
        postActionCalls += 1;
      }
    });

    await form.getByTestId("action-save-button").dblclick();

    await expect(form).toHaveCount(0, { timeout: 15_000 });
    await expect(panel.getByTestId("actions-taken-row")).toHaveCount(initialRowCount + 1);
    await expect(
      panel.getByTestId("actions-taken-row").filter({ hasText: uniqueText }),
    ).toHaveCount(1);
    expect(postActionCalls).toBe(1);

    // ─── 2. Rapid double-click on Status Change ─────────────────────────
    const statusControl = page.getByTestId("status-control");
    await expect(statusControl.locator('span[role="status"]')).toHaveText("In Progress");

    let patchStatusCalls = 0;
    page.on("request", (req) => {
      if (req.method() === "PATCH" && /\/api\/tickets\/\d+\/status$/.test(req.url())) {
        patchStatusCalls += 1;
      }
    });

    const waitingBtn = page.getByTestId("workflow-transition-WAITING_FOR_REQUESTER");
    await expect(waitingBtn).toBeVisible();
    await waitingBtn.dblclick();

    await expect(page.getByTestId("workflow-success")).toBeVisible({ timeout: 15_000 });
    await expect(statusControl.locator('span[role="status"]')).toHaveText("Waiting for Requester");
    expect(patchStatusCalls).toBe(1);

    // Restore TKT-2026-000005 back to In Progress so subsequent tests see the baseline status
    const inProgressBtn = page.getByTestId("workflow-transition-IN_PROGRESS");
    await expect(inProgressBtn).toBeVisible();
    await inProgressBtn.click();
    await expect(statusControl.locator('span[role="status"]')).toHaveText("In Progress", {
      timeout: 15_000,
    });
  });
});
