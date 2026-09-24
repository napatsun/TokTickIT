import { test, expect, type Page } from "@playwright/test";

/**
 * Lab 3 end-to-end ticket flow (tests.md §3, §5)
 *
 *   E2E-04  Requester flow — login as a migrated Requester → view an existing
 *           ticket → post a Public Comment → mark "Problem Appears Resolved"
 *           → logout
 *   E2E-05  IT Staff flow — login as IT Staff → open the Queue → claim a
 *           ticket → set IT Priority → change status → post a Public Comment
 *           → add an Internal Note
 *
 * Both flows live in this file as separate `test.describe` blocks: E2E-04 was
 * added by feature/lab3-03-requester-regression and E2E-05 was appended by
 * feature/lab3-04-staff-ticketing, so neither branch overwrites the other.
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

    // ─── "This looks resolved to me" advisory confirmation (Lab 4 §5) ──
    const confirmButton = page.getByTestId("requester-confirmation-button");
    await expect(confirmButton).toBeVisible();
    await expect(page.getByTestId("requester-confirmation-helper")).toHaveText(
      "Your IT Staff will review and confirm.",
    );
    await confirmButton.click();

    await expect(page.getByTestId("requester-confirmation-done")).toContainText(
      /You told IT Staff this looks resolved/i,
    );
    // The advisory action is replaced by the confirmed note, and the formal
    // Status badge is unchanged (BR-08).
    await expect(confirmButton).toHaveCount(0);
    await expect(page.getByText("Waiting for Requester")).toBeVisible();

    // ─── Logout ────────────────────────────────────────────────────────
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);

    // The session is really gone: a protected deep link bounces to Login.
    await page.goto("/tickets");
    await expect(page).toHaveURL(/\/login$/);
  });
});

// ─── IT Staff portion (feature/lab3-04-staff-ticketing) ─────────────────

/**
 * Alice Chen is a seeded IT Staff account that no other Lab 3 spec touches, so
 * she starts the run with her documented initial password and the mandatory
 * first-login change (BR-02).
 */
const STAFF = { email: "alice.chen@toktickit.example.com", password: "Password123!" };

/** Seeded, unassigned ticket used for the claim step (ownerId = null). */
const UNASSIGNED_TICKET = "TKT-2026-000009";

