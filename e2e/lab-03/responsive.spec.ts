import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Lab 3 responsive verification for every screen the sprint ships — tests.md
 * §4/§5/§8.
 *
 *   RESP-01  IT Staff Queue at 375px / 768px / 1280px
 *   RESP-02  IT Staff Ticket Detail at 375px / 768px / 1280px
 *   RESP-03  Administrator User Management at 375px / 768px / 1280px
 *   RESP-04  Login (idle + failure) and Change Password at 375/768/1280px
 *            (feature/lab3-06)
 *   RESP-05  App Shell navigation (hamburger collapse) and the Requester
 *            Ticket Detail with its Public Comments panel and
 *            "appears resolved" marker at 375/768/1280px (feature/lab3-06)
 *
 * For each width this spec:
 *   1. asserts there is no horizontal page overflow (ui-spec.md §9),
 *   2. asserts the correct layout is active — stacked cards below the screen's
 *      breakpoint, the full table at or above it (992px for the nine-column
 *      queue, 768px for the five-column user list), and the hamburger menu
 *      instead of the full nav below 768px,
 *   3. writes a screenshot to the artifacts directory the deliverable names:
 *        artifacts/lab-03/screenshots/staff-queue/
 *        artifacts/lab-03/screenshots/staff-ticket-detail/
 *        artifacts/lab-03/screenshots/user-management/
 *        artifacts/lab-03/screenshots/authentication/
 *        artifacts/lab-03/screenshots/app-shell/
 *        artifacts/lab-03/screenshots/requester-ticket-detail/
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
const AUTH_DIR = path.resolve("artifacts/lab-03/screenshots/authentication");
const SHELL_DIR = path.resolve("artifacts/lab-03/screenshots/app-shell");
const REQUESTER_DETAIL_DIR = path.resolve(
  "artifacts/lab-03/screenshots/requester-ticket-detail",
);

/**
 * Seeded Requester that no other Lab 3 spec signs in as, so it still holds its
 * initial password and the mandatory Change Password gate (BR-02) is on at
 * every width. RESP-04 never submits the form, so the account stays in that
 * documented seed state for later runs.
 */
const FIRST_LOGIN = { email: "michael.brown@example.com", password: "Password123!" };

/**
 * Jennifer Anderson owns both tickets used by RESP-05: TKT-2026-000011 is
 * seeded with `requesterMarkedResolved = true`, and TKT-2026-000006 is OPEN,
 * unmarked, and has two seeded Public Comments.
 */
const REQUESTER = { email: "jennifer.anderson@example.com", password: "Password123!" };
const MARKED_TICKET = "TKT-2026-000011";
const OPEN_TICKET = "TKT-2026-000006";

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
 * Log the RESP-05 Requester in and settle wherever the guard lands.
 *
 * authentication.spec.ts (which runs first) completes this account's mandatory
 * first-login change, so the helper retries with the changed password and then
 * completes the change if the guard still asks for it — the same pattern the
 * other Lab 3 specs use. Running this file on its own against a freshly seeded
 * database also works, because the first attempt then simply succeeds.
 */
