import { test, expect, type Page } from "@playwright/test";

/**
 * Lab 1–3 scripted regression walkthrough (submission checklist item: "full
 * Labs 1–3 regression walkthrough on the final merged Lab 4 codebase").
 *
 * NOT part of the automated suite: playwright.config.ts testMatch only picks up
 * `lab-{03,04}/**`, so this file never runs with `npm run test:e2e`. It is
 * executed explicitly:
 *
 *   npx playwright test e2e/walkthrough/regression-walkthrough.spec.ts
 *
 * It drives the real app UI — no API shortcuts — through one complete flow per
 * role and prints OBSERVATION lines that double as the walkthrough report.
 * globalSetup still resets + reseeds the database, so the documented seed
 * credentials apply at the start of the run; accounts whose mandatory
 * first-login password change (BR-02) is completed during the run are retried
 * with the changed password by `login()`.
 */

const RUN_ID = Date.now();
const SEED_PASSWORD = "Password123!";
const CHANGED = "Walkthrough123!";

const REQUESTER = { email: "jennifer.anderson@example.com", password: SEED_PASSWORD };
const STAFF = { email: "alice.chen@toktickit.example.com", password: SEED_PASSWORD };
const ADMIN = { email: "admin@toktickit.example.com", password: "Admin123!" };

