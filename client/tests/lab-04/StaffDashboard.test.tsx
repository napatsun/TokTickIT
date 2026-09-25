import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
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
 *   RESP-01  the card grid reflow rules exist for 1024/768/375px breakpoints
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
    ...overrides,
  };
}

function requesterPayload(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-09-22T08:00:00.000Z",
    timezone: "Asia/Bangkok",
    counts: { myOpen: 3, inProgress: 2, resolved: 5, closed: 12 },
    recentTickets: [],
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

// ─── UI-09 — Requester Dashboard (ui-spec §3.4) ─────────────────────────

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
