import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import StaffTicketDetailPage from "../../src/pages/StaffTicketDetailPage";

/**
 * IT Staff Ticket Detail — tests.md §5 (ui-spec.md §6)
 *
 *   UI-06  Public Comments and Internal Notes render as VISUALLY DISTINCT
 *          panels, plus the claim/reassign, IT Priority, requester-signal, and
 *          read-only attachment behaviours
 *   UI-07  the Status control offers exactly the permitted next states from the
 *          ui-spec.md §6.1 transition matrix — never more
 */

// ─── Mock apiClient ─────────────────────────────────────────────────────

const mockApiClient = vi.fn();

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: (url: string, init?: RequestInit) => mockApiClient(url, init),
}));

// ─── Spec fixtures ──────────────────────────────────────────────────────

/**
 * The transition matrix from ui-spec.md §6.1, transcribed independently here so
 * UI-07 fails loudly if the client ever renders options the spec does not allow.
 * (The server enforces the same table — see server/src/lib/statusTransitions.ts.)
 */
const SPEC_MATRIX: Record<string, string[]> = {
  NEW: ["OPEN", "IN_PROGRESS", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "REOPENED"],
  CLOSED: ["REOPENED"],
  REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "CANCELLED"],
  CANCELLED: [],
};

const OWNERS = [
  { id: "staff-1", name: "Alice Chen", email: "alice.chen@toktickit.example.com" },
  { id: "staff-2", name: "Ben Carter", email: "ben.carter@toktickit.example.com" },
];

function makeTicket(overrides: Record<string, unknown> = {}) {
  const status = (overrides.status as string) ?? "IN_PROGRESS";
  return {
    id: 42,
    ticketNumber: "TKT-2026-000006",
    createdAt: "2026-08-22T09:00:00.000Z",
    updatedAt: "2026-09-01T09:00:00.000Z",
    summary: "Laptop battery drains within an hour",
    description: "The battery drains within an hour of a full charge and the fan runs constantly.",
    category: { id: 1, name: "Hardware" },
    relatedSystem: { id: 1, name: "Corporate Laptop" },
    requester: {
      id: "req-1",
      name: "Jennifer Anderson",
      email: "jennifer.anderson@example.com",
    },
    owner: { id: "staff-1", name: "Alice Chen", email: "alice.chen@toktickit.example.com" },
    requestedPriority: "HIGH",
    itPriority: "URGENT",
    status,
    requesterMarkedResolved: false,
    requesterMarkedResolvedAt: null,
    resolutionSummary: null,
    allowedStatusTransitions: SPEC_MATRIX[status] ?? [],
    ...overrides,
  };
}

const NOTE_ITEM = {
  id: "note-1",
  ticketId: 42,
  authorId: "staff-1",
  authorName: "Alice Chen",
  authorRole: "IT_STAFF",
  content: "Replacement battery ordered under PO-4471.",
  createdAt: "2026-09-01T09:30:00.000Z",
};

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function routeApi(options: {
  ticket?: Record<string, unknown>;
  notes?: unknown[];
  comments?: unknown[];
  detailOk?: boolean;
  detailStatus?: number;
  priorityTicket?: Record<string, unknown>;
  statusTicket?: Record<string, unknown>;
  claimTicket?: Record<string, unknown>;
  assignTicket?: Record<string, unknown>;
} = {}) {
  const ticket = options.ticket ?? makeTicket();

  mockApiClient.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.includes("/api/staff/owners")) return ok({ items: OWNERS });

    if (url.includes("/notes")) {
      return {
        ok: true,
        status: 201,
        json: async () =>
          method === "POST"
            ? { ...NOTE_ITEM, id: "note-new", content: "new note" }
            : { items: options.notes ?? [] },
      };
    }

    if (url.includes("/comments")) {
      return {
        ok: true,
        status: 201,
        json: async () =>
          method === "POST"
            ? { ...NOTE_ITEM, id: "comment-new", authorRole: "IT_STAFF" }
            : { items: options.comments ?? [] },
      };
    }

    if (url.includes("/priority")) {
      return ok({ ticket: options.priorityTicket ?? { ...ticket, itPriority: "HIGH" } });
    }

    if (url.includes("/status")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { status?: string };
      return ok({
        ticket:
          options.statusTicket ??
          { ...ticket, status: body.status, allowedStatusTransitions: SPEC_MATRIX[body.status ?? ""] ?? [] },
      });
    }

    if (url.includes("/claim")) {
      return ok({ ticket: options.claimTicket ?? { ...ticket, owner: OWNERS[0] } });
    }

    if (url.includes("/assign")) {
      return ok({ ticket: options.assignTicket ?? { ...ticket, owner: OWNERS[1] } });
    }

    // Ticket detail
    if (options.detailOk === false) {
      return {
        ok: false,
        status: options.detailStatus ?? 500,
        json: async () => ({ error: { code: "SERVER_ERROR", message: "boom" } }),
      };
    }
    return ok({
      ticket,
      attachments: {
        active: [
          {
            id: 7,
            originalFileName: "battery-report.pdf",
            fileSizeBytes: 2048,
            mimeType: "application/pdf",
            uploadedAt: "2026-08-22T10:00:00.000Z",
          },
        ],
        removed: [],
      },
    });
  });
}

