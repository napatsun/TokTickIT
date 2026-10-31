import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AuthProvider } from "../../src/contexts/AuthContext";
import StaffDashboard from "../../src/pages/StaffDashboard";
import RequesterDashboard from "../../src/pages/RequesterDashboard";
import { expectNoA11yViolations } from "../support/a11y";
import type { AuthUser } from "../../src/contexts/AuthContext";

/**
 * Dashboards — tests.md §3 (ui-spec.md §2/§3)
 *
 *   UI-07    a zero-value staff card renders "0" with its label, no error (AC-10)
 *   UI-08    partial failure: one group shows retry, the other still renders
 *   UI-11    "My Actions Taken" panel: rows, follow-up badge, count, states
 *   UI-12    "Urgent Tickets" panel: rows, badges, owner, view-all, states
 *   UI-20    Quick Actions is not a nested <aside> (axe landmark rule)
 *   RESP-01  the card grid reflow rules exist for 1024/768/375px breakpoints
 *   RESP-02  the new sections' responsive rules carry no fixed widths
 *   plus     delta chips (icon + text, only when present), drill-down
 *            destinations per ui-spec §2.3/§3.3, the recent list / empty
 *            states, and axe checks.
 *
 * Conventions match the Lab 3/Lab 4 suites: React Testing Library + a mocked
 * `apiClient` (no live network) + jest-axe via tests/support/a11y. RESP-01's
 * reflow is asserted against the authored CSS cascade (jsdom applies no media
 * queries and performs no layout); the live reflow itself is executed in the
 * Playwright suite.
 */

// ─── Mock apiClient ─────────────────────────────────────────────────────

const mockApiClient = vi.fn();

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: (url: string, init?: RequestInit) => mockApiClient(url, init),
  // AuthProvider (mounted by the render helpers) imports these event names.
  AUTH_REQUIRED_EVENT: "auth:required",
  PASSWORD_CHANGE_REQUIRED_EVENT: "auth:password-change-required",
}));

// ─── Fixtures ───────────────────────────────────────────────────────────

function userFor(): AuthUser {
  return {
    id: "user-staff",
    name: "Ada Lovelace",
    email: "ada@example.com",
    role: "IT_STAFF",
    isActive: true,
    mustChangePassword: false,
  };
}

function ok(body: unknown, status = 200) {
  return { ok: true, status, json: async () => body };
}

function staffPayload(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-09-22T08:00:00.000Z",
    timezone: "Asia/Bangkok",
    counts: { new: 14, open: 23, inProgress: 18, waitingForRequester: 7, myAssigned: 16 },
    deltas: { new: 3, open: -2, inProgress: 1, waitingForRequester: -1 },
    recentTickets: [
      {
        id: 7,
        code: "TKT-2026-000007",
        title: "Cannot connect to campus Wi-Fi in the library",
        status: "IN_PROGRESS",
        updatedAt: "2026-09-20T09:14:00.000Z",
      },
    ],
    // FR-17: the current user's newest non-voided Actions Taken entries.
    myActions: {
      followUpCount: 2,
      items: [
        {
          id: "act-2",
          ticketId: 7,
          ticketNumber: "TKT-2026-000007",
          description: "Replaced the battery and ran a full charge cycle to confirm the fix.",
          actionDateTime: "2026-09-21T03:20:00.000Z",
          followUpRequired: true,
        },
        {
          id: "act-1",
          ticketId: 7,
          ticketNumber: "TKT-2026-000007",
          description: "Re-seated the Wi-Fi driver and re-joined the campus network.",
          actionDateTime: "2026-09-20T02:05:00.000Z",
          followUpRequired: false,
        },
      ],
    },
    // FR-18: the whole queue's oldest active URGENT Tickets.
    urgentTickets: [
      {
        id: 9,
        ticketNumber: "TKT-2026-000009",
        title: "Projector in Room 4-201 will not power on",
        status: "OPEN",
        itPriority: "URGENT",
        ownerName: null,
      },
      {
        id: 11,
        ticketNumber: "TKT-2026-000011",
        title: "Payment gateway integration keeps timing out",
        status: "IN_PROGRESS",
        itPriority: "URGENT",
        ownerName: "Ben Carter",
      },
    ],
    ...overrides,
  };
}

