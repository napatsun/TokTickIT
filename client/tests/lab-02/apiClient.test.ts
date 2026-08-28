import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { apiClient, REQUESTER_CLEARED_EVENT } from "../../src/lib/apiClient";

/**
 * apiClient — BR-03 / BR-05 global fetch wrapper
 *
 * Tests:
 * 1. Attaches X-Dev-Requester-Id header when requester exists in localStorage
 * 2. Does NOT attach header when no requester in localStorage
 * 3. On 401 INVALID_REQUESTER_CONTEXT: clears localStorage
 * 4. On other errors (400, 500): does NOT clear localStorage or dispatch event
 */

const STORAGE_KEY = "tkt_current_requester";

const MOCK_REQUESTER = {
  id: 42,
  fullName: "Test User",
  email: "test@example.com",
};

// ─── Helpers ────────────────────────────────────────────────────────────

type FetchArgs = [string | URL | Request, RequestInit | undefined];

function mockFetchSuccess(body: unknown = {}) {
  return vi.fn(async (): Promise<Response> => ({
    ok: true,
    status: 200,
    json: async () => body,
    clone() {
      return { json: async () => body } as Response;
    },
  } as Response));
}

function mockFetch401InvalidRequester() {
  return vi.fn(async () => ({
    ok: false,
    status: 401,
    json: async () => ({
      error: {
        code: "INVALID_REQUESTER_CONTEXT",
        message: "No active Development Requester selected.",
      },
    }),
    clone() {
      return {
        json: async () => ({
          error: {
            code: "INVALID_REQUESTER_CONTEXT",
            message: "No active Development Requester selected.",
          },
        }),
      } as Response;
    },
  } as Response));
}

function mockFetch401OtherCode() {
  return vi.fn(async () => ({
    ok: false,
    status: 401,
    json: async () => ({
      error: { code: "UNAUTHORIZED", message: "Not authenticated." },
    }),
    clone() {
      return {
        json: async () => ({
          error: { code: "UNAUTHORIZED", message: "Not authenticated." },
        }),
      } as Response;
    },
  } as Response));
}

function mockFetch400Validation() {
  return vi.fn(async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      error: {
        code: "VALIDATION_ERROR",
        message: "Please fix the highlighted fields.",
        fieldErrors: { summary: "Summary is too short." },
      },
    }),
    clone() {
      return {
        json: async () => ({
          error: {
            code: "VALIDATION_ERROR",
            message: "Please fix the highlighted fields.",
            fieldErrors: { summary: "Summary is too short." },
          },
        }),
      } as Response;
    },
  } as Response));
}

