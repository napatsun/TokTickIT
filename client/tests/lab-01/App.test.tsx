import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import App from "../../src/App.js";

/**
 * App.test.tsx — Lab 1 tests (worked examples) + checkSystem API tests.
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
  vi.restoreAllMocks();
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

/**
 * Lab 1's "Check System" UI was replaced by AppShell + routing in Lab 2.
 * The underlying API function still exists in api.ts, so these tests verify
 * checkSystem() at the API layer by mocking fetch directly.
 */
describe("checkSystem (API layer)", () => {
  it("returns online status and the seeded categories on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { checkSystem } = await import("../../src/api.js");

    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 1, name: "Account and Access" },
          { id: 2, name: "Hardware" },
          { id: 3, name: "Software" },
          { id: 4, name: "Network" },
        ],
      } as Response);

    const result = await checkSystem();

    expect(result.online).toBe(true);
    expect(result.categories).toEqual([
      { id: 1, name: "Account and Access" },
      { id: 2, name: "Hardware" },
      { id: 3, name: "Software" },
      { id: 4, name: "Network" },
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws an error when the API is unavailable", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { checkSystem } = await import("../../src/api.js");

    fetchSpy.mockResolvedValueOnce({
      ok: false,
    } as Response);

    await expect(checkSystem()).rejects.toThrow(
      /unable to connect to toktickit api/i
    );
  });
});
