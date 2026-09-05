/**
 * MyTickets.test.tsx — UI Component tests for MyTicketsPage
 *
 * Covers:
 *   UI-09  — Empty ticket list (zero ever) → empty-state message
 *   UI-10  — No-results state (filters active, zero matches)
 *   UI-11  — Paginated response (42 items) → pagination text + controls
 *   UI-32  — Filter dropdowns populated from filterOptions (not full list)
 *   UI-33  — Empty filterOptions → dropdowns empty, no error
 *   UI-34  — Loading state → skeleton rows
 *   UI-35  — Error state → error banner + Retry
 */

import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import MyTicketsPage from "../../src/pages/MyTicketsPage";

// ─── Mock apiClient ─────────────────────────────────────────────────────

const mockApiResponse = vi.fn();

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: vi.fn(async (_url: string | URL | Request) => {
    const result = mockApiResponse();
    // Support both sync returns and promise returns
    const data = await result;
    return {
      ok: data._ok !== undefined ? data._ok : true,
      json: async () => data,
    };
  }),
}));

// ─── Mock useNavigate ───────────────────────────────────────────────────

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// ─── Default mock response ──────────────────────────────────────────────

function createMockResponse(overrides: {
  tickets?: any[];
  totalItems?: number;
  totalPages?: number;
  filterOptions?: any;
  _ok?: boolean;
} = {}) {
  return {
    _ok: overrides._ok !== undefined ? overrides._ok : true,
    tickets: overrides.tickets ?? [],
    pagination: {
      page: 1,
      pageSize: 10,
      totalItems: overrides.totalItems ?? 0,
      totalPages: overrides.totalPages ?? 0,
    },
    filterOptions: overrides.filterOptions ?? {
      categories: [],
      requestedPriorities: [],
      currentStatuses: [],
    },
  };
}

// ─── Helper to render the page ──────────────────────────────────────────

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/tickets"]}>
      <MyTicketsPage />
    </MemoryRouter>,
  );
}

// ─── Setup / Teardown ──────────────────────────────────────────────────

beforeEach(() => {
  mockApiResponse.mockReturnValue(createMockResponse());
  mockNavigate.mockReset();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── UI-34: Loading state ──────────────────────────────────────────────

describe("UI-34 — Loading state", () => {
  it("shows skeleton rows while loading", async () => {
    // Make the API hang (never resolves during test)
    let resolveFetch: (v: any) => void;
    mockApiResponse.mockReturnValue(
      new Promise((resolve) => { resolveFetch = resolve; }),
    );

    renderPage();

    // Should show skeleton loading indicator
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();

    // Should NOT show table yet
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    // Resolve the fetch to clean up (wrap in act to avoid warning)
    await act(async () => {
      resolveFetch!(createMockResponse());
    });
  });

  it("hides skeleton after loading completes", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({
        tickets: [{
          id: 1, ticketNumber: "TKT-2026-000001", createdAt: "2026-08-22T09:14:00.000Z",
          summary: "Test ticket", category: "Hardware", requestedPriority: "MEDIUM",
          itPriority: null, currentStatus: "NEW", ticketOwner: null, updatedAt: "2026-08-22T09:14:00.000Z",
        }],
        totalItems: 1, totalPages: 1,
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("table")).toBeInTheDocument();
    });

    // Skeleton should be gone
    expect(screen.queryByRole("status", { name: /loading/i })).not.toBeInTheDocument();
  });
});

// ─── UI-09: Empty ticket list (zero ever) ───────────────────────────────

