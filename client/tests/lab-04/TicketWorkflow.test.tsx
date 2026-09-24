import { type ComponentProps } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import TicketWorkflowControls from "../../src/components/ticket-detail/TicketWorkflowControls";
import { expectNoA11yViolations } from "../support/a11y";
import type { AuthUser } from "../../src/contexts/AuthContext";

/**
 * Ticket Workflow controls — tests.md §2 (ui-spec.md §5)
 *
 *   UI-05  the status control renders only the transitions the current
 *          (role × status) permits — disallowed options are absent from the DOM
 *          entirely, not merely disabled
 *   UI-06  the Resolved transition is present but DISABLED with an accessible
 *          explanation while BR-09's Actions-Taken precondition is unmet
 *   plus   the non-optimistic badge (§5), the STALE_VERSION reconciliation
 *          banner, the confirmation step, and the Requester advisory button
 *
 * Conventions match the Lab 3/Lab 4 suites: React Testing Library + a mocked
 * `apiClient` (no live network) + jest-axe via tests/support/a11y.
 */

// ─── Mock apiClient ─────────────────────────────────────────────────────

const mockApiClient = vi.fn();

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: (url: string, init?: RequestInit) => mockApiClient(url, init),
}));

// ─── Fixtures ───────────────────────────────────────────────────────────

const RESOLVE_NOTE = "Add at least one Actions Taken with a result before resolving.";

function userFor(role: AuthUser["role"]): AuthUser {
  return {
    id: `user-${role}`,
    name: `${role} Person`,
    email: `${role.toLowerCase()}@example.com`,
    role,
    isActive: true,
    mustChangePassword: false,
  };
}

function ok(body: unknown, status = 200) {
  return { ok: true, status, json: async () => body };
}

function conflict(code: string, extra: Record<string, unknown> = {}) {
  return {
    ok: false,
    status: 409,
    json: async () => ({ error: { code, message: "conflict" }, ...extra }),
  };
}

function workflowTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    ticketNumber: "TKT-2026-000042",
    status: "IN_PROGRESS",
    version: 4,
    resolvedAt: null,
    ownerId: null,
    requesterId: "user-REQUESTER",
    requesterConfirmedResolved: false,
    requesterConfirmedResolvedAt: null,
    updatedAt: "2026-09-10T10:00:00.000Z",
    allowedStatusTransitions: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
    ...overrides,
  };
}

function renderControls(
  props: Partial<ComponentProps<typeof TicketWorkflowControls>> = {},
) {
  const onTicketUpdated = props.onTicketUpdated ?? vi.fn();
  const onReload = props.onReload ?? vi.fn();

  const utils = render(
    <TicketWorkflowControls
      ticketId={42}
      currentUser={userFor("IT_STAFF")}
      currentStatus="NEW"
      version={3}
      resolvedAt={null}
      allowedTransitions={["OPEN", "IN_PROGRESS", "CANCELLED"]}
      hasActionsWithResult
      requesterConfirmedResolved={false}
      requesterConfirmedResolvedAt={null}
      onTicketUpdated={onTicketUpdated}
      onReload={onReload}
      {...props}
    />,
  );

  return { ...utils, onTicketUpdated, onReload };
}