function mockFetch500() {
  return vi.fn(async () => ({
    ok: false,
    status: 500,
    json: async () => ({
      error: { code: "SERVER_ERROR", message: "Something went wrong." },
    }),
    clone() {
      return {
        json: async () => ({
          error: { code: "SERVER_ERROR", message: "Something went wrong." },
        }),
      } as Response;
    },
  } as Response));
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("apiClient", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // ─── Header attachment (BR-05) ──────────────────────────────────────

  describe("X-Dev-Requester-Id header", () => {
    it("attaches header when requester is in localStorage", async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_REQUESTER));
      const fetchSpy = mockFetchSuccess();
      vi.stubGlobal("fetch", fetchSpy);

      await apiClient("/api/tickets");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as unknown as FetchArgs;
      expect(url).toContain("/api/tickets");

      const headers = new Headers(init?.headers);
      expect(headers.get("X-Dev-Requester-Id")).toBe("42");
    });

    it("does NOT attach header when no requester in localStorage", async () => {
      const fetchSpy = mockFetchSuccess();
      vi.stubGlobal("fetch", fetchSpy);

      await apiClient("/api/dev-requesters");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, init] = fetchSpy.mock.calls[0] as unknown as FetchArgs;

      const headers = new Headers(init?.headers);
      expect(headers.has("X-Dev-Requester-Id")).toBe(false);
    });

    it("does NOT attach header when localStorage has invalid data", async () => {
      localStorage.setItem(STORAGE_KEY, "not-valid-json");
      const fetchSpy = mockFetchSuccess();
      vi.stubGlobal("fetch", fetchSpy);

      await apiClient("/api/dev-requesters");

      const [, init] = fetchSpy.mock.calls[0] as unknown as FetchArgs;
      const headers = new Headers(init?.headers);
      expect(headers.has("X-Dev-Requester-Id")).toBe(false);
    });

    it("uses correct requester ID from localStorage", async () => {
      const differentRequester = { id: 99, fullName: "Other", email: "other@test.com" };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(differentRequester));
      const fetchSpy = mockFetchSuccess();
      vi.stubGlobal("fetch", fetchSpy);

      await apiClient("/api/tickets");

      const [, init] = fetchSpy.mock.calls[0] as unknown as FetchArgs;
      const headers = new Headers(init?.headers);
      expect(headers.get("X-Dev-Requester-Id")).toBe("99");
    });
  });

  // ─── 401 INVALID_REQUESTER_CONTEXT (BR-03) ──────────────────────────

  describe("401 INVALID_REQUESTER_CONTEXT", () => {
    it("clears localStorage when 401 INVALID_REQUESTER_CONTEXT is received", async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_REQUESTER));
      vi.stubGlobal("fetch", mockFetch401InvalidRequester());

      await apiClient("/api/tickets");

      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("dispatches requester:cleared event when 401 INVALID_REQUESTER_CONTEXT is received", async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_REQUESTER));
      vi.stubGlobal("fetch", mockFetch401InvalidRequester());

      const handler = vi.fn();
      window.addEventListener(REQUESTER_CLEARED_EVENT, handler);

      await apiClient("/api/tickets");

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toBeInstanceOf(CustomEvent);

      window.removeEventListener(REQUESTER_CLEARED_EVENT, handler);
    });

    it("does NOT clear localStorage when 401 has a different error code", async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_REQUESTER));
      vi.stubGlobal("fetch", mockFetch401OtherCode());

      await apiClient("/api/tickets");

      expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    });

    it("does NOT dispatch event when 401 has a different error code", async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_REQUESTER));
      vi.stubGlobal("fetch", mockFetch401OtherCode());

      const handler = vi.fn();
      window.addEventListener(REQUESTER_CLEARED_EVENT, handler);

      await apiClient("/api/tickets");

      expect(handler).not.toHaveBeenCalled();

      window.removeEventListener(REQUESTER_CLEARED_EVENT, handler);
    });
  });

  // ─── Other errors — no side effects ─────────────────────────────────

  describe("other HTTP errors", () => {
    it("does NOT clear localStorage on 400 validation error", async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_REQUESTER));
      vi.stubGlobal("fetch", mockFetch400Validation());

      await apiClient("/api/tickets");

      expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    });

    it("does NOT dispatch event on 400 validation error", async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_REQUESTER));
      vi.stubGlobal("fetch", mockFetch400Validation());

      const handler = vi.fn();
      window.addEventListener(REQUESTER_CLEARED_EVENT, handler);

      await apiClient("/api/tickets");

      expect(handler).not.toHaveBeenCalled();

      window.removeEventListener(REQUESTER_CLEARED_EVENT, handler);
    });

    it("does NOT clear localStorage on 500 server error", async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_REQUESTER));
      vi.stubGlobal("fetch", mockFetch500());

      await apiClient("/api/tickets");

      expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    });

    it("does NOT dispatch event on 500 server error", async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_REQUESTER));
      vi.stubGlobal("fetch", mockFetch500());

      const handler = vi.fn();
      window.addEventListener(REQUESTER_CLEARED_EVENT, handler);

      await apiClient("/api/tickets");

      expect(handler).not.toHaveBeenCalled();

      window.removeEventListener(REQUESTER_CLEARED_EVENT, handler);
    });
  });

  // ─── URL resolution ─────────────────────────────────────────────────

  describe("URL resolution", () => {
    it("prepends BASE_URL to relative paths", async () => {
      const fetchSpy = mockFetchSuccess();
      vi.stubGlobal("fetch", fetchSpy);

      await apiClient("/api/dev-requesters");

      const [url] = fetchSpy.mock.calls[0] as unknown as FetchArgs;
      expect(url).toMatch(/localhost:3000\/api\/dev-requesters/);
    });

    it("does not modify absolute URLs", async () => {
      const fetchSpy = mockFetchSuccess();
      vi.stubGlobal("fetch", fetchSpy);

      await apiClient("https://example.com/api/test");

      const [url] = fetchSpy.mock.calls[0] as unknown as FetchArgs;
      expect(url).toBe("https://example.com/api/test");
    });
  });
});
