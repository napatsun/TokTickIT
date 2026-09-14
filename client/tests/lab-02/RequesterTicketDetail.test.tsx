/**
 * RequesterTicketDetail.test.tsx — UI tests for TicketDetailPage
 *
 * Covers:
 *   UI-12 — AC-16: Render Ticket Detail with mocked owned-ticket response
 *            All header fields render as read-only, no editable inputs
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TicketDetailPage from "../../src/pages/TicketDetailPage";

// ─── Mock apiClient ─────────────────────────────────────────────────────

const mockApiResponse = vi.fn();

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const result = mockApiResponse(String(url), init);
    const data = await result;
    return {
      ok: data._ok !== undefined ? data._ok : true,
      status: data.status ?? 200,
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

// ─── Mock data ──────────────────────────────────────────────────────────

const mockTicket = {
  id: 501,
  ticketNumber: "TKT-2026-000501",
  ticketDate: "2026-08-22T09:14:00.000Z",
  requester: { id: 1, fullName: "Jennifer Anderson" },
  category: { id: 2, name: "Hardware" },
  relatedSystem: { id: 4, name: "Corporate Laptop" },
  summary: "Laptop battery drains quickly",
  description:
    "My laptop battery is draining much faster than usual, lasting only 2 hours on a full charge.",
  requestedPriority: "MEDIUM",
  itPriority: null,
  currentStatus: "NEW",
  ticketOwner: null,
  resolutionSummary: null,
};

const mockAttachments = {
  active: [
    {
      id: 9001,
      originalFileName: "battery_report.pdf",
      fileSizeBytes: 204800,
      mimeType: "application/pdf",
      uploadedAt: "2026-08-22T09:14:00.500Z",
    },
  ],
  removed: [
    {
      id: 9002,
      originalFileName: "old_log.png",
      fileSizeBytes: 51200,
      removedAt: "2026-08-22T10:00:00.000Z",
      removedReason: "Uploaded wrong file",
    },
  ],
};

function createMockResponse(data: any) {
  return { _ok: true, ...data };
}

function renderPage(ticketNumber = "TKT-2026-000501") {
  return render(
    <MemoryRouter initialEntries={[`/tickets/${ticketNumber}`]}>
      <Routes>
        <Route path="/tickets/:ticketNumber" element={<TicketDetailPage />} />
        <Route path="/tickets" element={<div>My Tickets</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("UI-36 — Ticket Detail loading state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows skeleton loading indicator while fetching ticket detail", () => {
    // Never resolve the mock — keeps loading state
    mockApiResponse.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByLabelText("Loading ticket details")).toBeInTheDocument();
    // Back link should still be visible during loading
    expect(screen.getByText(/← Back to My Tickets/)).toBeInTheDocument();
  });

  it("hides skeleton after data loads successfully", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({
        ticket: mockTicket,
        attachments: mockAttachments,
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue("TKT-2026-000501")).toBeInTheDocument();
    });

    expect(screen.queryByLabelText("Loading ticket details")).not.toBeInTheDocument();
  });
});

describe("UI-37 — Ticket Detail not-found state (BR-13)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'Ticket not found.' message when API returns 404", async () => {
    mockApiResponse.mockReturnValue(
      createMockResponse({ _ok: false, status: 404 }),
    );

    // Override the mock to return 404
    mockApiResponse.mockReturnValue({ _ok: false, status: 404 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Ticket not found.")).toBeInTheDocument();
    });

    // Back button should be present
    expect(screen.getByText("Back to My Tickets")).toBeInTheDocument();
  });

  it("navigates to My Tickets when Back button is clicked", async () => {
    mockApiResponse.mockReturnValue({ _ok: false, status: 404 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Ticket not found.")).toBeInTheDocument();
    });

    const backButton = screen.getByText("Back to My Tickets");
    await userEvent.click(backButton);

    expect(mockNavigate).toHaveBeenCalledWith("/tickets");
  });

  it("does NOT show header block or attachments in not-found state", async () => {
    mockApiResponse.mockReturnValue({ _ok: false, status: 404 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Ticket not found.")).toBeInTheDocument();
    });

    expect(screen.queryByText("Ticket Detail")).not.toBeInTheDocument();
    expect(screen.queryByText(/Attachments/)).not.toBeInTheDocument();
  });
});

describe("UI-38 — Ticket Detail error state + retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows error message when API returns 500", async () => {
    mockApiResponse.mockReturnValue({ _ok: false, status: 500 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Couldn't load ticket details.")).toBeInTheDocument();
    });

    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("shows error message on network failure", async () => {
    mockApiResponse.mockRejectedValue(new Error("Network error"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Couldn't load ticket details.")).toBeInTheDocument();
    });
  });

  it("Retry button re-fetches ticket detail successfully", async () => {
    // First call fails
    mockApiResponse.mockReturnValueOnce({ _ok: false, status: 500 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Couldn't load ticket details.")).toBeInTheDocument();
    });

    // Second call succeeds
    mockApiResponse.mockReturnValueOnce(
      createMockResponse({
        ticket: mockTicket,
        attachments: mockAttachments,
      }),
    );

    const retryButton = screen.getByText("Retry");
    await userEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.getByDisplayValue("TKT-2026-000501")).toBeInTheDocument();
    });

    // Error should be gone
    expect(screen.queryByText("Couldn't load ticket details.")).not.toBeInTheDocument();
  });
});

describe("UI-12 — Ticket Detail renders with correct fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiResponse.mockReturnValue(
      createMockResponse({
        ticket: mockTicket,
        attachments: mockAttachments,
      }),
    );
  });

  it("renders all header fields as read-only", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue("TKT-2026-000501")).toBeInTheDocument();
    });

    // All header fields should be present and read-only
    expect(screen.getByDisplayValue("TKT-2026-000501")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Hardware")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Corporate Laptop")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Jennifer Anderson")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Not yet assigned")).toBeInTheDocument(); // Ticket Owner

    // Priority badge
    expect(screen.getByText("Medium")).toBeInTheDocument();
    // Status badge
    expect(screen.getByText("New")).toBeInTheDocument();
    // IT Priority shows "Not yet assigned" as muted text
    expect(screen.getByText("Not yet assigned")).toBeInTheDocument();
  });

  it("renders summary and description", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Laptop battery drains quickly")).toBeInTheDocument();
    });

    expect(
      screen.getByDisplayValue(
        "My laptop battery is draining much faster than usual, lasting only 2 hours on a full charge.",
      ),
    ).toBeInTheDocument();
  });

  it("renders resolution summary as muted text when null", async () => {
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText("No resolution summary available yet."),
      ).toBeInTheDocument();
    });
  });

  it("renders active attachments", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("battery_report.pdf")).toBeInTheDocument();
    });

    expect(screen.getByText("Download")).toBeInTheDocument();
    expect(screen.getByText("Remove")).toBeInTheDocument();
  });

  it("renders removed attachments with Unavailable label", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("old_log.png")).toBeInTheDocument();
    });

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    // Removal reason is part of a larger text node
    expect(screen.getByText(/Uploaded wrong file/)).toBeInTheDocument();
  });

  it("renders attachment count in heading", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Attachments (1 active)")).toBeInTheDocument();
    });
  });

  it("renders Back to My Tickets link", async () => {
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText("← Back to My Tickets"),
      ).toBeInTheDocument();
    });
  });

  it("no editable input elements present (all readonly)", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue("TKT-2026-000501")).toBeInTheDocument();
    });

    // Every read-only ticket field. The Lab 3 Public Comments composer is a
    // textarea and is intentionally excluded here (see UI-03 below).
    const inputs = screen
      .getAllByRole("textbox")
      .filter((element) => element.id !== "public-comment");

    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input).toHaveAttribute("readonly");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// Lab 3 additions (ui-spec.md §4): Public Comments + "Problem Appears
// Resolved". Kept in this file because the Requester Ticket Detail screen and
// its fixtures already live here.
// ══════════════════════════════════════════════════════════════════════

const openTicket = {
  ...mockTicket,
  currentStatus: "OPEN",
  requesterMarkedResolved: false,
  requesterMarkedResolvedAt: null,
};

const existingComments = [
  {
    id: "comment-1",
    ticketId: 501,
    authorId: "user-1",
    authorName: "Jennifer Anderson",
    authorRole: "REQUESTER",
    content: "The battery diagnostic finished.",
    createdAt: "2026-09-01T09:00:00.000Z",
  },
  {
    id: "comment-2",
    ticketId: 501,
    authorId: "user-2",
    authorName: "Alice Chen",
    authorRole: "IT_STAFF",
    content: "A replacement battery is on order.",
    createdAt: "2026-09-01T09:20:00.000Z",
  },
];

/** Route the mocked apiClient by URL so ticket / comments / resolve-mark can differ. */
function routeApi(options: {
  ticket: Record<string, unknown>;
  comments?: typeof existingComments;
  postComment?: { _ok: boolean; status?: number; body?: unknown };
  resolveMark?: { _ok: boolean; status?: number };
}) {
  mockApiResponse.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes("/comments")) {
      if (init?.method === "POST") {
        const post = options.postComment ?? { _ok: true };
        if (!post._ok) return { _ok: false, status: post.status ?? 500 };
        const parsed = JSON.parse(String(init.body)) as { content: string };
        return {
          id: `comment-${existingComments.length + 1}`,
          ticketId: 501,
          authorId: "user-1",
          authorName: "Jennifer Anderson",
          authorRole: "REQUESTER",
          content: parsed.content,
          createdAt: "2026-09-10T10:00:00.000Z",
        };
      }
      return { items: options.comments ?? [] };
    }

    if (url.includes("/resolve-mark")) {
      const mark = options.resolveMark ?? { _ok: true };
      if (!mark._ok) return { _ok: false, status: mark.status ?? 500 };
      return {
        requesterMarkedResolved: true,
        requesterMarkedResolvedAt: "2026-09-10T10:00:00.000Z",
      };
    }

    return { ticket: options.ticket, attachments: mockAttachments };
  });
}

