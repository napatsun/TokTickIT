import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Lab 3 responsive verification for the IT Staff screens — tests.md §4/§5
 *
 *   RESP-01  Queue screen at 375px / 768px / 1280px
 *   RESP-02  Ticket Detail screen at 375px / 768px / 1280px
 *   RESP-03  User Management screen at 375px / 768px / 1280px
 *
 * For each width this spec:
 *   1. asserts there is no horizontal page overflow (ui-spec.md §9),
 *   2. asserts the correct layout is active — stacked cards below the screen's
 *      breakpoint, the full table at or above it (992px for the nine-column
 *      queue, 768px for the five-column user list),
 *   3. writes a screenshot to the artifacts directory the deliverable names:
 *        artifacts/lab-03/screenshots/staff-queue/
 *        artifacts/lab-03/screenshots/staff-ticket-detail/
 *        artifacts/lab-03/screenshots/user-management/
 *
 * Credentials are the documented LOCAL DEV seed values; Playwright's
 * globalSetup re-seeds the database before the run.
 */

const STAFF = { email: "alice.chen@toktickit.example.com", password: "Password123!" };
const CHANGED_PASSWORD = "E2eChanged123";

/** Seeded Administrator: NOT flagged for a first-login change (README). */
const ADMIN = { email: "admin@toktickit.example.com", password: "Admin123!" };

const QUEUE_DIR = path.resolve("artifacts/lab-03/screenshots/staff-queue");
const DETAIL_DIR = path.resolve("artifacts/lab-03/screenshots/staff-ticket-detail");
const USERS_DIR = path.resolve("artifacts/lab-03/screenshots/user-management");

/** Ticket with a seeded Internal Note, so both panels are populated. */
const DETAIL_TICKET = "TKT-2026-000006";

const VIEWPORTS = [
  { name: "375", width: 375, height: 812 },
  { name: "768", width: 768, height: 1024 },
  { name: "1280", width: 1280, height: 900 },
] as const;

async function submitLogin(page: Page, email: string, password: string) {
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
}

/**
 * Log the IT Staff member in and complete the mandatory first-login password
 * change if the guard asks for it (same retry pattern as the other Lab 3 specs,
 * because a previous spec may already have completed it for this account).
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

/**
 * Log the Administrator in. The seeded Administrator holds a normal password
 * (mustChangePassword = false), so there is no forced-change step to handle —
 * if that ever becomes true this fails loudly rather than silently skipping
 * the screen under test.
 */
async function loginAdministrator(page: Page) {
  await page.goto("/login");
  await submitLogin(page, ADMIN.email, ADMIN.password);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
  expect(page.url()).not.toContain("/change-password");
}

/** ui-spec.md §9: no horizontal scroll at any of the required widths. */
async function expectNoHorizontalOverflow(page: Page, label: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  // 1px tolerance for sub-pixel rounding.
  expect(
    scrollWidth,
    `${label} must not overflow horizontally (scrollWidth ${scrollWidth} vs clientWidth ${clientWidth})`,
  ).toBeLessThanOrEqual(clientWidth + 1);
}

function isVisibleInLayout(locator: ReturnType<Page["getByTestId"]>) {
  return locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return element.offsetParent !== null && style.display !== "none" && style.visibility !== "hidden";
  });
}

// ─── RESP-01 — IT Staff Queue ───────────────────────────────────────────

