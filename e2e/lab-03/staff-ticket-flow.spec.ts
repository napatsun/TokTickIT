import { test, expect, type Page } from "@playwright/test";

/**
 * Lab 3 end-to-end ticket flow (tests.md §3, §5)
 *
 *   E2E-04  Requester flow — login as a migrated Requester → view an existing
 *           ticket → post a Public Comment → mark "Problem Appears Resolved"
 *           → logout
 *
 * SCOPE: this branch (feature/lab3-03-requester-regression) implements the
 * Requester portion only. The IT Staff portion of this same file (queue, claim,
 * priority/status transitions, staff comments + internal notes) is added in
 * feature/lab3-staff-ticketing in its own `test.describe` block, so the two
 * branches extend this file rather than overwrite each other.
 *
 * Credentials are the documented LOCAL DEV seed values (README → "Seed
 * Credentials (local dev only)"). Playwright's globalSetup re-seeds the
 * database before the run, so the account starts in its documented state.
 * Sarah Johnson is used here because she owns pre-Lab-3 tickets and is not
 * touched by authentication.spec.ts.
 */

const REQUESTER = { email: "sarah.johnson@example.com", password: "Password123!" };
const CHANGED_PASSWORD = "E2eChanged123";
const EXISTING_TICKET = "TKT-2026-000008";

function mainNav(page: Page) {
  return page.getByRole("navigation", { name: "Main navigation" });
}

async function submitLogin(page: Page, email: string, password: string) {
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
}

/**
 * Log the seeded Requester in and settle wherever the role guard lands.
 *
 * Because E2E-02/E2E-03 may have already completed this account's mandatory
 * first-login password change, the helper retries with the changed password
 * when the first attempt is rejected, then completes the change if the guard
 * still asks for it (BR-02).
 */
async function loginRequester(page: Page) {
  await page.goto("/login");
  await submitLogin(page, REQUESTER.email, REQUESTER.password);

  await Promise.race([
    page
      .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 })
      .catch(() => {}),
    page
      .getByRole("alert")
      .waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => {}),
  ]);

  if (page.url().includes("/login")) {
    await submitLogin(page, REQUESTER.email, CHANGED_PASSWORD);
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 15_000,
    });
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

// ─── Requester portion (this branch: feature/lab3-03-requester-regression) ─

test.describe("E2E-04 — Requester regression + new features", () => {
  test("login → view ticket → post public comment → mark appears-resolved → logout", async ({
    page,
  }) => {
    await loginRequester(page);

    // Lands on the Requester home screen.
    await expect(page).toHaveURL(/\/tickets$/, { timeout: 15_000 });
    await expect(mainNav(page).getByRole("link", { name: /my tickets/i })).toBeVisible();

    // Open a ticket that existed before Lab 3 (regression safety, AC-16).
    await page.getByText(EXISTING_TICKET).first().click();
    await expect(page).toHaveURL(new RegExp(`/tickets/${EXISTING_TICKET}$`));
    await expect(page.getByLabel("Ticket No.")).toHaveValue(EXISTING_TICKET);

    // ─── Public Comment ────────────────────────────────────────────────
    const comment = `E2E requester comment ${Date.now()}`;
    const composer = page.getByLabel("Add a comment");

    await expect(page.getByTestId("comment-counter")).toHaveText("0/2000");
    await composer.fill(comment);
    await expect(page.getByTestId("comment-counter")).toHaveText(`${comment.length}/2000`);

    await page.getByRole("button", { name: /post comment/i }).click();

    await expect(page.getByTestId("comment-success")).toBeVisible();
    await expect(
      page.getByTestId("comment-item").filter({ hasText: comment }),
    ).toBeVisible();
    await expect(composer).toHaveValue("");

    // ─── Problem Appears Resolved ──────────────────────────────────────
    const resolveButton = page.getByRole("button", {
      name: /problem appears resolved/i,
    });
    await expect(resolveButton).toBeVisible();
    await resolveButton.click();

    // Exact confirmation copy from ui-spec.md §4.
    await expect(page.getByRole("dialog")).toContainText(
      "This tells IT Staff the issue seems fixed. IT Staff will still need to formally close the ticket. Continue?",
    );
    await page.getByRole("button", { name: /^continue$/i }).click();

    await expect(page.getByTestId("requester-resolved-badge")).toContainText(
      /You marked this as resolved on/i,
    );
    // The action is hidden after success and the formal Status badge is
    // unchanged (BR-05/BR-20).
    await expect(resolveButton).toHaveCount(0);
    await expect(page.getByText("Waiting for Requester")).toBeVisible();

    // ─── Logout ────────────────────────────────────────────────────────
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);

    // The session is really gone: a protected deep link bounces to Login.
    await page.goto("/tickets");
    await expect(page).toHaveURL(/\/login$/);
  });
});
