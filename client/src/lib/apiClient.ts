/**
 * apiClient — single fetch wrapper for the whole app (Lab 3: session auth).
 *
 * Every API call goes through this client so that:
 *   1. Relative paths are resolved against VITE_API_URL.
 *   2. The HTTP-only `sid` session cookie is sent (`credentials: "include"`),
 *      replacing Lab 2's `X-Dev-Requester-Id` header (BR-03).
 *   3. State-changing requests echo the CSRF token from the readable `csrf`
 *      cookie in the `X-CSRF-Token` header (api-spec.md §0 double-submit).
 *   4. A 401 dispatches AUTH_REQUIRED_EVENT so AuthProvider can clear the
 *      user and send the browser back to /login; a 403 with
 *      PASSWORD_CHANGE_REQUIRED dispatches PASSWORD_CHANGE_REQUIRED_EVENT so
 *      the app routes to the mandatory Change Password screen (BR-02).
 *
 * This module lives outside the React tree (no hooks). It communicates with
 * AuthProvider through DOM CustomEvents rather than window.location, so the
 * SPA never does a full page reload / flash.
 */

// ─── Constants ──────────────────────────────────────────────────────────

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const CSRF_COOKIE = "csrf";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const AUTH_REQUIRED_EVENT = "auth:required";
export const PASSWORD_CHANGE_REQUIRED_EVENT = "auth:password-change-required";

// ─── Types ──────────────────────────────────────────────────────────────

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    /** api-spec.md §1 change-password and §4 admin validation use `fields`. */
    fields?: Record<string, string>;
    /** Lab 2 responses used `fieldErrors`; kept for backwards compatibility. */
    fieldErrors?: Record<string, string>;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

// ─── Public API ─────────────────────────────────────────────────────────

export async function apiClient(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string" && !input.startsWith("http")
      ? `${BASE_URL}${input}`
      : input;

  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
  const headers = new Headers(init?.headers);

  if (!SAFE_METHODS.has(method)) {
    const csrfToken = readCookie(CSRF_COOKIE);
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  }

  const response = await fetch(url, {
    ...init,
    headers,
    // Required for the HTTP-only session cookie to travel cross-origin
    // (Vite dev server → API) in both dev and production.
    credentials: "include",
  });

  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
  } else if (response.status === 403) {
    // Clone so the caller can still read the body.
    const cloned = response.clone();
    try {
      const body: ApiErrorResponse = await cloned.json();
      if (body.error?.code === "PASSWORD_CHANGE_REQUIRED") {
        window.dispatchEvent(new CustomEvent(PASSWORD_CHANGE_REQUIRED_EVENT));
      }
    } catch {
      // Not our envelope — ignore.
    }
  }

  return response;
}

/**
 * Check if a response is ok; if not, parse and throw the error body.
 * Usage: const data = await parseJson<MyType>(response);
 */
export async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorBody: ApiErrorResponse | undefined;
    try {
      errorBody = await response.json();
    } catch {
      // Could not parse — throw generic error
    }
    throw errorBody ?? { error: { code: "UNKNOWN", message: `HTTP ${response.status}` } };
  }
  return response.json() as Promise<T>;
}