test.describe("E2E-05 — IT Staff queue, claim, priority, status, comments, notes", () => {
  /**
   * Log the seeded IT Staff member in and settle wherever the role guard lands.
   *
   * E2E-03 may already have completed a first-login change for other accounts,
   * so this retries with the changed password and then completes the mandatory
   * change if the guard still asks for it — same approach as `loginRequester`.
   */
  async function loginStaff(page: Page) {
    await page.goto("/login");
    await submitLogin(page, STAFF.email, STAFF.password);

    await Promise.race([
      page
        .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 })
        .catch(() => {}),
      page.getByRole("alert").waitFor({ state: "visible", timeout: 15_000 }).catch(() => {}),
    ]);

    if (page.url().includes("/login")) {
      await submitLogin(page, STAFF.email, CHANGED_PASSWORD);
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

  test("login → queue → claim → IT priority → status → comment → internal note", async ({
    page,
  }) => {
    await loginStaff(page);

    // ─── Lands on the IT Staff Queue (the role home, FR-08) ────────────
    await expect(page).toHaveURL(/\/staff\/queue$/, { timeout: 15_000 });
    await expect(mainNav(page).getByRole("link", { name: /ticket queue/i })).toBeVisible();
    await expect(page.getByTestId("queue-table")).toBeVisible();

    // ─── Find the unassigned seeded ticket via queue search ────────────
    await page.getByLabel(/search by ticket number or summary/i).fill(UNASSIGNED_TICKET);

    const row = page.getByTestId("queue-row").filter({ hasText: UNASSIGNED_TICKET });
    await expect(row).toBeVisible({ timeout: 15_000 });
    // Unassigned in the queue table.
    await expect(row).toContainText("Unassigned");

    await row.getByRole("button", { name: new RegExp(`Open ticket ${UNASSIGNED_TICKET}`, "i") }).click();

    // ─── Ticket Detail (staff route keyed by internal id) ──────────────
    await expect(page).toHaveURL(/\/staff\/tickets\/\d+$/);
    await expect(page.getByLabel("Ticket No.")).toHaveValue(UNASSIGNED_TICKET);
    await expect(page.getByTestId("owner-display")).toHaveText("Unassigned");

    // ─── Claim (BR-13) ────────────────────────────────────────────────
    await page.getByRole("button", { name: /^claim$/i }).click();
    await expect(page.getByTestId("owner-success")).toBeVisible();
    await expect(page.getByTestId("owner-display")).toHaveText("Alice Chen");

    // ─── IT Priority, independently of Requested Priority (BR-14/15) ──
    await page.getByLabel(/^IT Priority/i).selectOption("HIGH");
    await expect(page.getByTestId("priority-success")).toBeVisible();

    // ─── Status transition NEW → OPEN (permitted, no dialog) ──────────
    // Lab 4 §5: the control renders one button per permitted transition.
    await expect(page.getByTestId("workflow-transition-OPEN")).toBeVisible();
    await page.getByTestId("workflow-transition-OPEN").click();
    await expect(page.getByTestId("workflow-success")).toBeVisible();
    await expect(
      page.getByTestId("status-control").locator('span[role="status"]'),
    ).toHaveText("Open");

    // ─── Public Comment (visible to the Requester too, BR-04) ─────────
    const comment = `E2E staff comment ${Date.now()}`;
    const commentBox = page.getByLabel("Add a comment");
    await commentBox.fill(comment);
    await expect(page.getByTestId("comment-counter")).toHaveText(`${comment.length}/2000`);
    await page.getByRole("button", { name: /post comment/i }).click();

    await expect(page.getByTestId("comment-success")).toBeVisible();
    await expect(page.getByTestId("comment-item").filter({ hasText: comment })).toBeVisible();
    await expect(commentBox).toHaveValue("");

    // ─── Internal Note (IT-only, visually distinct panel, §6.6) ───────
    const note = `E2E internal note ${Date.now()}`;
    const notesPanel = page.getByTestId("internal-notes-panel");

    await expect(notesPanel).toHaveAttribute("data-variant", "internal");
    await expect(
      notesPanel.getByRole("heading", { name: /internal notes \(IT Staff & Administrator only\)/i }),
    ).toBeVisible();
    await expect(notesPanel.getByTestId("internal-notes-lock")).toBeVisible();
    await expect(page.getByTestId("public-comments-panel")).toHaveAttribute(
      "data-variant",
      "public",
    );

    await notesPanel.getByLabel("Add an internal note").fill(note);
    await expect(notesPanel.getByTestId("note-counter")).toHaveText(`${note.length}/2000`);
    await notesPanel.getByRole("button", { name: /add note/i }).click();

    await expect(page.getByTestId("note-success")).toBeVisible();
    await expect(notesPanel.getByTestId("note-item").filter({ hasText: note })).toBeVisible();

    // The internal note must never show up as a Public Comment.
    await expect(page.getByTestId("comment-item").filter({ hasText: note })).toHaveCount(0);

    // ─── Terminal transitions require confirmation (§6.3) ─────────────
    await page.getByTestId("workflow-transition-CANCELLED").click();
    await expect(page.getByTestId("status-confirm-dialog")).toBeVisible();
    await page.getByRole("button", { name: /^cancel$/i }).click();
    await expect(page.getByTestId("status-confirm-dialog")).toHaveCount(0);

    // ─── Logout ───────────────────────────────────────────────────────
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);

    // A Requester still cannot reach the staff queue after this staff session.
    await page.goto("/staff/queue");
    await expect(page).toHaveURL(/\/login$/);
  });
});
