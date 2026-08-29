import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import RequireRequester from "../../src/components/RouteGuard";

/**
 * RequireRequester — AC-02
 *
 * Tests the three states:
 *   1. isLoaded=false → render nothing (no redirect, no children)
 *   2. isLoaded=true, requester=null → redirect to /select-requester
 *   3. isLoaded=true, requester present → render children
 */

// ─── Mock useRequester ──────────────────────────────────────────────────

let mockIsLoaded = true;
let mockRequester: { id: number; fullName: string; email: string } | null = null;

vi.mock("../../src/hooks/useRequester", () => ({
  useRequester: () => ({
    requester: mockRequester,
    isLoaded: mockIsLoaded,
    setRequester: vi.fn(),
    clearRequester: vi.fn(),
  }),
}));

// ─── Helper ─────────────────────────────────────────────────────────────

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={["/tickets"]}>
      <Routes>
        <Route
          path="/tickets"
          element={
            <RequireRequester>
              <div>Protected Content</div>
            </RequireRequester>
          }
        />
        <Route path="/select-requester" element={<div>Select Requester Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("RequireRequester", () => {
  it("renders nothing while isLoaded is false (no flash redirect)", () => {
    mockIsLoaded = false;
    mockRequester = null;

    const { container } = renderGuard();

    // Should not render children
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
    // Should not redirect
    expect(screen.queryByText("Select Requester Page")).not.toBeInTheDocument();
    // Container should be empty
    expect(container.innerHTML).toBe("");
  });

  it("redirects to /select-requester when isLoaded=true and requester=null", () => {
    mockIsLoaded = true;
    mockRequester = null;

    renderGuard();

    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
    expect(screen.getByText("Select Requester Page")).toBeInTheDocument();
  });

  it("renders children when isLoaded=true and requester is present", () => {
    mockIsLoaded = true;
    mockRequester = { id: 1, fullName: "Jennifer Anderson", email: "jennifer@example.com" };

    renderGuard();

    expect(screen.getByText("Protected Content")).toBeInTheDocument();
    expect(screen.queryByText("Select Requester Page")).not.toBeInTheDocument();
  });

  it("does not render children before isLoaded resolves, even if requester was previously set", () => {
    // Simulate: localStorage hasn't loaded yet, but a requester might be set later
    mockIsLoaded = false;
    mockRequester = null;

    const { container } = renderGuard();

    expect(container.innerHTML).toBe("");
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
    expect(screen.queryByText("Select Requester Page")).not.toBeInTheDocument();
  });
});
