import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "../../src/contexts/AuthContext";
import LoginPage, { bannerForCode } from "../../src/pages/LoginPage";
import { expectNoA11yViolations } from "../support/a11y";

/**
 * UI-01 — Login screen (ui-spec.md §2)
 *
 * Rendered through the real AuthProvider so the component is exercised
 * exactly as it ships: the only stubbed boundary is `fetch`.
 *
 * States covered: Idle, Validating, Busy, Failure (credentials / account
 * unavailable / server), Success redirect, and the accessibility contract
 * (bound labels, role="alert" banner, Enter submits).
 */

const REQUESTER = {
  id: "u1",
  name: "Jennifer Anderson",
  email: "jennifer.anderson@example.com",
  role: "REQUESTER",
  isActive: true,
  mustChangePassword: false,
};

interface CannedResponse {
  status: number;
  body: unknown;
}

/** fetch stub routed by URL substring. `/api/auth/me` defaults to 401. */
function stubFetch(overrides: Record<string, CannedResponse> = {}) {
  const routes: Record<string, CannedResponse> = {
    "/api/auth/me": { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "Authentication required." } } },
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

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/change-password" element={<div>Change Password Screen</div>} />
          <Route path="/tickets" element={<div>My Tickets Screen</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("UI-01 — Login screen", () => {
  // ─── Idle ──────────────────────────────────────────────────────────
  it("renders bound Email and Password fields with a disabled submit while empty", async () => {
    stubFetch();
    renderLogin();

    const email = await screen.findByLabelText(/email/i);
    const password = screen.getByLabelText(/password/i);
    const submit = screen.getByRole("button", { name: /log in/i });

    expect(email).toBeInTheDocument();
    expect(email).toHaveAttribute("type", "email");
    expect(password).toHaveAttribute("type", "password");
    expect(submit).toBeDisabled();
  });

  it("enables the submit button once both fields are non-empty", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderLogin();

    await user.type(await screen.findByLabelText(/email/i), "jennifer.anderson@example.com");
    await user.type(screen.getByLabelText(/password/i), "Password123!");

    expect(screen.getByRole("button", { name: /log in/i })).toBeEnabled();
  });

  // ─── Validating ────────────────────────────────────────────────────
  it("shows an inline error and does not call the API for an invalid email", async () => {
    const fetchSpy = stubFetch();
    const user = userEvent.setup();
    renderLogin();

    await user.type(await screen.findByLabelText(/email/i), "invalid@");
    await user.type(screen.getByLabelText(/password/i), "Password123!");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(await screen.findByText(/enter a valid email address/i)).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes("/api/auth/login"))).toBe(false);
  });

  it("keeps the submit button disabled while a field is only whitespace", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderLogin();

    await user.type(await screen.findByLabelText(/email/i), "   ");
    await user.type(screen.getByLabelText(/password/i), "Password123!");

    expect(screen.getByRole("button", { name: /log in/i })).toBeDisabled();
  });

  it("rejects a malformed email with an inline error", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderLogin();

    await user.type(await screen.findByLabelText(/email/i), "not-an-email");
    await user.type(screen.getByLabelText(/password/i), "x");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(await screen.findByText(/enter a valid email address/i)).toBeInTheDocument();
  });

  // ─── Busy ──────────────────────────────────────────────────────────
  it("shows a spinner label and disables inputs while the request is in flight", async () => {
    let resolveLogin: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      resolveLogin = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("/api/auth/login")) return pending;
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }),
          clone() {
            return { json: async () => ({}) } as Response;
          },
        } as Response;
      }),
    );

    const user = userEvent.setup();
    renderLogin();

    await user.type(await screen.findByLabelText(/email/i), REQUESTER.email);
    await user.type(screen.getByLabelText(/password/i), "Password123!");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(await screen.findByRole("button", { name: /logging in/i })).toBeDisabled();
    expect(screen.getByLabelText(/email/i)).toBeDisabled();
    expect(screen.getByLabelText(/password/i)).toBeDisabled();

    resolveLogin({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." } }),
      clone() {
        return { json: async () => ({}) } as Response;
      },
    } as Response);
  });

  // ─── Failure ───────────────────────────────────────────────────────
  it("shows one generic banner for invalid credentials (no field blame)", async () => {
    stubFetch({
      "/api/auth/login": { status: 401, body: { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." } } },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.type(await screen.findByLabelText(/email/i), REQUESTER.email);
    await user.type(screen.getByLabelText(/password/i), "WrongPassword1");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Invalid email or password.");
    // No field-level hint that would confirm which field was wrong.
    expect(screen.queryByText(/wrong password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/email not found/i)).not.toBeInTheDocument();
  });

  it("shows the neutral account-unavailable banner for that error code", async () => {
    stubFetch({
      "/api/auth/login": {
        status: 401,
        body: { error: { code: "ACCOUNT_UNAVAILABLE", message: "Account unavailable." } },
      },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.type(await screen.findByLabelText(/email/i), REQUESTER.email);
    await user.type(screen.getByLabelText(/password/i), "Password123!");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("This account is unavailable. Contact your administrator.");
    expect(banner).not.toHaveTextContent(/inactive/i);
  });

  it("shows a generic banner for a server error", async () => {
    stubFetch({
      "/api/auth/login": { status: 500, body: { error: { code: "SERVER_ERROR", message: "Something went wrong." } } },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.type(await screen.findByLabelText(/email/i), REQUESTER.email);
    await user.type(screen.getByLabelText(/password/i), "Password123!");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
  });

  // ─── Success ───────────────────────────────────────────────────────
  it("redirects to Change Password when mustChangePassword is true", async () => {
    stubFetch({
      "/api/auth/login": { status: 200, body: { user: { ...REQUESTER, mustChangePassword: true } } },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.type(await screen.findByLabelText(/email/i), REQUESTER.email);
    await user.type(screen.getByLabelText(/password/i), "Password123!");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(await screen.findByText("Change Password Screen")).toBeInTheDocument();
  });

  it("redirects to the role home screen on a normal login", async () => {
    stubFetch({
      "/api/auth/login": { status: 200, body: { user: REQUESTER } },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.type(await screen.findByLabelText(/email/i), REQUESTER.email);
    await user.type(screen.getByLabelText(/password/i), "Password123!");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(await screen.findByText("My Tickets Screen")).toBeInTheDocument();
  });

  // ─── Keyboard / a11y ───────────────────────────────────────────────
  it("submits with the Enter key", async () => {
    const fetchSpy = stubFetch({
      "/api/auth/login": { status: 401, body: { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." } } },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.type(await screen.findByLabelText(/email/i), REQUESTER.email);
    await user.type(screen.getByLabelText(/password/i), "Password123!{enter}");

    await waitFor(() => {
      expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes("/api/auth/login"))).toBe(true);
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid email or password/i);
  });

  it("maps every server code to a safe banner message", () => {
    expect(bannerForCode("INVALID_CREDENTIALS", "ignored")).toBe("Invalid email or password.");
    expect(bannerForCode("ACCOUNT_UNAVAILABLE", "ignored")).toBe(
      "This account is unavailable. Contact your administrator.",
    );
    expect(bannerForCode("SOMETHING_NEW", "ignored")).toBe("Something went wrong. Please try again.");
  });
});

// ─── UI-10: automated accessibility (jest-axe) ───────────────────────────

describe("UI-10 — Login screen automated accessibility (ui-spec §9)", () => {
  it("has no axe violations in the idle state", async () => {
    stubFetch();
    renderLogin();
    await screen.findByLabelText(/email/i);

    await expectNoA11yViolations(document.body, "Login (idle)");
  });

  it("has no axe violations with inline validation errors shown", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderLogin();

    await user.type(await screen.findByLabelText(/email/i), "not-an-email");
    await user.type(screen.getByLabelText(/password/i), "x");
    await user.click(screen.getByRole("button", { name: /log in/i }));
    await screen.findByText(/enter a valid email address/i);

    await expectNoA11yViolations(document.body, "Login (validating)");
  });

  it("has no axe violations with the generic failure banner shown", async () => {
    stubFetch({
      "/api/auth/login": {
        status: 401,
        body: { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." } },
      },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.type(await screen.findByLabelText(/email/i), REQUESTER.email);
    await user.type(screen.getByLabelText(/password/i), "WrongPassword1");
    await user.click(screen.getByRole("button", { name: /log in/i }));
    await screen.findByRole("alert");

    await expectNoA11yViolations(document.body, "Login (failure)");
  });

  it("binds each error to its own field via aria-describedby and role=alert", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderLogin();

    await user.type(await screen.findByLabelText(/email/i), "not-an-email");
    await user.type(screen.getByLabelText(/password/i), "x");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    const email = screen.getByLabelText(/email/i);
    const describedBy = email.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(email).toHaveAttribute("aria-invalid", "true");

    // The referenced node is the field's own error message, is marked as an
    // alert region, and lives inside the field's label group.
    const errorNode = document.getElementById(describedBy as string);
    expect(errorNode).not.toBeNull();
    expect(errorNode).toHaveAttribute("role", "alert");
    expect(errorNode).toHaveTextContent(/enter a valid email address/i);
  });
});
