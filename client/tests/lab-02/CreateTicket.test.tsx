/**
 * CreateTicketPage — Client-side validation tests (BR-19 to BR-24)
 *
 * Tests:
 * - Submit empty form → all fields show errors, no API call
 * - Each field boundary validation (summary, description, priority)
 * - Blur on field with error → re-validates, clears if fixed
 * - Focus moves to first error field after failed submit (AC-24)
 * - BR-24: field values preserved on validation failure
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import CreateTicketPage, { validateForm, type FormState } from "../../src/pages/CreateTicketPage";
import { fireEvent } from "@testing-library/react";

// ─── Mocks ──────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const MOCK_CATEGORIES = [
  { id: 1, name: "Hardware" },
  { id: 2, name: "Software" },
  { id: 3, name: "Network" },
  { id: 4, name: "Account and Access" },
];

const MOCK_RELATED_SYSTEMS = [
  { id: 1, name: "Email" },
  { id: 2, name: "Campus Wi-Fi" },
  { id: 3, name: "VPN" },
  { id: 4, name: "Corporate Laptop" },
];

let fetchHandler: (url: string) => { ok: boolean; json: () => Promise<unknown> };

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      return fetchHandler(input);
    }),
  );

  fetchHandler = (url: string) => {
    if (url.includes("/api/categories")) {
      return { ok: true, json: async () => ({ categories: MOCK_CATEGORIES }) };
    }
    if (url.includes("/api/related-systems")) {
      return { ok: true, json: async () => ({ relatedSystems: MOCK_RELATED_SYSTEMS }) };
    }
    return { ok: false, json: async () => ({ error: { code: "UNKNOWN" } }) };
  };

  mockNavigate.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Helper ─────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/tickets/new"]}>
      <CreateTicketPage />
    </MemoryRouter>,
  );
}

async function waitForFormReady() {
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Create Ticket" })).toBeInTheDocument();
  });
  await waitFor(() => {
    const selects = screen.getAllByRole("combobox");
    expect(selects.length).toBeGreaterThanOrEqual(2);
    expect(selects[0].querySelectorAll("option").length).toBeGreaterThan(1);
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("CreateTicketPage — validation", () => {
  // ─── Empty form submit ──────────────────────────────────────────

  describe("submitting empty form", () => {
    it("shows all field-level errors when submitting completely empty form", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitForFormReady();

      await user.click(screen.getByRole("button", { name: "Submit Ticket" }));

      await waitFor(() => {
        expect(screen.getByText(/Category is required/)).toBeInTheDocument();
        expect(screen.getByText(/Related system is required/)).toBeInTheDocument();
        expect(screen.getByText(/Summary is required/)).toBeInTheDocument();
        expect(screen.getByText(/Description is required/)).toBeInTheDocument();
        expect(screen.getByText(/Please select a priority/)).toBeInTheDocument();
      });
    });

    it("shows form-level validation summary banner", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitForFormReady();

      await user.click(screen.getByRole("button", { name: "Submit Ticket" }));

      await waitFor(() => {
        expect(screen.getByText(/Please fix 5 field\(s\) below/)).toBeInTheDocument();
      });
    });

    it("does NOT call POST /api/tickets when validation fails", async () => {
      const user = userEvent.setup();
      const fetchSpy = vi.fn(async (input: string) => {
        return fetchHandler(input);
      });
      vi.stubGlobal("fetch", fetchSpy);

      renderPage();
      await waitForFormReady();

      fetchSpy.mockClear();

      await user.click(screen.getByRole("button", { name: "Submit Ticket" }));

      await new Promise((r) => setTimeout(r, 150));

      const postCalls = fetchSpy.mock.calls.filter(
        ([url]: [string]) => typeof url === "string" && url.includes("/api/tickets"),
      );
      expect(postCalls).toHaveLength(0);
    });
  });

  // ─── Summary field boundary (BR-19) ────────────────────────────

  describe("summary validation (BR-19)", () => {
    it("rejects summary shorter than 5 characters", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitForFormReady();

      await user.type(screen.getByLabelText(/Summary/), "Hi");
      await user.click(screen.getByRole("button", { name: "Submit Ticket" }));

      await waitFor(() => {
        expect(screen.getByText(/Summary must be between 5 and 120 characters/)).toBeInTheDocument();
      });
    });

    it("accepts summary at exactly 5 characters", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitForFormReady();

      await user.selectOptions(screen.getAllByRole("combobox")[0], "1");
      await user.selectOptions(screen.getAllByRole("combobox")[1], "1");
      await user.click(screen.getByRole("radio", { name: /Low/ }));
      await user.type(screen.getByLabelText(/Summary/), "Hello");
      await user.type(screen.getByLabelText(/Description/), "A".repeat(20));

      await user.click(screen.getByRole("button", { name: "Submit Ticket" }));

      await waitFor(() => {
        expect(screen.queryByText(/Summary must be between/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Summary is required/)).not.toBeInTheDocument();
      });
    });

    it("has maxLength=120 attribute preventing >120 characters", async () => {
      renderPage();
      await waitForFormReady();

      const summaryInput = screen.getByLabelText(/Summary/);
      expect(summaryInput).toHaveAttribute("maxlength", "120");
    });

    it("accepts summary at exactly 120 characters", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitForFormReady();

      await user.selectOptions(screen.getAllByRole("combobox")[0], "1");
      await user.selectOptions(screen.getAllByRole("combobox")[1], "1");
      await user.click(screen.getByRole("radio", { name: /Low/ }));
      await user.type(screen.getByLabelText(/Summary/), "A".repeat(120));
      await user.type(screen.getByLabelText(/Description/), "A".repeat(20));

      await user.click(screen.getByRole("button", { name: "Submit Ticket" }));

      await waitFor(() => {
        expect(screen.queryByText(/Summary must be between/)).not.toBeInTheDocument();
      });
    });
  });

  // ─── Description field boundary (BR-20) ────────────────────────

  describe("description validation (BR-20)", () => {
    it("rejects description shorter than 20 characters", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitForFormReady();

      await user.type(screen.getByLabelText(/Description/), "Too short");
      await user.click(screen.getByRole("button", { name: "Submit Ticket" }));

      await waitFor(() => {
        expect(screen.getByText(/Description must be between 20 and 2000 characters/)).toBeInTheDocument();
      });
    });

    it("accepts description at exactly 20 characters", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitForFormReady();

      await user.selectOptions(screen.getAllByRole("combobox")[0], "1");
      await user.selectOptions(screen.getAllByRole("combobox")[1], "1");
      await user.click(screen.getByRole("radio", { name: /Low/ }));
      await user.type(screen.getByLabelText(/Summary/), "Hello");
      await user.type(screen.getByLabelText(/Description/), "A".repeat(20));

      await user.click(screen.getByRole("button", { name: "Submit Ticket" }));

      await waitFor(() => {
        expect(screen.queryByText(/Description must be between/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Description is required/)).not.toBeInTheDocument();
      });
    });
  });

  // ─── Priority not selected (BR-22) ─────────────────────────────

  describe("priority validation (BR-22)", () => {
    it("shows error when no priority is selected", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitForFormReady();

      await user.selectOptions(screen.getAllByRole("combobox")[0], "1");
      await user.selectOptions(screen.getAllByRole("combobox")[1], "1");
      await user.type(screen.getByLabelText(/Summary/), "Test summary here");
      await user.type(screen.getByLabelText(/Description/), "A".repeat(20));

      await user.click(screen.getByRole("button", { name: "Submit Ticket" }));

      await waitFor(() => {
        expect(screen.getByText(/Please select a priority/)).toBeInTheDocument();
      });
    });
  });

  // ─── Blur re-validation ────────────────────────────────────────

  describe("blur re-validation", () => {
    it("clears summary error when user fixes the value and blurs", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitForFormReady();

      await user.click(screen.getByRole("button", { name: "Submit Ticket" }));
      await waitFor(() => {
        expect(screen.getByText(/Summary is required/)).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText(/Summary/), "This is a valid summary");
      await user.tab();

      await waitFor(() => {
        expect(screen.queryByText(/Summary is required/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Summary must be between/)).not.toBeInTheDocument();
      });
    });

    it("keeps summary error when user types but value is still invalid on blur", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitForFormReady();

      await user.click(screen.getByRole("button", { name: "Submit Ticket" }));
      await waitFor(() => {
        expect(screen.getByText(/Summary is required/)).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText(/Summary/), "Hi");
      await user.tab();

      await waitFor(() => {
        expect(screen.getByText(/Summary must be between 5 and 120 characters/)).toBeInTheDocument();
      });
    });
  });

  // ─── Focus on first error field (AC-24) ────────────────────────

  describe("focus management (AC-24)", () => {
    it("focuses the first invalid field after submit fails", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitForFormReady();

      await user.click(screen.getByRole("button", { name: "Submit Ticket" }));

      await waitFor(() => {
        expect(screen.getByText(/Category is required/)).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(document.getElementById("categoryId")).toHaveFocus();
      });
    });
  });

  // ─── BR-24: Field values preserved ─────────────────────────────

  describe("BR-24 field value preservation", () => {
    it("preserves all entered values after validation failure", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitForFormReady();

      await user.selectOptions(screen.getAllByRole("combobox")[0], "1");
      await user.type(screen.getByLabelText(/Summary/), "Test summary here ok");
      await user.type(screen.getByLabelText(/Description/), "This is a test description that is long enough");
      await user.click(screen.getByRole("radio", { name: /Medium/ }));

      await user.click(screen.getByRole("button", { name: "Submit Ticket" }));

      await waitFor(() => {
        expect(screen.getByText(/Related system is required/)).toBeInTheDocument();
      });

      expect(screen.getAllByRole("combobox")[0]).toHaveValue("1");
      expect(screen.getByLabelText(/Summary/)).toHaveValue("Test summary here ok");
      expect(screen.getByLabelText(/Description/)).toHaveValue("This is a test description that is long enough");
      expect(screen.getByRole("radio", { name: /Medium/ })).toHaveAttribute("aria-checked", "true");
    });
  });

  // ─── Trimmed values ────────────────────────────────────────────

  describe("trimming behavior", () => {
    it("trims summary before validation (BR-19)", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitForFormReady();

      await user.type(screen.getByLabelText(/Summary/), "     ");
      await user.click(screen.getByRole("button", { name: "Submit Ticket" }));

      await waitFor(() => {
        expect(screen.getByText(/Summary is required/)).toBeInTheDocument();
      });
    });

    it("trims description before validation (BR-20)", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitForFormReady();

      await user.type(screen.getByLabelText(/Description/), "                    ");
      await user.click(screen.getByRole("button", { name: "Submit Ticket" }));

      await waitFor(() => {
        expect(screen.getByText(/Description is required/)).toBeInTheDocument();
      });
    });
  });

  // ─── validateForm() unit tests (bypasses UI maxLength) ─────────
  // These test the validation logic directly with mock FormState,
  // covering branches that jsdom's maxLength prevents via userEvent.type().

  describe("validateForm() — direct unit tests", () => {
    function makeValidState(overrides: Partial<FormState> = {}): FormState {
      return {
        categories: [],
        relatedSystems: [],
        refDataStatus: "success",
        categoryId: 1,
        relatedSystemId: 1,
        summary: "Test summary here",
        description: "A".repeat(20),
        requestedPriority: "MEDIUM",
        errors: {},
        submissionStatus: "idle",
        createdTicket: null,
        attachmentFailures: [],
        pendingFiles: [],
        apiErrorMessage: "",
        ...overrides,
      };
    }

    it("rejects summary longer than 120 characters", () => {
      const state = makeValidState({ summary: "A".repeat(121) });
      const errors = validateForm(state);
      expect(errors.summary).toBe("Summary must be between 5 and 120 characters.");
    });

    it("rejects description longer than 2000 characters", () => {
      const state = makeValidState({ description: "B".repeat(2001) });
      const errors = validateForm(state);
      expect(errors.description).toBe("Description must be between 20 and 2000 characters.");
    });

    it("accepts summary at exactly 120 characters", () => {
      const state = makeValidState({ summary: "A".repeat(120) });
      const errors = validateForm(state);
      expect(errors.summary).toBeUndefined();
    });

    it("accepts description at exactly 2000 characters", () => {
      const state = makeValidState({ description: "B".repeat(2000) });
      const errors = validateForm(state);
      expect(errors.description).toBeUndefined();
    });

    it("returns empty object when all fields are valid", () => {
      const errors = validateForm(makeValidState());
      expect(Object.keys(errors)).toHaveLength(0);
    });
  });

  // ─── maxLength bypass via fireEvent.change ──────────────────────
  // Proves that validateForm catches oversized values even when
  // they bypass the HTML maxLength attribute (e.g. backend prefill,
  // browser extension, programmatic setState).

  describe("maxLength bypass protection", () => {
    it("catches summary >120 chars set via fireEvent.change (bypasses maxLength)", async () => {
      renderPage();
      await waitForFormReady();

      const summaryInput = screen.getByLabelText(/Summary/) as HTMLInputElement;

      // Directly set a value that exceeds maxLength via fireEvent.change
      // This simulates what happens if a backend prefill or browser extension
      // sets a value longer than the HTML attribute allows.
      fireEvent.change(summaryInput, { target: { value: "A".repeat(121) } });

      // The input now has the long value (React state updated)
      expect(summaryInput.value).toHaveLength(121);

      // Submit the form — validateForm should catch it
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Submit Ticket" }));

      await waitFor(() => {
        expect(screen.getByText(/Summary must be between 5 and 120 characters/)).toBeInTheDocument();
      });
    });

    it("catches description >2000 chars set via fireEvent.change (bypasses maxLength)", async () => {
      renderPage();
      await waitForFormReady();

      const descInput = screen.getByLabelText(/Description/) as HTMLTextAreaElement;

      // Directly set a value exceeding maxLength
      fireEvent.change(descInput, { target: { value: "B".repeat(2001) } });

      expect(descInput.value).toHaveLength(2001);

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Submit Ticket" }));

      await waitFor(() => {
        expect(screen.getByText(/Description must be between 20 and 2000 characters/)).toBeInTheDocument();
      });
    });
  });
});