describe("UI-03 — Public Comments panel (ui-spec §4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeApi({ ticket: openTicket, comments: existingComments });
  });

  it("renders the comment list oldest-first with author name, role, and timestamp", async () => {
    renderPage();

    const items = await screen.findAllByTestId("comment-item");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("The battery diagnostic finished.");
    expect(items[1]).toHaveTextContent("A replacement battery is on order.");

    expect(screen.getByText("Jennifer Anderson")).toBeInTheDocument();
    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    // Human-readable role labels, not raw enum values, scoped to each comment.
    expect(within(items[0]).getByText("Requester")).toBeInTheDocument();
    expect(within(items[1]).getByText("IT Staff")).toBeInTheDocument();
    expect(screen.getByText("Public Comments")).toBeInTheDocument();
  });

  it("shows the empty state when the ticket has no comments", async () => {
    routeApi({ ticket: openTicket, comments: [] });
    renderPage();

    expect(await screen.findByTestId("comments-empty")).toBeInTheDocument();
  });

  it("disables Post Comment while the draft is empty or whitespace-only", async () => {
    renderPage();

    const button = await screen.findByRole("button", { name: /post comment/i });
    expect(button).toBeDisabled();

    const textarea = screen.getByLabelText("Add a comment");
    await userEvent.type(textarea, "    ");
    expect(button).toBeDisabled();

    await userEvent.type(textarea, "Something helpful");
    expect(button).toBeEnabled();
  });

  it("shows a live character counter against the 2,000 character limit (BR-18)", async () => {
    renderPage();

    const textarea = await screen.findByLabelText("Add a comment");
    expect(textarea).toHaveAttribute("maxlength", "2000");
    expect(screen.getByTestId("comment-counter")).toHaveTextContent("0/2000");

    await userEvent.type(textarea, "Battery");
    expect(screen.getByTestId("comment-counter")).toHaveTextContent("7/2000");
  });

  it("posts a comment, appends it to the list, and clears the draft", async () => {
    renderPage();

    const textarea = await screen.findByLabelText("Add a comment");
    await userEvent.type(textarea, "Still seeing the drain.");
    await userEvent.click(screen.getByRole("button", { name: /post comment/i }));

    await waitFor(() => {
      expect(screen.getByTestId("comment-success")).toBeInTheDocument();
    });

    const items = screen.getAllByTestId("comment-item");
    expect(items).toHaveLength(3);
    expect(items[2]).toHaveTextContent("Still seeing the drain.");
    expect(screen.getByLabelText("Add a comment")).toHaveValue("");
  });

  it("preserves the draft and shows a safe banner when posting fails", async () => {
    routeApi({
      ticket: openTicket,
      comments: existingComments,
      postComment: { _ok: false, status: 500 },
    });
    renderPage();

    const textarea = await screen.findByLabelText("Add a comment");
    await userEvent.type(textarea, "This draft must survive the failure");
    await userEvent.click(screen.getByRole("button", { name: /post comment/i }));

    expect(await screen.findByTestId("comment-error")).toBeInTheDocument();
    // Draft preserved so the user does not lose their text.
    expect(screen.getByLabelText("Add a comment")).toHaveValue(
      "This draft must survive the failure",
    );
    expect(screen.getAllByTestId("comment-item")).toHaveLength(2);
  });
});

