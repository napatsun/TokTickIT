import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AuthProvider } from "../../src/contexts/AuthContext";
import ChangePasswordPage, { validateNewPassword } from "../../src/pages/ChangePasswordPage";
import { expectNoA11yViolations } from "../support/a11y";

/**
 * UI-02 — Mandatory Change Password screen (ui-spec.md §3)
 *
 * Every state is exercised through the real AuthProvider with only `fetch`
 * stubbed:
 *   Idle → Validating (inline errors) → Busy → Success (into the app)
 *   → Failure (safe generic banner)
 * plus the always-visible complexity hint and label/field binding.
 */

const MUST_CHANGE_USER = {
  id: "u1",
  name: "Jennifer Anderson",
  email: "jennifer.anderson@example.com",
  role: "REQUESTER",
  isActive: true,
  mustChangePassword: true,
};

interface CannedResponse {
  status: number;
  body: unknown;
}

function stubFetch(overrides: Record<string, CannedResponse> = {}) {
  const routes: Record<string, CannedResponse> = {
    "/api/auth/me": { status: 200, body: MUST_CHANGE_USER },
    ...overrides,
  };

  const spy = vi.fn(async (input: unknown) => {
    const url = String(input);
    const match = Object.keys(routes).find((key) => url.includes(key));
    const canned = match ? routes[match] : { status: 500, body: {} };
    return {
      ok: canned.status >= 200 && canned.status < 300,
      status: canned.status,
      json: async () => canned.body,
      clone() {
        return { json: async () => canned.body } as Response;
      },
    } as Response;
  });

  vi.stubGlobal("fetch", spy);
  return spy;
}

function renderChangePassword() {
  return render(
    <MemoryRouter initialEntries={["/change-password"]}>
      <AuthProvider>
        <Routes>
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/tickets" element={<div>My Tickets Screen</div>} />
          <Route path="/login" element={<div>Login Screen</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** Wait for the initial /api/auth/me bootstrap to settle. */
async function ready() {
  return {
    // Anchored so "New Password" does not also match "Confirm New Password".
    newPassword: await screen.findByLabelText(/^new password/i),
    confirmPassword: screen.getByLabelText(/^confirm new password/i),
    submit: screen.getByRole("button", { name: /save and continue/i }),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("UI-02 — Change Password screen", () => {
  // ─── Idle ──────────────────────────────────────────────────────────
  it("renders both password fields, the submit button, and the always-visible hint", async () => {
    stubFetch();
    renderChangePassword();

    const { newPassword, confirmPassword, submit } = await ready();

    expect(newPassword).toHaveAttribute("type", "password");
    expect(confirmPassword).toHaveAttribute("type", "password");
    expect(submit).toBeDisabled();

    // §3: the complexity hint is visible before any error occurs.
    expect(screen.getByTestId("password-hint")).toHaveTextContent(
      /minimum 8 characters, at least one letter and one number/i,
    );
  });

  // ─── Validating ────────────────────────────────────────────────────
  it("shows an inline error for a password that breaks the complexity rule", async () => {
    const fetchSpy = stubFetch();
    const user = userEvent.setup();
    renderChangePassword();

    const { newPassword, confirmPassword, submit } = await ready();
    await user.type(newPassword, "abcdefgh"); // 8 chars, no digit
    await user.type(confirmPassword, "abcdefgh");
    await user.click(submit);

    expect(await screen.findByText(/include a letter and a number/i)).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes("/api/auth/change-password"))).toBe(false);
  });

  it("shows an inline error when the confirmation does not match", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderChangePassword();

    const { newPassword, confirmPassword, submit } = await ready();
    await user.type(newPassword, "ValidPass123");
    await user.type(confirmPassword, "Different123");
    await user.click(submit);

    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
  });

  // ─── Busy ──────────────────────────────────────────────────────────
  it("disables the form and shows the saving label while the request is in flight", async () => {
    let resolveSave: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      resolveSave = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("/api/auth/change-password")) return pending;
        return {
          ok: true,
          status: 200,
          json: async () => MUST_CHANGE_USER,
          clone() {
            return this;
          },
        } as unknown as Response;
      }),
    );

    const user = userEvent.setup();
    renderChangePassword();

    const { newPassword, confirmPassword, submit } = await ready();
    await user.type(newPassword, "ValidPass123");
    await user.type(confirmPassword, "ValidPass123");
    await user.click(submit);

    expect(await screen.findByRole("button", { name: /saving/i })).toBeDisabled();
    expect(screen.getByLabelText(/^new password/i)).toBeDisabled();

    resolveSave({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
      clone() {
        return this;
      },
    } as unknown as Response);
  });

  // ─── Success ───────────────────────────────────────────────────────
  it("enters the app after a successful change (mustChangePassword cleared)", async () => {
    stubFetch({
      "/api/auth/change-password": { status: 200, body: { success: true } },
    });
    const user = userEvent.setup();
    renderChangePassword();

    const { newPassword, confirmPassword, submit } = await ready();
    await user.type(newPassword, "ValidPass123");
    await user.type(confirmPassword, "ValidPass123");
    await user.click(submit);

    expect(await screen.findByText("My Tickets Screen")).toBeInTheDocument();
  });

  // ─── Failure ───────────────────────────────────────────────────────
  it("shows a safe generic banner when the server fails", async () => {
    stubFetch({
      "/api/auth/change-password": { status: 500, body: { error: { code: "SERVER_ERROR", message: "boom" } } },
    });
    const user = userEvent.setup();
    renderChangePassword();

    const { newPassword, confirmPassword, submit } = await ready();
    await user.type(newPassword, "ValidPass123");
    await user.type(confirmPassword, "ValidPass123");
    await user.click(submit);

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Could not update password. Please try again.");
    expect(banner).not.toHaveTextContent(/boom/i);
  });

  it("maps server field errors back onto the fields", async () => {
    stubFetch({
      "/api/auth/change-password": {
        status: 422,
        body: {
          error: {
            code: "VALIDATION_ERROR",
            message: "Please fix the highlighted fields.",
            fields: { newPassword: "Must be at least 8 characters and include a letter and a number" },
          },
        },
      },
    });
    const user = userEvent.setup();
    renderChangePassword();

    const { newPassword, confirmPassword, submit } = await ready();
    await user.type(newPassword, "ValidPass123");
    await user.type(confirmPassword, "ValidPass123");
    await user.click(submit);

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  // ─── Policy unit ───────────────────────────────────────────────────
  it("enforces the documented password policy", () => {
    expect(validateNewPassword("short1")).toMatch(/at least 8 characters/i);
    expect(validateNewPassword("abcdefgh")).toMatch(/letter and a number/i);
    expect(validateNewPassword("12345678")).toMatch(/letter and a number/i);
    expect(validateNewPassword("")).toMatch(/required/i);
    expect(validateNewPassword("ValidPass123")).toBeUndefined();
  });
});

