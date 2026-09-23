import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ActionsTakenPanel from "../../src/components/ticket-detail/ActionsTakenPanel";
import { expectNoA11yViolations } from "../support/a11y";
import type { AuthUser } from "../../src/contexts/AuthContext";
import type { ActionTakenEntry } from "../../src/components/ticket-detail/ActionsTakenPanel";

/**
 * Actions Taken panel — tests.md §1 (ui-spec.md §4)
 *
 *   UI-01  Create form shows/hides Follow-up Note based on the toggle
 *   UI-02  Submit button is disabled while a request is in flight (no
 *          second request from a second click — FR-15/AC-11 client guard)
 *   UI-03  Failed submit preserves every entered value (§4.5 safe failure)
 *   UI-04  Requester view renders no create/edit controls in the DOM
 *   plus: edit-window/Administrator gating, void flow, Show-voided toggle,
 *   error-code handling (EDIT_WINDOW_EXPIRED / NOT_AUTHOR / ENTRY_VOIDED),
 *   the §4.2 view-mode table, and automated axe checks (§8).
 *
 * Conventions match the Lab 3 suites: React Testing Library + a mocked
 * `apiClient` (no live network) + jest-axe via tests/support/a11y.
 */

// ─── Mock apiClient ─────────────────────────────────────────────────────

const mockApiClient = vi.fn();

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: (url: string, init?: RequestInit) => mockApiClient(url, init),
}));

// ─── Fixtures ───────────────────────────────────────────────────────────

function userFor(role: AuthUser["role"], id = `user-${role}`): AuthUser {
  return {
    id,
    name: `${role} Person`,
    email: `${role.toLowerCase()}@example.com`,
    role,
    isActive: true,
    mustChangePassword: false,
  };
}

function makeEntry(overrides: Partial<ActionTakenEntry> = {}): ActionTakenEntry {
  // Fresh enough to sit inside the 15-minute author edit window (BR-11); tests
  // that need an out-of-window or stale row override `createdAt` explicitly.
  const created = overrides.createdAt ?? new Date(Date.now() - 60_000).toISOString();
  return {
    id: "act-1",
    ticketId: 42,
    actionDateTime: "2026-09-18T09:00:00.000Z",
    description: "Initial diagnosis run.",
    result: "Confirmed swollen battery cell.",
    performedById: "staff-1",
    performedBy: { id: "staff-1", name: "Alice Chen" },
    followUpRequired: false,
    followUpNote: null,
    attachmentNotes: null,
    isVoided: false,
    voidReason: null,
    createdAt: created,
    editedAt: null,
    editedById: null,
    ...overrides,
  };
}

const TICKET_ID = 42;
const LIST_PATH = `/api/tickets/${TICKET_ID}/actions`;
const ENTRY_PATH = `${LIST_PATH}/act-1`;

function ok(body: unknown, status = 200) {
  return { ok: true, status, json: async () => body };
}

function errorBody(status: number, code: string, fieldErrors?: Record<string, string>) {
  return {
    ok: false,
    status,
    json: async () => ({
      error: {
        code,
        message: "error",
        ...(fieldErrors ? { fieldErrors } : {}),
      },
    }),
  };
}

/**
 * Wire the mock to the three api-spec.md §1 endpoints with overridable data.
 * `items` is captured by reference so a test can mutate the array between
 * renders (the panel re-fetches after every successful write, mirroring the
 * real list flow).
 */
