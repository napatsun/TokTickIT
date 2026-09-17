import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import App from "../../src/App.js";

/**
 * App.test.tsx — Lab 1 smoke tests (updated for Lab 3 session auth).
 *
 * After feature/lab3-02-auth-and-authorization the app boots by calling
 * GET /api/auth/me; the Development Requester selector and its localStorage
 * key are gone (FR-11). These tests stub the session endpoint as a signed-in
 * Requester so the shell renders normally.
 */

const REQUESTER = {
  id: "user-1",
  name: "Jennifer Anderson",
  email: "jennifer.anderson@example.com",
  role: "REQUESTER",
  isActive: true,
  mustChangePassword: false,
};

function stubSession(user: unknown = REQUESTER) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      const body = url.includes("/api/auth/me") ? user : {};
      return {
        ok: true,
        status: 200,
        json: async () => body,
        clone() {
          return this;
        },
      } as unknown as Response;
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("App", () => {
  it("renders the TokTickIT heading", async () => {
    stubSession();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/TokTickIT/i)).toBeInTheDocument();
    });
  });

  it("renders the My Tickets nav link for a Requester", async () => {
    stubSession();
    render(<App />);

    await waitFor(() => {
      const desktopNav = screen.getByRole("navigation", { name: /main navigation/i });
      expect(within(desktopNav).getByRole("link", { name: /my tickets/i })).toBeInTheDocument();
    });
  });

  it("renders the Create Ticket nav link for a Requester", async () => {
    stubSession();
    render(<App />);

    await waitFor(() => {
      const desktopNav = screen.getByRole("navigation", { name: /main navigation/i });
      expect(within(desktopNav).getByRole("link", { name: /create ticket/i })).toBeInTheDocument();
    });
  });

  it("sends an unauthenticated visitor to the Login screen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }),
        clone() {
          return this;
        },
      } as unknown as Response)),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /log in/i })).toBeInTheDocument();
    });
  });
});