describe('FR-15 — "Problem Appears Resolved" (ui-spec §4, AC-11)', () => {
  it("shows the action for an eligible status", async () => {
    vi.clearAllMocks();
    routeApi({ ticket: openTicket });
    renderPage();

    expect(
      await screen.findByRole("button", { name: /problem appears resolved/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("requester-resolved-badge")).not.toBeInTheDocument();
  });

  it("hides the action for statuses that are not eligible", async () => {
    for (const status of ["NEW", "RESOLVED", "CLOSED", "CANCELLED"]) {
      vi.clearAllMocks();
      routeApi({ ticket: { ...mockTicket, currentStatus: status, requesterMarkedResolved: false } });
      const { unmount } = renderPage();

      await waitFor(() => {
        expect(screen.getByDisplayValue("TKT-2026-000501")).toBeInTheDocument();
      });

      expect(
        screen.queryByRole("button", { name: /problem appears resolved/i }),
        `${status} should not offer the action`,
      ).not.toBeInTheDocument();
      unmount();
    }
  });

  it("shows the marker badge and hides the action once already marked", async () => {
    vi.clearAllMocks();
    routeApi({
      ticket: {
        ...mockTicket,
        currentStatus: "OPEN",
        requesterMarkedResolved: true,
        requesterMarkedResolvedAt: "2026-09-05T10:00:00.000Z",
      },
    });
    renderPage();

    const badge = await screen.findByTestId("requester-resolved-badge");
    expect(badge).toHaveTextContent(/You marked this as resolved on/i);
    expect(
      screen.queryByRole("button", { name: /problem appears resolved/i }),
    ).not.toBeInTheDocument();
    // The formal Status badge is unchanged and separate from the marker.
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("asks for confirmation with the exact spec copy before sending", async () => {
    vi.clearAllMocks();
    routeApi({ ticket: openTicket });
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: /problem appears resolved/i }),
    );

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "This tells IT Staff the issue seems fixed. IT Staff will still need to formally close the ticket. Continue?",
    );

    // Cancel closes the dialog without sending anything.
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /problem appears resolved/i }),
    ).toBeInTheDocument();
  });

  it("confirms, records the marker, keeps currentStatus untouched, and hides the action", async () => {
    vi.clearAllMocks();
    routeApi({ ticket: openTicket });
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: /problem appears resolved/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByTestId("requester-resolved-badge")).toHaveTextContent(
      /You marked this as resolved on/i,
    );
    expect(
      screen.queryByRole("button", { name: /problem appears resolved/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Status badge still shows the formal status (BR-20).
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.queryByText("Resolved")).not.toBeInTheDocument();
  });

  it("shows a safe banner and leaves the state unchanged when the request fails", async () => {
    vi.clearAllMocks();
    routeApi({ ticket: openTicket, resolveMark: { _ok: false, status: 500 } });
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: /problem appears resolved/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't record your response/i,
    );
    // Dialog stays open and the action is still offered.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("requester-resolved-badge")).not.toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
  });
});