describe("UI-09 — Empty ticket list", () => {
  it("shows empty state message when zero tickets and no filters active", async () => {
    mockApiResponse.mockReturnValue(createMockResponse({ totalItems: 0, totalPages: 0 }));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("You haven't created any tickets yet.")).toBeInTheDocument();
    });
  });

  it("shows 'Create your first ticket' button in empty state", async () => {
    mockApiResponse.mockReturnValue(createMockResponse({ totalItems: 0, totalPages: 0 }));
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Create your first ticket" })).toBeInTheDocument();
    });
  });

  it("navigates to /tickets/new when 'Create your first ticket' is clicked", async () => {
    const user = userEvent.setup();
    mockApiResponse.mockReturnValue(createMockResponse({ totalItems: 0, totalPages: 0 }));
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Create your first ticket" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Create your first ticket" }));
    expect(mockNavigate).toHaveBeenCalledWith("/tickets/new");
  });

  it("hides search and filter controls in empty state", async () => {
    mockApiResponse.mockReturnValue(createMockResponse({ totalItems: 0, totalPages: 0 }));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("You haven't created any tickets yet.")).toBeInTheDocument();
    });

    // Search input and filter controls should NOT be rendered
    expect(screen.queryByPlaceholderText(/Search by ticket number or summary/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Category")).not.toBeInTheDocument();
  });

  it("renders My Tickets heading in empty state", async () => {
    mockApiResponse.mockReturnValue(createMockResponse({ totalItems: 0, totalPages: 0 }));
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "My Tickets" })).toBeInTheDocument();
    });
  });
});

// ─── UI-10: No-results state (filters active, zero matches) ─────────────

describe("UI-10 — No-results state", () => {
  it("shows no-results message when filters active and zero matches", async () => {
    // First render with tickets so controls are visible,
    // then mock returns zero results after filter change
    let callCount = 0;
    mockApiResponse.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Initial load: return some tickets
        return createMockResponse({
          tickets: [{
            id: 1, ticketNumber: "TKT-2026-000001", createdAt: "2026-08-22T09:14:00.000Z",
            summary: "Laptop battery", category: "Hardware", requestedPriority: "MEDIUM",
            itPriority: null, currentStatus: "NEW", ticketOwner: null, updatedAt: "2026-08-22T09:14:00.000Z",
          }],
          totalItems: 1, totalPages: 1,
          filterOptions: {
            categories: [{ id: 2, name: "Hardware" }],
            requestedPriorities: ["MEDIUM"],
            currentStatuses: ["NEW"],
          },
        });
      }
      // After filter: return zero results
      return createMockResponse({
        totalItems: 0, totalPages: 0,
        filterOptions: {
          categories: [{ id: 2, name: "Hardware" }],
          requestedPriorities: ["MEDIUM"],
          currentStatuses: ["NEW"],
        },
      });
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Category")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Category"), "2");

    await waitFor(() => {
      expect(screen.getByText("No tickets match your search/filters.")).toBeInTheDocument();
    });
  });

  it("shows 'Clear filters' button in no-results state", async () => {
    let callCount = 0;
    mockApiResponse.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return createMockResponse({
          tickets: [{
            id: 1, ticketNumber: "TKT-2026-000001", createdAt: "2026-08-22T09:14:00.000Z",
            summary: "Laptop battery", category: "Hardware", requestedPriority: "MEDIUM",
            itPriority: null, currentStatus: "NEW", ticketOwner: null, updatedAt: "2026-08-22T09:14:00.000Z",
          }],
          totalItems: 1, totalPages: 1,
          filterOptions: {
            categories: [{ id: 2, name: "Hardware" }],
            requestedPriorities: ["MEDIUM"],
            currentStatuses: ["NEW"],
          },
        });
      }
      return createMockResponse({
        totalItems: 0, totalPages: 0,
        filterOptions: {
          categories: [{ id: 2, name: "Hardware" }],
          requestedPriorities: ["MEDIUM"],
          currentStatuses: ["NEW"],
        },
      });
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Category")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Category"), "2");

    await waitFor(() => {
      // There are 2 Clear filters buttons: one in FilterControls, one in no-results state
      const clearButtons = screen.getAllByRole("button", { name: "Clear filters" });
      expect(clearButtons.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("keeps search/filter controls visible in no-results state", async () => {
    let callCount = 0;
    mockApiResponse.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return createMockResponse({
          tickets: [{
            id: 1, ticketNumber: "TKT-2026-000001", createdAt: "2026-08-22T09:14:00.000Z",
            summary: "Laptop battery", category: "Hardware", requestedPriority: "MEDIUM",
            itPriority: null, currentStatus: "NEW", ticketOwner: null, updatedAt: "2026-08-22T09:14:00.000Z",
          }],
          totalItems: 1, totalPages: 1,
          filterOptions: {
            categories: [{ id: 2, name: "Hardware" }],
            requestedPriorities: ["MEDIUM"],
            currentStatuses: ["NEW"],
          },
        });
      }
      return createMockResponse({
        totalItems: 0, totalPages: 0,
        filterOptions: {
          categories: [{ id: 2, name: "Hardware" }],
          requestedPriorities: ["MEDIUM"],
          currentStatuses: ["NEW"],
        },
      });
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Category")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Category"), "2");

    await waitFor(() => {
      expect(screen.getByText("No tickets match your search/filters.")).toBeInTheDocument();
    });

    // Controls should still be visible
    expect(screen.getByPlaceholderText(/Search by ticket number or summary/)).toBeInTheDocument();
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
  });

  it("does NOT show empty state when filters are active (BR-39 distinction)", async () => {
    let callCount = 0;
    mockApiResponse.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return createMockResponse({
          tickets: [{
            id: 1, ticketNumber: "TKT-2026-000001", createdAt: "2026-08-22T09:14:00.000Z",
            summary: "Laptop battery", category: "Hardware", requestedPriority: "MEDIUM",
            itPriority: null, currentStatus: "NEW", ticketOwner: null, updatedAt: "2026-08-22T09:14:00.000Z",
          }],
          totalItems: 1, totalPages: 1,
          filterOptions: {
            categories: [{ id: 2, name: "Hardware" }],
            requestedPriorities: ["MEDIUM"],
            currentStatuses: ["NEW"],
          },
        });
      }
      return createMockResponse({
        totalItems: 0, totalPages: 0,
        filterOptions: {
          categories: [{ id: 2, name: "Hardware" }],
          requestedPriorities: ["MEDIUM"],
          currentStatuses: ["NEW"],
        },
      });
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Category")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Category"), "2");

    await waitFor(() => {
      expect(screen.getByText("No tickets match your search/filters.")).toBeInTheDocument();
    });

    // Should NOT show the empty state message
    expect(screen.queryByText("You haven't created any tickets yet.")).not.toBeInTheDocument();
  });
});

