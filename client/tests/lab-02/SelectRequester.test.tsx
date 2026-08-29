import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import SelectRequesterPage from "../../src/pages/SelectRequesterPage";

/**
 * SelectRequesterPage — ui-spec.md §5
 *
 * Tests all 4 states (loading, empty, error, success) and the
 * Continue button interaction (setRequester + navigate).
 *
 * Mocks: fetch (global), useNavigate, useRequester
 */

// ─── Mocks ──────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
const mockSetRequester = vi.fn();
const mockClearRequester = vi.fn();

let mockRequesters: { id: number; fullName: string; email: string }[] = [];
let fetchShouldFail = false;

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../../src/hooks/useRequester", () => ({
  useRequester: () => ({
    requester: null,
    isLoaded: true,
    setRequester: mockSetRequester,
    clearRequester: mockClearRequester,
  }),
}));

// ─── Fetch mock ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (fetchShouldFail) {
        return { ok: false, status: 500 };
      }
      return {
        ok: true,
        json: async () => ({ requesters: mockRequesters }),
      };
    }),
  );

  mockRequesters = [
    { id: 1, fullName: "Jennifer Anderson", email: "jennifer.anderson@example.com" },
    { id: 2, fullName: "Sarah Johnson", email: "sarah.johnson@example.com" },
  ];
  fetchShouldFail = false;
  mockNavigate.mockReset();
  mockSetRequester.mockReset();
  mockClearRequester.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Helper ─────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/select-requester"]}>
      <SelectRequesterPage />
    </MemoryRouter>,
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("SelectRequesterPage", () => {
  // ─── §5: Static elements (always present) ───────────────────────

  describe("static elements", () => {
    it("renders TokTickIT wordmark", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByText("TokTickIT")).toBeInTheDocument();
      });
    });

    it("renders heading 'Select Development Requester'", async () => {
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByRole("heading", { name: "Select Development Requester" }),
        ).toBeInTheDocument();
      });
    });

    it("renders amber 'testing only' banner", async () => {
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByText("This is for testing only and is not a login screen."),
        ).toBeInTheDocument();
      });
    });

    it("renders Lab 3 info callout", async () => {
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByText(/Authentication coming in Lab 3/),
        ).toBeInTheDocument();
      });
    });

    it("renders Cancel button (disabled)", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    });

    it("renders Continue button (disabled initially)", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    });
  });

  // ─── Loading state ──────────────────────────────────────────────

  describe("loading state", () => {
    it("shows loading spinner and text on mount", () => {
      // Make fetch hang so loading state persists
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

      renderPage();

      expect(screen.getByText("Loading requesters…")).toBeInTheDocument();
      expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    });

    it("dropdown is not shown during loading", () => {
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

      renderPage();

      expect(screen.queryByLabelText(/Development Requester/)).not.toBeInTheDocument();
    });
  });

  // ─── Success state ──────────────────────────────────────────────

  describe("success state", () => {
    it("shows dropdown with requesters after loading", async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByRole("combobox")).toBeInTheDocument();
      });

      const select = screen.getByRole("combobox");
      expect(select).toBeInTheDocument();

      // Should have options: placeholder + 2 requesters
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(3); // placeholder + 2
    });

    it("renders requester names in dropdown options", async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Jennifer Anderson/)).toBeInTheDocument();
      });

      expect(screen.getByText(/Jennifer Anderson.*jennifer.anderson@example.com/)).toBeInTheDocument();
      expect(screen.getByText(/Sarah Johnson.*sarah.johnson@example.com/)).toBeInTheDocument();
    });

    it("shows helper text", async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Only active development requesters are shown.")).toBeInTheDocument();
      });
    });

    it("Continue is disabled until a requester is selected", async () => {
      const user = userEvent.setup();
      renderPage();

      await waitFor(() => {
        expect(screen.getByRole("combobox")).toBeInTheDocument();
      });

      const continueBtn = screen.getByRole("button", { name: "Continue" });
      expect(continueBtn).toBeDisabled();

      // Select a requester
      await user.selectOptions(screen.getByRole("combobox"), "1");

      expect(continueBtn).not.toBeDisabled();
    });
  });

  // ─── Empty state ────────────────────────────────────────────────

  describe("empty state", () => {
    it("shows empty message when no active requesters", async () => {
      mockRequesters = [];
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByText(/No active Development Requesters are available/),
        ).toBeInTheDocument();
      });
    });

    it("Continue button is disabled in empty state", async () => {
      mockRequesters = [];
      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/No active Development Requesters/)).toBeInTheDocument();
      });

      const continueBtn = screen.getByRole("button", { name: "Continue" });
      expect(continueBtn).toBeDisabled();
    });

    it("does not show dropdown in empty state", async () => {
      mockRequesters = [];
      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/No active Development Requesters/)).toBeInTheDocument();
      });

      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });
  });

  // ─── Error state ────────────────────────────────────────────────

  describe("error state", () => {
    it("shows error banner when API fails", async () => {
      fetchShouldFail = true;
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Could not load Development Requesters."),
        ).toBeInTheDocument();
      });
    });

    it("shows Retry button in error state", async () => {
      fetchShouldFail = true;
      renderPage();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
      });
    });

    it("Retry re-fetches from API", async () => {
      const fetchSpy = vi.fn();
      fetchShouldFail = true;
      vi.stubGlobal("fetch", fetchSpy);

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
      });

      // First call failed
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Now make it succeed
      fetchShouldFail = false;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ requesters: mockRequesters }),
        })),
      );

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Retry" }));

      await waitFor(() => {
        expect(screen.getByRole("combobox")).toBeInTheDocument();
      });
    });
  });

  // ─── Continue interaction ───────────────────────────────────────

  describe("Continue interaction", () => {
    it("calls setRequester and navigates to /tickets on Continue", async () => {
      const user = userEvent.setup();
      renderPage();

      await waitFor(() => {
        expect(screen.getByRole("combobox")).toBeInTheDocument();
      });

      // Select first requester
      await user.selectOptions(screen.getByRole("combobox"), "1");

      // Click Continue
      await user.click(screen.getByRole("button", { name: "Continue" }));

      expect(mockSetRequester).toHaveBeenCalledTimes(1);
      expect(mockSetRequester).toHaveBeenCalledWith({
        id: 1,
        fullName: "Jennifer Anderson",
        email: "jennifer.anderson@example.com",
      });

      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith("/tickets", { replace: true });
    });

    it("calls setRequester with correct data for second requester", async () => {
      const user = userEvent.setup();
      renderPage();

      await waitFor(() => {
        expect(screen.getByRole("combobox")).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByRole("combobox"), "2");
      await user.click(screen.getByRole("button", { name: "Continue" }));

      expect(mockSetRequester).toHaveBeenCalledWith({
        id: 2,
        fullName: "Sarah Johnson",
        email: "sarah.johnson@example.com",
      });
    });
  });

  // ─── API call ───────────────────────────────────────────────────

  describe("API call", () => {
    it("calls GET /api/dev-requesters on mount via apiClient", async () => {
      const fetchSpy = vi.fn(async () => ({
        ok: true,
        json: async () => ({ requesters: mockRequesters }),
      }));
      vi.stubGlobal("fetch", fetchSpy);

      renderPage();

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalled();
      });

      // apiClient resolves the URL against the API base and passes RequestInit
      const [url] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit | undefined];
      expect(url).toContain("/api/dev-requesters");
    });

    it("does NOT send X-Dev-Requester-Id header when no requester in localStorage", async () => {
      const fetchSpy = vi.fn(async () => ({
        ok: true,
        json: async () => ({ requesters: mockRequesters }),
      }));
      vi.stubGlobal("fetch", fetchSpy);

      renderPage();

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalled();
      });

      // apiClient passes RequestInit with Headers, but no X-Dev-Requester-Id
      const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit | undefined];
      const headers = new Headers(init?.headers);
      expect(headers.has("X-Dev-Requester-Id")).toBe(false);
    });
  });
});
