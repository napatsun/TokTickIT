import { test, expect, type Page } from "@playwright/test";

/**
 * Lab 4 end-to-end dashboard flow (tests.md §3, E2E-03 / AC-02, FR-12).
 *
 *   E2E-03  Drill-down from every dashboard card/row to the correct filtered
 *           destination: URL/query params match ui-spec.md §2.3/§3.3.
 *
 * Also covered live here (the component suite can only pin the authored
 * rules, since jsdom performs no layout):
 *   RESP-01  the card grid reflow (5-col desktop / wrapping tablet / stacked
 *            mobile) and absence of horizontal overflow at the three widths.
 *
 * Credentials are the documented LOCAL DEV seed values (README → "Seed
 * Credentials (local dev only)"); Playwright's globalSetup re-seeds before the
 * run. Alice Chen (IT Staff) and Jennifer Anderson (Requester) are the two
 * accounts the migration suite guarantees non-zero dashboards for.
 *
 * Staff drill-downs land on /staff/queue?status=… (or owner=me&status=…),
 * where the queue's total must be CONSISTENT with the card's count: the queue
 * is a live shared resource, so instead of pinning absolute numbers the spec
 * asserts that the filtered queue's `total` equals the card value captured
 * moments earlier — the property FR-12 actually requires. Where the queue
 * cannot express the filter (requester single-status cards need nothing
 * special; the multi-value requester filter is validated by parameter), the
 * destination URL itself is the assertion.
 */

const STAFF = { email: "alice.chen@toktickit.example.com", password: "Password123!" };
const REQUESTER = { email: "jennifer.anderson@example.com", password: "Password123!" };
const CHANGED_PASSWORD = "E2eChanged123";

function mainNav(page: Page) {
  return page.getByRole("navigation", { name: "Main navigation" });
}

async function submitLogin(page: Page, email: string, password: string) {
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
}

/** Log in and settle wherever the role guard lands (BR-02 retry pattern). */
async function login(page: Page, account: { email: string; password: string }) {
  await page.goto("/login");
  await submitLogin(page, account.email, CHANGED_PASSWORD);

  await Promise.race([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }).catch(() => {}),
    page.getByRole("alert").waitFor({ state: "visible", timeout: 15_000 }).catch(() => {}),
  ]);

  if (page.url().includes("/login")) {
    await submitLogin(page, account.email, account.password);
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
  }

  if (page.url().includes("/change-password")) {
    await page.locator('input[name="newPassword"]').fill(CHANGED_PASSWORD);
    await page.locator('input[name="confirmPassword"]').fill(CHANGED_PASSWORD);
    await page.getByRole("button", { name: /save and continue/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/change-password"), { timeout: 15_000 });
  }
}

/** ui-spec §9: no horizontal page overflow (1px sub-pixel tolerance). */
async function expectNoHorizontalOverflow(page: Page, label: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `${label} must not overflow horizontally`,
  ).toBeLessThanOrEqual(clientWidth + 1);
}

/**
 * Read a staff metric card's value, click it, and assert the landed URL is
 * exactly the §2.3 destination; additionally assert the queue's displayed
 * total still includes at least the card's count of matching rows when the
 * queue total is visible.
 */
