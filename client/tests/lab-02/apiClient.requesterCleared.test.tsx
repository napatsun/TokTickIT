import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { RequesterProvider } from "../../src/contexts/RequesterContext";
import { REQUESTER_CLEARED_EVENT } from "../../src/lib/apiClient";

/**
 * apiClient ↔ RequesterProvider integration — BR-03 redirect mechanism
 *
 * Tests that when apiClient dispatches "requester:cleared" CustomEvent,
 * RequesterProvider:
 *   1. Clears React state (requester becomes null)
 *   2. Navigates to /select-requester
 *
 * This is the "redirect" mechanism: apiClient dispatches the event from
 * outside React, RequesterProvider catches it and uses React Router's
 * navigate() for a smooth SPA transition (no full page reload).
 */

const STORAGE_KEY = "tkt_current_requester";

const MOCK_REQUESTER = {
  id: 1,
  fullName: "Jennifer Anderson",
  email: "jennifer.anderson@example.com",
};

function ProtectedPage() {
  return <div>Protected Content</div>;
}

function SelectionPage() {
  return <div>Select Requester Page</div>;
}

function renderWithProviders(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <RequesterProvider>
        <Routes>
          <Route path="/select-requester" element={<SelectionPage />} />
          <Route path="/tickets" element={<ProtectedPage />} />
        </Routes>
      </RequesterProvider>
    </MemoryRouter>,
  );
}

describe("apiClient → RequesterProvider BR-03 redirect", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("dispatching requester:cleared event clears React state and navigates to /select-requester", async () => {
    // Seed localStorage so RequesterProvider starts with a requester
    localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_REQUESTER));

    renderWithProviders("/tickets");

    // Initially, protected page should render
    expect(screen.getByText("Protected Content")).toBeInTheDocument();
    expect(screen.queryByText("Select Requester Page")).not.toBeInTheDocument();

    // Simulate what apiClient does on 401 INVALID_REQUESTER_CONTEXT:
    // 1. Clear localStorage (apiClient does this)
    localStorage.removeItem(STORAGE_KEY);

    // 2. Dispatch the event (apiClient does this)
    act(() => {
      window.dispatchEvent(new CustomEvent(REQUESTER_CLEARED_EVENT));
    });

    // After the event, RequesterProvider should have cleared state
    // and navigated to /select-requester
    expect(screen.getByText("Select Requester Page")).toBeInTheDocument();
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("event dispatch does NOT navigate when not on a protected route", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_REQUESTER));

    renderWithProviders("/select-requester");

    // Already on selection page
    expect(screen.getByText("Select Requester Page")).toBeInTheDocument();

    // Simulate apiClient clearing + event
    localStorage.removeItem(STORAGE_KEY);

    act(() => {
      window.dispatchEvent(new CustomEvent(REQUESTER_CLEARED_EVENT));
    });

    // Should still be on selection page (no error, no crash)
    expect(screen.getByText("Select Requester Page")).toBeInTheDocument();
  });

  it("multiple event dispatches do not cause errors", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_REQUESTER));

    renderWithProviders("/tickets");
    expect(screen.getByText("Protected Content")).toBeInTheDocument();

    localStorage.removeItem(STORAGE_KEY);

    // Dispatch multiple times — should not throw
    act(() => {
      window.dispatchEvent(new CustomEvent(REQUESTER_CLEARED_EVENT));
      window.dispatchEvent(new CustomEvent(REQUESTER_CLEARED_EVENT));
    });

    // Should navigate to selection page
    expect(screen.getByText("Select Requester Page")).toBeInTheDocument();
  });
});
