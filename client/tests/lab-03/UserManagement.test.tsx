import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AdminUsersPage from "../../src/pages/AdminUsersPage";

/**
 * Administrator User Management — tests.md §9 (ui-spec.md §7)
 *
 *   UI-08  list · search · role filter · Create/Edit modals render and validate,
 *          across the Idle → Validating → Busy → Success/Failure states
 *   UI-09  self-deactivation and last-active-Administrator guard rules disable
 *          the right controls with the right tooltip
 *
 * The apiClient mock is a miniature version of the real endpoint rather than a
 * canned response: it parses `q`/`role` out of the URL, so a test that types in
 * the search box proves the page actually SENT the query, and the unfiltered
 * administrator "roster" request (also GET /api/admin/users) is answered
 * correctly without having to special-case it.
 */

// ─── Mocks ──────────────────────────────────────────────────────────────

const mockApiClient = vi.fn();

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: (url: string, init?: RequestInit) => mockApiClient(url, init),
}));

/** The signed-in Administrator, injected through useAuth. */
const authState = vi.hoisted(() => ({
  user: null as null | { id: string; name: string; email: string; role: string },
}));

vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: authState.user, status: "authenticated" }),
}));

// ─── Fixtures ───────────────────────────────────────────────────────────

interface FixtureUser {
  id: string;
  name: string;
  email: string;
  role: "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR";
  isActive: boolean;
}

const SELF_ID = "admin-1";

const BASE_USERS: FixtureUser[] = [
  {
    id: SELF_ID,
    name: "System Administrator",
    email: "admin@toktickit.example.com",
    role: "ADMINISTRATOR",
    isActive: true,
  },
  {
    id: "admin-2",
    name: "Second Administrator",
    email: "second.admin@toktickit.example.com",
    role: "ADMINISTRATOR",
    isActive: true,
  },
  {
    id: "staff-1",
    name: "Alice Chen",
    email: "alice.chen@toktickit.example.com",
    role: "IT_STAFF",
    isActive: true,
  },
  {
    id: "req-1",
    name: "Jennifer Anderson",
    email: "jennifer.anderson@example.com",
    role: "REQUESTER",
    isActive: true,
  },
  {
    id: "req-2",
    name: "Robert Wilson",
    email: "robert.wilson@example.com",
    role: "REQUESTER",
    isActive: false,
  },
];

/** Mutable per-test server state. */
let users: FixtureUser[];
let listShouldFail: boolean;
let failNextWrite: { status: number; body: unknown } | null;
let requests: Array<{ url: string; method: string; body?: Record<string, unknown> }>;

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function installServer() {
  mockApiClient.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const parsed = new URL(url, "http://localhost");
    requests.push({
      url,
      method,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
    });

    if (method === "GET" && parsed.pathname === "/api/admin/users") {
      if (listShouldFail) return response({ error: { code: "SERVER_ERROR", message: "boom" } }, 500);
      const q = (parsed.searchParams.get("q") ?? "").toLowerCase();
      const role = parsed.searchParams.get("role");
      return response({
        items: users.filter(
          (row) =>
            (!q || `${row.name} ${row.email}`.toLowerCase().includes(q)) &&
            (!role || row.role === role),
        ),
      });
    }

    if (method === "POST" && parsed.pathname === "/api/admin/users") {
      if (failNextWrite) {
        const failure = failNextWrite;
        failNextWrite = null;
        return response(failure.body, failure.status);
      }
      const body = (init?.body ? JSON.parse(String(init.body)) : {}) as Record<string, unknown>;
      const created: FixtureUser = {
        id: `created-${users.length + 1}`,
        name: String(body.name),
        email: String(body.email).toLowerCase(),
        role: body.role as FixtureUser["role"],
        isActive: Boolean(body.isActive),
      };
      users = [...users, created];
      return response(created, 201);
    }

    if (method === "POST" && parsed.pathname.endsWith("/reset-password")) {
      if (failNextWrite) {
        const failure = failNextWrite;
        failNextWrite = null;
        return response(failure.body, failure.status);
      }
      return response({ success: true });
    }

    if (method === "PATCH" && parsed.pathname.startsWith("/api/admin/users/")) {
      if (failNextWrite) {
        const failure = failNextWrite;
        failNextWrite = null;
        return response(failure.body, failure.status);
      }
      const id = parsed.pathname.split("/").pop() as string;
      const body = (init?.body ? JSON.parse(String(init.body)) : {}) as Partial<FixtureUser>;
      const existing = users.find((row) => row.id === id) as FixtureUser;
      const updated = { ...existing, ...body };
      users = users.map((row) => (row.id === id ? updated : row));
      return response(updated);
    }

    return response({ items: [] });
  });
}