beforeEach(() => {
  mockApiClient.mockReset();
  mockApiClient.mockResolvedValue(ok({ ticket: workflowTicket() }));
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── UI-05 — only permitted transitions ─────────────────────────────────

describe("UI-05 — only permitted transitions are rendered (ui-spec §5)", () => {
  it("renders one control per permitted transition and nothing else", async () => {
    renderControls({
      currentStatus: "NEW",
      allowedTransitions: ["OPEN", "IN_PROGRESS", "CANCELLED"],
    });

    expect(screen.getByTestId("workflow-transition-OPEN")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-transition-IN_PROGRESS")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-transition-CANCELLED")).toBeInTheDocument();

    // Every non-permitted status is absent from the DOM entirely.
    for (const disallowed of [
      "NEW",
      "WAITING_FOR_REQUESTER",
      "RESOLVED",
      "CLOSED",
      "REOPENED",
    ]) {
      expect(screen.queryByTestId(`workflow-transition-${disallowed}`)).not.toBeInTheDocument();
    }

    // The control carries the current status as visible text (never colour-only).
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("gives a Requester only their own-Ticket transitions, plus the advisory button", async () => {
    renderControls({
      currentUser: userFor("REQUESTER"),
      currentStatus: "OPEN",
      allowedTransitions: ["CANCELLED"],
    });

    expect(screen.getByTestId("workflow-transition-CANCELLED")).toBeInTheDocument();
    expect(screen.queryByTestId("workflow-transition-RESOLVED")).not.toBeInTheDocument();
    expect(screen.queryByTestId("workflow-transition-IN_PROGRESS")).not.toBeInTheDocument();

    expect(screen.getByTestId("requester-confirmation-button")).toHaveTextContent(
      /this looks resolved to me/i,
    );
    expect(screen.getByTestId("requester-confirmation-helper")).toHaveTextContent(
      "Your IT Staff will review and confirm.",
    );
  });

  it("offers no transition group at all for a status with no outbound transitions", async () => {
    renderControls({ currentStatus: "CANCELLED", allowedTransitions: [] });

    expect(
      screen.queryByRole("group", { name: /available status changes/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("workflow-no-transitions")).toHaveTextContent(
      /No status changes are available/i,
    );
  });
});

// ─── UI-06 — disabled Resolved with explanation ─────────────────────────

describe("UI-06 — Resolved is present but disabled when BR-09's gate is unmet (ui-spec §5)", () => {
  it("disables only the Resolved control and exposes the explanation accessibly", async () => {
    renderControls({
      currentStatus: "IN_PROGRESS",
      allowedTransitions: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
      hasActionsWithResult: false,
    });

    const resolve = screen.getByTestId("workflow-transition-RESOLVED");
    expect(resolve).toBeDisabled();
    // Both a native tooltip and a programmatic description are provided.
    expect(resolve).toHaveAttribute("title", RESOLVE_NOTE);
    expect(resolve).toHaveAttribute("aria-describedby", "workflow-resolve-blocked");

    const note = screen.getByTestId("workflow-resolve-blocked-note");
    expect(note).toHaveAttribute("id", "workflow-resolve-blocked");
    expect(note).toHaveTextContent(RESOLVE_NOTE);

    // Every other permitted transition stays usable.
    expect(screen.getByTestId("workflow-transition-WAITING_FOR_REQUESTER")).toBeEnabled();
    expect(screen.getByTestId("workflow-transition-CANCELLED")).toBeEnabled();
  });

  it("enables Resolved and drops the note once the gate is satisfied", async () => {
    renderControls({
      currentStatus: "IN_PROGRESS",
      allowedTransitions: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
      hasActionsWithResult: true,
    });

    expect(screen.getByTestId("workflow-transition-RESOLVED")).toBeEnabled();
    expect(screen.queryByTestId("workflow-resolve-blocked-note")).not.toBeInTheDocument();
  });
});

// ─── Non-optimistic badge + conflict handling (§5) ──────────────────────

describe("workflow submission (ui-spec §5)", () => {
  it("does not advance the badge until the server confirms (not optimistic)", async () => {
    const user = userEvent.setup();

    let release!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    mockApiClient.mockImplementation(async () => {
      await gate;
      return ok({ ticket: workflowTicket() });
    });

    const { onTicketUpdated } = renderControls({
      currentStatus: "NEW",
      allowedTransitions: ["OPEN", "IN_PROGRESS", "CANCELLED"],
    });

    await user.click(screen.getByTestId("workflow-transition-IN_PROGRESS"));

    // While the request is in flight the badge is unchanged and no update fired.
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(onTicketUpdated).not.toHaveBeenCalled();

    release(undefined);

    await screen.findByTestId("workflow-success");
    expect(onTicketUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ status: "IN_PROGRESS", version: 4 }),
    );
  });

  it("confirms before applying a Resolved transition, then PATCHes with targetStatus + version", async () => {
    const user = userEvent.setup();
    mockApiClient.mockResolvedValue(ok({ ticket: workflowTicket({ status: "RESOLVED" }) }));

    renderControls({
      currentStatus: "IN_PROGRESS",
      allowedTransitions: ["RESOLVED", "CANCELLED"],
    });

    await user.click(screen.getByTestId("workflow-transition-RESOLVED"));
    const dialog = await screen.findByTestId("status-confirm-dialog");
    expect(dialog).toHaveAttribute("role", "dialog");

    // Nothing is sent until the user confirms.
    expect(mockApiClient).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: /^continue$/i }));

    await waitFor(() => {
      const call = mockApiClient.mock.calls.find(
        (c) => String(c[0]) === "/api/tickets/42/status",
      );
      expect(call).toBeDefined();
      const init = call?.[1] as RequestInit;
      expect(new Headers(init.headers).get("Idempotency-Key")).toBeTruthy();
      expect(JSON.parse(String(init.body))).toEqual({ targetStatus: "RESOLVED", version: 3 });
    });
  });

  it("on 409 STALE_VERSION reloads the Ticket and shows a non-blocking banner", async () => {
    const user = userEvent.setup();
    mockApiClient.mockResolvedValue(
      conflict("STALE_VERSION", {
        currentState: { status: "OPEN", version: 9 },
      }),
    );

    const { onReload } = renderControls({
      currentStatus: "NEW",
      allowedTransitions: ["OPEN", "IN_PROGRESS", "CANCELLED"],
    });

    await user.click(screen.getByTestId("workflow-transition-IN_PROGRESS"));

    expect(await screen.findByTestId("workflow-banner")).toHaveTextContent(
      /updated by someone else.*refreshed to the latest version/i,
    );
    expect(onReload).toHaveBeenCalled();
  });

  it("surfaces ACTIONS_REQUIRED as an inline explanation and leaves the badge unchanged", async () => {
    const user = userEvent.setup();
    mockApiClient.mockResolvedValue(conflict("ACTIONS_REQUIRED"));

    renderControls({
      currentStatus: "IN_PROGRESS",
      allowedTransitions: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
      hasActionsWithResult: true,
    });

    await user.click(screen.getByTestId("workflow-transition-RESOLVED"));
    const dialog = await screen.findByTestId("status-confirm-dialog");
    await user.click(within(dialog).getByRole("button", { name: /^continue$/i }));

    const error = await screen.findByTestId("workflow-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent(RESOLVE_NOTE);
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("records the Requester's advisory confirmation without changing status", async () => {
    const user = userEvent.setup();
    mockApiClient.mockResolvedValue(
      ok({
        ticketId: 42,
        requesterConfirmedResolved: true,
        requesterConfirmedResolvedAt: "2026-09-10T10:00:00.000Z",
      }),
    );

    const { onTicketUpdated } = renderControls({
      currentUser: userFor("REQUESTER"),
      currentStatus: "OPEN",
      allowedTransitions: ["CANCELLED"],
    });

    await user.click(screen.getByTestId("requester-confirmation-button"));

    expect(await screen.findByTestId("workflow-success")).toHaveTextContent(/review this/i);
    expect(onTicketUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "OPEN",
        requesterConfirmedResolved: true,
      }),
    );
    expect(mockApiClient.mock.calls.some((c) => String(c[0]) === "/api/tickets/42/requester-confirmation")).toBe(
      true,
    );
  });
});

// ─── Accessibility ──────────────────────────────────────────────────────

describe("Ticket workflow controls — automated accessibility (ui-spec §8)", () => {
  it("has no axe violations in the working state", async () => {
    renderControls({ currentStatus: "IN_PROGRESS", allowedTransitions: ["RESOLVED", "CANCELLED"] });
    await expectNoA11yViolations(document.body, "Ticket workflow controls");
  });

  it("has no axe violations with the Resolved gate explanation shown", async () => {
    renderControls({
      currentStatus: "IN_PROGRESS",
      allowedTransitions: ["RESOLVED", "CANCELLED"],
      hasActionsWithResult: false,
    });
    await expectNoA11yViolations(document.body, "Ticket workflow controls (gate unmet)");
  });
});