// ─── UI-35: Error state ────────────────────────────────────────────────

describe("UI-35 — Error state", () => {
  it("shows error banner when API returns non-ok response", async () => {
    mockApiResponse.mockReturnValue(createMockResponse({ _ok: false }));
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Couldn't load your tickets.")).toBeInTheDocument();
    });
  });

  it("shows error banner when API throws an error", async () => {
    mockApiResponse.mockRejectedValue(new Error("Network error"));
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Couldn't load your tickets.")).toBeInTheDocument();
    });
  });

  it("shows Retry button in error state", async () => {
    mockApiResponse.mockReturnValue(createMockResponse({ _ok: false }));
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });
  });

  it("Retry button re-fetches tickets", async () => {
    mockApiResponse.mockReturnValue(createMockResponse({ _ok: false }));
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });

    // Now make the API succeed
    mockApiResponse.mockReturnValue(
      createMockResponse({
        tickets: [{
          id: 1, ticketNumber: "TKT-2026-000001", createdAt: "2026-08-22T09:14:00.000Z",
          summary: "Test ticket", category: "Hardware", requestedPriority: "MEDIUM",
          itPriority: null, currentStatus: "NEW", ticketOwner: null, updatedAt: "2026-08-22T09:14:00.000Z",
        }],
        totalItems: 1, totalPages: 1,
      }),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByRole("table")).toBeInTheDocument();
    });

    // Error banner should be gone
    expect(screen.queryByText("Couldn't load your tickets.")).not.toBeInTheDocument();
  });

  it("hides error banner after successful retry", async () => {
    mockApiResponse.mockReturnValue(createMockResponse({ _ok: false }));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Couldn't load your tickets.")).toBeInTheDocument();
    });

    mockApiResponse.mockReturnValue(
      createMockResponse({ totalItems: 0, totalPages: 0 }),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.queryByText("Couldn't load your tickets.")).not.toBeInTheDocument();
    });
  });
});

