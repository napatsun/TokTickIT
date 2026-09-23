import { test, expect, type Page } from "@playwright/test";

/**
 * Lab 4 end-to-end Actions Taken flow (tests.md §1, E2E-01 / AC-01 + AC-07)
 *
 *   E2E-01  IT Staff logs in → opens a Ticket Detail → creates an Actions
 *           Taken entry (first hitting a validation error, then succeeding)
 *           → the new row appears in the panel; a Requester viewing their own
 *           Ticket sees the read-only table with no create/edit controls
 *           anywhere in the DOM (AC-07, §4.2).
 *
 * Credentials are the documented LOCAL DEV seed values (README → "Seed
 * Credentials (local dev only)"); Playwright's globalSetup re-seeds before the
 * run. The login helpers mirror e2e/lab-03/staff-ticket-flow.spec.ts because
 * E2E-02/E2E-03 may already have completed those accounts' mandatory
 * first-login password change (BR-02).
 */

const STAFF = { email: "ben.carter@toktickit.example.com", password: "Password123!" };
const CHANGED_PASSWORD = "E2eChanged123";
const REQUESTER = { email: "sarah.johnson@example.com", password: "Password123!" };

/** Seeded staff-queue ticket with exactly one Actions Taken entry (§7.6). */
const TICKET_WITH_ACTIONS = "TKT-2026-000006";
/** Seeded Requester-owned ticket the Requester can open read-only. */
const OWNED_TICKET = "TKT-2026-000008";

function mainNav(page: Page) {
  return page.getByRole("navigation", { name: "Main navigation" });
}

async function submitLogin(page: Page, email: string, password: string) {
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
}

/**
 * Log in and settle wherever the role guard lands, completing the mandatory
 * first-login password change if the guard still asks for it (BR-02) — the
 * same retry ladder the Lab 3 specs use.
 */
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

test.describe("E2E-01 — Actions Taken create flow with validation error then success", () => {
  test("staff: open ticket → validation error → valid entry appears in the panel", async ({
    page,
  }) => {
    await login(page, STAFF);

    // IT Staff lands on the queue; find a seeded ticket and open it.
    await expect(page).toHaveURL(/\/staff\/queue$/, { timeout: 15_000 });
    await page.getByLabel(/search by ticket number or summary/i).fill(TICKET_WITH_ACTIONS);
    const row = page.getByTestId("queue-row").filter({ hasText: TICKET_WITH_ACTIONS });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row
      .getByRole("button", { name: new RegExp(`Open ticket ${TICKET_WITH_ACTIONS}`, "i") })
      .click();

    await expect(page).toHaveURL(/\/staff\/tickets\/\d+$/);

    // ─── The panel is present below Comments/Notes ──────────────────────
    const panel = page.getByTestId("actions-taken-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: /actions taken/i })).toBeVisible();
    // The seed gives this ticket exactly one entry (§7.6).
    await expect(panel.getByTestId("actions-taken-row")).toHaveCount(1);

    // ─── Open the inline create form ────────────────────────────────────
    await panel.getByTestId("add-action-button").click();
    const form = page.getByTestId("actions-taken-form");
    await expect(form).toBeVisible();
    // BR-03: Performed By is static text, never an input.
    await expect(form.getByTestId("performed-by-text")).toContainText("Will be recorded as:");

    // ─── Validation error first (AC-01's documented flow) ───────────────
    // Description below the 5-character minimum → 422 with fieldErrors.
    await form.getByLabel(/action description/i).fill("no");
    await form.getByLabel(/^result/i).fill("This result is long enough.");
    await form.getByTestId("action-save-button").click();

    const description = form.getByLabel(/action description/i);
    await expect(description).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText(/between 5 and 2000 characters/i)).toBeVisible();
    // §4.3: focus moves to the first invalid field.
    await expect(description).toBeFocused();
    // The draft's other values survive the failed submit (§4.5).
    await expect(form.getByLabel(/^result/i)).toHaveValue("This result is long enough.");

    // ─── Correct the entry and save ─────────────────────────────────────
    await description.fill("Replaced the keyboard ribbon cable.");
    await form.getByTestId("action-save-button").click();

    // Form collapses; the new row appears (highlight animation aside).
    await expect(form).toHaveCount(0);
    await expect(
      panel.getByTestId("actions-taken-row").filter({ hasText: "Replaced the keyboard ribbon cable." }),
    ).toBeVisible();
    // The count badge grew from the seeded (1) to (2): "Actions Taken (2)".
    await expect(
      panel.getByRole("heading", { name: /actions taken \(2\)/i }),
    ).toBeVisible();
  });

  test("requester: read-only panel with no create/edit controls in the DOM (AC-07)", async ({
    page,
  }) => {
    await login(page, REQUESTER);

    // Requester lands on My Tickets and opens one of their own tickets.
    await expect(page).toHaveURL(/\/tickets$/, { timeout: 15_000 });
    await page.getByText(OWNED_TICKET).first().click();
    await expect(page).toHaveURL(new RegExp(`/tickets/${OWNED_TICKET}$`));

    const panel = page.getByTestId("actions-taken-panel");
    await expect(panel).toBeVisible();

    // UI-04's assertion, live in a real browser: the control does not exist.
    await expect(panel.getByRole("button", { name: /add actions taken/i })).toHaveCount(0);
    await expect(panel.getByTestId("actions-taken-form")).toHaveCount(0);
    // Show-voided is staff-only.
    await expect(panel.getByTestId("show-voided-toggle")).toHaveCount(0);

    // The read-only table itself renders (TKT-...-000008 has a seeded entry).
    await expect(panel.getByTestId("actions-taken-row").first()).toBeVisible();
  });
});