function lastRequestMatching(pattern: RegExp, method?: string) {
  return requests.filter(
    (entry) => pattern.test(entry.url) && (!method || entry.method === method),
  ).at(-1);
}

function renderPage() {
  return render(<AdminUsersPage />);
}

beforeEach(() => {
  users = BASE_USERS.map((row) => ({ ...row }));
  listShouldFail = false;
  failNextWrite = null;
  requests = [];
  authState.user = {
    id: SELF_ID,
    name: "System Administrator",
    email: "admin@toktickit.example.com",
    role: "ADMINISTRATOR",
  };
  mockApiClient.mockReset();
  installServer();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── UI-08: list, search, filter, create, edit ──────────────────────────

describe("UI-08 — User Management list, search, filter and modals (ui-spec §7)", () => {
  it("renders the required columns and a row per user", async () => {
    renderPage();

    const table = await screen.findByTestId("users-table");
    for (const column of ["Name", "Email", "Role", "Status", "Action"]) {
      expect(within(table).getByRole("columnheader", { name: column })).toBeInTheDocument();
    }

    const rows = screen.getAllByTestId("user-row");
    expect(rows).toHaveLength(BASE_USERS.length);

    const badge = { selector: "span[role='status']" } as const;
    const first = rows[0];
    expect(within(first).getByText("System Administrator")).toBeInTheDocument();
    expect(within(first).getByText("admin@toktickit.example.com")).toBeInTheDocument();
    expect(within(first).getByText("Administrator", badge)).toBeInTheDocument();
    expect(within(first).getByText("Active", badge)).toBeInTheDocument();
    expect(within(first).getByRole("button", { name: /edit System Administrator/i })).toBeInTheDocument();

    // Deactivated accounts are still listed, labelled "Inactive" — never blank
    // and never "error" coloured.
    const lastRow = rows.at(-1);
    expect(within(lastRow!).getByText("Inactive", badge)).toBeInTheDocument();
  });

  it("renders stacked-card markup for the narrow-viewport breakpoint", async () => {
    renderPage();

    const cards = await screen.findAllByTestId("user-card");
    expect(cards).toHaveLength(BASE_USERS.length);
    expect(within(cards[0]).getByText("System Administrator")).toBeInTheDocument();
    expect(within(cards[0]).getByRole("button", { name: /edit System Administrator/i })).toBeInTheDocument();
  });

  it("sends the debounced search term as `q` and renders the matching subset", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("users-table");

    await user.type(screen.getByLabelText(/search by name or email/i), "alice");

    await waitFor(() => {
      expect(lastRequestMatching(/[?&]q=alice/, "GET")).toBeDefined();
    });

    await waitFor(() => {
      const rows = screen.getAllByTestId("user-row");
      expect(rows).toHaveLength(1);
      expect(within(rows[0]).getByText("Alice Chen")).toBeInTheDocument();
    });
  });

  it("searches by email as well as name", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("users-table");

    await user.type(screen.getByLabelText(/search by name or email/i), "jennifer.anderson");

    await waitFor(() => {
      const rows = screen.getAllByTestId("user-row");
      expect(rows).toHaveLength(1);
      expect(within(rows[0]).getByText("jennifer.anderson@example.com")).toBeInTheDocument();
    });
  });

  it("filters by role and sends `role` to the API", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("users-table");

    await user.selectOptions(screen.getByLabelText("Filter by role"), "IT_STAFF");

    await waitFor(() => {
      expect(lastRequestMatching(/[?&]role=IT_STAFF/, "GET")).toBeDefined();
    });

    await waitFor(() => {
      const rows = screen.getAllByTestId("user-row");
      expect(rows).toHaveLength(1);
      expect(within(rows[0]).getByText("Alice Chen")).toBeInTheDocument();
    });
  });

  it("shows the empty message when there are no users at all", async () => {
    users = [];
    renderPage();

    const empty = await screen.findByTestId("users-empty");
    expect(within(empty).getByText("No users found.")).toBeInTheDocument();
    expect(within(empty).queryByRole("button", { name: /clear filters/i })).not.toBeInTheDocument();
  });

  it("shows no-results with a working Clear filters when the search matches nothing", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("users-table");

    await user.type(screen.getByLabelText(/search by name or email/i), "zzzz");

    const empty = await screen.findByTestId("users-empty");
    expect(within(empty).getByText("No users match your search/filters.")).toBeInTheDocument();

    await user.click(within(empty).getByRole("button", { name: /clear filters/i }));

    await waitFor(() => {
      expect(screen.getAllByTestId("user-row")).toHaveLength(BASE_USERS.length);
    });
  });

  it("shows skeleton rows while loading", async () => {
    // The page issues two GETs per load (filtered list + administrator roster),
    // so hold EVERY pending promise and settle them together.
    const resolvers: Array<(value: unknown) => void> = [];
    mockApiClient.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve as (value: unknown) => void);
        }),
    );

    renderPage();

    expect(screen.getAllByTestId("users-skeleton-row").length).toBeGreaterThan(0);

    resolvers.forEach((resolve) => resolve(response({ items: [] })));
    await screen.findByTestId("users-empty");
  });

  it("shows a retry banner when the list request fails, and recovers on Retry", async () => {
    const user = userEvent.setup();
    listShouldFail = true;
    renderPage();

    const banner = await screen.findByTestId("users-error");
    expect(within(banner).getByText("Couldn't load users. Retry.")).toBeInTheDocument();

    listShouldFail = false;
    await user.click(within(banner).getByRole("button", { name: /retry/i }));

    expect(await screen.findAllByTestId("user-row")).toHaveLength(BASE_USERS.length);
  });

  // ─── Create User modal ────────────────────────────────────────────────

  it("opens the Create User modal in the Idle state with every required field", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("users-table");

    await user.click(screen.getByTestId("create-user-button"));

    const dialog = screen.getByTestId("create-user-dialog");
    expect(within(dialog).getByRole("heading", { name: "Create User" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Name/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Email/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Role/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Initial Password/)).toBeInTheDocument();
    // The Active toggle defaults to true (§7).
    expect(within(dialog).getByRole("checkbox", { name: "Active" })).toBeChecked();
    // Helper text is mandated verbatim.
    expect(within(dialog).getByText("User must change this password at first login")).toBeInTheDocument();
    // Idle: no request has been made just by opening it.
    expect(requests.filter((entry) => entry.method === "POST")).toHaveLength(0);
  });

  it("validates locally and never calls the API for an unsubmittable form", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("users-table");
    await user.click(screen.getByTestId("create-user-button"));

    const dialog = screen.getByTestId("create-user-dialog");
    await user.type(within(dialog).getByLabelText(/^Email/), "not-an-email");
    await user.type(within(dialog).getByLabelText(/Initial Password/), "short");
    await user.click(within(dialog).getByRole("button", { name: "Create User" }));

    expect(within(dialog).getByText("Name is required.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Must be at least 8 characters and include a letter and a number"),
    ).toBeInTheDocument();

    expect(requests.filter((entry) => entry.method === "POST")).toHaveLength(0);
    // Failure state is reachable but the form is NOT closed — nothing typed is lost.
    expect(within(dialog).getByLabelText(/^Email/)).toHaveValue("not-an-email");
  });

  it("creates a user: Busy → Success (toast, modal closes, list refreshes)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("users-table");
    await user.click(screen.getByTestId("create-user-button"));

    const dialog = screen.getByTestId("create-user-dialog");
    await user.type(within(dialog).getByLabelText(/^Name/), "New Person");
    await user.type(within(dialog).getByLabelText(/^Email/), "new.person@example.com");
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), "IT_STAFF");
    await user.type(within(dialog).getByLabelText(/Initial Password/), "InitialPass1!");
    await user.click(within(dialog).getByRole("button", { name: "Create User" }));

    expect(await screen.findByTestId("users-toast")).toHaveTextContent("User created.");
    await waitFor(() => expect(screen.queryByTestId("create-user-dialog")).not.toBeInTheDocument());

    const post = requests.find((entry) => entry.method === "POST");
    expect(post?.url).toBe("/api/admin/users");
    expect(post?.body).toMatchObject({
      name: "New Person",
      email: "new.person@example.com",
      role: "IT_STAFF",
      isActive: true,
      initialPassword: "InitialPass1!",
    });
    // The list was refreshed, so the new user is visible without a manual
    // reload (both the table and the mobile card list are in the DOM in jsdom).
    await waitFor(() => {
      expect(screen.getAllByText("new.person@example.com").length).toBeGreaterThan(0);
    });
  });

  it("shows the duplicate-email inline error under Email and keeps the form values", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("users-table");
    await user.click(screen.getByTestId("create-user-button"));

    failNextWrite = {
      status: 422,
      body: {
        error: {
          code: "EMAIL_ALREADY_IN_USE",
          message: "This email is already in use.",
          fields: { email: "This email is already in use." },
        },
      },
    };

    const dialog = screen.getByTestId("create-user-dialog");
    await user.type(within(dialog).getByLabelText(/^Name/), "Copy Cat");
    await user.type(within(dialog).getByLabelText(/^Email/), "admin@toktickit.example.com");
    await user.type(within(dialog).getByLabelText(/Initial Password/), "InitialPass1!");
    await user.click(within(dialog).getByRole("button", { name: "Create User" }));

    expect(await within(dialog).findByText("This email is already in use.")).toBeInTheDocument();
    // A duplicate email is a FIELD error (§7: "inline error under Email"), so it
    // must not also be duplicated into the generic banner.
    expect(within(dialog).queryByTestId("create-user-dialog-error")).not.toBeInTheDocument();
    // Values preserved (§7 Failure state).
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue("Copy Cat");
    expect(within(dialog).getByLabelText(/^Email/)).toHaveValue("admin@toktickit.example.com");
    expect(screen.queryByTestId("users-toast")).not.toBeInTheDocument();
  });

  it("shows a generic in-modal banner (not a field error) for an unexpected failure", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("users-table");
    await user.click(screen.getByTestId("create-user-button"));

    failNextWrite = {
      status: 500,
      body: { error: { code: "SERVER_ERROR", message: "Something went wrong. Please try again." } },
    };

    const dialog = screen.getByTestId("create-user-dialog");
    await user.type(within(dialog).getByLabelText(/^Name/), "Unlucky Person");
    await user.type(within(dialog).getByLabelText(/^Email/), "unlucky@example.com");
    await user.type(within(dialog).getByLabelText(/Initial Password/), "InitialPass1!");
    await user.click(within(dialog).getByRole("button", { name: "Create User" }));

    const banner = await within(dialog).findByTestId("create-user-dialog-error");
    expect(banner).toHaveTextContent("Something went wrong. Please try again.");
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue("Unlucky Person");
  });

  // ─── Edit User modal ──────────────────────────────────────────────────

  it("opens the Edit modal prefilled and disables Save until something changes", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("users-table");

    const staffRow = screen.getAllByTestId("user-row")[2];
    await user.click(within(staffRow).getByRole("button", { name: /edit Alice Chen/i }));

    const dialog = screen.getByTestId("edit-user-dialog");
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue("Alice Chen");
    expect(within(dialog).getByLabelText(/^Email/)).toHaveValue("alice.chen@toktickit.example.com");
    expect(within(dialog).getByLabelText(/^Role/)).toHaveValue("IT_STAFF");
    expect(within(dialog).getByRole("checkbox", { name: "Active" })).toBeChecked();

    const save = within(dialog).getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/^Name/), " Jr");
    expect(save).toBeEnabled();
  });

  it("PATCHes only the changed fields and reports success", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("users-table");

    const staffRow = screen.getAllByTestId("user-row")[2];
    await user.click(within(staffRow).getByRole("button", { name: /edit Alice Chen/i }));

    const dialog = screen.getByTestId("edit-user-dialog");
    await user.clear(within(dialog).getByLabelText(/^Name/));
    await user.type(within(dialog).getByLabelText(/^Name/), "Alice Chen-Reyes");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await screen.findByTestId("users-toast")).toHaveTextContent("User updated.");

    const patch = requests.find((entry) => entry.method === "PATCH");
    expect(patch?.url).toBe("/api/admin/users/staff-1");
    // Only the edited field travels — a stale form value can never rewrite an
    // untouched column.
    expect(patch?.body).toEqual({ name: "Alice Chen-Reyes" });
  });

  it("surfaces a duplicate-email error inline when editing onto a taken address", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("users-table");

    const staffRow = screen.getAllByTestId("user-row")[2];
    await user.click(within(staffRow).getByRole("button", { name: /edit Alice Chen/i }));

    failNextWrite = {
      status: 422,
      body: {
        error: {
          code: "EMAIL_ALREADY_IN_USE",
          message: "This email is already in use.",
          fields: { email: "This email is already in use." },
        },
      },
    };

    const dialog = screen.getByTestId("edit-user-dialog");
    await user.clear(within(dialog).getByLabelText(/^Email/));
    await user.type(within(dialog).getByLabelText(/^Email/), "admin@toktickit.example.com");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await within(dialog).findByText("This email is already in use.")).toBeInTheDocument();
  });

  it("shows the API's own 409 wording in the banner when the server refuses an edit", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("users-table");

    const adminRow = screen.getAllByTestId("user-row")[1];
    await user.click(within(adminRow).getByRole("button", { name: /edit Second Administrator/i }));

    failNextWrite = {
      status: 409,
      body: {
        error: { code: "LAST_ACTIVE_ADMIN", message: "At least one active Administrator is required." },
      },
    };

    const dialog = screen.getByTestId("edit-user-dialog");
    await user.click(within(dialog).getByRole("checkbox", { name: "Active" }));
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    // The UI hides nothing here (a second active Administrator exists in its
    // view) — the server is the authority and its message is what the user sees.
    const banner = await within(dialog).findByTestId("edit-user-dialog-error");
    expect(banner).toHaveTextContent("At least one active Administrator is required.");
  });

  // ─── Reset password sub-action ────────────────────────────────────────

  it("requires its own confirmation before resetting a password, with the mandated copy", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("users-table");

    const staffRow = screen.getAllByTestId("user-row")[2];
    await user.click(within(staffRow).getByRole("button", { name: /edit Alice Chen/i }));

    const dialog = screen.getByTestId("edit-user-dialog");
    await user.type(within(dialog).getByLabelText(/^New initial password/), "FreshPass1!");
    await user.click(within(dialog).getByTestId("reset-password-button"));

    const confirm = screen.getByTestId("reset-password-confirm");
    expect(
      within(confirm).getByText(
        "This resets Alice Chen's password. They will need to set a new one at next login. Continue?",
      ),
    ).toBeInTheDocument();

    // Cancelling must not call the API.
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("reset-password-confirm")).not.toBeInTheDocument();
    expect(requests.filter((entry) => entry.url.includes("/reset-password"))).toHaveLength(0);

    // Confirming does.
    await user.click(within(dialog).getByTestId("reset-password-button"));
    await user.click(
      within(screen.getByTestId("reset-password-confirm")).getByRole("button", { name: "Reset password" }),
    );

    await waitFor(() => {
      expect(requests.filter((entry) => entry.url.includes("/reset-password"))).toHaveLength(1);
    });
    const reset = requests.find((entry) => entry.url.includes("/reset-password"));
    expect(reset?.method).toBe("POST");
    expect(reset?.url).toBe("/api/admin/users/staff-1/reset-password");
    expect(reset?.body).toEqual({ newInitialPassword: "FreshPass1!" });

    expect(await screen.findByTestId("users-toast")).toHaveTextContent("Password reset for Alice Chen.");
  });

  it("blocks the reset locally when the new password fails the policy", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("users-table");

    const staffRow = screen.getAllByTestId("user-row")[2];
    await user.click(within(staffRow).getByRole("button", { name: /edit Alice Chen/i }));

    const dialog = screen.getByTestId("edit-user-dialog");
    await user.type(within(dialog).getByLabelText(/^New initial password/), "weak");
    await user.click(within(dialog).getByTestId("reset-password-button"));

    expect(
      within(dialog).getByText("Must be at least 8 characters and include a letter and a number"),
    ).toBeInTheDocument();
    // No confirmation step and no request for an unsubmittable value.
    expect(screen.queryByTestId("reset-password-confirm")).not.toBeInTheDocument();
    expect(requests.filter((entry) => entry.url.includes("/reset-password"))).toHaveLength(0);
  });
});