// ─── UI-11: Paginated response (42 items) ──────────────────────────────

describe("UI-11 — Paginated response", () => {
  it('renders "Showing 1 to 10 of 42 tickets" text', async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({ totalItems: 42, totalPages: 5 }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Showing 1 to 10 of 42 tickets")).toBeInTheDocument();
    });
  });

  it("renders Previous button (disabled on page 1)", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({ totalItems: 42, totalPages: 5 }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Showing 1 to 10 of 42 tickets")).toBeInTheDocument();
    });

    const prevButton = screen.getByRole("button", { name: "Previous page" });
    expect(prevButton).toBeInTheDocument();
    expect(prevButton).toBeDisabled();
  });

  it("renders Next button (enabled when more pages exist)", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({ totalItems: 42, totalPages: 5 }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Showing 1 to 10 of 42 tickets")).toBeInTheDocument();
    });

    const nextButton = screen.getByRole("button", { name: "Next page" });
    expect(nextButton).toBeInTheDocument();
    expect(nextButton).not.toBeDisabled();
  });

  it("renders page number buttons", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({ totalItems: 42, totalPages: 5 }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Showing 1 to 10 of 42 tickets")).toBeInTheDocument();
    });

    for (let i = 1; i <= 5; i++) {
      expect(screen.getByRole("button", { name: `Page ${i}` })).toBeInTheDocument();
    }
  });
});

// ─── UI-32: Filter dropdowns populated from filterOptions ───────────────

describe("UI-32 — Filter dropdowns from filterOptions", () => {
  it("Category dropdown options come from filterOptions.categories", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({
        filterOptions: {
          categories: [{ id: 2, name: "Hardware" }, { id: 3, name: "Software" }],
          requestedPriorities: ["MEDIUM", "HIGH"],
          currentStatuses: ["NEW"],
        },
        totalItems: 2, totalPages: 1,
      }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Category")).toBeInTheDocument();
    });

    const categorySelect = screen.getByLabelText("Category");
    const options = within(categorySelect).getAllByRole("option");
    expect(options).toHaveLength(3); // "All Categories" + 2
    expect(options[1]).toHaveTextContent("Hardware");
    expect(options[2]).toHaveTextContent("Software");
  });

  it("Requested Priority dropdown options come from filterOptions.requestedPriorities", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({
        filterOptions: {
          categories: [],
          requestedPriorities: ["LOW", "MEDIUM", "HIGH"],
          currentStatuses: ["NEW"],
        },
        totalItems: 3, totalPages: 1,
      }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Requested Priority")).toBeInTheDocument();
    });

    const prioritySelect = screen.getByLabelText("Requested Priority");
    const options = within(prioritySelect).getAllByRole("option");
    expect(options).toHaveLength(4); // "All Priorities" + 3
  });

  it("Current Status dropdown options come from filterOptions.currentStatuses", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({
        filterOptions: {
          categories: [],
          requestedPriorities: [],
          currentStatuses: ["NEW"],
        },
        totalItems: 1, totalPages: 1,
      }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Current Status")).toBeInTheDocument();
    });

    const statusSelect = screen.getByLabelText("Current Status");
    const options = within(statusSelect).getAllByRole("option");
    expect(options).toHaveLength(2); // "All Statuses" + 1
  });

  it("Sort dropdown has 4 options per D4", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({
        tickets: [{
          id: 1, ticketNumber: "TKT-2026-000001", createdAt: "2026-08-22T09:14:00.000Z",
          summary: "Test", category: "Hardware", requestedPriority: "MEDIUM",
          itPriority: null, currentStatus: "NEW", ticketOwner: null, updatedAt: "2026-08-22T09:14:00.000Z",
        }],
        totalItems: 1, totalPages: 1,
      }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Sort by")).toBeInTheDocument();
    });

    const sortSelect = screen.getByLabelText("Sort by");
    const options = within(sortSelect).getAllByRole("option");
    expect(options).toHaveLength(4);
    expect(options[0]).toHaveTextContent("Created Date (newest)");
    expect(options[1]).toHaveTextContent("Created Date (oldest)");
    expect(options[2]).toHaveTextContent("Last Updated (newest)");
    expect(options[3]).toHaveTextContent("Last Updated (oldest)");
  });
});

