/**
 * MyTickets.test.tsx — UI Component tests for MyTicketsPage
 *
 * Covers:
 *   UI-09  — Mocked empty ticket list (zero ever) → empty-state message
 *   UI-11  — Mocked paginated response (42 items) → pagination text + controls
 *   UI-32  — Filter dropdowns populated from filterOptions (not full list)
 *   UI-33  — Empty filterOptions → dropdowns empty, no error
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import MyTicketsPage from "../../src/pages/MyTicketsPage";

// ─── Mock apiClient ─────────────────────────────────────────────────────

const mockApiResponse = vi.fn();

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: vi.fn(async (_url: string | URL | Request) => {
    const data = mockApiResponse();
    return {
      ok: true,
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
} = {}) {
  return {
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

// ─── UI-09: Empty ticket list (zero ever) ───────────────────────────────

describe("UI-09 — Empty ticket list", () => {
  it("renders My Tickets heading", async () => {
    mockApiResponse.mockReturnValue(createMockResponse());
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "My Tickets" })).toBeInTheDocument();
    });
  });

  it("renders Create Ticket button", async () => {
    mockApiResponse.mockReturnValue(createMockResponse());
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Create Ticket" })).toBeInTheDocument();
    });
  });

  it("renders search input", async () => {
    mockApiResponse.mockReturnValue(createMockResponse());
    renderPage();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search by ticket number or summary/)).toBeInTheDocument();
    });
  });

  it("renders the subtitle", async () => {
    mockApiResponse.mockReturnValue(createMockResponse());
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("View and track all of your support requests.")).toBeInTheDocument();
    });
  });

  it("renders table with 9 column headers when tickets exist", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({
        tickets: [
          {
            id: 1,
            ticketNumber: "TKT-2026-000001",
            createdAt: "2026-08-22T09:14:00.000Z",
            summary: "Laptop battery drains quickly",
            category: "Hardware",
            requestedPriority: "MEDIUM",
            itPriority: null,
            currentStatus: "NEW",
            ticketOwner: null,
            updatedAt: "2026-08-22T09:14:00.000Z",
          },
        ],
        totalItems: 1,
        totalPages: 1,
      }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("table")).toBeInTheDocument();
    });

    const table = screen.getByRole("table");
    const headerRow = within(table).getAllByRole("columnheader");
    expect(headerRow).toHaveLength(9);

    const expectedHeaders = [
      "Ticket No.",
      "Created Date",
      "Summary",
      "Category",
      "Requested Priority",
      "IT Priority",
      "Current Status",
      "Ticket Owner",
      "Last Updated",
    ];

    expectedHeaders.forEach((header) => {
      expect(headerRow.find((th) => th.textContent === header)).toBeTruthy();
    });
  });
});

// ─── UI-11: Paginated response (42 items) ──────────────────────────────

describe("UI-11 — Paginated response", () => {
  it('renders "Showing 1 to 10 of 42 tickets" text', async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({
        totalItems: 42,
        totalPages: 5,
      }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Showing 1 to 10 of 42 tickets")).toBeInTheDocument();
    });
  });

  it("renders Previous button (disabled on page 1)", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({
        totalItems: 42,
        totalPages: 5,
      }),
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
      createMockResponse({
        totalItems: 42,
        totalPages: 5,
      }),
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
      createMockResponse({
        totalItems: 42,
        totalPages: 5,
      }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Showing 1 to 10 of 42 tickets")).toBeInTheDocument();
    });

    // Should have page buttons 1–5
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByRole("button", { name: `Page ${i}` })).toBeInTheDocument();
    }
  });

  it("does not render pagination when totalItems is 0", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({
        totalItems: 0,
        totalPages: 0,
      }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("table")).toBeInTheDocument();
    });

    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Previous page" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
  });
});

// ─── UI-32: Filter dropdowns populated from filterOptions ───────────────

describe("UI-32 — Filter dropdowns from filterOptions", () => {
  it("Category dropdown options come from filterOptions.categories", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({
        filterOptions: {
          categories: [
            { id: 2, name: "Hardware" },
            { id: 3, name: "Software" },
          ],
          requestedPriorities: ["MEDIUM", "HIGH"],
          currentStatuses: ["NEW"],
        },
        totalItems: 2,
        totalPages: 1,
      }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Category")).toBeInTheDocument();
    });

    const categorySelect = screen.getByLabelText("Category");
    const options = within(categorySelect).getAllByRole("option");

    // "All Categories" + 2 from filterOptions
    expect(options).toHaveLength(3);
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
        totalItems: 3,
        totalPages: 1,
      }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Requested Priority")).toBeInTheDocument();
    });

    const prioritySelect = screen.getByLabelText("Requested Priority");
    const options = within(prioritySelect).getAllByRole("option");

    // "All Priorities" + 3 from filterOptions
    expect(options).toHaveLength(4);
    expect(options[1]).toHaveTextContent("Low");
    expect(options[2]).toHaveTextContent("Medium");
    expect(options[3]).toHaveTextContent("High");
  });

  it("Current Status dropdown options come from filterOptions.currentStatuses", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({
        filterOptions: {
          categories: [],
          requestedPriorities: [],
          currentStatuses: ["NEW"],
        },
        totalItems: 1,
        totalPages: 1,
      }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Current Status")).toBeInTheDocument();
    });

    const statusSelect = screen.getByLabelText("Current Status");
    const options = within(statusSelect).getAllByRole("option");

    // "All Statuses" + 1 from filterOptions
    expect(options).toHaveLength(2);
    expect(options[1]).toHaveTextContent("New");
  });

  it("Sort dropdown has 4 options per D4", async () => {
    mockApiResponse.mockReturnValue(createMockResponse());
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
    mockApiResponse.mockReturnValue(
      createMockResponse({
        filterOptions: {
          categories: [],
          requestedPriorities: [],
          currentStatuses: [],
        },
        totalItems: 0,
        totalPages: 0,
      }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Category")).toBeInTheDocument();
    });

    const categorySelect = screen.getByLabelText("Category");
    const options = within(categorySelect).getAllByRole("option");

    // Only "All Categories" — no data options
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("All Categories");
  });

  it("Requested Priority dropdown has no filter options when empty", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({
        filterOptions: {
          categories: [],
          requestedPriorities: [],
          currentStatuses: [],
        },
        totalItems: 0,
        totalPages: 0,
      }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Requested Priority")).toBeInTheDocument();
    });

    const prioritySelect = screen.getByLabelText("Requested Priority");
    const options = within(prioritySelect).getAllByRole("option");

    // Only "All Priorities" — no data options
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("All Priorities");
  });

  it("Current Status dropdown has no filter options when empty", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({
        filterOptions: {
          categories: [],
          requestedPriorities: [],
          currentStatuses: [],
        },
        totalItems: 0,
        totalPages: 0,
      }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Current Status")).toBeInTheDocument();
    });

    const statusSelect = screen.getByLabelText("Current Status");
    const options = within(statusSelect).getAllByRole("option");

    // Only "All Statuses" — no data options
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("All Statuses");
  });

  it("does not throw an error when filterOptions arrays are all empty", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({
        filterOptions: {
          categories: [],
          requestedPriorities: [],
          currentStatuses: [],
        },
        totalItems: 0,
        totalPages: 0,
      }),
    );

    // Should render without throwing
    expect(() => {
      renderPage();
    }).not.toThrow();

    await waitFor(() => {
      expect(screen.getByLabelText("Category")).toBeInTheDocument();
    });
  });
});