function renderPage(id = 42) {
  return render(
    <MemoryRouter initialEntries={[`/staff/tickets/${id}`]}>
      <Routes>
        <Route path="/staff/tickets/:id" element={<StaffTicketDetailPage />} />
        <Route path="/staff/queue" element={<div>Queue Landing</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function renderLoaded() {
  renderPage();
  await screen.findByTestId("staff-ticket-header");
}

beforeEach(() => {
  mockApiClient.mockReset();
  routeApi();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── UI-06 ──────────────────────────────────────────────────────────────

describe("UI-06 — Public Comments vs Internal Notes are visually distinct (ui-spec §6.5/§6.6)", () => {
  it("renders both panels with different variants and class names", async () => {
    await renderLoaded();

    const publicPanel = screen.getByTestId("public-comments-panel");
    const notesPanel = screen.getByTestId("internal-notes-panel");

    expect(publicPanel).toHaveAttribute("data-variant", "public");
    expect(notesPanel).toHaveAttribute("data-variant", "internal");
    // The internal panel must not be styled as the public one.
    expect(notesPanel.className).not.toBe(publicPanel.className);
  });

  it("labels the internal panel with the lock icon and the IT-only header", async () => {
    await renderLoaded();

    const notesPanel = screen.getByTestId("internal-notes-panel");

    expect(
      within(notesPanel).getByRole("heading", {
        name: /internal notes \(IT Staff & Administrator only\)/i,
      }),
    ).toBeInTheDocument();
    expect(within(notesPanel).getByTestId("internal-notes-lock")).toBeInTheDocument();

    expect(
      screen.getByRole("heading", { name: /^public comments$/i }),
    ).toBeInTheDocument();
  });

  it("gives each panel its own composer, counter, and list", async () => {
    routeApi({ notes: [NOTE_ITEM] });
    await renderLoaded();

    // Public comments → its own composer + counter
    expect(await screen.findByLabelText("Add a comment")).toBeInTheDocument();
    expect(screen.getByTestId("comment-counter")).toHaveTextContent("0/2000");

    // Internal notes → its own composer + counter + item
    expect(await screen.findByLabelText("Add an internal note")).toBeInTheDocument();
    expect(screen.getByTestId("note-counter")).toHaveTextContent("0/2000");

    const noteItems = await screen.findAllByTestId("note-item");
    expect(noteItems).toHaveLength(1);
    expect(noteItems[0]).toHaveTextContent("Replacement battery ordered under PO-4471.");

    // The note must NOT appear in the public comments list.
    expect(screen.queryAllByTestId("comment-item")).toHaveLength(0);
  });

  it("points each panel at its own endpoint (staff comments vs IT-only notes)", async () => {
    await renderLoaded();
    await screen.findByLabelText("Add an internal note");

    const urls = mockApiClient.mock.calls.map((call) => String(call[0]));

    expect(urls).toContain("/api/staff/tickets/42/comments");
    expect(urls).toContain("/api/staff/tickets/42/notes");
  });

  it("shows the requester appears-resolved signal as a distinct banner", async () => {
    routeApi({
      ticket: makeTicket({
        requesterMarkedResolved: true,
        requesterMarkedResolvedAt: "2026-09-01T09:00:00.000Z",
      }),
    });
    await renderLoaded();

    const banner = screen.getByTestId("requester-signal");
    expect(banner).toHaveTextContent(/Requester marked this as appears-resolved on/i);
    // The formal Status is still shown unchanged, and separately.
    expect(within(screen.getByTestId("status-control")).getByText("In Progress")).toBeInTheDocument();
  });

  it("keeps attachments read-only (no upload control)", async () => {
    await renderLoaded();

    const attachments = screen.getByTestId("staff-attachments");
    expect(within(attachments).getByText("battery-report.pdf")).toBeInTheDocument();
    expect(within(attachments).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("UI-06 — ownership, IT Priority, and page states", () => {
  it("shows Claim only while the ticket is unassigned", async () => {
    routeApi({ ticket: makeTicket({ owner: null }) });
    await renderLoaded();

    expect(screen.getByTestId("owner-display")).toHaveTextContent("Unassigned");
    expect(screen.getByRole("button", { name: /^claim$/i })).toBeInTheDocument();
  });

  it("hides Claim and offers Reassign once the ticket has an owner", async () => {
    await renderLoaded();

    expect(screen.getByTestId("owner-display")).toHaveTextContent("Alice Chen");
    expect(screen.queryByRole("button", { name: /^claim$/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/reassign owner/i)).toBeInTheDocument();
  });

  it("claims the ticket through the staff claim endpoint", async () => {
    const user = userEvent.setup();
    routeApi({ ticket: makeTicket({ owner: null }) });
    await renderLoaded();

    await user.click(screen.getByRole("button", { name: /^claim$/i }));

    await waitFor(() => {
      const claimCall = mockApiClient.mock.calls.find((call) =>
        String(call[0]).includes("/api/staff/tickets/42/claim"),
      );
      expect(claimCall).toBeDefined();
      expect((claimCall?.[1] as RequestInit | undefined)?.method).toBe("POST");
    });
    expect(await screen.findByTestId("owner-success")).toHaveTextContent(/claimed by alice chen/i);
  });

  it("reassigns to the selected active IT Staff member", async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.selectOptions(await screen.findByLabelText(/reassign owner/i), "staff-2");
    await user.click(screen.getByRole("button", { name: /^reassign$/i }));

    await waitFor(() => {
      const assignCall = mockApiClient.mock.calls.find((call) =>
        String(call[0]).includes("/api/staff/tickets/42/assign"),
      );
      expect(assignCall).toBeDefined();
      expect(JSON.parse(String((assignCall?.[1] as RequestInit)?.body))).toEqual({
        ownerId: "staff-2",
      });
    });
  });

  it("saves IT Priority on change and never touches Requested Priority", async () => {
    const user = userEvent.setup();
    await renderLoaded();

    // Requested Priority is read-only text/badge, not a control.
    expect(screen.queryByLabelText(/requested priority/i)).not.toBeInTheDocument();
    expect(screen.getByText("High", { selector: "span[role='status']" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^IT Priority/i), "HIGH");

    await waitFor(() => {
      const call = mockApiClient.mock.calls.find((c) =>
        String(c[0]).includes("/api/staff/tickets/42/priority"),
      );
      expect(call).toBeDefined();
      expect((call?.[1] as RequestInit)?.method).toBe("PATCH");
      expect(JSON.parse(String((call?.[1] as RequestInit)?.body))).toEqual({ itPriority: "HIGH" });
    });
    expect(await screen.findByTestId("priority-success")).toBeInTheDocument();
  });

  it("shows a safe retry banner when the detail request fails", async () => {
    routeApi({ detailOk: false, detailStatus: 500 });
    renderPage();

    expect(await screen.findByTestId("staff-detail-error")).toHaveTextContent(
      /Couldn't load this ticket/i,
    );
  });

  it("shows the not-found state for a missing ticket", async () => {
    routeApi({ detailOk: false, detailStatus: 404 });
    renderPage();

    expect(await screen.findByTestId("staff-detail-not-found")).toHaveTextContent(
      /Ticket not found./i,
    );
  });

  it("shows the forbidden state when the role is refused", async () => {
    routeApi({ detailOk: false, detailStatus: 403 });
    renderPage();

    expect(await screen.findByTestId("staff-detail-forbidden")).toHaveTextContent(
      /don't have access to this ticket/i,
    );
  });
});

// ─── UI-07 ──────────────────────────────────────────────────────────────

describe("UI-07 — Status control offers only permitted next states (ui-spec §6.1)", () => {
  for (const status of Object.keys(SPEC_MATRIX)) {
    it(`offers exactly the §6.1 next states for ${status}`, async () => {
      routeApi({ ticket: makeTicket({ status }) });
      await renderLoaded();

      const select = screen.getByLabelText(/change status/i);
      const optionValues = Array.from(select.querySelectorAll("option"))
        .map((option) => option.getAttribute("value"))
        .filter((value): value is string => value !== "");

      expect(optionValues).toEqual(SPEC_MATRIX[status]);
    });
  }

  it("never offers a status the matrix forbids (e.g. CLOSED from IN_PROGRESS)", async () => {
    routeApi({ ticket: makeTicket({ status: "IN_PROGRESS" }) });
    await renderLoaded();

    const select = screen.getByLabelText(/change status/i);
    const rendered = Array.from(select.querySelectorAll("option")).map((option) => option.textContent);

    expect(rendered).not.toContain("Closed");
    expect(rendered).not.toContain("New");
    expect(rendered).not.toContain("Reopened");
    expect(rendered).toContain("Resolved");
  });

  it("disables the control and explains why for the terminal CANCELLED status", async () => {
    routeApi({ ticket: makeTicket({ status: "CANCELLED" }) });
    await renderLoaded();

    expect(screen.getByLabelText(/change status/i)).toBeDisabled();
    expect(
      screen.getByText(/terminal status and cannot be moved/i),
    ).toBeInTheDocument();
  });

  it("applies a non-terminal transition immediately (no dialog)", async () => {
    const user = userEvent.setup();
    routeApi({ ticket: makeTicket({ status: "IN_PROGRESS" }) });
    await renderLoaded();

    await user.selectOptions(screen.getByLabelText(/change status/i), "WAITING_FOR_REQUESTER");
    await user.click(screen.getByRole("button", { name: /^change status$/i }));

    expect(screen.queryByTestId("status-confirm-dialog")).not.toBeInTheDocument();
    await waitFor(() => {
      const call = mockApiClient.mock.calls.find((c) =>
        String(c[0]).includes("/api/staff/tickets/42/status"),
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String((call?.[1] as RequestInit)?.body))).toEqual({
        status: "WAITING_FOR_REQUESTER",
      });
    });
    expect(await screen.findByTestId("status-success")).toBeInTheDocument();
  });

  for (const target of ["RESOLVED", "CLOSED", "CANCELLED"]) {
    it(`requires confirmation before moving to ${target}`, async () => {
      const user = userEvent.setup();
      const from =
        target === "CLOSED" ? "RESOLVED" : target === "CANCELLED" ? "OPEN" : "IN_PROGRESS";
      routeApi({ ticket: makeTicket({ status: from }) });
      await renderLoaded();

      await user.selectOptions(screen.getByLabelText(/change status/i), target);
      await user.click(screen.getByRole("button", { name: /^change status$/i }));

      const dialog = await screen.findByTestId("status-confirm-dialog");
      expect(dialog).toHaveAttribute("role", "dialog");

      // Nothing has been sent until the user confirms.
      expect(
        mockApiClient.mock.calls.some((c) => String(c[0]).includes("/api/staff/tickets/42/status")),
      ).toBe(false);

      await user.click(within(dialog).getByRole("button", { name: /^continue$/i }));

      await waitFor(() => {
        const call = mockApiClient.mock.calls.find((c) =>
          String(c[0]).includes("/api/staff/tickets/42/status"),
        );
        expect(JSON.parse(String((call?.[1] as RequestInit)?.body))).toEqual({ status: target });
      });
    });
  }
});
