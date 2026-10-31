import { test, expect, type Page } from "@playwright/test";

/**
 * Lab 4 end-to-end resolution flow (tests.md §2, E2E-02 / AC-03).
 *
 *   E2E-02  IT Staff opens a resolvable Ticket (WAITING_FOR_REQUESTER with a
 *           recorded Actions Taken result) → moves it to Resolved through the
 *           new workflow control (confirmation step → server-confirmed badge) →
 *           the owning Requester sees the Resolved badge and reopens the Ticket
 *           within BR-10's window → the badge becomes Reopened.
 *
 * Credentials are the documented LOCAL DEV seed values (README → "Seed
 * Credentials (local dev only)"); Playwright's globalSetup re-seeds before the
 * run, and the seed script (idempotent upsert) restores TKT-2026-000008 to
 * WAITING_FOR_REQUESTER with `resolvedAt = null`. The login helpers mirror
 * e2e/lab-03/staff-ticket-flow.spec.ts because an earlier spec may already have
 * completed the mandatory first-login password change (BR-02).
 */

const STAFF = { email: "ben.carter@toktickit.example.com", password: "Password123!" };
const REQUESTER = { email: "sarah.johnson@example.com", password: "Password123!" };
const CHANGED_PASSWORD = "E2eChanged123";

/** Seeded WAITING_FOR_REQUESTER Ticket owned (requesterId) by Sarah Johnson with
 *  exactly one non-voided Actions Taken entry, coordinated by Ben Carter. */
const RESOLVABLE_TICKET = "TKT-2026-000008";

function mainNav(page: Page) {
  return page.getByRole("navigation", { name: "Main navigation" });
}

async function submitLogin(page: Page, email: string, password: string) {
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
}

/** Log in and settle wherever the role guard lands, completing the mandatory
 *  first-login password change if the guard still asks for it (BR-02). */
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

test.describe("E2E-02 — resolution flow: resolve then reopen", () => {
  test("IT Staff resolves a gated Ticket; the Requester reopens it within the window", async ({
    page,
  }) => {
    // ─── IT Staff: open the resolvable Ticket from the queue ─────────────
    await login(page, STAFF);
    await expect(page).toHaveURL(/\/staff\/queue$/, { timeout: 15_000 });

    await page.getByLabel(/search by ticket number or summary/i).fill(RESOLVABLE_TICKET);
    const row = page.getByTestId("queue-row").filter({ hasText: RESOLVABLE_TICKET });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row
      .getByRole("button", { name: new RegExp(`Open ticket ${RESOLVABLE_TICKET}`, "i") })
      .click();
    await expect(page).toHaveURL(/\/staff\/tickets\/\d+$/);

    // ─── The workflow control offers Resolved, enabled (BR-09 satisfied) ──
    const statusControl = page.getByTestId("status-control");
    await expect(statusControl.locator('span[role="status"]')).toHaveText(
      "Waiting for Requester",
    );

    const resolveButton = page.getByTestId("workflow-transition-RESOLVED");
    await expect(resolveButton).toBeVisible();
    await expect(resolveButton).toBeEnabled();
    // The gate explanation must NOT be shown when the precondition is met.
    await expect(page.getByTestId("workflow-resolve-blocked-note")).toHaveCount(0);

    // ─── Confirm and apply the transition (non-optimistic badge) ─────────
    await resolveButton.click();
    const dialog = page.getByTestId("status-confirm-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /^continue$/i }).click();

    await expect(page.getByTestId("workflow-success")).toBeVisible({ timeout: 15_000 });
    await expect(statusControl.locator('span[role="status"]')).toHaveText("Resolved");
    // Resolved is not terminal for staff: Closed and Reopened remain available.
    await expect(page.getByTestId("workflow-transition-CLOSED")).toBeVisible();

    // ─── Requester: sees Resolved and reopens within BR-10's window ──────
    // Drop the staff session first: /login would otherwise bounce an already
    // authenticated caller straight back into the app (no login form).
    await page.context().clearCookies();
    await login(page, REQUESTER);
    await expect(page).toHaveURL(/\/tickets$/, { timeout: 15_000 });
    await page.getByText(RESOLVABLE_TICKET).first().click();
    await expect(page).toHaveURL(new RegExp(`/tickets/${RESOLVABLE_TICKET}$`));

    // The header badge reflects the authoritative status the staff member set.
    await expect(
      page.getByRole("status").filter({ hasText: /^Resolved$/ }),
    ).toBeVisible({ timeout: 15_000 });

    // BR-10: inside the window the reopen control exists (hidden, not disabled).
    const reopenButton = page.getByTestId("workflow-transition-REOPENED");
    await expect(reopenButton).toBeVisible();
    await expect(reopenButton).toBeEnabled();

    await reopenButton.click();
    await expect(page.getByTestId("workflow-success")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("status").filter({ hasText: /^Reopened$/ }),
    ).toBeVisible();
  });
});
