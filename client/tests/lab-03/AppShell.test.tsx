import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "../../src/contexts/AuthContext";
import AppShell from "../../src/components/layout/AppShell";
import { expectNoA11yViolations } from "../support/a11y";

/**
 * Application Shell — ui-spec.md §1 (FR-08, FR-11)
 *
 *   - only role-permitted nav destinations render (never rendered-but-disabled)
 *   - current user's name + role badge render
 *   - Logout is present and ends the session
 *   - the Lab 2 Development Requester selector / "Change Requester" is gone
 */

function userFor(role: "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR", mustChangePassword = false) {
  return {
    id: `user-${role}`,
    name: `${role} Person`,
    email: `${role.toLowerCase()}@example.com`,
    role,
    isActive: true,
    mustChangePassword,
  };
}

function stubFetch(user: unknown) {
  const spy = vi.fn(async (input: unknown) => {
    const url = String(input);
    const isMe = url.includes("/api/auth/me");
    return {
      ok: isMe ? true : true,
      status: 200,
      json: async () => (isMe ? user : { success: true }),
      clone() {
        return this;
      },
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function renderShell(initialPath = "/tickets") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/tickets" element={<div>Tickets Content</div>} />
            <Route path="/tickets/new" element={<div>Create Ticket Content</div>} />
            <Route path="/staff/queue" element={<div>Queue Content</div>} />
            <Route path="/admin/users" element={<div>Users Content</div>} />
          </Route>
          <Route path="/login" element={<div>Login Screen</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AppShell — role-scoped navigation (FR-08)", () => {
  it("renders My Tickets and Create Ticket for a Requester, and nothing else", async () => {
    stubFetch(userFor("REQUESTER"));
    renderShell();

    const nav = await screen.findByRole("navigation", { name: /main navigation/i });

    expect(within(nav).getByRole("link", { name: /my tickets/i })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: /create ticket/i })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: /ticket queue/i })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: /user management/i })).not.toBeInTheDocument();
  });

  it("renders only Ticket Queue for IT Staff", async () => {
    stubFetch(userFor("IT_STAFF"));
    renderShell("/staff/queue");

    const nav = await screen.findByRole("navigation", { name: /main navigation/i });

    expect(within(nav).getByRole("link", { name: /ticket queue/i })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: /my tickets/i })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: /user management/i })).not.toBeInTheDocument();
  });

  it("renders only User Management for an Administrator", async () => {
    stubFetch(userFor("ADMINISTRATOR"));
    renderShell("/admin/users");

    const nav = await screen.findByRole("navigation", { name: /main navigation/i });

    expect(within(nav).getByRole("link", { name: /user management/i })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: /ticket queue/i })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: /my tickets/i })).not.toBeInTheDocument();
  });
});

describe("AppShell — identity and logout", () => {
  it("shows the authenticated user's name and role badge", async () => {
    stubFetch(userFor("IT_STAFF"));
    renderShell("/staff/queue");

    await waitFor(() => {
      expect(screen.getByTestId("shell-user-name")).toHaveTextContent("IT_STAFF Person");
    });
    // The role badge also renders inside the mobile menu, so query all copies.
    expect(screen.getAllByTestId("shell-role-badge")[0]).toHaveTextContent("IT Staff");
  });

  it("no longer renders the Development Requester selector or Change Requester action", async () => {
    stubFetch(userFor("REQUESTER"));
    renderShell();

    await screen.findByRole("navigation", { name: /main navigation/i });

    expect(screen.queryByText(/change requester/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/change requester/i)).not.toBeInTheDocument();
  });

  it("logs out and returns to the Login screen", async () => {
    const fetchSpy = stubFetch(userFor("REQUESTER"));
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole("navigation", { name: /main navigation/i });
    // Logout renders in both the desktop header and the mobile menu.
    await user.click(screen.getAllByRole("button", { name: /log out/i })[0]);

    expect(await screen.findByText("Login Screen")).toBeInTheDocument();
    expect(
      fetchSpy.mock.calls.some((call) => String(call[0]).includes("/api/auth/logout")),
    ).toBe(true);
  });
});

// ─── UI-10: automated accessibility (jest-axe) ───────────────────────────

describe("UI-10 — App Shell accessibility (ui-spec §9)", () => {
  it("has no axe violations, with landmark coverage enabled", async () => {
    stubFetch(userFor("IT_STAFF"));
    renderShell("/staff/queue");
    await screen.findByRole("navigation", { name: /main navigation/i });

    // Unlike the single-screen suites, the shell DOES supply the page landmarks
    // (<header>, the two labelled <nav>s, <main>), so the `region` rule runs here
    // rather than being exempted.
    await expectNoA11yViolations(document.body, "App Shell", { disableRules: [] });
  });

  it("exposes the hamburger as a labelled toggle that works from the keyboard", async () => {
    const user = userEvent.setup();
    stubFetch(userFor("REQUESTER"));
    renderShell("/tickets");
    await screen.findByRole("navigation", { name: /main navigation/i });

    const closed = screen.getByRole("button", { name: /open menu/i });
    expect(closed).toHaveAttribute("aria-expanded", "false");

    await user.click(closed);

    const open = screen.getByRole("button", { name: /close menu/i });
    expect(open).toHaveAttribute("aria-expanded", "true");

    // The mobile menu is its own labelled landmark and carries exactly the same
    // role-scoped destinations as the desktop nav — never more (FR-08).
    const mobileNav = screen.getByRole("navigation", { name: /mobile navigation/i });
    expect(within(mobileNav).getByRole("link", { name: /my tickets/i })).toBeInTheDocument();
    expect(within(mobileNav).getByRole("link", { name: /create ticket/i })).toBeInTheDocument();
    expect(within(mobileNav).queryByRole("link", { name: /user management/i })).not.toBeInTheDocument();
    expect(within(mobileNav).queryByRole("link", { name: /ticket queue/i })).not.toBeInTheDocument();

    // It is a real <button>, so Enter (and Space) toggles it.
    open.focus();
    expect(open).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: /open menu/i })).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the identity, nav, and logout controls reachable in DOM order", async () => {
    stubFetch(userFor("ADMINISTRATOR"));
    renderShell("/admin/users");
    await screen.findByRole("navigation", { name: /main navigation/i });

    // Every interactive shell control is a native button/anchor or a labelled
    // toast-free control — nothing is removed from the tab order with
    // tabindex="-1", so Tab reaches them all.
    const controls = [
      screen.getByTestId("shell-user-name"),
      screen.getByRole("button", { name: /^log out$/i }),
      screen.getByRole("button", { name: /open menu/i }),
      screen.getByRole("navigation", { name: /main navigation/i }),
    ];
    for (const control of controls) {
      expect(control).not.toHaveAttribute("tabindex", "-1");
    }

    const navLink = within(screen.getByRole("navigation", { name: /main navigation/i })).getByRole(
      "link",
      { name: /user management/i },
    );
    expect(navLink).not.toHaveAttribute("tabindex", "-1");
    // The active destination is programmatically marked, not colour-only.
    expect(navLink).toHaveAttribute("aria-current", "page");
  });
});