test.describe("RESP-01 — IT Staff Ticket Queue responsiveness", () => {
  test.beforeAll(() => {
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
  });

  for (const viewport of VIEWPORTS) {
    test(`renders the Queue without overflow at ${viewport.name}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginStaff(page);

      await expect(page).toHaveURL(/\/staff\/queue$/, { timeout: 15_000 });
      await expect(page.getByTestId("queue-table")).toBeAttached();
      await page.waitForTimeout(400); // let the first page of results settle

      await expectNoHorizontalOverflow(page, `Queue @ ${viewport.name}px`);

      const tableVisible = await isVisibleInLayout(page.getByTestId("queue-table"));
      const cardsVisible = await isVisibleInLayout(page.getByTestId("queue-cards"));

      if (viewport.width < 992) {
        // Stacked cards take over below 992px; the table is removed from layout.
        expect(cardsVisible, `cards at ${viewport.name}px`).toBe(true);
        expect(tableVisible, `table hidden at ${viewport.name}px`).toBe(false);
        await expect(page.getByTestId("queue-card").first()).toBeVisible();
        expect(await page.getByTestId("queue-card").count()).toBeGreaterThan(0);
      } else {
        expect(tableVisible, `table at ${viewport.name}px`).toBe(true);
        expect(cardsVisible, `cards hidden at ${viewport.name}px`).toBe(false);
        await expect(page.getByTestId("queue-row").first()).toBeVisible();
      }

      await page.screenshot({
        path: path.join(QUEUE_DIR, `queue-${viewport.name}.png`),
        fullPage: true,
      });
    });
  }
});

// ─── RESP-02 — IT Staff Ticket Detail ───────────────────────────────────

test.describe("RESP-02 — IT Staff Ticket Detail responsiveness", () => {
  test.beforeAll(() => {
    fs.mkdirSync(DETAIL_DIR, { recursive: true });
  });

  for (const viewport of VIEWPORTS) {
    test(`renders Ticket Detail without overflow at ${viewport.name}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginStaff(page);

      // Reach the detail screen the way a user does: search the queue, open a row.
      await expect(page).toHaveURL(/\/staff\/queue$/, { timeout: 15_000 });
      await page.getByLabel(/search by ticket number or summary/i).fill(DETAIL_TICKET);

      const row = page.getByTestId("queue-row").filter({ hasText: DETAIL_TICKET });
      const card = page.getByTestId("queue-card").filter({ hasText: DETAIL_TICKET });

      // Whichever layout is active for this width, click its own "Open" action.
      if (viewport.width < 992) {
        await card.first().getByRole("button", { name: /open ticket/i }).click();
      } else {
        await row.first().getByRole("button", { name: /open ticket/i }).click();
      }

      await expect(page).toHaveURL(/\/staff\/tickets\/\d+$/, { timeout: 15_000 });
      await expect(page.getByLabel("Ticket No.")).toHaveValue(DETAIL_TICKET);
      await expect(page.getByTestId("internal-notes-panel")).toBeVisible();
      await page.waitForTimeout(400); // let comments/notes settle

      await expectNoHorizontalOverflow(page, `Ticket Detail @ ${viewport.name}px`);

      // §6.6: the Internal Notes panel must stay visually distinct (tinted, not
      // the plain surface) at every width — colour is a supplement to the lock
      // icon and the explicit IT-only heading, both of which stay visible.
      const backgrounds = await page.evaluate(() => {
        const publicPanel = document.querySelector('[data-testid="public-comments-panel"]');
        const notesPanel = document.querySelector('[data-testid="internal-notes-panel"]');
        if (!publicPanel || !notesPanel) return null;
        return {
          publicBg: window.getComputedStyle(publicPanel as Element).backgroundColor,
          notesBg: window.getComputedStyle(notesPanel as Element).backgroundColor,
        };
      });

      expect(backgrounds).not.toBeNull();
      expect(backgrounds!.notesBg).not.toBe(backgrounds!.publicBg);
      await expect(
        page.getByTestId("internal-notes-panel").getByTestId("internal-notes-lock"),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: /internal notes \(IT Staff & Administrator only\)/i }),
      ).toBeVisible();

      await page.screenshot({
        path: path.join(DETAIL_DIR, `staff-ticket-detail-${viewport.name}.png`),
        fullPage: true,
      });
    });
  }
});

// ─── RESP-03 — Administrator User Management ────────────────────────────

test.describe("RESP-03 — User Management responsiveness", () => {
  test.beforeAll(() => {
    fs.mkdirSync(USERS_DIR, { recursive: true });
  });

  for (const viewport of VIEWPORTS) {
    test(`renders User Management without overflow at ${viewport.name}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginAdministrator(page);

      await expect(page).toHaveURL(/\/admin\/users$/, { timeout: 15_000 });
      await expect(page.getByTestId("users-table")).toBeAttached();
      await expect(page.getByTestId("user-row").first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(400); // let the list settle

      await expectNoHorizontalOverflow(page, `User Management @ ${viewport.name}px`);

      const tableVisible = await isVisibleInLayout(page.getByTestId("users-table"));
      const cardsVisible = await isVisibleInLayout(page.getByTestId("users-cards"));

      if (viewport.width < 768) {
        // Five columns is too many for a phone: stacked cards take over.
        expect(cardsVisible, `cards at ${viewport.name}px`).toBe(true);
        expect(tableVisible, `table hidden at ${viewport.name}px`).toBe(false);
        await expect(page.getByTestId("user-card").first()).toBeVisible();
        expect(await page.getByTestId("user-card").count()).toBeGreaterThan(0);
      } else {
        expect(tableVisible, `table at ${viewport.name}px`).toBe(true);
        expect(cardsVisible, `cards hidden at ${viewport.name}px`).toBe(false);
        await expect(page.getByTestId("user-row").first()).toBeVisible();
      }

      // The Create modal is the widest thing on this screen — prove it also
      // fits without clipping at the narrowest width.
      await page.getByTestId("create-user-button").click();
      const dialog = page.getByTestId("create-user-dialog");
      await expect(dialog).toBeVisible();
      await expectNoHorizontalOverflow(page, `Create User modal @ ${viewport.name}px`);

      const dialogBox = await dialog.boundingBox();
      expect(dialogBox, `dialog box at ${viewport.name}px`).not.toBeNull();
      expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport.width + 1);

      await page.screenshot({
        path: path.join(USERS_DIR, `create-user-modal-${viewport.name}.png`),
        fullPage: true,
      });

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();

      await page.screenshot({
        path: path.join(USERS_DIR, `user-management-${viewport.name}.png`),
        fullPage: true,
      });
    });
  }
});