// ─── UI-10: automated accessibility (jest-axe) ───────────────────────────

describe("UI-10 — Change Password screen automated accessibility (ui-spec §9)", () => {
  it("has no axe violations in the idle state", async () => {
    stubFetch();
    renderChangePassword();
    await ready();

    await expectNoA11yViolations(document.body, "Change Password (idle)");
  });

  it("has no axe violations with both inline validation errors shown", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderChangePassword();

    const { newPassword, confirmPassword, submit } = await ready();
    await user.type(newPassword, "abcdefgh"); // no digit
    await user.type(confirmPassword, "Different1");
    await user.click(submit);
    await screen.findByText(/include a letter and a number/i);

    await expectNoA11yViolations(document.body, "Change Password (validating)");
  });

  it("has no axe violations with the safe failure banner shown", async () => {
    stubFetch({
      "/api/auth/change-password": {
        status: 500,
        body: { error: { code: "SERVER_ERROR", message: "boom" } },
      },
    });
    const user = userEvent.setup();
    renderChangePassword();

    const { newPassword, confirmPassword, submit } = await ready();
    await user.type(newPassword, "ValidPass123");
    await user.type(confirmPassword, "ValidPass123");
    await user.click(submit);
    await screen.findByRole("alert");

    await expectNoA11yViolations(document.body, "Change Password (failure)");
  });

  it("associates the always-visible policy hint with the new-password field", async () => {
    stubFetch();
    renderChangePassword();

    const { newPassword } = await ready();
    const hinted = newPassword.getAttribute("aria-describedby") ?? "";

    // §3/§9: the hint is announced with the field rather than merely rendered near it.
    expect(hinted.split(/\s+/)).toContain("password-hint");
    expect(screen.getByTestId("password-hint")).toHaveAttribute("id", "password-hint");
  });

  it("adds the inline error to aria-describedby alongside the hint when invalid", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderChangePassword();

    const { newPassword, confirmPassword, submit } = await ready();
    await user.type(newPassword, "abcdefgh");
    await user.type(confirmPassword, "abcdefgh");
    await user.click(submit);
    await screen.findByText(/include a letter and a number/i);

    const describedBy = (newPassword.getAttribute("aria-describedby") ?? "").split(/\s+/);
    expect(describedBy).toContain("password-hint");

    const errorId = describedBy.find((id) => id.endsWith("-error"));
    expect(errorId).toBeDefined();
    expect(document.getElementById(errorId as string)).toHaveAttribute("role", "alert");
    expect(newPassword).toHaveAttribute("aria-invalid", "true");
  });
});