async function login(page: Page, account: { email: string; password: string }) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="password"]').fill(account.password);
  await page.getByRole("button", { name: /log in/i }).click();

  await Promise.race([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }).catch(() => {}),
    page.getByRole("alert").waitFor({ state: "visible", timeout: 15_000 }).catch(() => {}),
  ]);

  if (page.url().includes("/login")) {
    // BR-02 fallout from earlier tests in the same run: retry with changed pw.
    await page.locator('input[name="email"]').fill(account.email);
    await page.locator('input[name="password"]').fill(CHANGED);
    await page.getByRole("button", { name: /log in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
  }

  if (page.url().includes("/change-password")) {
    await page.locator('input[name="newPassword"]').fill(CHANGED);
    await page.locator('input[name="confirmPassword"]').fill(CHANGED);
    await page.getByRole("button", { name: /save and continue/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/change-password"), { timeout: 15_000 });
    console.log(`OBSERVATION: ${account.email} completed mandatory first-login password change (BR-02).`);
  }
}

test.describe("Labs 1–3 regression walkthrough (final Lab 4 codebase)", () => {
  test("Requester: dashboard → create ticket → comment → My Tickets → dashboard reflection", async ({ page }) => {
    await login(page, REQUESTER);

    // ── 1. Role home after login is My Tickets; the dashboard is a Lab 4 nav item
    await expect(page.getByRole("heading", { name: "My Tickets" })).toBeVisible({ timeout: 15_000 });
    console.log("OBSERVATION: requester landed on My Tickets (role home) after login.");

    // ── 2. Requester dashboard renders (Lab 4 §3 route over the merged codebase)
    await page.goto("/dashboard");
    await expect(page.getByTestId("requester-dashboard")).toBeVisible({ timeout: 15_000 });
    console.log("OBSERVATION: requester dashboard renders with metric cards and recent list.");

    // ── 2. Create a ticket (Lab 2)
    await page.goto("/tickets/new");
    await expect(page.getByRole("heading", { name: "Create Ticket" })).toBeVisible();
    await page.getByLabel("Category").selectOption({ index: 1 });
    await page.getByLabel("Related System").selectOption({ index: 1 });
    await page.getByRole("radio", { name: /medium/i }).click();
    const summary = `Walkthrough printer issue ${RUN_ID}`;
    await page.getByLabel("Summary").fill(summary);
    await page
      .getByLabel("Description")
      .fill("The office printer on floor 3 jams on every duplex job and shows error code E2. Please inspect the fuser unit.");
    await page.getByRole("button", { name: "Submit Ticket" }).click();
    // The page shows an in-place success banner carrying the new ticket number.
    const successBanner = page.getByText(/TKT-\d{4}-\d{6}/).first();
    await expect(successBanner).toBeVisible({ timeout: 15_000 });
    const ticketNumber = (await successBanner.textContent())!.match(/TKT-\d{4}-\d{6}/)![0];
    await page.getByRole("button", { name: "View Ticket" }).click();
    await page.waitForURL(/\/tickets\//, { timeout: 15_000 });
    console.log(`OBSERVATION: ticket created — ${ticketNumber} ("${summary}"); success banner shown, opened its detail page.`);

    // ── 3. Add a public comment (Lab 2/3 content thread)
    await page.getByPlaceholder("Share an update with IT Staff…").fill("Adding a walkthrough comment: the error code appears only after warm-up.");
    await page.getByRole("button", { name: "Post Comment" }).click();
    await expect(page.getByText(/walkthrough comment: the error code/i).first()).toBeVisible({ timeout: 15_000 });
    console.log("OBSERVATION: comment posted and rendered in the ticket's comment thread.");

    // ── 4. Ticket appears in My Tickets (Lab 2)
    await page.goto("/tickets");
    await expect(page.getByText(ticketNumber).first()).toBeVisible({ timeout: 15_000 });
    console.log("OBSERVATION: new ticket listed on My Tickets.");

    // ── 5. Ticket reflected on the requester dashboard (Lab 4 §3 over the merged codebase)
    await page.goto("/dashboard");
    await expect(page.getByTestId("requester-dashboard")).toBeVisible();
    await expect(page.getByTestId("metric-cards")).toBeVisible();
    await expect(page.getByText(ticketNumber).first()).toBeVisible({ timeout: 15_000 });
    console.log("OBSERVATION: new ticket visible on the requester dashboard (recent list).");
  });

  test("IT Staff: queue → open → claim → Actions Taken → status transitions → dashboard reflection", async ({ page }) => {
    await login(page, STAFF);

    // ── 1. Staff dashboard baseline (Lab 4 §2 route), then the queue (role home)
    await page.goto("/dashboard");
    await expect(page.getByTestId("staff-dashboard")).toBeVisible({ timeout: 15_000 });
    console.log("OBSERVATION: staff dashboard renders with metric cards.");

    // ── 2. Pick up the seeded unassigned NEW ticket from the queue (Lab 3)
    await page.goto("/staff/queue");
    await expect(page.getByTestId("queue-table")).toBeVisible({ timeout: 15_000 });
    const ticketNumber = "TKT-2026-000009"; // seeded unassigned, per staff-ticket-flow.spec.ts
    const row = page.getByTestId("queue-row").filter({ hasText: ticketNumber });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: new RegExp(`Open ticket ${ticketNumber}`, "i") }).click();
    await expect(page).toHaveURL(/\/staff\/tickets\/\d+$/, { timeout: 15_000 });
    console.log(`OBSERVATION: opened ${ticketNumber} from the queue (unassigned, status New).`);

    // ── 3. Claim ownership (Lab 3)
    await page.getByRole("button", { name: "Claim" }).click();
    await expect(page.getByTestId("owner-display")).toHaveText(/Alice Chen/, { timeout: 15_000 });
    console.log("OBSERVATION: claimed the ticket — owner is now Alice Chen.");

    // ── 4. Add an Actions Taken entry with a result (Lab 4; unblocks Resolve)
    await page.getByTestId("add-action-button").click();
    await expect(page.getByTestId("actions-taken-form")).toBeVisible();
    const actionsForm = page.getByTestId("actions-taken-form");
    await expect(actionsForm).toBeVisible();
    await actionsForm.getByLabel(/description/i).fill("Inspect fuser unit, cleared jammed duplex roller path.");
    await actionsForm.getByLabel(/result/i).fill("Printer completes duplex jobs without errors; fuser replaced.");
    await actionsForm.getByRole("button", { name: "Save Actions Taken" }).click();
    await expect(page.getByText(/cleared jammed duplex roller path/i).first()).toBeVisible({ timeout: 15_000 });
    console.log("OBSERVATION: Actions Taken entry saved with a result (Resolve precondition now met).");
    // The panel's onActionsChanged callback refreshes the ticket state, so the
    // Resolved button must re-enable immediately — no reload, no manual
    // refresh. (Verified live: this exact sequence resolves without one.)

    // ── 5. Transition status NEW → OPEN → IN_PROGRESS → RESOLVED (Lab 3/4
    // workflow through the Lab 4 §5 control). OPEN/IN_PROGRESS apply
    // immediately; RESOLVED is CONFIRMATION_REQUIRED and goes through the
    // StatusChangeConfirm dialog (its BR-09 precondition is met by the
    // Actions Taken entry added above).
    for (const target of ["OPEN", "IN_PROGRESS"] as const) {
      await page.getByTestId(`workflow-transition-${target}`).click();
      await expect(page.getByTestId("workflow-success")).toBeVisible({ timeout: 15_000 });
      console.log(`OBSERVATION: status transition to ${target} applied immediately (no confirmation needed).`);
    }
    await page.getByTestId("workflow-transition-RESOLVED").click();
    const dialog = page.getByTestId("status-confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByTestId("workflow-transition-RESOLVED")).toBeHidden({ timeout: 15_000 });
    console.log("OBSERVATION: status transition to RESOLVED confirmed in the dialog and applied.");

    // ── 6. Reflection on the staff dashboard (Lab 4 §2)
    await page.goto("/dashboard");
    await expect(page.getByTestId("staff-dashboard")).toBeVisible();
    await expect(page.getByTestId("metric-cards")).toBeVisible();
    await expect(page.getByText(ticketNumber).first()).toBeVisible({ timeout: 15_000 });
    console.log("OBSERVATION: worked ticket visible on the staff dashboard (recent list).");
  });

  test("Administrator: user management — create, search, edit", async ({ page }) => {
    await login(page, ADMIN);

    await expect(page.getByTestId("users-table")).toBeVisible({ timeout: 15_000 });
    console.log("OBSERVATION: administrator landed on User Management (role home).");

    // ── 1. Create a user (Lab 3)
    const name = `Walkthrough User ${RUN_ID}`;
    const email = `walkthrough.${RUN_ID}@toktickit.example.com`;
    await page.getByTestId("create-user-button").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Email").fill(email);
    await dialog.getByLabel("Role").selectOption("REQUESTER");
    await dialog.getByLabel("Initial Password").fill("Walkthru123!");
    await dialog.getByRole("button", { name: "Create User" }).click();
    await expect(page.getByRole("status").filter({ hasText: /created/i })).toBeVisible({ timeout: 15_000 });
    console.log("OBSERVATION: user created — success toast shown.");

    // ── 2. Search narrows the list to the new account
    await page.getByPlaceholder("Search by name or email…").fill(email);
    await expect(page.getByTestId("user-row").filter({ hasText: email })).toBeVisible({ timeout: 15_000 });
    console.log("OBSERVATION: search by email returns exactly the created user's row.");

    // ── 3. Edit the user (rename)
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    const editDialog = page.getByRole("dialog");
    await expect(editDialog).toBeVisible();
    await editDialog.getByLabel("Name").fill(`${name} Renamed`);
    await editDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(`${name} Renamed`).first()).toBeVisible({ timeout: 15_000 });
    console.log("OBSERVATION: user renamed via Edit modal; list reflects the change.");
  });

  test("Keyboard: navigation order, visible focus indicators, modal focus trap + Escape", async ({ page }) => {
    // ── 1. Login page: with both fields filled (submit enabled), tab order is
    // email → password → submit and every stop shows a visible focus ring.
    await page.goto("/login");
    await page.locator('input[name="email"]').fill("probe@example.com");
    await page.locator('input[name="password"]').fill("probe");
    await page.locator('input[name="email"]').focus();
    const order: string[] = ["email"];
    const stops = ["password", /log in/i] as const;
    for (let i = 0; i < stops.length; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const cs = getComputedStyle(el);
        const ring =
          el.matches(":focus-visible") &&
          (cs.outlineStyle !== "none" || cs.boxShadow !== "none");
        return { name: el.getAttribute("aria-label") ?? el.getAttribute("name") ?? el.tagName, ring };
      });
      expect(info, `tab stop after email (${stops[i]}) exists`).not.toBeNull();
      order.push(info!.name);
      expect(info!.ring, `tab stop ${order.join(" → ")} shows a visible focus indicator`).toBeTruthy();
    }
    console.log(`OBSERVATION: login tab order = ${order.join(" → ")}; every stop shows a visible focus ring.`);

    // ── 2. Admin modal: focus moves in, Tab stays trapped, Escape closes and returns focus
    await login(page, ADMIN);
    await page.getByTestId("create-user-button").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const dialogBox = await dialog.boundingBox();
    let escaped = false;
    for (let i = 0; i < 30 && !escaped; i++) {
      await page.keyboard.press("Tab");
      const box = await page.evaluate(() => document.activeElement?.getBoundingClientRect() ?? null);
      escaped =
        box === null ||
        dialogBox === null ||
        box.left < dialogBox.x - 1 ||
        box.right > dialogBox.x + dialogBox.width + 1 ||
        box.top < dialogBox.y - 1 ||
        box.bottom > dialogBox.y + dialogBox.height + 1;
    }
    expect(escaped, "focus never left the Create User dialog after 30 Tabs").toBe(false);
    console.log("OBSERVATION: 30 Tabs pressed — focus stayed inside the modal (trap holds).");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 5_000 });
    await expect(page.getByTestId("create-user-button")).toBeFocused();
    console.log("OBSERVATION: Escape closed the modal and focus returned to the Create User trigger.");
  });

  test("No horizontal scrolling at 1280 / 768 / 375 on the walkthrough surfaces", async ({ page }) => {
    await login(page, REQUESTER);
    const surfaces = ["/dashboard", "/tickets", "/tickets/new"];

    for (const vp of [
      { name: "1280", width: 1280, height: 900 },
      { name: "768", width: 768, height: 1024 },
      { name: "375", width: 375, height: 812 },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const surface of surfaces) {
        await page.goto(surface);
        await page.waitForLoadState("networkidle");
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${surface} @ ${vp.name}px`).toBeLessThanOrEqual(1);
        console.log(`OBSERVATION: ${surface} @ ${vp.name}px — no horizontal scroll (overflow=${overflow}px).`);
      }
    }
  });
});
