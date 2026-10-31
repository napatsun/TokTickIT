import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";

/**
 * Lab 4 Automated Accessibility & Palette Scan (ui-spec.md §1, §8)
 *
 * Scans all 7 major screens across Desktop (1440x900), Tablet (820x1180),
 * and Mobile (390x844) with @axe-core/playwright (WCAG 2.1 A/AA tags),
 * verifies zero serious/critical violations, verifies no horizontal overflow,
 * verifies computed colour palette tokens, and writes raw axe output to
 * docs/lab-04/axe-report.json.
 */

const STAFF = { email: "alice.chen@toktickit.example.com", password: "Password123!" };
const REQUESTER = { email: "jennifer.anderson@example.com", password: "Password123!" };
const CHANGED_PASSWORD = "E2eChanged123";
const TICKET_NUMBER = "TKT-2026-000009";
const REQUESTER_TICKET_NUMBER = "TKT-2026-000007";

const VIEWPORTS = [
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "tablet-820x1180", width: 820, height: 1180 },
  { name: "mobile-390x844", width: 390, height: 844 },
] as const;

interface AxeScreenReport {
  screen: string;
  viewport: string;
  url: string;
  passesCount: number;
  incompleteCount: number;
  violations: Array<{
    id: string;
    impact?: string | null;
    description: string;
    helpUrl: string;
    nodes: number;
  }>;
}

const scanResults: AxeScreenReport[] = [];

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

async function runAxeAndOverflowCheck(page: Page, screenName: string, viewportName: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `${screenName} (${viewportName}) must not overflow horizontally`,
  ).toBeLessThanOrEqual(clientWidth + 1);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  scanResults.push({
    screen: screenName,
    viewport: viewportName,
    url: page.url(),
    passesCount: results.passes.length,
    incompleteCount: results.incomplete.length,
    violations: results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      helpUrl: v.helpUrl,
      nodes: v.nodes.length,
    })),
  });

  const seriousOrCritical = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    seriousOrCritical,
    `Serious/critical axe violations on ${screenName} (${viewportName}): ${JSON.stringify(
      seriousOrCritical,
      null,
      2,
    )}`,
  ).toEqual([]);
}

test.describe("A11Y-AXE — WCAG 2.1 A/AA axe scan across 7 screens × 3 viewports (ui-spec §1, §8)", () => {
  test.afterAll(() => {
    const outPath = path.resolve(process.cwd(), "docs", "lab-04", "axe-report.json");
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          tool: "@axe-core/playwright",
          tags: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
          totalScans: scanResults.length,
          totalViolations: scanResults.reduce((acc, s) => acc + s.violations.length, 0),
          scans: scanResults,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  });

  test("scans Login, Staff Dashboard, Actions Taken list/form, Ticket Detail, Requester Dashboard, and My Tickets at 3 viewports", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // ─── 1. Login screen (3 viewports) ──────────────────────────────────
    await page.context().clearCookies();
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /log in/i })).toBeVisible();
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await runAxeAndOverflowCheck(page, "Login", vp.name);
    }

    // ─── 2. IT Staff Dashboard + Palette Verification (3 viewports) ─────
    await login(page, STAFF);
    await page.goto("/dashboard");
    await expect(page.getByTestId("staff-dashboard")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("metric-cards")).toBeVisible({ timeout: 15_000 });

    // Verify authoritative computed palette on Staff Dashboard
    const computedColors = await page.evaluate(() => {
      const header = document.querySelector("header");
      const rootStyle = getComputedStyle(document.documentElement);
      return {
        bodyBg: getComputedStyle(document.body).backgroundColor,
        headerBg: header ? getComputedStyle(header).backgroundColor : null,
        tokenPrimary: rootStyle.getPropertyValue("--color-primary-green").trim(),
        tokenSecondary: rootStyle.getPropertyValue("--color-secondary-green").trim(),
        tokenPale: rootStyle.getPropertyValue("--color-pale-green").trim(),
        tokenBgPage: rootStyle.getPropertyValue("--color-bg-page").trim(),
      };
    });
    expect(computedColors.bodyBg).toBe("rgb(245, 247, 246)"); // #F5F7F6
    expect(computedColors.headerBg).toBe("rgb(0, 107, 60)"); // #006B3C
    expect(computedColors.tokenPrimary.toUpperCase()).toBe("#006B3C");
    expect(computedColors.tokenSecondary.toUpperCase()).toBe("#0B7A46");
    expect(computedColors.tokenPale.toUpperCase()).toBe("#EAF6EF");
    expect(computedColors.tokenBgPage.toUpperCase()).toBe("#F5F7F6");

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await runAxeAndOverflowCheck(page, "IT Staff Dashboard", vp.name);
    }

    // ─── 3 & 4 & 5. Staff Ticket Detail + Actions Taken list + create/edit form ──
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/staff/queue");
    await page.getByLabel(/search by ticket number or summary/i).fill(TICKET_NUMBER);
    const row = page.getByTestId("queue-row").filter({ hasText: TICKET_NUMBER });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row
      .getByRole("button", { name: new RegExp(`Open ticket ${TICKET_NUMBER}`, "i") })
      .click();
    await expect(page).toHaveURL(/\/staff\/tickets\/\d+$/);
    const panel = page.getByTestId("actions-taken-panel");
    await expect(panel).toBeVisible();

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await runAxeAndOverflowCheck(page, "Ticket Detail & Actions Taken List (Staff)", vp.name);
    }

    // Open Actions Taken create form and scan at all 3 viewports
    await panel.getByTestId("add-action-button").click();
    await expect(page.getByTestId("actions-taken-form")).toBeVisible();
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await runAxeAndOverflowCheck(page, "Actions Taken Create/Edit Form", vp.name);
    }

    // ─── 6 & 7. Requester Dashboard, My Tickets, and Requester Ticket Detail ──
    await page.context().clearCookies();
    await login(page, REQUESTER);

    await page.goto("/dashboard");
    await expect(page.getByTestId("requester-dashboard")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("attention-required-section")).toBeVisible({ timeout: 15_000 });
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await runAxeAndOverflowCheck(page, "Requester Dashboard", vp.name);
    }

    await page.goto("/tickets");
    await expect(page.getByRole("heading", { name: /my tickets/i })).toBeVisible({ timeout: 15_000 });
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await runAxeAndOverflowCheck(page, "My Tickets", vp.name);
    }

    await page.goto(`/tickets/${REQUESTER_TICKET_NUMBER}`);
    await expect(page.getByTestId("actions-taken-panel")).toBeVisible({ timeout: 15_000 });
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await runAxeAndOverflowCheck(page, "Ticket Detail (Requester)", vp.name);
    }
  });
});
