import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import StaffQueuePage from "../../src/pages/StaffQueuePage";

/**
 * IT Staff Ticket Queue — tests.md §4 (ui-spec.md §5)
 *
 *   UI-04  table renders the handout columns, badges, and pagination footer;
 *          stacked-card markup is present for the mobile/tablet breakpoint;
 *          search / filter / sort / pagination drive the API query
 *   UI-05  empty and no-results states show the right message and the
 *          "Clear filters" affordance
 *
 * jsdom does not apply CSS media queries, so the table and the card list are
 * both in the DOM; the breakpoint switch itself is CSS (`display:none`), which
 * is what the RESP-01 screenshots verify visually. These tests assert the
 * markup/flags that CSS depends on.
 */

// ─── Mock apiClient ─────────────────────────────────────────────────────

const mockApiClient = vi.fn();

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: (url: string, init?: RequestInit) => mockApiClient(url, init),
}));

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

// ─── Fixtures ───────────────────────────────────────────────────────────

const items = [
  {
    id: 101,
    ticketNumber: "TKT-2026-000006",
    createdAt: "2026-08-22T09:00:00.000Z",
    summary: "Laptop battery drains within an hour",
    category: "Hardware",
    requestedPriority: "HIGH",
    itPriority: "URGENT",
    status: "OPEN",
    owner: { id: "staff-1", name: "Alice Chen" },
  },
  {
    id: 102,
    ticketNumber: "TKT-2026-000009",
    createdAt: "2026-08-25T09:00:00.000Z",
    summary: "Print driver missing after update",
    category: "Software",
    requestedPriority: "LOW",
    itPriority: "LOW",
    status: "NEW",
    owner: null,
  },
];

function queueResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    items,
    page: 1,
    pageSize: 10,
    total: 67,
    totalPages: 7,
    ...overrides,
  };
}

/** Route the mocked apiClient by URL so the queue endpoint can be inspected. */
function routeApi(options: {
  response?: unknown;
  ok?: boolean;
  status?: number;
} = {}) {
  mockApiClient.mockImplementation(async (url: string) => {
    if (url.includes("/api/staff/tickets")) {
      const ok = options.ok ?? true;
      return {
        ok,
        status: options.status ?? (ok ? 200 : 500),
        json: async () => options.response ?? queueResponse(),
      };
    }
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/staff/queue"]}>
      <StaffQueuePage />
    </MemoryRouter>,
  );
}

/** Last URL the page asked the API for. */
function lastQueueUrl(): string {
  const calls = mockApiClient.mock.calls.filter((call) => String(call[0]).includes("/api/staff/tickets"));
  return String(calls.at(-1)?.[0] ?? "");
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockApiClient.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── UI-04 ──────────────────────────────────────────────────────────────

describe("UI-04 — Queue table, cards, and pagination (ui-spec §5)", () => {
  beforeEach(() => {
    routeApi();
  });

  it("renders the handout columns in the desktop table", async () => {
    renderPage();

    const table = await screen.findByTestId("queue-table");
    for (const column of [
      "Ticket No.",
      "Created Date",
      "Summary",
      "Category",
      "Req. Priority",
      "IT Priority",
      "Status",
      "Owner",
      "Action",
    ]) {
      expect(within(table).getByRole("columnheader", { name: new RegExp(`^${column}`) })).toBeInTheDocument();
    }
  });

  it("renders a row per ticket with its badges, owner, and an Open action", async () => {
    renderPage();

    const rows = await screen.findAllByTestId("queue-row");
    expect(rows).toHaveLength(2);

    const first = rows[0];
    expect(within(first).getByText("TKT-2026-000006")).toBeInTheDocument();
    expect(within(first).getByText("Hardware")).toBeInTheDocument();
    expect(within(first).getByText("Alice Chen")).toBeInTheDocument();
    // Badges carry a text label, not colour alone (§9). The selector scopes to
    // the Badge's own <span role="status"> ("Open" is also a button label).
    const badge = { selector: "span[role='status']" } as const;
    expect(within(first).getByText("Urgent", badge)).toBeInTheDocument();
    expect(within(first).getByText("High", badge)).toBeInTheDocument();
    expect(within(first).getByText("Open", badge)).toBeInTheDocument();
    expect(
      within(first).getByRole("button", { name: /open ticket TKT-2026-000006/i }),
    ).toBeInTheDocument();

    // Unassigned tickets are labelled, never blank.
    expect(within(rows[1]).getByText("Unassigned")).toBeInTheDocument();
  });

  it("renders stacked-card markup for the mobile/tablet breakpoint", async () => {
    renderPage();

    const cards = await screen.findAllByTestId("queue-card");
    expect(cards).toHaveLength(2);

    const first = cards[0];
    expect(within(first).getByText("TKT-2026-000006")).toBeInTheDocument();
    expect(within(first).getByText("Laptop battery drains within an hour")).toBeInTheDocument();
    const badge = { selector: "span[role='status']" } as const;
    expect(within(first).getByText("Open", badge)).toBeInTheDocument();
    expect(within(first).getByText("Urgent", badge)).toBeInTheDocument();
    expect(within(first).getByText("Alice Chen")).toBeInTheDocument();
    expect(
      within(first).getByRole("button", { name: /open ticket TKT-2026-000006/i }),
    ).toBeInTheDocument();
  });

  it("shows the handout pagination footer exactly", async () => {
    renderPage();

    expect(await screen.findByText("Showing 1 to 10 of 67 tickets")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /previous page/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next page/i })).toBeEnabled();
  });

  it("requests page 2 when Next is clicked", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("queue-table");
    await user.click(screen.getByRole("button", { name: /next page/i }));

    await waitFor(() => {
      expect(lastQueueUrl()).toContain("page=2");
    });
  });

  it("opens the Ticket Detail route using the internal id, not the ticket number", async () => {
    const user = userEvent.setup();
    renderPage();

    const rows = await screen.findAllByTestId("queue-row");
    await user.click(within(rows[0]).getByRole("button", { name: /open ticket/i }));

    expect(mockNavigate).toHaveBeenCalledWith("/staff/tickets/101");
  });

  it("sends the default sort (createdAt desc) on first load", async () => {
    renderPage();

    await screen.findByTestId("queue-table");
    expect(lastQueueUrl()).toContain("sortBy=createdAt");
    expect(lastQueueUrl()).toContain("sortDir=desc");
    expect(lastQueueUrl()).toContain("pageSize=10");
  });

  it("sorts by IT Priority asc then desc when the header is clicked twice", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("queue-table");

    await user.click(screen.getByRole("button", { name: /^IT Priority/ }));
    await waitFor(() => {
      expect(lastQueueUrl()).toContain("sortBy=itPriority");
      expect(lastQueueUrl()).toContain("sortDir=asc");
    });

    await user.click(screen.getByRole("button", { name: /^IT Priority/ }));
    await waitFor(() => {
      expect(lastQueueUrl()).toContain("sortBy=itPriority");
      expect(lastQueueUrl()).toContain("sortDir=desc");
    });
  });

  it("filters by status, IT priority, and ownership", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("queue-table");

    await user.selectOptions(screen.getByLabelText(/^Status/i), "IN_PROGRESS");
    await waitFor(() => expect(lastQueueUrl()).toContain("status=IN_PROGRESS"));

    await user.selectOptions(screen.getByLabelText(/^IT Priority/i), "URGENT");
    await waitFor(() => expect(lastQueueUrl()).toContain("priority=URGENT"));

    await user.selectOptions(screen.getByLabelText(/^Ownership/i), "unassigned");
    await waitFor(() => expect(lastQueueUrl()).toContain("owner=unassigned"));

    // Filters combine.
    expect(lastQueueUrl()).toContain("status=IN_PROGRESS");
  });

  it("debounces the search box and sends q after the pause", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("queue-table");

    await user.type(screen.getByLabelText(/search by ticket number or summary/i), "battery");

    await waitFor(
      () => {
        expect(lastQueueUrl()).toContain("q=battery");
      },
      { timeout: 3000 },
    );
    // Search resets to page 1 so results are never hidden on a stale page.
    expect(lastQueueUrl()).toContain("page=1");
  });
});