function routeApi(options: {
  items?: ActionTakenEntry[];
  createResponse?: () => { status: number; body: unknown };
  patchResponse?: (path: string, body: unknown) => { status: number; body: unknown };
  failCreate?: boolean;
} = {}) {
  const items = options.items ?? [];
  mockApiClient.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const [path, query] = String(url).split("?");
    const includeVoided = new URLSearchParams(query ?? "").get("includeVoided") === "true";

    if (path === LIST_PATH && method === "GET") {
      // §4.4: the server filters voided rows; the panel re-fetches on toggle.
      const visible = includeVoided ? items : items.filter((entry) => !entry.isVoided);
      return ok({ ticketId: TICKET_ID, count: visible.length, items: visible });
    }

    if (path === LIST_PATH && method === "POST") {
      if (options.failCreate) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: { code: "SERVER_ERROR", message: "boom" } }),
        };
      }
      const provided = options.createResponse?.();
      if (provided) {
        return { ok: provided.status < 400, status: provided.status, json: async () => provided.body };
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as Partial<ActionTakenEntry>;
      const created = makeEntry({
        id: "act-new",
        description: body.description ?? "",
        result: body.result ?? "",
        followUpRequired: body.followUpRequired ?? false,
        followUpNote: body.followUpNote ?? null,
        performedBy: { id: "staff-1", name: "IT_STAFF Person" },
      });
      items.push(created);
      return ok(created, 201);
    }

    if (path.startsWith(`${LIST_PATH}/`) && method === "PATCH") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const result = options.patchResponse?.(path, body);
      if (result) {
        if (result.status >= 400) {
          return { ok: false, status: result.status, json: async () => result.body };
        }
        // Apply the successful response to the stored row so the panel's
        // post-PATCH re-fetch observes it (voiding, edits).
        const index = items.findIndex((entry) => path.endsWith(entry.id));
        if (index !== -1) items[index] = result.body as ActionTakenEntry;
        return ok(result.body);
      }
      const index = items.findIndex((entry) => path.endsWith(entry.id));
      if (index !== -1) {
        items[index] = {
          ...items[index],
          ...body,
          editedAt: "2026-09-20T09:10:00.000Z",
        } as ActionTakenEntry;
        return ok(items[index]);
      }
      return ok(makeEntry({ ...body, editedAt: "2026-09-20T09:10:00.000Z" } as Partial<ActionTakenEntry>));
    }

    return ok({});
  });
}

function renderPanel(user: AuthUser) {
  return render(<ActionsTakenPanel ticketId={TICKET_ID} currentUser={user} />);
}