async function loginRequester(page: Page) {
  await page.goto("/login");
  await submitLogin(page, REQUESTER.email, REQUESTER.password);

  await Promise.race([
    page
      .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 })
      .catch(() => {}),
    page.getByRole("alert").waitFor({ state: "visible", timeout: 15_000 }).catch(() => {}),
  ]);

  if (page.url().includes("/login")) {
    await submitLogin(page, REQUESTER.email, CHANGED_PASSWORD);
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

/**
 * ui-spec.md §9: nothing may be clipped or pushed past the viewport edge.
 *
 * Stricter than the document-level check above — it walks every rendered element
 * and reports any whose box extends left of 0 or right of the viewport, except
 * for elements inside a container that is *meant* to scroll horizontally (the
 * Queue/User Management table wrappers use `overflow-x: auto`).
 *
 * Zero-size elements (display:none, collapsed skeletons) are skipped.
 */
async function expectNoClipping(page: Page, label: string) {
  const offenders = await page.evaluate(() => {
    const found: string[] = [];

    function insideHorizontalScroller(element: Element): boolean {
      let node = element.parentElement;
      while (node && node !== document.body) {
        const overflowX = window.getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return true;
        node = node.parentElement;
      }
      return false;
    }

    for (const element of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (insideHorizontalScroller(element)) continue;
      if (rect.right > window.innerWidth + 1 || rect.left < -1) {
        found.push(
          `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0] || "-"} ` +
            `[${Math.round(rect.left)}..${Math.round(rect.right)}]`,
        );
      }
    }

    return found;
  });

  expect(
    offenders,
    `${label} clips content outside the ${page.viewportSize()?.width}px viewport: ${offenders.join(", ")}`,
  ).toEqual([]);
}

/**
 * ui-spec.md §9 / handout §8.7: no overlapping content.
 *
 * Compares every visible text-bearing leaf element with every other one and
 * fails if two boxes intersect without one containing the other. Ancestor /
 * descendant pairs are ignored (a card legitimately contains its text), and
 * zero-size or fully transparent elements are skipped.
 *
 * Must only be called with any overlay (mobile menu, dialog) closed, since an
 * intentional overlay does sit on top of the page beneath it.
 */
async function expectNoTextOverlap(page: Page, label: string) {
  const offenders = await page.evaluate(() => {
    interface Leaf {
      path: string;
      top: number;
      left: number;
      right: number;
      bottom: number;
      element: Element;
    }

    const leaves: Leaf[] = [];

    for (const element of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const text = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("")
        .trim();
      if (!text) continue;

      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (window.getComputedStyle(element).visibility === "hidden") continue;

      leaves.push({
        path: `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0] || "-"}`,
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        element,
      });
    }

    const found: string[] = [];
    for (let a = 0; a < leaves.length; a += 1) {
      for (let b = a + 1; b < leaves.length; b += 1) {
        const first = leaves[a];
        const second = leaves[b];
        if (first.element.contains(second.element) || second.element.contains(first.element)) {
          continue;
        }

        const overlapWidth = Math.min(first.right, second.right) - Math.max(first.left, second.left);
        const overlapHeight =
          Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
        if (overlapWidth > 1 && overlapHeight > 1) {
          found.push(
            `${first.path} overlaps ${second.path} by ${Math.round(overlapWidth)}x${Math.round(overlapHeight)}px`,
          );
        }
      }
    }

    // `compared` makes the check self-validating: a zero-element pass would
    // otherwise look identical to "nothing overlaps".
    return { found: found.slice(0, 5), compared: leaves.length };
  });

  expect(
    offenders.compared,
    `${label}: compared only ${offenders.compared} text element(s) — the scan did not cover the screen`,
  ).toBeGreaterThan(4);
  expect(
    offenders.found,
    `${label} has overlapping text: ${offenders.found.join("; ")}`,
  ).toEqual([]);
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
      await expectNoClipping(page, `Queue @ ${viewport.name}px`);
      await expectNoTextOverlap(page, `Queue @ ${viewport.name}px`);

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
      await expectNoClipping(page, `Ticket Detail @ ${viewport.name}px`);
      await expectNoTextOverlap(page, `Ticket Detail @ ${viewport.name}px`);

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
      // The table rows only exist in layout at/above 768px; below that the
      // stacked cards take over (same branch-on-viewport pattern as RESP-01,
      // which uses 992px for the nine-column queue).
      if (viewport.width < 768) {
        await expect(page.getByTestId("user-card").first()).toBeVisible({ timeout: 15_000 });
      } else {
        await expect(page.getByTestId("user-row").first()).toBeVisible({ timeout: 15_000 });
      }
      await page.waitForTimeout(400); // let the list settle

      await expectNoHorizontalOverflow(page, `User Management @ ${viewport.name}px`);
      await expectNoClipping(page, `User Management @ ${viewport.name}px`);
      await expectNoTextOverlap(page, `User Management @ ${viewport.name}px`);

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
      await expectNoClipping(page, `Create User modal @ ${viewport.name}px`);

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

// ─── RESP-04 — Login (idle + failure) and Change Password ───────────────

test.describe("RESP-04 — Login and Change Password responsiveness", () => {
  test.beforeAll(() => {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  });

  for (const viewport of VIEWPORTS) {
    test(`renders Login and Change Password without overflow at ${viewport.name}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      // ─── Login — idle ──────────────────────────────────────────────────
      await page.goto("/login");
      await expect(page.getByRole("button", { name: /log in/i })).toBeVisible();
      await expectNoHorizontalOverflow(page, `Login (idle) @ ${viewport.name}px`);
      await expectNoClipping(page, `Login (idle) @ ${viewport.name}px`);
      await expectNoTextOverlap(page, `Login (idle) @ ${viewport.name}px`);

      // §9: the focused control shows the Zen Green focus token, not the
      // browser default. --focus-ring-color is #0B7A46 → rgb(11, 122, 70).
      // The field transitions its box-shadow over 150ms, so let it settle
      // before reading the computed value (otherwise the transition's start
      // value — a fully transparent 0px shadow — is what gets read).
      await page.locator('input[name="email"]').click();
      await expect(page.locator('input[name="email"]')).toBeFocused();
      await page.waitForTimeout(250);
      const focusRing = await page
        .locator('input[name="email"]')
        .evaluate((element) => window.getComputedStyle(element).boxShadow);
      expect(focusRing, `Login focus ring @ ${viewport.name}px`).toContain(
        "rgb(11, 122, 70)",
      );

      await page.screenshot({
        path: path.join(AUTH_DIR, `login-${viewport.name}.png`),
        fullPage: true,
      });

      // ─── Login — failure (one generic banner, never a raw error) ───────
      await submitLogin(page, FIRST_LOGIN.email, "DefinitelyWrong1");
      await expect(page.getByRole("alert")).toHaveText("Invalid email or password.");
      await expectNoHorizontalOverflow(page, `Login (failure) @ ${viewport.name}px`);
      await expectNoClipping(page, `Login (failure) @ ${viewport.name}px`);
      await expectNoTextOverlap(page, `Login (failure) @ ${viewport.name}px`);

      await page.screenshot({
        path: path.join(AUTH_DIR, `login-failure-${viewport.name}.png`),
        fullPage: true,
      });

      // ─── Change Password — the BR-02 gate ─────────────────────────────
      await page.goto("/login");
      await submitLogin(page, FIRST_LOGIN.email, FIRST_LOGIN.password);
      await expect(page).toHaveURL(/\/change-password$/, { timeout: 15_000 });

      // §3: the complexity hint is always visible, and the screen renders
      // outside the App Shell (no nav) while the gate is on.
      await expect(page.getByTestId("password-hint")).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
      await expectNoHorizontalOverflow(page, `Change Password @ ${viewport.name}px`);
      await expectNoClipping(page, `Change Password @ ${viewport.name}px`);
      await expectNoTextOverlap(page, `Change Password @ ${viewport.name}px`);

      await page.screenshot({
        path: path.join(AUTH_DIR, `change-password-${viewport.name}.png`),
        fullPage: true,
      });
    });
  }
});

// ─── RESP-05 — App Shell navigation + Requester Ticket Detail ───────────

test.describe("RESP-05 — App Shell navigation and Requester Ticket Detail responsiveness", () => {
  test.beforeAll(() => {
    fs.mkdirSync(SHELL_DIR, { recursive: true });
    fs.mkdirSync(REQUESTER_DETAIL_DIR, { recursive: true });
  });

  for (const viewport of VIEWPORTS) {
    test(`renders the App Shell and Requester Ticket Detail without overflow at ${viewport.name}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginRequester(page);

      // ─── App Shell navigation (ui-spec §1, §9) ────────────────────────
      await expect(page).toHaveURL(/\/tickets$/, { timeout: 15_000 });

      const desktopNav = page.getByRole("navigation", { name: "Main navigation" });
      const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
      const hamburger = page.getByRole("button", { name: /(open|close) menu/i });

      if (viewport.width < 768) {
        // Mobile: the full nav collapses into the hamburger, identity and
        // Logout stay reachable, and every destination is role-scoped.
        await expect(hamburger).toBeVisible();
        await expect(desktopNav).toBeHidden();
        await expect(mobileNav).toBeHidden();

        await hamburger.click();
        await expect(hamburger).toHaveAttribute("aria-expanded", "true");
        await expect(mobileNav).toBeVisible();
        await expect(mobileNav.getByRole("link", { name: /my tickets/i })).toBeVisible();
        await expect(mobileNav.getByRole("link", { name: /create ticket/i })).toBeVisible();
        await expect(mobileNav.getByRole("link", { name: /ticket queue/i })).toHaveCount(0);
        await expect(mobileNav.getByRole("link", { name: /user management/i })).toHaveCount(0);

        // The open dropdown must fit the viewport too.
        await expectNoHorizontalOverflow(page, `App Shell (menu open) @ ${viewport.name}px`);
        await expectNoClipping(page, `App Shell (menu open) @ ${viewport.name}px`);
      } else {
        await expect(hamburger).toBeHidden();
        await expect(desktopNav).toBeVisible();
        await expect(desktopNav.getByRole("link", { name: /my tickets/i })).toBeVisible();
        await expect(desktopNav.getByRole("link", { name: /create ticket/i })).toBeVisible();
        await expect(desktopNav.getByRole("link", { name: /ticket queue/i })).toHaveCount(0);
        await expect(desktopNav.getByRole("link", { name: /user management/i })).toHaveCount(0);
      }

      await expectNoHorizontalOverflow(page, `App Shell @ ${viewport.name}px`);
      await expectNoClipping(page, `App Shell @ ${viewport.name}px`);
      await page.screenshot({
        path: path.join(SHELL_DIR, `app-shell-${viewport.name}.png`),
        fullPage: true,
      });

      // The open mobile menu overlays the content below it — close it before
      // the overlap check and before navigating, so the next screenshots show
      // the page, not the menu.
      if (viewport.width < 768) {
        await hamburger.click();
        await expect(mobileNav).toBeHidden();
      }

      await expectNoTextOverlap(page, `App Shell @ ${viewport.name}px`);

      // ─── Ticket Detail: the "appears resolved" marker ────────────────
      await page.goto(`/tickets/${MARKED_TICKET}`);
      await expect(page.getByLabel("Ticket No.")).toHaveValue(MARKED_TICKET);
      await expect(page.getByTestId("requester-resolved-badge")).toContainText(
        /You marked this as resolved on/i,
      );
      await expect(page.getByTestId("public-comments-panel")).toBeVisible();
      // BR-05/BR-20: the marker is a distinct element from the formal Status
      // badge, which still shows the real ticket status.
      await expect(page.getByText("Resolved", { exact: true })).toBeVisible();

      await expectNoHorizontalOverflow(
        page,
        `Requester Ticket Detail (marker) @ ${viewport.name}px`,
      );
      await expectNoClipping(page, `Requester Ticket Detail (marker) @ ${viewport.name}px`);
      await expectNoTextOverlap(page, `Requester Ticket Detail (marker) @ ${viewport.name}px`);
      await page.screenshot({
        path: path.join(REQUESTER_DETAIL_DIR, `requester-ticket-detail-${viewport.name}.png`),
        fullPage: true,
      });

      // ─── Ticket Detail: Public Comments + the resolve action ──────────
      await page.goto(`/tickets/${OPEN_TICKET}`);
      await expect(page.getByLabel("Ticket No.")).toHaveValue(OPEN_TICKET);
      await expect(page.getByTestId("comment-item").first()).toBeVisible();
      await expect(
        page.getByRole("button", { name: /problem appears resolved/i }),
      ).toBeVisible();

      await expectNoHorizontalOverflow(
        page,
        `Requester Ticket Detail (comments) @ ${viewport.name}px`,
      );
      await expectNoClipping(page, `Requester Ticket Detail (comments) @ ${viewport.name}px`);
      await expectNoTextOverlap(page, `Requester Ticket Detail (comments) @ ${viewport.name}px`);
      await page.screenshot({
        path: path.join(REQUESTER_DETAIL_DIR, `requester-resolve-mark-${viewport.name}.png`),
        fullPage: true,
      });
    });
  }
});
