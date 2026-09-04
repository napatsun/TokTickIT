import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import App from "../../src/App.js";

/**
 * App.test.tsx — Lab 1 tests (worked examples).
 *
 * After lab2/04, the routing tree includes RequesterProvider + RequireRequester.
 * Protected routes (/tickets, etc.) only render when a requester is in localStorage.
 * We seed localStorage before each test so the app renders normally.
 */

const STORAGE_KEY = "tkt_current_requester";
const MOCK_REQUESTER = {
  id: 1,
  fullName: "Jennifer Anderson",
  email: "jennifer.anderson@example.com",
};

beforeEach(() => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_REQUESTER));
});

afterEach(() => {
  localStorage.removeItem(STORAGE_KEY);
});

describe("App", () => {
  // WORKED EXAMPLE — provided for you.
  it("renders the TokTickIT heading", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/TokTickIT/i)).toBeInTheDocument();
    });
  });

  it("renders the My Tickets nav link", async () => {
    render(<App />);
    await waitFor(() => {
      const desktopNav = screen.getByRole("navigation", { name: /main navigation/i });
      expect(within(desktopNav).getByRole("link", { name: /my tickets/i })).toBeInTheDocument();
    });
  });

  it("renders the Create Ticket nav link", async () => {
    render(<App />);
    await waitFor(() => {
      const desktopNav = screen.getByRole("navigation", { name: /main navigation/i });
      expect(within(desktopNav).getByRole("link", { name: /create ticket/i })).toBeInTheDocument();
    });
  });
});