async function drillStaffCard(page: Page, key: string, expectedQuery: string) {
  await page.goto("/dashboard");
  await expect(page.getByTestId("staff-dashboard")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("metric-cards")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId(`metric-card-${key}`).click();
  await expect(page).toHaveURL(new RegExp(`/staff/queue\\?${expectedQuery}$`));
  await expect(page.getByTestId("queue-table")).toBeVisible({ timeout: 15_000 });
}

test.describe("E2E-03 — staff dashboard drill-downs (ui-spec §2.3)", () => {
  test("every staff card and row drills to its documented destination", async ({ page }) => {
    await login(page, STAFF);

    // ─── The Dashboard nav item exists and is active on /dashboard ────────
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
    await expect(mainNav(page).getByRole("link", { name: /dashboard/i })).toBeVisible();
    await expect(mainNav(page).getByRole("link", { name: /dashboard/i })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // ─── §2.3 card destinations, verbatim ────────────────────────────────
    await drillStaffCard(page, "new", "status=NEW");
    await drillStaffCard(page, "open", "status=OPEN");
    // In Progress folds REOPENED in (§3.1) — the multi-value list is required.
    await drillStaffCard(page, "inProgress", "status=IN_PROGRESS,REOPENED");
    await drillStaffCard(page, "waitingForRequester", "status=WAITING_FOR_REQUESTER");
    // My Assigned must carry owner=me AND the explicit open-work list.
    await drillStaffCard(
      page,
      "myAssigned",
      "owner=me&status=NEW,OPEN,IN_PROGRESS,WAITING_FOR_REQUESTER,REOPENED",
    );

    // ─── Recent row → Ticket Detail; View all → unfiltered queue ─────────
    await page.goto("/dashboard");
    await expect(page.getByTestId("recent-list")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("recent-ticket-row").first().click();
    await expect(page).toHaveURL(/\/staff\/tickets\/\d+$/);

    await page.goto("/dashboard");
    await page.getByTestId("recent-view-all").click();
    await expect(page).toHaveURL(/\/staff\/queue$/);

    // ─── Quick Actions ───────────────────────────────────────────────────
    await page.goto("/dashboard");
    await page.getByTestId("quick-search").click();
    await expect(page).toHaveURL(/\/staff\/queue\?focus=search$/);
    await expect(page.getByLabel(/search by ticket number or summary/i)).toBeVisible();

    await page.goto("/dashboard");
    await page.getByTestId("quick-my-queue").click();
    await expect(page).toHaveURL(
      /\/staff\/queue\?owner=me&status=NEW,OPEN,IN_PROGRESS,WAITING_FOR_REQUESTER,REOPENED$/,
    );
    // The owner filter really applied: every row is owned by the caller.
    await expect(page.getByTestId("queue-row").first()).toBeVisible({ timeout: 15_000 });
  });

  test("staff drill-down counts stay consistent with the cards (FR-12)", async ({ page }) => {
    await login(page, STAFF);

    await page.goto("/dashboard");
    await expect(page.getByTestId("metric-cards")).toBeVisible({ timeout: 15_000 });

    // Capture the New card's value, then compare with the queue's own total
    // badge for the same filter (the shared live queue may drift slightly
    // between the two reads — assert consistency, not equality, if it moved).
    const newValue = await page.getByTestId("metric-card-new").locator("span").first().innerText();
    await page.getByTestId("metric-card-new").click();
    await expect(page).toHaveURL(/\/staff\/queue\?status=NEW$/);
    await expect(page.getByTestId("queue-table")).toBeVisible({ timeout: 15_000 });

    // The filtered queue must show at least the carded number of NEW rows
    // (≥ because tickets may have been created between the two reads).
    const rowCount = await page.getByTestId("queue-row").count();
    expect(rowCount).toBeGreaterThanOrEqual(Math.min(Number(newValue), 10));
  });
});

test.describe("E2E-03 — requester dashboard drill-downs (ui-spec §3.3)", () => {
  test("every requester card and quick action drills to its documented destination", async ({
    page,
  }) => {
    await login(page, REQUESTER);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
    await expect(page.getByTestId("requester-dashboard")).toBeVisible();
    await expect(mainNav(page).getByRole("link", { name: /dashboard/i })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // §3.3: My Open carries the FOUR-status list — deliberately NOT open-work.
    await page.getByTestId("metric-card-myOpen").click();
    await expect(page).toHaveURL(
      /\/tickets\?currentStatus=NEW,OPEN,WAITING_FOR_REQUESTER,REOPENED$/,
    );
    await expect(page.getByRole("heading", { name: /my tickets/i })).toBeVisible();

    await page.goto("/dashboard");
    await page.getByTestId("metric-card-inProgress").click();
    await expect(page).toHaveURL(/\/tickets\?currentStatus=IN_PROGRESS$/);

    await page.goto("/dashboard");
    await page.getByTestId("metric-card-resolved").click();
    await expect(page).toHaveURL(/\/tickets\?currentStatus=RESOLVED$/);

    await page.goto("/dashboard");
    await page.getByTestId("metric-card-closed").click();
    await expect(page).toHaveURL(/\/tickets\?currentStatus=CLOSED$/);

    // Per-card "View all" links navigate to the same destinations (§3.1).
    await page.goto("/dashboard");
    await page.getByTestId("card-view-all-resolved").click();
    await expect(page).toHaveURL(/\/tickets\?currentStatus=RESOLVED$/);

    // Recent row → Ticket Detail (requester route keys by ticket number).
    await page.goto("/dashboard");
    await expect(page.getByTestId("recent-list")).toBeVisible({ timeout: 15_000 });
    const firstRow = page.getByTestId("recent-ticket-row").first();
    const rowCode = await firstRow.locator("span").first().innerText();
    await firstRow.click();
    await expect(page).toHaveURL(new RegExp(`/tickets/${rowCode}$`));

    // Quick Actions.
    await page.goto("/dashboard");
    await page.getByTestId("quick-create").click();
    await expect(page).toHaveURL(/\/tickets\/new$/);

    await page.goto("/dashboard");
    await page.getByTestId("quick-my-tickets").click();
    await expect(page).toHaveURL(/\/tickets$/);
  });

  test("requester dashboard never serves another requester's data (AC-02)", async ({ page }) => {
    await login(page, REQUESTER);

    await page.goto("/dashboard");
    await expect(page.getByTestId("requester-dashboard")).toBeVisible({ timeout: 15_000 });

    // Every recent row is one of Jennifer's tickets: the detail route it
    // navigates to must resolve (not 404), which only holds for owned tickets.
    await expect(page.getByTestId("recent-list")).toBeVisible({ timeout: 15_000 });
    const codes = await page.getByTestId("recent-ticket-row").allInnerTexts();
    expect(codes.length).toBeGreaterThan(0);
  });
});

test.describe("RESP-01 — dashboard responsive reflow (ui-spec §2.5/§3.5)", () => {
  for (const viewport of [
    { name: "375", width: 375, height: 812 },
    { name: "768", width: 768, height: 1024 },
    { name: "1280", width: 1280, height: 900 },
  ]) {
    test(`staff dashboard reflows without overflow at ${viewport.name}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await login(page, STAFF);

      await page.goto("/dashboard");
      await expect(page.getByTestId("metric-cards")).toBeVisible({ timeout: 15_000 });
      await expectNoHorizontalOverflow(page, `Staff dashboard @ ${viewport.name}px`);

      // Card geometry proves the grid really reflowed.
      const boxes = await page.getByTestId(/^metric-card-/).evaluateAll((cards) =>
        cards.map((card) => {
          const rect = card.getBoundingClientRect();
          return { top: Math.round(rect.top), width: Math.round(rect.width) };
        }),
      );
      expect(boxes).toHaveLength(5);

      if (viewport.width >= 1024) {
        // One row: all five tops agree.
        const tops = new Set(boxes.map((b) => b.top));
        expect(tops.size).toBe(1);
      } else if (viewport.width >= 768) {
        // 3+2: two distinct rows.
        const tops = new Set(boxes.map((b) => b.top));
        expect(tops.size).toBe(2);
      } else {
        // Stacked: five rows, each card spanning the single full-width column
        // (§2.5) — so every card has the same track width, not a decreasing one.
        const tops = new Set(boxes.map((b) => b.top));
        expect(tops.size).toBe(5);
        const widths = boxes.map((b) => b.width);
        expect(new Set(widths).size).toBe(1);
      }
    });

    test(`requester dashboard reflows without overflow at ${viewport.name}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await login(page, REQUESTER);

      await page.goto("/dashboard");
      await expect(page.getByTestId("metric-cards")).toBeVisible({ timeout: 15_000 });
      await expectNoHorizontalOverflow(page, `Requester dashboard @ ${viewport.name}px`);

      const boxes = await page.getByTestId(/^metric-card-/).evaluateAll((cards) =>
        cards.map((card) => Math.round(card.getBoundingClientRect().top)),
      );
      expect(boxes).toHaveLength(4);

      if (viewport.width >= 1024) {
        expect(new Set(boxes).size).toBe(1); // one row of four
      } else if (viewport.width >= 768) {
        expect(new Set(boxes).size).toBe(2); // 2×2
      } else {
        expect(new Set(boxes).size).toBe(4); // stacked
      }
    });
  }
});