beforeEach(() => {
  mockApiClient.mockReset();
  routeApi({ items: [makeEntry()] });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── §4.2 View mode ─────────────────────────────────────────────────────

describe("Actions Taken — view mode (ui-spec §4.2)", () => {
  it("renders the section with a count badge and the oldest-first table", async () => {
    routeApi({
      items: [
        makeEntry({ id: "act-early", actionDateTime: "2026-09-18T09:00:00.000Z", description: "First." }),
        makeEntry({ id: "act-late", actionDateTime: "2026-09-20T10:00:00.000Z", description: "Second." }),
      ],
    });
    renderPanel(userFor("IT_STAFF"));

    const panel = await screen.findByTestId("actions-taken-panel");
    expect(within(panel).getByRole("heading", { name: /actions taken/i })).toBeInTheDocument();
    // Badge is present with visible text, and the heading's accessible name
    // matches what is displayed: "Actions Taken (2)" (WCAG 2.5.3 Label in Name).
    expect(within(panel).getByText("(2)")).toBeInTheDocument();
    expect(
      within(panel).getByRole("heading", { name: /actions taken \(2\)/i }),
    ).toBeInTheDocument();

    const rows = await screen.findAllByTestId("actions-taken-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("First.");
    expect(rows[1]).toHaveTextContent("Second.");
    // api-spec.md §1.2: oldest first — the server's order is rendered verbatim.
  });

  it("shows the follow-up badge as text (never colour-only)", async () => {
    routeApi({ items: [makeEntry({ followUpRequired: true, followUpNote: "Watch the AP." })] });
    renderPanel(userFor("IT_STAFF"));

    expect(await screen.findByText("Follow-up needed")).toBeInTheDocument();
  });

  it("expands a row to reveal Attachment Notes and the Edited caption", async () => {
    const user = userEvent.setup();
    routeApi({
      items: [
        makeEntry({
          attachmentNotes: "See battery-test-photo.jpg.",
          editedAt: "2026-09-20T09:10:00.000Z",
          editedById: "staff-1",
        }),
      ],
    });
    renderPanel(userFor("IT_STAFF"));

    await user.click(await screen.findByTestId(`expand-action-act-1`));

    expect(screen.getByText(/Attachment Notes:/).closest("p")).toHaveTextContent(
      "See battery-test-photo.jpg.",
    );
    expect(screen.getByTestId("edited-caption-act-1")).toHaveTextContent(/Edited .* by Alice Chen/);
  });

  it("hides voided rows by default and shows them under the Show-voided toggle (staff only)", async () => {
    const user = userEvent.setup();
    routeApi({
      items: [makeEntry(), makeEntry({ id: "act-voided", isVoided: true, voidReason: "Duplicate entry." })],
    });
    renderPanel(userFor("ADMINISTRATOR"));

    await screen.findByTestId("actions-taken-row");
    expect(screen.queryByText("Duplicate entry.")).not.toBeInTheDocument();

    // §4.4: the toggle re-fetches with includeVoided=true — no client-side filter.
    mockApiClient.mockClear();
    await user.click(screen.getByTestId("show-voided-toggle"));

    await waitFor(() => {
      expect(mockApiClient.mock.calls.some((call) => String(call[0]).includes("includeVoided=true"))).toBe(true);
    });
    await user.click(await screen.findByTestId(`expand-action-act-voided`));
    expect(screen.getByTestId("void-caption-act-voided")).toHaveTextContent(/Voided — reason: Duplicate entry\./);
  });

  it("renders no Show-voided toggle for a Requester", async () => {
    renderPanel(userFor("REQUESTER"));
    await screen.findByTestId("actions-taken-row");
    expect(screen.queryByTestId("show-voided-toggle")).not.toBeInTheDocument();
  });
});

// ─── UI-01: conditional Follow-up Note (§4.3 / BR-05) ───────────────────

describe("UI-01 — Follow-up Note shows/hides with the toggle (ui-spec §4.3)", () => {
  it("hides the Follow-up Note field until the toggle is on, then shows it required", async () => {
    const user = userEvent.setup();
    renderPanel(userFor("IT_STAFF"));

    await user.click(await screen.findByTestId("add-action-button"));

    expect(screen.queryByLabelText(/follow-up note/i)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText(/follow-up required/i));

    const note = screen.getByLabelText(/follow-up note/i);
    expect(note).toBeInTheDocument();
    expect(note).toBeRequired();

    // §8: the conditional field's appearance is announced (aria-live region).
    expect(screen.getByText(/follow-up note is required/i)).toHaveAttribute("aria-live", "polite");

    // Toggling off removes the field again.
    await user.click(screen.getByLabelText(/follow-up required/i));
    expect(screen.queryByLabelText(/follow-up note/i)).not.toBeInTheDocument();
  });

  it("validates a too-short note inline while the toggle is on (BR-05, live)", async () => {
    const user = userEvent.setup();
    renderPanel(userFor("IT_STAFF"));

    await user.click(await screen.findByTestId("add-action-button"));
    await user.click(screen.getByLabelText(/follow-up required/i));
    await user.type(screen.getByLabelText(/follow-up note/i), "ab");

    expect(screen.getByText(/at least 3 characters/i)).toBeInTheDocument();
  });
});

// ─── Create mode (§4.3) ─────────────────────────────────────────────────

describe("Actions Taken — create mode (ui-spec §4.3)", () => {
  it("opens the inline form above the table with the documented field order", async () => {
    const user = userEvent.setup();
    renderPanel(userFor("IT_STAFF"));

    await user.click(await screen.findByTestId("add-action-button"));

    const form = screen.getByTestId("actions-taken-form");
    const labels = within(form)
      .getAllByText(
        /^(Action Date\/Time|Action Description|Result|Follow-Up Required\?|Attachment Notes|Performed By)\*?$/,
        { selector: "label" },
      )
      .map((node) => node.textContent?.replace(/\*$/, "").trim() ?? "");

    expect(labels.indexOf("Action Date/Time")).toBeLessThan(labels.indexOf("Action Description"));
    expect(labels.indexOf("Action Description")).toBeLessThan(labels.indexOf("Result"));
    expect(labels.indexOf("Result")).toBeLessThan(labels.indexOf("Follow-Up Required?"));

    // BR-03: Performed By is static transparency text, never an editable field.
    expect(within(form).getByTestId("performed-by-text")).toHaveTextContent(
      "Will be recorded as: IT_STAFF Person",
    );
    // Not an editable field: no input/select/textarea carries the label.
    expect(within(form).queryByRole("textbox", { name: /performed by/i })).toBeNull();
  });

  it("submits with the documented payload and an Idempotency-Key header (FR-15)", async () => {
    const user = userEvent.setup();
    renderPanel(userFor("IT_STAFF"));

    await user.click(await screen.findByTestId("add-action-button"));
    await user.type(screen.getByLabelText(/action description/i), "Replaced the battery cell.");
    await user.type(screen.getByLabelText(/^result/i), "Laptop now holds charge.");
    await user.click(screen.getByTestId("action-save-button"));

    await waitFor(() => {
      const call = mockApiClient.mock.calls.find((c) => String(c[0]) === LIST_PATH && c[1]?.method === "POST");
      expect(call).toBeDefined();
      const init = call?.[1] as RequestInit;
      expect(new Headers(init.headers).get("Idempotency-Key")).toBeTruthy();
      const body = JSON.parse(String(init.body));
      expect(body.description).toBe("Replaced the battery cell.");
      expect(body.result).toBe("Laptop now holds charge.");
      expect(body.followUpRequired).toBe(false);
      expect(typeof body.actionDateTime).toBe("string");
    });
  });

  it("rejects a future Action Date/Time client-side before any request (BR-04)", async () => {
    const user = userEvent.setup();
    renderPanel(userFor("IT_STAFF"));

    await user.click(await screen.findByTestId("add-action-button"));

    const future = new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const futureValue = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(
      future.getHours(),
    )}:${pad(future.getMinutes())}`;
    await user.clear(screen.getByLabelText(/action date\/time/i));
    await user.type(screen.getByLabelText(/action date\/time/i), futureValue);
    await user.type(screen.getByLabelText(/action description/i), "Too early to be true.");
    await user.type(screen.getByLabelText(/^result/i), "It has not happened.");
    await user.click(screen.getByTestId("action-save-button"));

    expect(await screen.findByText(/cannot be in the future/i)).toBeInTheDocument();
    expect(mockApiClient.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(0);
  });

  it("maps server 422 fieldErrors to the offending fields and focuses the first one (§4.3)", async () => {
    const user = userEvent.setup();
    routeApi({
      createResponse: () => ({
        status: 422,
        body: {
          error: {
            code: "VALIDATION_ERROR",
            message: "Please fix the highlighted fields.",
            fieldErrors: { description: "Description must be between 5 and 2000 characters." },
          },
        },
      }),
    });
    renderPanel(userFor("IT_STAFF"));

    await user.click(await screen.findByTestId("add-action-button"));
    await user.type(screen.getByLabelText(/action description/i), "no");
    await user.type(screen.getByLabelText(/^result/i), "Fine result.");
    await user.click(screen.getByTestId("action-save-button"));

    const errorNode = await screen.findByText(/between 5 and 2000 characters/i);
    expect(errorNode).toHaveAttribute("role", "alert");
    expect(screen.getByLabelText(/action description/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/action description/i)).toHaveAttribute(
      "aria-describedby",
      "action-description-error",
    );
    // §4.3: focus moves to the first invalid field.
    expect(screen.getByLabelText(/action description/i)).toHaveFocus();
  });

  it("collapses the form and shows the created row after a successful save (§4.3)", async () => {
    const user = userEvent.setup();
    routeApi({ items: [] });
    renderPanel(userFor("IT_STAFF"));

    await screen.findByTestId("actions-taken-empty");
    await user.click(screen.getByTestId("add-action-empty-cta"));
    await user.type(screen.getByLabelText(/action description/i), "Fresh entry from the form.");
    await user.type(screen.getByLabelText(/^result/i), "It worked.");
    await user.click(screen.getByTestId("action-save-button"));

    expect(await screen.findByText("Fresh entry from the form.")).toBeInTheDocument();
    expect(screen.queryByTestId("actions-taken-form")).not.toBeInTheDocument();
  });
});

// ─── UI-02: double-submit guard (FR-15/AC-11) ───────────────────────────

describe("UI-02 — submit is disabled while the request is in flight (ui-spec §4.3)", () => {
  it("ignores a second click before the response arrives", async () => {
    const user = userEvent.setup();

    let releaseResponse: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });

    mockApiClient.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === LIST_PATH && (init?.method ?? "GET").toUpperCase() === "POST") {
        await gate;
        return ok(makeEntry({ id: "act-new" }), 201);
      }
      if (url === LIST_PATH) {
        return ok({ ticketId: TICKET_ID, count: 0, items: [] });
      }
      return ok({});
    });

    renderPanel(userFor("IT_STAFF"));
    await user.click(await screen.findByTestId("add-action-button"));
    await user.type(screen.getByLabelText(/action description/i), "Only once, please.");
    await user.type(screen.getByLabelText(/^result/i), "Exactly one entry.");

    await user.click(screen.getByTestId("action-save-button"));
    // A second click while the first request hangs.
    await user.click(screen.getByTestId("action-save-button"));

    const postCalls = mockApiClient.mock.calls.filter(
      (c) => String(c[0]) === LIST_PATH && c[1]?.method === "POST",
    );
    expect(postCalls).toHaveLength(1);

    releaseResponse?.();
    await screen.findByText("Only once, please.");
  });
});

// ─── UI-03: safe failure preserves the draft (§4.5) ─────────────────────

describe("UI-03 — failed submit preserves entered values (ui-spec §4.5)", () => {
  it("keeps every field's value and shows a dismissible banner on a 500", async () => {
    const user = userEvent.setup();
    routeApi({ failCreate: true });
    renderPanel(userFor("IT_STAFF"));

    await user.click(await screen.findByTestId("add-action-button"));
    await user.type(screen.getByLabelText(/action description/i), "Draft that must survive.");
    await user.type(screen.getByLabelText(/^result/i), "Surviving result.");
    await user.click(screen.getByTestId("action-save-button"));

    const banner = await screen.findByTestId("action-form-error");
    expect(banner).toHaveTextContent(/couldn't save/i);
    expect(screen.getByLabelText(/action description/i)).toHaveValue("Draft that must survive.");
    expect(screen.getByLabelText(/^result/i)).toHaveValue("Surviving result.");

    // The banner is dismissible (§4.5).
    await user.click(screen.getByTestId("action-form-error-dismiss"));
    expect(screen.queryByTestId("action-form-error")).not.toBeInTheDocument();
    // …and the draft is still intact afterwards.
    expect(screen.getByLabelText(/action description/i)).toHaveValue("Draft that must survive.");
  });

  it("keeps the draft on a network failure too", async () => {
    const user = userEvent.setup();
    mockApiClient.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === LIST_PATH && (init?.method ?? "GET").toUpperCase() === "POST") {
        throw new TypeError("network down");
      }
      if (url === LIST_PATH) {
        return ok({ ticketId: TICKET_ID, count: 0, items: [] });
      }
      return ok({});
    });

    renderPanel(userFor("IT_STAFF"));
    await user.click(await screen.findByTestId("add-action-button"));
    await user.type(screen.getByLabelText(/action description/i), "Offline draft.");
    await user.type(screen.getByLabelText(/^result/i), "Still here.");
    await user.click(screen.getByTestId("action-save-button"));

    expect(await screen.findByTestId("action-form-error")).toBeInTheDocument();
    expect(screen.getByLabelText(/action description/i)).toHaveValue("Offline draft.");
  });
});

// ─── UI-04: Requester never sees write controls (FR-06, BR-15) ──────────

describe("UI-04 — Requester view has no create/edit controls in the DOM (ui-spec §4.2)", () => {
  it("renders the read-only table without any Add/Edit/Void control", async () => {
    routeApi({ items: [makeEntry()] });
    renderPanel(userFor("REQUESTER"));

    await screen.findByTestId("actions-taken-row");

    // UI-04's documented assertion: the query returns null — not a hidden node.
    expect(screen.queryByRole("button", { name: /add actions taken/i })).toBeNull();
    expect(screen.queryByTestId("add-action-button")).toBeNull();
    expect(screen.queryByTestId("add-action-empty-cta")).toBeNull();
    expect(screen.queryByTestId(`edit-action-act-1`)).toBeNull();
    expect(screen.queryByTestId(`void-action-act-1`)).toBeNull();
  });

  it("does not render the form element at all for a Requester", async () => {
    renderPanel(userFor("REQUESTER"));
    await screen.findByTestId("actions-taken-row");
    expect(screen.queryByTestId("actions-taken-form")).toBeNull();
  });
});

// ─── Edit mode (§4.4) ───────────────────────────────────────────────────

describe("Actions Taken — edit mode (ui-spec §4.4, BR-11)", () => {
  it("offers Edit to the author within the 15-minute window and pre-fills the form", async () => {
    const user = userEvent.setup();
    routeApi({
      items: [
        makeEntry({ performedById: "user-IT_STAFF", performedBy: { id: "user-IT_STAFF", name: "IT_STAFF Person" } }),
      ],
    });
    renderPanel(userFor("IT_STAFF", "user-IT_STAFF"));

    const editButton = await screen.findByTestId("edit-action-act-1");
    await user.click(editButton);

    expect(screen.getByLabelText(/action description/i)).toHaveValue("Initial diagnosis run.");
    expect(screen.getByLabelText(/^result/i)).toHaveValue("Confirmed swollen battery cell.");
    expect(screen.getByTestId("performed-by-text")).toHaveTextContent("Recorded as: IT_STAFF Person");
  });

  it("offers no Edit affordance to a non-author IT Staff member", async () => {
    routeApi({ items: [makeEntry()] });
    renderPanel(userFor("IT_STAFF", "someone-else"));

    await screen.findByTestId("actions-taken-row");
    expect(screen.queryByTestId("edit-action-act-1")).toBeNull();
  });

  it("shows EDIT_WINDOW_EXPIRED as a role-appropriate inline message", async () => {
    const user = userEvent.setup();
    // The window check is client-side (the Edit affordance disappears after 15
    // minutes), so simulate the race the API documents: an in-window row whose
    // PATCH the server rejects because the window lapsed server-side first.
    routeApi({
      items: [makeEntry({ performedById: "user-IT_STAFF", performedBy: { id: "user-IT_STAFF", name: "IT_STAFF Person" } })],
      patchResponse: () => ({
        status: 403,
        body: { error: { code: "EDIT_WINDOW_EXPIRED", message: "The edit window has expired." } },
      }),
    });

    renderPanel(userFor("IT_STAFF", "user-IT_STAFF"));
    await user.click(await screen.findByTestId("edit-action-act-1"));
    await user.click(screen.getByTestId("action-save-button"));

    const banner = await screen.findByTestId("action-form-error");
    expect(banner).toHaveTextContent(/15-minute edit window .* has expired/i);
    // The draft survives (§4.5).
    expect(screen.getByLabelText(/action description/i)).toHaveValue("Initial diagnosis run.");
  });

  it("shows NOT_AUTHOR as an inline message when the server rejects the edit", async () => {
    const user = userEvent.setup();
    routeApi({
      items: [makeEntry({ performedById: "user-IT_STAFF", performedBy: { id: "user-IT_STAFF", name: "IT_STAFF Person" } })],
      patchResponse: () => ({
        status: 403,
        body: { error: { code: "NOT_AUTHOR", message: "Only the author or an Administrator can change this entry." } },
      }),
    });
    renderPanel(userFor("IT_STAFF", "user-IT_STAFF"));

    await user.click(await screen.findByTestId("edit-action-act-1"));
    await user.type(screen.getByLabelText(/action description/i), "Updated by the author.");
    await user.click(screen.getByTestId("action-save-button"));

    expect(await screen.findByTestId("action-form-error")).toHaveTextContent(
      /only the author of this entry or an administrator/i,
    );
  });

  it("lets an Administrator edit any entry regardless of the window", async () => {
    routeApi({
      items: [makeEntry({ createdAt: "2026-09-01T09:00:00.000Z" })], // months old
    });
    renderPanel(userFor("ADMINISTRATOR"));

    expect(await screen.findByTestId("edit-action-act-1")).toBeInTheDocument();
  });

  it("re-fetches and explains when the server answers ENTRY_VOIDED (§4.4)", async () => {
    const user = userEvent.setup();
    routeApi({
      items: [makeEntry({ performedById: "user-IT_STAFF", performedBy: { id: "user-IT_STAFF", name: "IT_STAFF Person" } })],
      patchResponse: () => ({
        status: 409,
        body: { error: { code: "ENTRY_VOIDED", message: "This entry has been voided and can no longer be changed." } },
      }),
    });
    renderPanel(userFor("IT_STAFF", "user-IT_STAFF"));

    await user.click(await screen.findByTestId("edit-action-act-1"));
    await user.click(screen.getByTestId("action-save-button"));

    expect(await screen.findByTestId("action-form-error")).toHaveTextContent(
      /voided and can no longer be changed/i,
    );
    await waitFor(() => {
      expect(mockApiClient.mock.calls.filter((c) => String(c[0]) === LIST_PATH).length).toBeGreaterThan(1);
    });
  });
});

// ─── Void (Administrator, §4.4 / BR-11) ─────────────────────────────────

describe("Actions Taken — void (ui-spec §4.4, Administrator only)", () => {
  it("requires a reason of at least 3 characters before voiding", async () => {
    const user = userEvent.setup();
    routeApi({ items: [makeEntry()] });
    renderPanel(userFor("ADMINISTRATOR"));

    await user.click(await screen.findByTestId("void-action-act-1"));
    await user.click(screen.getByTestId("void-confirm-button"));

    expect(await screen.findByText(/void reason is required/i)).toBeInTheDocument();
    expect(mockApiClient.mock.calls.filter((c) => c[1]?.method === "PATCH")).toHaveLength(0);
  });

  it("sends isVoided + voidReason and hides the row on success", async () => {
    const user = userEvent.setup();
    routeApi({
      items: [makeEntry()],
      patchResponse: (_path, body) => ({
        status: body && (body as { isVoided?: boolean }).isVoided === true ? 200 : 200,
        body: makeEntry({ isVoided: true, voidReason: (body as { voidReason?: string })?.voidReason ?? "" }),
      }),
    });
    renderPanel(userFor("ADMINISTRATOR"));

    await user.click(await screen.findByTestId("void-action-act-1"));
    await user.type(screen.getByLabelText(/void reason/i), "Duplicate entry created by double submission.");
    await user.click(screen.getByTestId("void-confirm-button"));

    await waitFor(() => {
      const patch = mockApiClient.mock.calls.find((c) => String(c[0]) === ENTRY_PATH);
      expect(patch).toBeDefined();
      expect(JSON.parse(String((patch?.[1] as RequestInit)?.body))).toEqual({
        isVoided: true,
        voidReason: "Duplicate entry created by double submission.",
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("actions-taken-row")).toBeNull();
    });
  });

  it("offers no Void control to IT Staff", async () => {
    routeApi({ items: [makeEntry()] });
    renderPanel(userFor("IT_STAFF"));

    await screen.findByTestId("actions-taken-row");
    expect(screen.queryByTestId("void-action-act-1")).toBeNull();
  });
});

// ─── Cancel protection (§4.3, handout §8.5) ─────────────────────────────

describe("Actions Taken — cancel protects entered data (ui-spec §4.3)", () => {
  it("prompts before discarding touched fields, then discards on confirm", async () => {
    const user = userEvent.setup();
    renderPanel(userFor("IT_STAFF"));

    await user.click(await screen.findByTestId("add-action-button"));
    await user.type(screen.getByLabelText(/action description/i), "Precious draft.");

    // First Cancel press opens the confirmation.
    await user.click(screen.getByTestId("action-cancel-button"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/discard/i);

    // Second Cancel press (inside the dialog) discards.
    await user.click(within(dialog).getByRole("button", { name: /^discard$/i }));

    expect(screen.queryByTestId("actions-taken-form")).not.toBeInTheDocument();
  });

  it("returns to the form when the confirmation is dismissed", async () => {
    const user = userEvent.setup();
    renderPanel(userFor("IT_STAFF"));

    await user.click(await screen.findByTestId("add-action-button"));
    await user.type(screen.getByLabelText(/action description/i), "Another draft.");
    await user.click(screen.getByTestId("action-cancel-button"));

    const dialog = await screen.findByRole("dialog");
    // ConfirmDialog's secondary button is "Cancel" — staying in the form.
    await user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    expect(screen.getByTestId("actions-taken-form")).toBeInTheDocument();
    expect(screen.getByLabelText(/action description/i)).toHaveValue("Another draft.");
  });

  it("closes immediately when nothing was touched", async () => {
    const user = userEvent.setup();
    renderPanel(userFor("IT_STAFF"));

    await user.click(await screen.findByTestId("add-action-button"));
    await user.click(screen.getByTestId("action-cancel-button"));

    expect(screen.queryByTestId("actions-taken-form")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ─── §8: automated accessibility ────────────────────────────────────────

describe("Actions Taken — automated accessibility (ui-spec §8)", () => {
  it("has no axe violations in the populated staff view", async () => {
    routeApi({
      items: [
        makeEntry({ followUpRequired: true, followUpNote: "Watch the AP for 48 hours." }),
        makeEntry({ id: "act-2", description: "Second entry with a description." }),
      ],
    });
    renderPanel(userFor("IT_STAFF"));
    await screen.findAllByTestId("actions-taken-row");

    await expectNoA11yViolations(document.body, "Actions Taken (staff, populated)");
  });

  it("has no axe violations in the Requester read-only view", async () => {
    routeApi({ items: [makeEntry()] });
    renderPanel(userFor("REQUESTER"));
    await screen.findByTestId("actions-taken-row");

    await expectNoA11yViolations(document.body, "Actions Taken (requester)");
  });

  it("has no axe violations with the create form open and follow-up on", async () => {
    const user = userEvent.setup();
    renderPanel(userFor("IT_STAFF"));

    await user.click(await screen.findByTestId("add-action-button"));
    await user.click(screen.getByLabelText(/follow-up required/i));

    await expectNoA11yViolations(document.body, "Actions Taken (create form)");
  });

  it("has no axe violations in the empty state", async () => {
    routeApi({ items: [] });
    renderPanel(userFor("IT_STAFF"));
    await screen.findByTestId("actions-taken-empty");

    await expectNoA11yViolations(document.body, "Actions Taken (empty)");
  });
});
