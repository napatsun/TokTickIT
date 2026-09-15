import { test, expect, type Page } from "@playwright/test";

/**
 * E2E-06 — Administrator User Management (ui-spec.md §7, api-spec.md §4)
 *
 * Full flow: log in as Administrator → search / filter → create a user → edit
 * that user → reset their initial password → attempt self-deactivation, which
 * is blocked. Then, once the extra Administrator has been deactivated, the
 * last-active-Administrator guard is checked too, because at that point the
 * signed-in account is genuinely the only active Administrator left.
 *
 * Ordering matters and is deliberate:
 *   1..5  create/edit/reset need a SECOND active Administrator to exist so the
 *         guard rules do not interfere with ordinary edits;
 *   6     with two active Administrators, editing yourself exposes the
 *         self-deactivation rule specifically;
 *   7     deactivating the second Administrator restores the seeded state;
 *   8     with one active Administrator, the last-administrator rule is what
 *         blocks editing that account.
 *
 * Credentials are the documented LOCAL DEV seed values (README → "Seed
 * Credentials"); Playwright's globalSetup re-seeds before every run. The
 * created account uses a per-run unique email so repeated runs stay independent
 * (there is no delete endpoint by design — deactivation is the supported
 * removal path).
 */

const ADMIN = { email: "admin@toktickit.example.com", password: "Admin123!" };

const RUN_ID = Date.now();
const E2E_USER = {
  name: `E2E User ${RUN_ID}`,
  email: `e2e.user.${RUN_ID}@toktickit.example.com`,
  renamedTo: `E2E User Renamed ${RUN_ID}`,
  resetPassword: "E2eReset123!",
};

async function loginAdministrator(page: Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(ADMIN.email);
  await page.locator('input[name="password"]').fill(ADMIN.password);    await page.getByRole("button", { name: /log in/i }).click();

  // The seeded Administrator is NOT flagged for a password change, so this
  // lands straight on their role home (roleHome("ADMINISTRATOR") === /admin/users).
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

/** Wait for the list to be loaded and select a row by its email text. */
async function rowFor(page: Page, email: string) {
  await expect(page.getByTestId("users-table")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(email).first()).toBeVisible({ timeout: 15_000 });
  return page.getByTestId("user-row").filter({ hasText: email }).first();
}

/**
 * Clear both list filters so every user is visible again.
 *
 * There are two "Clear filters" buttons — the toolbar one and the one inside
 * the no-results state — so this targets the toolbar (`.first()`). The search
 * box is asserted empty afterwards: the search input is debounced, so a click
 * that lands mid-debounce would otherwise be silently undone by the pending
 * timer, and every later assertion would be made against a stale list.
 */
async function clearFilters(page: Page) {
  const clear = page.getByRole("button", { name: "Clear filters" }).first();
  if (!(await clear.isEnabled())) return;
  await clear.click();
  await expect(page.getByLabel(/search by name or email/i)).toHaveValue("");
  // The search box is debounced (300ms). Wait out that window and re-assert, so
  // a stale timer that re-applies the cleared term fails here, with a message
  // that says what happened, instead of surfacing later as a mystery timeout.
  await page.waitForTimeout(450);
  await expect(page.getByLabel(/search by name or email/i)).toHaveValue("");
}

/**
 * Reduce the system to a single active Administrator: the signed-in account.
 *
 * The last-Administrator guard is global by definition, so it cannot be
 * asserted without controlling how many active Administrators exist. A run that
 * fails part-way through leaves its created account behind (there is no delete
 * endpoint by design), so this drains whatever is there rather than assuming a
 * pristine database — which also makes the spec safe to re-run.
 */
async function deactivateOtherAdministrators(page: Page, selfEmail: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await clearFilters(page);
    await page.getByLabel("Filter by role").selectOption("ADMINISTRATOR");
    await expect(page.getByTestId("users-table")).toBeVisible({ timeout: 15_000 });
    // Never inspect the list mid-load: the table is replaced by the skeleton
    // while a request is in flight, which would look like "no rows".
    await expect(page.getByTestId("users-skeleton-row")).toHaveCount(0);

    const rows = page.getByTestId("user-row");
    const total = await rows.count();
    let target: ReturnType<typeof rows.nth> | null = null;

    for (let index = 0; index < total; index += 1) {
      const row = rows.nth(index);
      const text = (await row.textContent()) ?? "";
      if (text.includes(selfEmail)) continue;
      // `exact: true` matters: a substring match for "Active" also matches the
      // "Inactive" badge, which would make this click a SAVE on an unchanged
      // form (disabled button → guaranteed timeout).
      const activeBadges = await row.getByText("Active", { exact: true }).count();
      if (activeBadges === 0) continue;
      target = row;
      break;
    }

    if (!target) return;

    await target.getByRole("button", { name: /^Edit / }).click();
    const dialog = page.getByTestId("edit-user-dialog");
    const toggle = dialog.getByRole("checkbox", { name: "Active" });
    // Only a non-last, non-self Administrator can be deactivated from the UI.
    await expect(toggle).toBeEnabled();
    await toggle.uncheck();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByTestId("users-toast")).toContainText("User updated.");
    await expect(dialog).toBeHidden();
  }

  throw new Error("could not reduce the system to a single active Administrator");
}

