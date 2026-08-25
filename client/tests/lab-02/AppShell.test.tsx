import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect } from "vitest";
import AppShell from "../../src/components/layout/AppShell";

/**
 * Placeholder page for testing — renders unique heading + text.
 */
function PlaceholderPage({ title }: { title: string }) {
  return (
    <div>
      <h1>{title}</h1>
      <p>Coming in Step 9</p>
    </div>
  );
}

/**
 * Helper — renders AppShell with child routes at the given path.
 */
function renderAtRoute(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/tickets" element={<PlaceholderPage title="My Tickets" />} />
          <Route path="/tickets/new" element={<PlaceholderPage title="Create Ticket" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Get desktop nav links (inside <nav aria-label="Main navigation">).
 */
function getDesktopNav() {
  return screen.getByLabelText("Main navigation");
}

describe("Application Shell", () => {
  // -----------------------------------------------------------
  // §6: Nav active state
  // -----------------------------------------------------------
  describe("nav active state", () => {
    it("highlights My Tickets when at /tickets", () => {
      renderAtRoute("/tickets");
      const nav = getDesktopNav();
      const links = nav.querySelectorAll("a");
      const myTicketsLink = Array.from(links).find((a) => a.textContent === "My Tickets");
      expect(myTicketsLink).not.toBeNull();
      expect(myTicketsLink!.className).toMatch(/navLinkActive/);
    });

    it("highlights Create Ticket when at /tickets/new", () => {
      renderAtRoute("/tickets/new");
      const nav = getDesktopNav();
      const links = nav.querySelectorAll("a");
      const createLink = Array.from(links).find((a) => a.textContent === "Create Ticket");
      expect(createLink).not.toBeNull();
      expect(createLink!.className).toMatch(/navLinkActive/);
    });

    it("My Tickets is NOT active when at /tickets/new", () => {
      renderAtRoute("/tickets/new");
      const nav = getDesktopNav();
      const links = nav.querySelectorAll("a");
      const myTicketsLink = Array.from(links).find((a) => a.textContent === "My Tickets");
      expect(myTicketsLink).not.toBeNull();
      expect(myTicketsLink!.className).not.toMatch(/navLinkActive/);
    });
  });

  // -----------------------------------------------------------
  // §6: Wordmark
  // -----------------------------------------------------------
  describe("wordmark", () => {
    it("renders TokTickIT wordmark", () => {
      renderAtRoute("/tickets");
      expect(screen.getByText("TokTickIT")).toBeInTheDocument();
    });

    it("wordmark links to /tickets", () => {
      renderAtRoute("/tickets/new");
      const wordmark = screen.getByText("TokTickIT");
      expect(wordmark).toHaveAttribute("href", "/tickets");
    });
  });

  // -----------------------------------------------------------
  // §6: Current-Requester badge — always visible
  // -----------------------------------------------------------
  describe("requester badge", () => {
    it("shows mock requester name", () => {
      renderAtRoute("/tickets");
      const badges = screen.getAllByText("Jennifer Anderson");
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });

    it("requester badge is present (never hidden entirely per §6)", () => {
      renderAtRoute("/tickets");
      const badges = screen.getAllByText("Jennifer Anderson");
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------
  // §6: Change Requester button
  // -----------------------------------------------------------
  describe("change requester button", () => {
    it("renders Change Requester button", () => {
      renderAtRoute("/tickets");
      expect(screen.getByLabelText("Change Requester (placeholder)")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------
  // §11: Hamburger menu — mobile
  // -----------------------------------------------------------
  describe("hamburger menu", () => {
    it("hamburger button exists in DOM", () => {
      renderAtRoute("/tickets");
      expect(screen.getByLabelText("Open menu")).toBeInTheDocument();
    });

    it("clicking hamburger toggles mobile menu and shows Close label", () => {
      renderAtRoute("/tickets");
      const hamburger = screen.getByLabelText("Open menu");
      fireEvent.click(hamburger);
      expect(screen.getByLabelText("Close menu")).toBeInTheDocument();
    });

    it("mobile menu shows nav links after opening", () => {
      renderAtRoute("/tickets");
      fireEvent.click(screen.getByLabelText("Open menu"));
      const mobileNav = screen.getByLabelText("Mobile navigation");
      expect(mobileNav).toBeInTheDocument();
      expect(mobileNav.textContent).toContain("My Tickets");
      expect(mobileNav.textContent).toContain("Create Ticket");
    });

    it("requester badge is visible inside mobile menu (§6)", () => {
      renderAtRoute("/tickets");
      fireEvent.click(screen.getByLabelText("Open menu"));
      const badges = screen.getAllByText("Jennifer Anderson");
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------
  // §6: Content area — Outlet renders child route
  // -----------------------------------------------------------
  describe("content area", () => {
    it("renders child route placeholder content", () => {
      renderAtRoute("/tickets");
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("My Tickets");
      expect(screen.getByText("Coming in Step 9")).toBeInTheDocument();
    });
  });
});