// ─── UI-05 ──────────────────────────────────────────────────────────────

describe("UI-05 — empty and no-results states (ui-spec §5)", () => {
  it("shows the empty state when the queue has no tickets at all", async () => {
    routeApi({ response: queueResponse({ items: [], total: 0, totalPages: 1 }) });
    renderPage();

    const empty = await screen.findByTestId("queue-empty");
    expect(within(empty).getByText("No tickets yet.")).toBeInTheDocument();
    // Nothing to clear when no filter is active.
    expect(within(empty).queryByRole("button", { name: /clear filters/i })).not.toBeInTheDocument();
  });

  it("shows the no-results state with a working Clear filters action", async () => {
    const user = userEvent.setup();
    routeApi(); // populated first…
    renderPage();

    await screen.findAllByTestId("queue-row");

    // …then the active filter yields nothing, which is a "no match" state, not
    // the "no tickets yet" empty state.
    routeApi({ response: queueResponse({ items: [], total: 0, totalPages: 1 }) });
    await user.selectOptions(screen.getByLabelText(/^Status/i), "CANCELLED");

    const empty = await screen.findByTestId("queue-empty");
    expect(
      within(empty).getByText("No tickets match your search/filters."),
    ).toBeInTheDocument();

    routeApi(); // restore a populated response for the retry
    await user.click(within(empty).getByRole("button", { name: /clear filters/i }));

    await waitFor(() => {
      expect(lastQueueUrl()).not.toContain("status=CANCELLED");
    });
    expect(await screen.findAllByTestId("queue-row")).toHaveLength(2);
  });

  it("shows skeleton rows while the queue is loading", async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    mockApiClient.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    renderPage();

    expect(screen.getAllByTestId("queue-skeleton-row").length).toBeGreaterThan(0);

    // Settle the request so the test does not leave a dangling state update.
    resolveFetch?.({
      ok: true,
      status: 200,
      json: async () => queueResponse({ items: [], total: 0, totalPages: 1 }),
    });
    await screen.findByTestId("queue-empty");
  });

  it("shows a retry banner when the queue request fails", async () => {
    const user = userEvent.setup();
    routeApi({ ok: false, status: 500 });
    renderPage();

    const banner = await screen.findByTestId("queue-error");
    expect(
      within(banner).getByText("Couldn't load the queue. Retry."),
    ).toBeInTheDocument();

    routeApi();
    await user.click(within(banner).getByRole("button", { name: /retry/i }));

    expect(await screen.findAllByTestId("queue-row")).toHaveLength(2);
  });
});