test.describe("E2E-06 — Administrator User Management", () => {
  test("search, filter, create, edit, reset password, and the two guard rules", async ({
    page,
  }) => {
    await loginAdministrator(page);

    // ─── 1. Landing + list ──────────────────────────────────────────────
    await expect(page).toHaveURL(/\/admin\/users$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
    await expect(page.getByTestId("users-table")).toBeVisible({ timeout: 15_000 });

    // Seeded staff member is listed with a role badge and an Active state.
    const aliceRow = await rowFor(page, "alice.chen@toktickit.example.com");
    await expect(aliceRow.getByText("IT Staff", { exact: true })).toBeVisible();
    await expect(aliceRow.getByText("Active", { exact: true })).toBeVisible();

    // ─── 2. Search ──────────────────────────────────────────────────────
    await page.getByLabel(/search by name or email/i).fill("alice.chen");
    await expect(page.getByTestId("user-row")).toHaveCount(1, { timeout: 10_000 });
    await expect(page.getByTestId("user-row").first()).toContainText("Alice Chen");

    // Search by name too.
    await page.getByLabel(/search by name or email/i).fill("Robert");
    await expect(page.getByTestId("user-row").first()).toContainText("Robert Wilson");

    // A search that matches nobody is a "no results" state, not an error.
    await page.getByLabel(/search by name or email/i).fill("zzz-no-such-user");
    await expect(page.getByTestId("users-empty")).toContainText("No users match your search/filters.");
    await clearFilters(page);

    // ─── 3. Role filter ─────────────────────────────────────────────────
    // Scoped to the table on purpose: the shell header also renders the
    // signed-in Administrator's name, so an unscoped text query is ambiguous.
    await page.getByLabel("Filter by role").selectOption("ADMINISTRATOR");
    await expect(
      page.getByTestId("users-table").getByText("System Administrator"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("user-row").filter({ hasText: "Alice Chen" })).toHaveCount(0);
    await clearFilters(page);

    // ─── 4. Create a user ───────────────────────────────────────────────
    await page.getByTestId("create-user-button").click();
    const createDialog = page.getByTestId("create-user-dialog");
    await expect(createDialog.getByRole("heading", { name: "Create User" })).toBeVisible();

    await createDialog.getByLabel(/^Name/).fill(E2E_USER.name);
    await createDialog.getByLabel(/^Email/).fill(E2E_USER.email);
    // A second ACTIVE Administrator is required for the guard sequencing below.
    await createDialog.getByLabel(/^Role/).selectOption("ADMINISTRATOR");
    await createDialog.getByLabel(/Initial Password/).fill("InitialPass1!");
    await expect(createDialog.getByText("User must change this password at first login")).toBeVisible();

    await createDialog.getByRole("button", { name: "Create User" }).click();

    await expect(page.getByTestId("users-toast")).toContainText("User created.");
    await expect(createDialog).toBeHidden();

    await page.getByLabel(/search by name or email/i).fill(E2E_USER.email);
    const createdRow = await rowFor(page, E2E_USER.email);
    await expect(createdRow.getByText("Administrator", { exact: true })).toBeVisible();
    await expect(createdRow.getByText("Active", { exact: true })).toBeVisible();

    // ─── 5. Edit that user ──────────────────────────────────────────────
    await createdRow.getByRole("button", { name: /^Edit / }).click();
    const editDialog = page.getByTestId("edit-user-dialog");
    await expect(editDialog.getByLabel(/^Name/)).toHaveValue(E2E_USER.name);

    await editDialog.getByLabel(/^Name/).fill(E2E_USER.renamedTo);
    await editDialog.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByTestId("users-toast")).toContainText("User updated.");
    await expect(editDialog).toBeHidden();
    await expect(await rowFor(page, E2E_USER.email)).toContainText(E2E_USER.renamedTo);

    // ─── 6. Reset that user's initial password ──────────────────────────
    const renamedRow = await rowFor(page, E2E_USER.email);
    await renamedRow.getByRole("button", { name: /^Edit / }).click();

    const resetDialog = page.getByTestId("edit-user-dialog");
    await resetDialog.getByLabel(/^New initial password/).fill(E2E_USER.resetPassword);
    await resetDialog.getByTestId("reset-password-button").click();

    const confirm = page.getByTestId("reset-password-confirm");
    await expect(confirm).toContainText(
      `This resets ${E2E_USER.renamedTo}'s password. They will need to set a new one at next login. Continue?`,
    );
    await confirm.getByRole("button", { name: "Reset password" }).click();

    await expect(page.getByTestId("users-toast")).toContainText(
      `Password reset for ${E2E_USER.renamedTo}.`,
    );
    await page.keyboard.press("Escape"); // close the edit dialog
    await expect(page.getByTestId("edit-user-dialog")).toBeHidden();

    // ─── 7. Self-deactivation is blocked ────────────────────────────────
    await clearFilters(page);
    const selfRow = await rowFor(page, ADMIN.email);
    const dump = async (tag: string) => {
      const events = (await page.evaluate(() => (window as any).__si ?? [])) as Array<unknown[]>;
      console.log(
        tag,
        JSON.stringify(
          events.slice(-8).map((e, i, arr) => {
            const prev = arr[i - 1];
            return i === 0 || !prev ? e : [...e, `+${Number(e[e.length - 1]) - Number(prev[prev.length - 1])}ms`];
          }),
        ),
      );
    };
    await dump("SI_BEFORE");
    await selfRow.getByRole("button", { name: /^Edit / }).click();

    const selfDialog = page.getByTestId("edit-user-dialog");
    const selfToggle = selfDialog.getByRole("checkbox", { name: "Active" });
    // Two active Administrators exist at this point, so this is the ACCOUNT
    // guard specifically, not the last-Administrator guard.
    await expect(selfToggle).toBeDisabled();
    await expect(selfDialog.getByTestId("active-guard")).toHaveAttribute(
      "title",
      "You cannot deactivate your own account.",
    );
    await expect(selfDialog.getByText("You cannot deactivate your own account.")).toBeVisible();

    // Role changes are still permitted for your own account.
    await expect(selfDialog.getByLabel(/^Role/)).toBeEnabled();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("edit-user-dialog")).toBeHidden();

    // ─── 8. Deactivate the extra Administrator (restores seeded state) ──
    const extraRow = await rowFor(page, E2E_USER.email);
    await extraRow.getByRole("button", { name: /^Edit / }).click();

    const deactivateDialog = page.getByTestId("edit-user-dialog");
    const extraToggle = deactivateDialog.getByRole("checkbox", { name: "Active" });
    await expect(extraToggle).toBeEnabled(); // not self, and not the last admin
    await extraToggle.uncheck();
    await deactivateDialog.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByTestId("users-toast")).toContainText("User updated.");
    await expect(page.getByTestId("edit-user-dialog")).toBeHidden();

    await clearFilters(page);
    await expect(
      (await rowFor(page, E2E_USER.email)).getByText("Inactive", { exact: true }),
    ).toBeVisible();

    // ─── 9. Last-active-Administrator guard ─────────────────────────────
    // The guard counts Administrators globally, so the precondition is
    // established explicitly: the signed-in account must be the only ACTIVE
    // one. (This also drains accounts left behind by an earlier failed run.)
    await deactivateOtherAdministrators(page, ADMIN.email);

    const lastRow = await rowFor(page, ADMIN.email);
    await lastRow.getByRole("button", { name: /^Edit / }).click();

    const lastDialog = page.getByTestId("edit-user-dialog");
    await expect(lastDialog.getByRole("checkbox", { name: "Active" })).toBeDisabled();
    await expect(lastDialog.getByLabel(/^Role/)).toBeDisabled();
    await expect(lastDialog.getByTestId("active-guard")).toHaveAttribute(
      "title",
      "At least one active Administrator is required.",
    );
    await expect(lastDialog.getByTestId("role-guard")).toHaveAttribute(
      "title",
      "At least one active Administrator is required.",
    );
  });
});
