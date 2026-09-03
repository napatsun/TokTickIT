/**
 * RequesterTicketDetail.test.tsx — UI tests for TicketDetailPage
 *
 * Covers:
 *   UI-12 — AC-16: Render Ticket Detail with mocked owned-ticket response
 *            All header fields render as read-only, no editable inputs
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TicketDetailPage from "../../src/pages/TicketDetailPage";

// ─── Mock apiClient ─────────────────────────────────────────────────────

const mockApiResponse = vi.fn();

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: vi.fn(async (_url: string | URL | Request) => {
    const result = mockApiResponse();
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

    // Check that all text inputs are readonly (not disabled — Field uses readonly attribute)
    const inputs = screen.getAllByRole("textbox");
    for (const input of inputs) {
      expect(input).toHaveAttribute("readonly");
    }
  });
});