// ─── UI-33: Empty filterOptions → dropdowns empty, no error ─────────────

describe("UI-33 — Empty filterOptions", () => {
  it("Category dropdown has no filter options when filterOptions.categories is empty", async () => {
    // Use totalItems > 0 so controls are visible (not hidden by empty state)
    mockApiResponse.mockReturnValue(
      createMockResponse({
        tickets: [{
          id: 1, ticketNumber: "TKT-2026-000001", createdAt: "2026-08-22T09:14:00.000Z",
          summary: "Test", category: "Hardware", requestedPriority: "MEDIUM",
          itPriority: null, currentStatus: "NEW", ticketOwner: null, updatedAt: "2026-08-22T09:14:00.000Z",
        }],
        totalItems: 1, totalPages: 1,
        filterOptions: { categories: [], requestedPriorities: [], currentStatuses: [] },
      }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Category")).toBeInTheDocument();
    });

    const categorySelect = screen.getByLabelText("Category");
    const options = within(categorySelect).getAllByRole("option");
    expect(options).toHaveLength(1); // Only "All Categories"
    expect(options[0]).toHaveTextContent("All Categories");
  });

  it("Requested Priority dropdown has no filter options when empty", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({
        tickets: [{
          id: 1, ticketNumber: "TKT-2026-000001", createdAt: "2026-08-22T09:14:00.000Z",
          summary: "Test", category: "Hardware", requestedPriority: "MEDIUM",
          itPriority: null, currentStatus: "NEW", ticketOwner: null, updatedAt: "2026-08-22T09:14:00.000Z",
        }],
        totalItems: 1, totalPages: 1,
        filterOptions: { categories: [], requestedPriorities: [], currentStatuses: [] },
      }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Requested Priority")).toBeInTheDocument();
    });

    const prioritySelect = screen.getByLabelText("Requested Priority");
    const options = within(prioritySelect).getAllByRole("option");
    expect(options).toHaveLength(1); // Only "All Priorities"
  });

  it("Current Status dropdown has no filter options when empty", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({
        tickets: [{
          id: 1, ticketNumber: "TKT-2026-000001", createdAt: "2026-08-22T09:14:00.000Z",
          summary: "Test", category: "Hardware", requestedPriority: "MEDIUM",
          itPriority: null, currentStatus: "NEW", ticketOwner: null, updatedAt: "2026-08-22T09:14:00.000Z",
        }],
        totalItems: 1, totalPages: 1,
        filterOptions: { categories: [], requestedPriorities: [], currentStatuses: [] },
      }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Current Status")).toBeInTheDocument();
    });

    const statusSelect = screen.getByLabelText("Current Status");
    const options = within(statusSelect).getAllByRole("option");
    expect(options).toHaveLength(1); // Only "All Statuses"
  });

  it("does not throw an error when filterOptions arrays are all empty", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({
        tickets: [{
          id: 1, ticketNumber: "TKT-2026-000001", createdAt: "2026-08-22T09:14:00.000Z",
          summary: "Test", category: "Hardware", requestedPriority: "MEDIUM",
          itPriority: null, currentStatus: "NEW", ticketOwner: null, updatedAt: "2026-08-22T09:14:00.000Z",
        }],
        totalItems: 1, totalPages: 1,
        filterOptions: { categories: [], requestedPriorities: [], currentStatuses: [] },
      }),
    );

    expect(() => {
      renderPage();
    }).not.toThrow();

    await waitFor(() => {
      expect(screen.getByLabelText("Category")).toBeInTheDocument();
    });
  });
});
