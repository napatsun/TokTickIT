import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  apiClient,
  parseJson,
  AUTH_REQUIRED_EVENT,
  PASSWORD_CHANGE_REQUIRED_EVENT,
} from "../../src/lib/apiClient";

/**
 * apiClient — Lab 3 session authentication (api-spec.md §0)
 *
 * Replaces the Lab 2 X-Dev-Requester-Id tests, which covered behaviour that
 * FR-11 deleted along with the Development Requester selector.
 *
 * Covered:
 *   1. credentials: "include" so the HTTP-only `sid` cookie is sent
 *   2. X-CSRF-Token is echoed from the readable `csrf` cookie on writes only
 *   3. 401 → AUTH_REQUIRED_EVENT (global sign-out)
 *   4. 403 PASSWORD_CHANGE_REQUIRED → PASSWORD_CHANGE_REQUIRED_EVENT (BR-02)
 *   5. other errors → no global side effects
 *   6. URL resolution
 */

type FetchArgs = [string | URL | Request, RequestInit | undefined];

function mockFetch(status: number, body: unknown = {}) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone() {
      return { json: async () => body } as Response;
    },
  } as Response));
}

function lastInit(spy: ReturnType<typeof mockFetch>): RequestInit | undefined {
  const call = spy.mock.calls[0] as unknown as FetchArgs;
  return call[1];
}

function setCsrfCookie(value: string) {
  document.cookie = `csrf=${value}; path=/`;
}

beforeEach(() => {
  document.cookie = "csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  vi.restoreAllMocks();
});

afterEach(() => {
  document.cookie = "csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("apiClient — session + CSRF (api-spec.md §0)", () => {
  it("sends the session cookie by setting credentials: include", async () => {
    const fetchSpy = mockFetch(200);
    vi.stubGlobal("fetch", fetchSpy);

    await apiClient("/api/tickets");

    expect(lastInit(fetchSpy)?.credentials).toBe("include");
    // The Lab 2 dev header is gone.
    const headers = new Headers(lastInit(fetchSpy)?.headers);
    expect(headers.has("X-Dev-Requester-Id")).toBe(false);
  });

  it("echoes the CSRF cookie in X-CSRF-Token for state-changing requests", async () => {
    setCsrfCookie("token-abc");
    const fetchSpy = mockFetch(200);
    vi.stubGlobal("fetch", fetchSpy);

    await apiClient("/api/auth/logout", { method: "POST" });

    const headers = new Headers(lastInit(fetchSpy)?.headers);
    expect(headers.get("X-CSRF-Token")).toBe("token-abc");
  });

  it("does not attach X-CSRF-Token to safe methods", async () => {
    setCsrfCookie("token-abc");
    const fetchSpy = mockFetch(200);
    vi.stubGlobal("fetch", fetchSpy);

    await apiClient("/api/tickets");

    const headers = new Headers(lastInit(fetchSpy)?.headers);
    expect(headers.has("X-CSRF-Token")).toBe(false);
  });
});

describe("apiClient — global auth events", () => {
  it("dispatches AUTH_REQUIRED_EVENT on 401", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(401, { error: { code: "UNAUTHENTICATED", message: "Authentication required." } }),
    );

    const handler = vi.fn();
    window.addEventListener(AUTH_REQUIRED_EVENT, handler);

    await apiClient("/api/tickets");

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_REQUIRED_EVENT, handler);
  });

  it("dispatches PASSWORD_CHANGE_REQUIRED_EVENT on 403 PASSWORD_CHANGE_REQUIRED", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(403, {
        error: { code: "PASSWORD_CHANGE_REQUIRED", message: "You must change your password." },
      }),
    );

    const handler = vi.fn();
    window.addEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, handler);

    await apiClient("/api/tickets");

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, handler);
  });

  it("does not dispatch the password event for a plain 403 FORBIDDEN", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(403, { error: { code: "FORBIDDEN", message: "You don't have access." } }),
    );

    const handler = vi.fn();
    window.addEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, handler);

    await apiClient("/api/staff/tickets");

    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, handler);
  });
});

describe("apiClient — URL resolution and parseJson", () => {
  it("prepends the API base URL to relative paths", async () => {
    const fetchSpy = mockFetch(200);
    vi.stubGlobal("fetch", fetchSpy);

    await apiClient("/api/tickets");

    expect(String((fetchSpy.mock.calls[0] as unknown as FetchArgs)[0])).toMatch(
      /localhost:3000\/api\/tickets/,
    );
  });

  it("does not modify absolute URLs", async () => {
    const fetchSpy = mockFetch(200);
    vi.stubGlobal("fetch", fetchSpy);

    await apiClient("https://example.com/api/test");

    expect((fetchSpy.mock.calls[0] as unknown as FetchArgs)[0]).toBe("https://example.com/api/test");
  });

  it("parseJson throws the server error envelope on failure", async () => {
    const response = {
      ok: false,
      status: 422,
      json: async () => ({ error: { code: "VALIDATION_ERROR", message: "Bad input", fields: { a: "b" } } }),
    } as unknown as Response;

    await expect(parseJson(response)).rejects.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });
});
