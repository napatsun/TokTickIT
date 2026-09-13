import { test, expect, type Page } from "@playwright/test";

/**
 * Lab 3 end-to-end authentication (tests.md §1 and §2)
 *
 *   E2E-01  full login flow — busy state, valid login, invalid login banner
 *   E2E-02  initial-password login → forced Change Password → normal app
 *   E2E-03  role-based navigation for all three roles (+ forbidden deep link)
 *
 * Credentials are the documented LOCAL DEV seed values (README → "Seed
 * Credentials (local dev only)"). Playwright's globalSetup re-seeds the
 * database before the run.
 */

const ADMIN = { email: "admin@toktickit.example.com", password: "Admin123!" };
const REQUESTER = { email: "jennifer.anderson@example.com", password: "Password123!" };
const REQUESTER_2 = { email: "david.lee@example.com", password: "Password123!" };
const IT_STAFF = { email: "ben.carter@toktickit.example.com", password: "Password123!" };

const NEW_PASSWORD = "E2eChanged123";

function mainNav(page: Page) {
  return page.getByRole("navigation", { name: "Main navigation" });
}

async function submitLogin(page: Page, email: string, password: string) {
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
}

/**
 * Log in and settle wherever the role guard lands: either straight on the role
 * home screen, or on /change-password when the account still holds an initial
 * password (BR-02). In the latter case the mandatory change is completed.
 */
async function loginAndSettle(page: Page, credentials: { email: string; password: string }) {
  await submitLogin(page, credentials.email, credentials.password);

  // The SPA spends a moment on /login while the session is established.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });

  if (page.url().includes("/change-password")) {
    await page.locator('input[name="newPassword"]').fill(NEW_PASSWORD);
    await page.locator('input[name="confirmPassword"]').fill(NEW_PASSWORD);
    await page.getByRole("button", { name: /save and continue/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/change-password"), { timeout: 15_000 });
  }
}

// ─── E2E-01 ─────────────────────────────────────────────────────────────

test.describe("E2E-01 — full login flow", () => {
  test("shows the busy state, then lands the Administrator in the app", async ({ page }) => {
    // Delay the login response so the busy state is observable.
    await page.route("**/api/auth/login", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });

    await page.goto("/login");
    await submitLogin(page, ADMIN.email, ADMIN.password);

    await expect(page.getByRole("button", { name: /logging in/i })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/users$/, { timeout: 15_000 });
  });

  test("shows one generic banner for invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await submitLogin(page, ADMIN.email, "DefinitelyWrong1");

    await expect(page.getByRole("alert")).toHaveText("Invalid email or password.");
    // Still on the Login screen — no session was established.
    await expect(page).toHaveURL(/\/login$/);
  });
});

// ─── E2E-02 ─────────────────────────────────────────────────────────────

test.describe("E2E-02 — mandatory first-login password change", () => {
  test("forces the Change Password screen before the app is reachable", async ({ page }) => {
    // Unauthenticated deep link to a protected route → Login.
    await page.goto("/change-password");
    await expect(page).toHaveURL(/\/login$/);

    // Initial-password login redirects straight to Change Password.
    await submitLogin(page, REQUESTER.email, REQUESTER.password);
    await expect(page).toHaveURL(/\/change-password$/);

    // Every other authenticated route bounces back here.
    await page.goto("/tickets");
    await expect(page).toHaveURL(/\/change-password$/);

    // The complexity hint is always visible.
    await expect(page.getByText(/at least one letter and one number/i)).toBeVisible();

    // Save a valid new password → the app opens.
    await page.locator('input[name="newPassword"]').fill(NEW_PASSWORD);
    await page.locator('input[name="confirmPassword"]').fill(NEW_PASSWORD);
    await page.getByRole("button", { name: /save and continue/i }).click();

    await expect(page).toHaveURL(/\/tickets$/, { timeout: 15_000 });
    await expect(mainNav(page).getByRole("link", { name: /my tickets/i })).toBeVisible();

    // …and the gate is gone for this session.
    await page.goto("/tickets/new");
    await expect(page).toHaveURL(/\/tickets\/new$/);
  });
});

// ─── E2E-03 ─────────────────────────────────────────────────────────────

test.describe("E2E-03 — role-based navigation", () => {
  test("Administrator only sees User Management", async ({ page }) => {
    await page.goto("/login");
    await loginAndSettle(page, ADMIN);

    const nav = mainNav(page);
    await expect(nav.getByRole("link", { name: /user management/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /ticket queue/i })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /my tickets/i })).toHaveCount(0);
    await expect(page.getByTestId("shell-role-badge").first()).toHaveText(/administrator/i);
  });

  test("IT Staff only sees Ticket Queue and cannot open Requester routes", async ({ page }) => {
    await page.goto("/login");
    await loginAndSettle(page, IT_STAFF);

    const nav = mainNav(page);
    await expect(nav.getByRole("link", { name: /ticket queue/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /my tickets/i })).toHaveCount(0);
    await expect(page.getByTestId("shell-role-badge").first()).toHaveText(/it staff/i);

    // Direct URL to a forbidden destination redirects to the role home.
    await page.goto("/tickets");
    await expect(page).toHaveURL(/\/staff\/queue$/, { timeout: 15_000 });
  });

  test("Requester only sees Requester navigation and cannot open the Admin route", async ({ page }) => {
    await page.goto("/login");
    await loginAndSettle(page, REQUESTER_2);

    const nav = mainNav(page);
    await expect(nav.getByRole("link", { name: /my tickets/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /create ticket/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /user management/i })).toHaveCount(0);
    await expect(page.getByTestId("shell-role-badge").first()).toHaveText(/requester/i);

    // Direct URL to a forbidden destination redirects to the role home.
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/tickets$/, { timeout: 15_000 });
  });

  test("no Development Requester selector remains in the shell (MIG-02)", async ({ page }) => {
    await page.goto("/login");
    await loginAndSettle(page, ADMIN);

    await expect(page.getByText(/change requester/i)).toHaveCount(0);
    await expect(page.getByText(/select requester/i)).toHaveCount(0);
  });
});
