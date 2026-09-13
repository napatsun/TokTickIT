import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "../../src/contexts/AuthContext";
import ChangePasswordPage, { validateNewPassword } from "../../src/pages/ChangePasswordPage";

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