// ─── UI-09: guard rules surfaced in the UI ──────────────────────────────

describe("UI-09 — self-deactivation and last-active-Administrator guards (ui-spec §7)", () => {
  it("disables the Active toggle with the self tooltip when editing your own account", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("users-table");

    // admin-1 is the signed-in user; admin-2 is also an active Administrator,
    // so the last-admin rule does NOT apply here — this isolates the self rule.
    const selfRow = screen.getAllByTestId("user-row")[0];
    await user.click(within(selfRow).getByRole("button", { name: /edit System Administrator/i }));

    const dialog = screen.getByTestId("edit-user-dialog");
    const toggle = within(dialog).getByRole("checkbox", { name: "Active" });

    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-describedby", "edit-active-guard-note");

    const guard = within(dialog).getByTestId("active-guard");
    expect(guard).toHaveAttribute("title", "You cannot deactivate your own account.");
    expect(within(guard).getByText("You cannot deactivate your own account.")).toBeInTheDocument();

    // Role changes are still allowed — only deactivation is blocked.
    expect(within(dialog).getByLabelText(/^Role/)).toBeEnabled();
    expect(within(dialog).queryByTestId("role-guard")).not.toHaveTextContent(
      "At least one active Administrator is required.",
    );
  });

  it("disables Role and Active with the last-administrator tooltip for the only active Administrator", async () => {
    const user = userEvent.setup();
    // Everything except the signed-in Administrator is inactive, so admin-1 is
    // the LAST active Administrator as well as the current user. Both rules
    // match; the system-level message must win (the same precedence the server
    // uses), because "you can't deactivate yourself" would hide the real reason.
    users = users.map((row) =>
      row.id === SELF_ID ? row : { ...row, isActive: false },
    );

    renderPage();
    await screen.findByTestId("users-table");

    const selfRow = screen.getAllByTestId("user-row")[0];
    await user.click(within(selfRow).getByRole("button", { name: /edit System Administrator/i }));

    const dialog = screen.getByTestId("edit-user-dialog");

    expect(within(dialog).getByRole("checkbox", { name: "Active" })).toBeDisabled();
    expect(within(dialog).getByLabelText(/^Role/)).toBeDisabled();

    const activeGuard = within(dialog).getByTestId("active-guard");
    const roleGuard = within(dialog).getByTestId("role-guard");
    expect(activeGuard).toHaveAttribute("title", "At least one active Administrator is required.");
    expect(roleGuard).toHaveAttribute("title", "At least one active Administrator is required.");
    expect(
      within(dialog).getAllByText("At least one active Administrator is required.").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("leaves both controls enabled when another active Administrator exists", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("users-table");

    const otherAdminRow = screen.getAllByTestId("user-row")[1];
    await user.click(within(otherAdminRow).getByRole("button", { name: /edit Second Administrator/i }));

    const dialog = screen.getByTestId("edit-user-dialog");
    expect(within(dialog).getByRole("checkbox", { name: "Active" })).toBeEnabled();
    expect(within(dialog).getByLabelText(/^Role/)).toBeEnabled();
    expect(within(dialog).getByTestId("active-guard")).not.toHaveAttribute("title");
    expect(within(dialog).getByTestId("role-guard")).not.toHaveAttribute("title");
  });

  it("does not infer the last active Administrator from a FILTERED view", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("users-table");

    // Filter down to IT Staff only. A naive implementation would look at the
    // visible rows, find zero Administrators, and conclude the next edit is the
    // last one. The page separately requests the unfiltered administrator
    // roster, so the guard must stay off.
    await user.selectOptions(screen.getByLabelText("Filter by role"), "IT_STAFF");

    const rows = await screen.findAllByTestId("user-row");
    expect(rows).toHaveLength(1);
    await user.click(within(rows[0]).getByRole("button", { name: /edit Alice Chen/i }));

    const dialog = screen.getByTestId("edit-user-dialog");
    expect(within(dialog).getByRole("checkbox", { name: "Active" })).toBeEnabled();
    expect(within(dialog).getByLabelText(/^Role/)).toBeEnabled();

    // …and the roster really was fetched separately from the filtered list.
    expect(lastRequestMatching(/role=ADMINISTRATOR/, "GET")).toBeDefined();
  });

  it("keeps the guards off when the administrator roster cannot be loaded", async () => {
    const user = userEvent.setup();

    // Answer the roster request with a failure while the list still succeeds —
    // the blocked-controls state must not be fabricated from missing data. The
    // server still enforces both guards.
    mockApiClient.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const parsed = new URL(url, "http://localhost");
      if (method === "GET" && parsed.pathname === "/api/admin/users") {
        if (parsed.searchParams.get("role") === "ADMINISTRATOR") {
          return response({ error: { code: "SERVER_ERROR", message: "boom" } }, 500);
        }
        return response({ items: users });
      }
      return response({}, 200);
    });

    renderPage();
    await screen.findByTestId("users-table");

    const selfRow = screen.getAllByTestId("user-row")[0];
    await user.click(within(selfRow).getByRole("button", { name: /edit System Administrator/i }));

    const dialog = screen.getByTestId("edit-user-dialog");
    // No roster → no last-admin claim. The self rule is still known exactly,
    // because it only depends on the session identity.
    expect(within(dialog).getByTestId("active-guard")).toHaveAttribute(
      "title",
      "You cannot deactivate your own account.",
    );
    expect(within(dialog).getByTestId("role-guard")).not.toHaveAttribute("title");
  });
});