/**
 * The dashboard issues one GET per section, in this fixed order (ui-spec §2.4
 * partial failure). Tests that need to fail ONE section key off this order.
 */
const SECTION_ORDER = ["metrics", "recent", "myActions", "urgent"] as const;

function routeSections(payload: unknown, fail: Partial<Record<(typeof SECTION_ORDER)[number], boolean>> = {}) {
  let call = 0;
  mockApiClient.mockImplementation(async () => {
    const section = SECTION_ORDER[Math.min(call, SECTION_ORDER.length - 1)];
    call += 1;
    // Only the section's INITIAL request fails, so the Retry assertion later in
    // a test observes a successful re-fetch.
    if (call <= SECTION_ORDER.length && fail[section]) throw new TypeError("network down");
    return ok(payload);
  });
}

function requesterPayload(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-09-22T08:00:00.000Z",
    timezone: "Asia/Bangkok",
    counts: { myOpen: 3, inProgress: 2, resolved: 5, closed: 12 },
    recentTickets: [],
    attentionRequired: { count: 0, items: [] },
    recentlyUpdated: { count: 0, items: [] },
    resolvedWork: { count: 0, items: [] },
    ...overrides,
  };
}

/**
 * RESP-01 helper: assert the authored stylesheet carries the responsive
 * grid cascade (desktop base → tablet → mobile) for a given column count.
 * jsdom applies no media queries, so the E2E suite verifies the live layout;
 * this pins the authored breakpoints so a stylesheet edit cannot silently
 * drop a breakpoint.
 */
function stylesheetText(): string {
  const cssPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "src",
    "pages",
    "Dashboard.module.css",
  );
  return fs.readFileSync(cssPath, "utf8");
}

/**
 * Render a dashboard inside the AuthProvider it requires. The provider's
 * bootstrapping GET /api/auth/me is stubbed like the AppShell suite does
 * (tests/lab-03), so the session user is real and no live network is used.
 */
