/**
 * RequesterFlow.integration.test.tsx — AC-02 / AC-22 end-to-end
 *
 * Full integration tests using real components (no hook mocks).
 * Only `fetch` is mocked to avoid needing a running server.
 *
 * Proves: RequesterProvider + RequireRequester + SelectRequesterPage +
 *         AppShell work together as a complete flow.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import App from "../../src/App";

// ─── Constants ──────────────────────────────────────────────────────────

const STORAGE_KEY = "tkt_current_requester";

const SEED_REQUESTERS = [
  { id: 10, fullName: "Alice Test", email: "alice@test.com" },
  { id: 20, fullName: "Bob Test", email: "bob@test.com" },
];

// ─── Setup / Teardown ──────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────

describe("Requester flow (integration)", () => {
  // ─── Test 1: Empty localStorage → redirect to selection ──────────

  it("redirects to /select-requester when localStorage is empty", async () => {
    // Mock fetch to return requesters (so the selection page loads successfully)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ requesters: SEED_REQUESTERS }),
      })),
    );

    render(<App />);

    // Should land on the Selection screen, not AppShell
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Select Development Requester" }),
      ).toBeInTheDocument();
    });

    // AppShell nav should NOT be visible
    expect(screen.queryByLabelText("Main navigation")).not.toBeInTheDocument();
  });

  // ─── Test 2: Full flow — select → Continue → protected page ─────

  it("full flow: select requester → land on protected page with correct badge", async () => {
    const user = userEvent.setup();

    // Mock GET /api/dev-requesters
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ requesters: SEED_REQUESTERS }),
      })),
    );

    render(<App />);

    // 1. Wait for Selection screen to load with dropdown
    const select = await screen.findByRole("combobox");
    expect(select).toBeInTheDocument();

    // 2. Select Alice Test
    await user.selectOptions(select, "10");

    // 3. Click Continue
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(continueBtn).not.toBeDisabled();
    await user.click(continueBtn);

    // 4. Verify localStorage has the selected requester
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored).toEqual(SEED_REQUESTERS[0]);
    });

    // 5. Verify AppShell renders (nav visible) — we're on /tickets now
    await waitFor(() => {
      expect(screen.getByLabelText("Main navigation")).toBeInTheDocument();
    });

    // 6. Verify Requester badge shows the correct name
    const badges = screen.getAllByText("Alice Test");
    expect(badges.length).toBeGreaterThanOrEqual(1);

    // 7. Selection screen should be gone
    expect(
      screen.queryByRole("heading", { name: "Select Development Requester" }),
    ).not.toBeInTheDocument();
  });

  // ─── Test 3: Change Requester → back to selection ───────────────

  it("Change Requester clears state and returns to selection screen", async () => {
    const user = userEvent.setup();

    // Seed localStorage so RequireRequester lets us through
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_REQUESTERS[0]));

    // Mock fetch (not needed for this flow, but App might call it)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ requesters: SEED_REQUESTERS }),
      })),
    );

    render(<App />);

    // 1. Verify we're on AppShell (protected page)
    await waitFor(() => {
      expect(screen.getByLabelText("Main navigation")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Alice Test").length).toBeGreaterThanOrEqual(1);

    // 2. Click Change Requester
    await user.click(screen.getByLabelText("Change Requester"));

    // 3. Verify localStorage is cleared
    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    // 4. Verify we're back on the Selection screen
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Select Development Requester" }),
      ).toBeInTheDocument();
    });

    // 5. AppShell nav should be gone
    expect(screen.queryByLabelText("Main navigation")).not.toBeInTheDocument();
  });
});