// ─── UI-15 — the policy hint sits fully below the field ─────────────────

/** Every declaration block the stylesheet authors for a selector. */
function cssRuleBodies(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `[^{}]*` keeps the match inside one selector list, so grouped rules still resolve.
  const pattern = new RegExp(`${escaped}[^{}]*\\{([^}]*)\\}`, "g");
  return [...css.matchAll(pattern)].map((match) => match[1]);
}

function changePasswordStylesheet(): string {
  return fs.readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "src",
      "pages",
      "ChangePasswordPage.module.css",
    ),
    "utf8",
  );
}

/**
 * UI-15 — the always-visible complexity hint must render *below* the New
 * Password input with a normal-flow gap (ui-spec.md §3).
 *
 * jsdom performs no layout, so overlap itself cannot be measured here:
 * the suite pins the two things that caused the shipped overlap — the hint's
 * document position relative to the two field groups, and the authored
 * spacing/positioning of its class. The rendered pixels are verified visually
 * at 390x844 / 768x1024 / 1440x900.
 */
describe("UI-15 — the policy hint sits fully below the New Password field (ui-spec §3)", () => {
  it("renders the hint after the New Password input and before the Confirm group", async () => {
    stubFetch();
    renderChangePassword();

    const { newPassword, confirmPassword } = await ready();
    const hint = screen.getByTestId("password-hint");

    // §3: the hint follows the input in document order, so it cannot sit on
    // the field's bottom border.
    expect(
      newPassword.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // …and it belongs to the New Password group: it is preceded by the wrapper
    // that holds that input and followed by the Confirm New Password group.
    expect(hint.previousElementSibling?.contains(newPassword)).toBe(true);
    expect(hint.nextElementSibling?.contains(confirmPassword)).toBe(true);
  });

  it("authors no negative or overlay positioning on the hint", () => {
    const bodies = cssRuleBodies(changePasswordStylesheet(), ".hint");
    expect(bodies.length, ".hint must be authored").toBeGreaterThan(0);

    for (const body of bodies) {
      // The hint must sit in normal flow under the input, never on top of it.
      expect(body).not.toMatch(/position:\s*(absolute|fixed)/);
      expect(body).not.toMatch(/(^|[^-])height:\s*\d/);
      expect(body).not.toMatch(/(^|[;\s])top:\s*-/);

      // A negative margin is exactly what pulled the text over the input.
      for (const declaration of body.match(/margin[^:]*:[^;]*/g) ?? []) {
        const value = declaration.slice(declaration.indexOf(":") + 1);
        expect(value, `negative margin in "${declaration.trim()}"`).not.toMatch(/calc\(\s*-/);
        expect(value, `negative margin in "${declaration.trim()}"`).not.toMatch(/(^|[\s,])-\d/);
      }
    }

    // Spacing comes from the Zen Green scale as a positive gap below the field.
    expect(bodies.join("\n")).toMatch(/margin:\s*var\(--space-\d\)/);
  });

  it("keeps the hint below the field and linked to it when an inline error appears", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderChangePassword();

    const { newPassword, confirmPassword, submit } = await ready();
    await user.type(newPassword, "abcdefgh"); // 8 chars, no digit
    await user.type(confirmPassword, "abcdefgh");
    await user.click(submit);

    const error = await screen.findByText(/include a letter and a number/i);
    const hint = screen.getByTestId("password-hint");

    // The error does not replace the hint, and the hint stays after the input.
    expect(hint).toBeInTheDocument();
    expect(
      newPassword.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // §3: error and hint are distinct boxes — neither contains the other — so
    // the error text cannot be drawn over the helper text.
    expect(hint.contains(error)).toBe(false);
    expect((error as HTMLElement).contains(hint)).toBe(false);
    expect(hint).toHaveTextContent(/minimum 8 characters/i);
    expect(hint).not.toHaveTextContent(/include a letter and a number/i);

    // §9: both messages remain announced with the field.
    const describedBy = (newPassword.getAttribute("aria-describedby") ?? "").split(/\s+/);
    expect(describedBy).toContain("password-hint");
  });
});