function stubAuthFetch(user: AuthUser) {
  const spy = vi.fn(async (input: unknown) => {
    const url = String(input);
    return {
      ok: true,
      status: 200,
      json: async () => (url.includes("/api/auth/me") ? user : { success: true }),
      clone() {
        return this;
      },
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function renderStaff() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <StaffDashboard />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function renderRequester() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <RequesterDashboard />
      </AuthProvider>
    </MemoryRouter>,
  );
}

/**
 * Render the staff dashboard inside real routes so drill-downs can be clicked
 * and their destination asserted (FR-12), instead of only grepping the source.
 */
function renderStaffWithRoutes() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <AuthProvider>
        <Routes>
          <Route path="/dashboard" element={<StaffDashboard />} />
          <Route
            path="/staff/tickets/:id"
            element={<div data-testid="staff-detail-destination" />}
          />
          <Route path="/staff/queue" element={<div data-testid="queue-destination" />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockApiClient.mockReset();
  stubAuthFetch(userFor());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ─── Staff Dashboard: populated state ───────────────────────────────────

describe("StaffDashboard — populated state (ui-spec §2)", () => {
  it("renders 5 metric cards with values and labels, and the welcome row", async () => {
    mockApiClient.mockResolvedValue(ok(staffPayload()));
    renderStaff();

    expect(await screen.findByTestId("staff-dashboard")).toBeInTheDocument();

    for (const key of ["new", "open", "inProgress", "waitingForRequester", "myAssigned"]) {
      expect(screen.getByTestId(`metric-card-${key}`)).toBeInTheDocument();
    }
    expect(within(screen.getByTestId("metric-card-new")).getByText("14")).toBeInTheDocument();
    expect(within(screen.getByTestId("metric-card-myAssigned")).getByText("16")).toBeInTheDocument();
  });

  it("renders delta chips with icon AND text, never for My Assigned (§3.1)", async () => {
    mockApiClient.mockResolvedValue(ok(staffPayload()));
    renderStaff();

    await screen.findByTestId("staff-dashboard");

    expect(screen.getByTestId("delta-new")).toHaveTextContent("+3 from yesterday");
    expect(screen.getByTestId("delta-open")).toHaveTextContent("-2 from yesterday");
    expect(screen.getByTestId("delta-inProgress")).toHaveTextContent("+1 from yesterday");
    expect(screen.getByTestId("delta-waitingForRequester")).toHaveTextContent(
      "-1 from yesterday",
    );

    // §3.1: no deltas.myAssigned key exists — no chip on that card at all.
    expect(screen.queryByTestId("delta-myAssigned")).not.toBeInTheDocument();
  });

  it("renders no delta chip when a delta is null (render only when present)", async () => {
    const payload = staffPayload();
    (payload.deltas as Record<string, unknown>).new = null;
    mockApiClient.mockResolvedValue(ok(payload));
    renderStaff();

    await screen.findByTestId("staff-dashboard");
    expect(screen.queryByTestId("delta-new")).not.toBeInTheDocument();
    // The other cards' chips are unaffected.
    expect(screen.getByTestId("delta-open")).toBeInTheDocument();
  });

  it("cards expose accessible names carrying label + value (§8), and recent rows render", async () => {
    mockApiClient.mockResolvedValue(ok(staffPayload()));
    renderStaff();

    await screen.findByTestId("recent-list");

    const newCard = screen.getByTestId("metric-card-new");
    expect(newCard).toHaveAttribute("aria-label", expect.stringContaining("New"));
    expect(newCard).toHaveAttribute("aria-label", expect.stringContaining("14"));

    const rows = screen.getAllByTestId("recent-ticket-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("TKT-2026-000007");
    expect(within(rows[0]).getByText("In Progress")).toBeInTheDocument(); // badge text
    expect(screen.getByTestId("recent-view-all")).toHaveTextContent("View all");
  });

  it("renders Search Tickets and My Queue quick actions", async () => {
    mockApiClient.mockResolvedValue(ok(staffPayload()));
    renderStaff();

    await screen.findByTestId("staff-dashboard");
    expect(screen.getByTestId("quick-search")).toBeInTheDocument();
    expect(screen.getByTestId("quick-my-queue")).toBeInTheDocument();
  });
});

// ─── UI-07 — zero-value card (AC-10) ────────────────────────────────────

describe("UI-07 — zero-value staff card renders 0 with its label, not an error (AC-10)", () => {
  it("shows 0 values and no error banner for an empty queue", async () => {
    mockApiClient.mockResolvedValue(
      ok(
        staffPayload({
          counts: { new: 0, open: 0, inProgress: 0, waitingForRequester: 0, myAssigned: 0 },
          deltas: { new: 0, open: 0, inProgress: 0, waitingForRequester: 0 },
          recentTickets: [],
        }),
      ),
    );
    renderStaff();

    await screen.findByTestId("staff-dashboard");

    for (const key of ["new", "open", "inProgress", "waitingForRequester", "myAssigned"]) {
      const card = screen.getByTestId(`metric-card-${key}`);
      expect(within(card).getByText("0")).toBeInTheDocument();
    }
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("recent-empty")).toHaveTextContent(/No recent Tickets yet/i);
  });
});

// ─── UI-08 — partial failure (ui-spec §2.4) ─────────────────────────────

describe("UI-08 — one failed group shows retry while the other still renders (ui-spec §2.4)", () => {
  it("a failed metrics group shows Retry while the recent list still renders", async () => {
    // Per-group state: the FIRST GET (metrics) fails, the SECOND (recent)
    // succeeds — only the failed group shows the retry affordance (UI-08).
    mockApiClient.mockRejectedValueOnce(new TypeError("network down"));
    mockApiClient.mockResolvedValueOnce(ok(staffPayload()));
    renderStaff();

    expect(await screen.findByTestId("metrics-error")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("recent-list")).toBeInTheDocument());
    // The other group renders its data — no page-level blank-out.
    expect(screen.getByTestId("recent-list")).toBeInTheDocument();
  });

  it("a failed recent group shows Retry while the metric cards still render", async () => {
    mockApiClient.mockResolvedValueOnce(ok(staffPayload()));
    mockApiClient.mockRejectedValueOnce(new TypeError("network down"));
    renderStaff();

    expect(await screen.findByTestId("recent-error")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("metric-cards")).toBeInTheDocument());
    expect(screen.getByTestId("metric-cards")).toBeInTheDocument();
  });

  it("a refresh failure after a good load keeps both groups mounted — no blank-out", async () => {
    mockApiClient.mockResolvedValue(ok(staffPayload()));
    renderStaff();
    // The initial load (two GETs) must fully settle before failing.
    await waitFor(() => expect(screen.getByTestId("recent-list")).toBeInTheDocument());

    // Every later call fails.
    mockApiClient.mockRejectedValue(new TypeError("network down"));

    const user = userEvent.setup();
    await user.click(screen.getByTestId("dashboard-refresh"));

    expect(await screen.findByTestId("metrics-error")).toBeInTheDocument();
    expect(screen.getByTestId("recent-error")).toBeInTheDocument();
  });

  it("Retry re-fetches the failed group and recovers it", async () => {
    // Initial: metrics fail, recent succeeds. Retry then succeeds.
    mockApiClient.mockRejectedValueOnce(new TypeError("down"));
    mockApiClient.mockResolvedValueOnce(ok(staffPayload()));
    mockApiClient.mockResolvedValue(ok(staffPayload()));

    renderStaff();
    await waitFor(() => expect(screen.getByTestId("metrics-error")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(
      within(screen.getByTestId("metrics-error")).getByRole("button", { name: /retry/i }),
    );

    await waitFor(() => expect(screen.getByTestId("metric-cards")).toBeInTheDocument());
    expect(screen.queryByTestId("metrics-error")).not.toBeInTheDocument();
  });
});

// ─── Drill-down destinations (ui-spec §2.3/§3.3, pinned as authored data) ─

describe("drill-down destinations match ui-spec §2.3 / §3.3 exactly (FR-12)", () => {
  it("staff cards carry the documented multi-value / owner-scoped queues", async () => {
    // The destinations are authored constants in the component; assert them
    // through the module source so a destination edit is caught here, while
    // the click-through itself is exercised live by E2E-03.
    const source = fs.readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "src",
        "pages",
        "StaffDashboard.tsx",
      ),
      "utf8",
    );

    expect(source).toContain('to: "/staff/queue?status=NEW"');
    expect(source).toContain('to: "/staff/queue?status=OPEN"');
    expect(source).toContain('to: "/staff/queue?status=IN_PROGRESS,REOPENED"');
    expect(source).toContain('to: "/staff/queue?status=WAITING_FOR_REQUESTER"');
    // owner=me alone would include Closed/Cancelled — the open-work list is required.
    expect(source).toContain("status=${OPEN_WORK_QUERY}");
    expect(source).toContain(
      '"NEW,OPEN,IN_PROGRESS,WAITING_FOR_REQUESTER,REOPENED"',
    );
  });

  it("requester cards never use the open-work alias for My Open (§3.3)", async () => {
    const source = fs.readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "src",
        "pages",
        "RequesterDashboard.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("/tickets?currentStatus=NEW,OPEN,WAITING_FOR_REQUESTER,REOPENED");
    expect(source).toContain("/tickets?currentStatus=IN_PROGRESS");
    expect(source).toContain("/tickets?currentStatus=RESOLVED");
    expect(source).toContain("/tickets?currentStatus=CLOSED");
    // The alias must not appear anywhere in the requester destinations.
    expect(source).not.toContain("currentStatus=open-work");
  });
});

// ─── UI-11 — "My Actions Taken" panel (FR-17, AC-15, AC-17) ──────────

describe("UI-11 — My Actions Taken panel (FR-17, AC-15)", () => {
  it("renders the caller's entries with the follow-up badge and the header count", async () => {
    routeSections(staffPayload());
    renderStaff();

    const section = await screen.findByTestId("my-actions-section");
    expect(within(section).getByRole("heading", { name: /my actions taken/i })).toBeInTheDocument();

    const count = screen.getByTestId("my-followups-count");
    expect(count).toHaveTextContent(/my follow-ups needed/i);
    expect(count).toHaveTextContent("2");

    const rows = screen.getAllByTestId("my-actions-row");
    expect(rows).toHaveLength(2);

    // Newest first, as the API returns them (FR-17): ticket number, truncated
    // description carrying the full text, and a follow-up badge only when needed.
    expect(rows[0]).toHaveTextContent("TKT-2026-000007");
    const description = within(rows[0]).getByText(/replaced the battery/i);
    expect(description).toHaveAttribute(
      "title",
      "Replaced the battery and ran a full charge cycle to confirm the fix.",
    );
    expect(within(rows[0]).getByText("Follow-up")).toBeInTheDocument();
    expect(within(rows[0]).getByText(/21 Sep/)).toBeInTheDocument();

    expect(within(rows[1]).queryByText("Follow-up")).not.toBeInTheDocument();
  });

  it("opens the staff Ticket Detail for the row's Ticket (FR-12)", async () => {
    routeSections(staffPayload());
    renderStaffWithRoutes();

    const rows = await screen.findAllByTestId("my-actions-row");
    const user = userEvent.setup();
    await user.click(rows[0]);

    expect(await screen.findByTestId("staff-detail-destination")).toBeInTheDocument();
  });

  it("renders 5 skeleton rows while loading, with aria-busy", async () => {
    mockApiClient.mockImplementation(() => new Promise(() => {}));
    renderStaff();

    expect(screen.getAllByTestId("my-actions-skeleton")).toHaveLength(5);
    expect(screen.getByLabelText(/loading your actions taken/i)).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("renders the empty state and a 0 count when the user has no entries", async () => {
    routeSections(
      staffPayload({ myActions: { followUpCount: 0, items: [] } }),
    );
    renderStaff();

    expect(await screen.findByTestId("my-actions-empty")).toHaveTextContent(
      /no actions taken recorded yet/i,
    );
    expect(screen.getByTestId("my-followups-count")).toHaveTextContent("0");
    expect(screen.queryByTestId("my-actions-row")).not.toBeInTheDocument();
  });

  it("fails alone: friendly retry here, every other section still renders", async () => {
    routeSections(staffPayload(), { myActions: true });
    renderStaff();

    const error = await screen.findByTestId("my-actions-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent(/couldn't load your actions taken/i);
    // No internals leak into the message (§5 safe failure).
    expect(error.textContent ?? "").not.toMatch(/TypeError|stack|at \//i);

    // The other three sections keep their own data.
    expect(screen.getByTestId("metric-cards")).toBeInTheDocument();
    expect(screen.getByTestId("recent-list")).toBeInTheDocument();
    expect(screen.getByTestId("urgent-tickets-list")).toBeInTheDocument();

    // Retry recovers only this section.
    const user = userEvent.setup();
    await user.click(within(error).getByRole("button", { name: /retry/i }));
    expect(await screen.findByTestId("my-actions-list")).toBeInTheDocument();
    expect(screen.queryByTestId("my-actions-error")).not.toBeInTheDocument();
  });
});

// ─── UI-12 — "Urgent Tickets" panel (FR-18, AC-16, AC-17) ──────────────

describe("UI-12 — Urgent Tickets panel (FR-18, AC-16)", () => {
  it("renders urgent rows with status/priority badges and the owner or Unassigned", async () => {
    routeSections(staffPayload());
    renderStaff();

    const section = await screen.findByTestId("urgent-tickets-section");
    expect(within(section).getByRole("heading", { name: /urgent tickets/i })).toBeInTheDocument();

    const rows = screen.getAllByTestId("urgent-ticket-row");
    expect(rows).toHaveLength(2);

    const badge = { selector: "span[role='status']" } as const;
    expect(rows[0]).toHaveTextContent("TKT-2026-000009");
    expect(within(rows[0]).getByText("Projector in Room 4-201 will not power on")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Open", badge)).toBeInTheDocument();
    expect(within(rows[0]).getByText("Urgent", badge)).toBeInTheDocument();
    expect(within(rows[0]).getByText("Unassigned")).toBeInTheDocument();

    expect(within(rows[1]).getByText("In Progress", badge)).toBeInTheDocument();
    expect(within(rows[1]).getByText("Ben Carter")).toBeInTheDocument();
  });

  it("sends View all urgent to the URGENT-filtered queue (FR-12, AC-16)", async () => {
    routeSections(staffPayload());
    renderStaffWithRoutes();

    const link = await screen.findByTestId("urgent-view-all-link");
    expect(link).toHaveTextContent(/view all urgent/i);

    const user = userEvent.setup();
    await user.click(link);

    expect(await screen.findByTestId("queue-destination")).toBeInTheDocument();
  });

  it("pins the View all urgent destination to the documented query (ui-spec §2.3)", () => {
    const source = fs.readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "src",
        "pages",
        "StaffDashboard.tsx",
      ),
      "utf8",
    );
    expect(source).toContain('/staff/queue?priority=URGENT');
  });

  it("renders 5 skeleton rows while loading, with aria-busy", async () => {
    mockApiClient.mockImplementation(() => new Promise(() => {}));
    renderStaff();

    expect(screen.getAllByTestId("urgent-tickets-skeleton")).toHaveLength(5);
    expect(screen.getByLabelText(/loading urgent tickets/i)).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("renders its own empty state when nothing is urgent", async () => {
    routeSections(staffPayload({ urgentTickets: [] }));
    renderStaff();

    expect(await screen.findByTestId("urgent-tickets-empty")).toHaveTextContent(
      /no urgent tickets right now/i,
    );
    expect(screen.queryByTestId("urgent-ticket-row")).not.toBeInTheDocument();
  });

  it("fails alone: friendly retry here, every other section still renders", async () => {
    routeSections(staffPayload(), { urgent: true });
    renderStaff();

    const error = await screen.findByTestId("urgent-tickets-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent(/couldn't load urgent tickets/i);
    expect(error.textContent ?? "").not.toMatch(/TypeError|stack|at \//i);

    expect(screen.getByTestId("my-actions-list")).toBeInTheDocument();
    expect(screen.getByTestId("metric-cards")).toBeInTheDocument();
    expect(screen.getByTestId("recent-list")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(error).getByRole("button", { name: /retry/i }));
    expect(await screen.findByTestId("urgent-tickets-list")).toBeInTheDocument();
  });

  it("opens the staff Ticket Detail for an urgent row (FR-12)", async () => {
    routeSections(staffPayload());
    renderStaffWithRoutes();

    const rows = await screen.findAllByTestId("urgent-ticket-row");
    const user = userEvent.setup();
    await user.click(rows[0]);

    expect(await screen.findByTestId("staff-detail-destination")).toBeInTheDocument();
  });
});

// ─── RESP-01 — card grid reflow rules (ui-spec §2.5/§3.5) ───────────────

describe("RESP-01 — dashboard card grid reflow rules for 1024/768/375px", () => {
  it("authers a 5-col staff grid with 3-col tablet and 1-col mobile overrides", () => {
    const css = stylesheetText();
    expect(css).toContain("grid-template-columns: repeat(5, minmax(0, 1fr))");
    expect(css).toMatch(/@media \(max-width: 1023px\)[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.metricRow,\s*\.metricRow4\s*\{\s*grid-template-columns: 1fr/);
  });

  it("authers a 4-col requester grid with 2-col tablet and 1-col mobile overrides", () => {
    const css = stylesheetText();
    expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(css).toMatch(/@media \(max-width: 1023px\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  });

  it("the grids actually render with the expected card counts", async () => {
    mockApiClient.mockResolvedValue(ok(staffPayload()));
    const staff = renderStaff();
    await screen.findByTestId("metric-cards");
    expect(within(staff.getByTestId("metric-cards")).getAllByTestId(/^metric-card-/)).toHaveLength(5);
    staff.unmount();

    mockApiClient.mockResolvedValue(ok(requesterPayload()));
    const requester = renderRequester();
    await screen.findByTestId("requester-dashboard");
    expect(within(requester.getByTestId("metric-cards")).getAllByTestId(/^metric-card-/)).toHaveLength(4);
  });
});

// ─── RESP-02 — the new sections' responsive rules (AC-19) ──────────────

/** Every declaration block the stylesheet authors for a selector. */
function cssRuleBodies(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `[^{}]*` keeps the match inside one selector list, so grouped rules such as
  // ".actionRow,\n.urgentRow {" still resolve for each selector.
  const pattern = new RegExp(`${escaped}[^{}]*\\{([^}]*)\\}`, "g");
  return [...css.matchAll(pattern)].map((match) => match[1]);
}

describe("RESP-02 — new sections stack on tablet/mobile and use no fixed widths (AC-19)", () => {
  it("stacks the second content row to one column at ≤1023px", () => {
    const css = stylesheetText();

    expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(css).toMatch(
      /@media \(max-width: 1023px\)[\s\S]*\.contentRow2\s*\{[^}]*grid-template-columns: 1fr/,
    );
  });

  it("declares no fixed pixel width on any new section class", () => {
    const css = stylesheetText();

    for (const selector of [
      ".contentRow2",
      ".actionRow",
      ".urgentRow",
      ".followUpBadge",
      ".panelCount",
    ]) {
      const bodies = cssRuleBodies(css, selector);
      expect(bodies.length, `${selector} must be authored`).toBeGreaterThan(0);
      for (const body of bodies) {
        // A px width on a row/panel is exactly what forces horizontal scroll at
        // 390px; the layout must rely on the grid and on min-width: 0 instead.
        expect(body, `${selector} must not fix a pixel width`).not.toMatch(
          /(^|[^-])width:\s*\d+(\.\d+)?px/,
        );
      }
    }
  });
});

// ─── UI-09 & UI-21 — Requester Dashboard (ui-spec §3.4, AC-21) ──────────

describe("UI-09 — Requester Dashboard empty recent state with CTA (ui-spec §3.4)", () => {
  it("renders the empty-state component with a Create Ticket CTA", async () => {
    mockApiClient.mockResolvedValue(ok(requesterPayload()));
    renderRequester();

    expect(await screen.findByTestId("requester-dashboard")).toBeInTheDocument();

    const empty = screen.getByTestId("recent-empty");
    expect(empty).toHaveTextContent(/No recent Tickets yet/i);
    expect(screen.getByTestId("recent-empty-cta")).toBeInTheDocument();
  });

  it("renders 4 cards, each with its own View all link beneath the value (§3.1)", async () => {
    mockApiClient.mockResolvedValue(ok(requesterPayload()));
    renderRequester();

    await screen.findByTestId("requester-dashboard");
    for (const key of ["myOpen", "inProgress", "resolved", "closed"]) {
      expect(screen.getByTestId(`metric-card-${key}`)).toBeInTheDocument();
      expect(screen.getByTestId(`card-view-all-${key}`)).toHaveTextContent("View all");
    }
    // No delta chips exist on the requester dashboard at all (§3.2).
    expect(screen.queryByTestId(/^delta-/)).not.toBeInTheDocument();
  });
});

describe("UI-21 — Requester Dashboard Attention Required, Recently Updated, and Resolved sections (FR-11, AC-21)", () => {
  it("renders all 3 sections with total count badges, up to 5 rows, and matching drill-down links", async () => {
    mockApiClient.mockResolvedValue(
      ok(
        requesterPayload({
          attentionRequired: {
            count: 2,
            items: [
              {
                id: 101,
                code: "TKT-2026-000101",
                title: "Need VPN confirmation code",
                status: "WAITING_FOR_REQUESTER",
                updatedAt: "2026-09-22T07:00:00.000Z",
              },
              {
                id: 102,
                code: "TKT-2026-000102",
                title: "Printer jam recurred",
                status: "REOPENED",
                updatedAt: "2026-09-21T07:00:00.000Z",
              },
            ],
          },
          recentlyUpdated: {
            count: 20,
            items: [
              {
                id: 101,
                code: "TKT-2026-000101",
                title: "Need VPN confirmation code",
                status: "WAITING_FOR_REQUESTER",
                updatedAt: "2026-09-22T07:00:00.000Z",
              },
            ],
          },
          resolvedWork: {
            count: 17,
            items: [
              {
                id: 103,
                code: "TKT-2026-000103",
                title: "Laptop battery replaced",
                status: "RESOLVED",
                updatedAt: "2026-09-20T07:00:00.000Z",
              },
              {
                id: 104,
                code: "TKT-2026-000104",
                title: "Badge access granted",
                status: "CLOSED",
                updatedAt: "2026-09-19T07:00:00.000Z",
              },
            ],
          },
        }),
      ),
    );
    renderRequester();

    await screen.findByTestId("requester-dashboard");

    // 1. Attention Required section
    const attentionSection = screen.getByTestId("attention-required-section");
    expect(within(attentionSection).getByRole("heading", { name: /attention required/i })).toBeInTheDocument();
    expect(screen.getByTestId("attention-required-count")).toHaveTextContent("Total: 2");
    expect(screen.getAllByTestId("attention-required-row")).toHaveLength(2);
    expect(screen.getByTestId("attention-required-view-all")).toHaveTextContent("View all");

    // 2. Recently Updated section
    expect(screen.getByRole("heading", { name: /recently updated/i })).toBeInTheDocument();
    expect(screen.getByTestId("recently-updated-count")).toHaveTextContent("Total: 20");
    expect(screen.getAllByTestId("recent-ticket-row")).toHaveLength(1);
    expect(screen.getByTestId("recent-view-all")).toHaveTextContent("View all");

    // 3. Resolved section
    const resolvedSection = screen.getByTestId("resolved-work-section");
    expect(within(resolvedSection).getByRole("heading", { name: /^resolved$/i })).toBeInTheDocument();
    expect(screen.getByTestId("resolved-work-count")).toHaveTextContent("Total: 17");
    expect(screen.getAllByTestId("resolved-work-row")).toHaveLength(2);
    expect(screen.getByTestId("resolved-work-view-all")).toHaveTextContent("View all");
  });

  it("pins the drill-down URLs for Attention Required, Recently Updated, and Resolved", () => {
    const source = fs.readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "src",
        "pages",
        "RequesterDashboard.tsx",
      ),
      "utf8",
    );
    expect(source).toContain('"/tickets?currentStatus=WAITING_FOR_REQUESTER,REOPENED"');
    expect(source).toContain('"/tickets?currentStatus=RESOLVED,CLOSED"');
    expect(source).toContain('navigate("/tickets")');
  });
});

// ─── Accessibility (ui-spec §8) ─────────────────────────────────────────

describe("dashboards — automated accessibility (ui-spec §8)", () => {
  it("staff dashboard populated: no axe violations", async () => {
    mockApiClient.mockResolvedValue(ok(staffPayload()));
    renderStaff();
    await screen.findByTestId("recent-list");
    await expectNoA11yViolations(document.body, "Staff dashboard (populated)");
  });

  it("staff dashboard zero/empty state: no axe violations", async () => {
    mockApiClient.mockResolvedValue(
      ok(
        staffPayload({
          counts: { new: 0, open: 0, inProgress: 0, waitingForRequester: 0, myAssigned: 0 },
          deltas: { new: 0, open: 0, inProgress: 0, waitingForRequester: 0 },
          recentTickets: [],
        }),
      ),
    );
    renderStaff();
    await screen.findByTestId("recent-empty");
    await expectNoA11yViolations(document.body, "Staff dashboard (empty)");
  });

  it("requester dashboard empty state: no axe violations", async () => {
    mockApiClient.mockResolvedValue(ok(requesterPayload()));
    renderRequester();
    await screen.findByTestId("recent-empty");
    await expectNoA11yViolations(document.body, "Requester dashboard (empty)");
  });
});

// ─── UI-20 — no nested complementary landmark (axe) ──────────────────────

/**
 * UI-20 — axe `landmark-complementary-is-top-level` (moderate) fired on both
 * dashboards: the Quick Actions panel was an `<aside>` nested inside the App
 * Shell's `<main>`. The fix swaps in a `<section>` that keeps the same
 * `aria-labelledby` association; `Dashboard.module.css` has no `aside` element
 * selector, so the box model is unchanged. These assertions pin both halves:
 * no complementary element remains, and the labelled panel survives.
 */
describe("UI-20 — Quick Actions is not a nested <aside> (axe landmark-complementary-is-top-level)", () => {
  it("renders the staff dashboard's Quick Actions panel without a complementary landmark", async () => {
    mockApiClient.mockResolvedValue(ok(staffPayload()));
    const { container } = renderStaff();

    await screen.findByTestId("quick-actions");

    expect(container.querySelector("aside")).toBeNull();
    expect(screen.getByRole("heading", { name: /quick actions/i })).toBeInTheDocument();
    expect(container.querySelector('[aria-labelledby="quick-heading"]')).not.toBeNull();
  });

  it("renders the requester dashboard's Quick Actions panel without a complementary landmark", async () => {
    mockApiClient.mockResolvedValue(ok(requesterPayload()));
    const { container } = renderRequester();

    await screen.findByTestId("quick-actions");

    expect(container.querySelector("aside")).toBeNull();
    expect(screen.getByRole("heading", { name: /quick actions/i })).toBeInTheDocument();
    expect(container.querySelector('[aria-labelledby="quick-heading"]')).not.toBeNull();
  });
});
