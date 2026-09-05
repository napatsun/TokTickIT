/**
 * apiClient — BR-03 / BR-05 global fetch wrapper
 *
 * Every API call in the app should go through this client so that:
 *   1. The X-Dev-Requester-Id header is attached automatically from localStorage
 *      (BR-05: every ticket/attachment endpoint must include the identity).
 *   2. A 401 INVALID_REQUESTER_CONTEXT response (inactive/deleted requester)
 *      triggers BR-03 enforcement: localStorage is cleared and a
 *      "requester:cleared" custom event is dispatched so RequesterProvider
 *      can reset React state and redirect to /select-requester.
 *
 * This module lives OUTSIDE the React component tree (no hooks allowed).
 * It reads localStorage directly for the requester ID and dispatches a
 * DOM CustomEvent that RequesterProvider listens to.
 *
 * Redirect mechanism chosen: CustomEvent "requester:cleared" →
 *   RequesterProvider.addEventListener → clearRequester() + navigate().
 * Why not window.location.replace()? That causes a full page reload,
 * losing all React state and causing a flash. The custom event lets
 * React Router handle navigation smoothly within the SPA.
 */

// ─── Constants ──────────────────────────────────────────────────────────

const STORAGE_KEY = "tkt_current_requester";
const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

// ─── Types ──────────────────────────────────────────────────────────────

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string>;
  };
}

// ─── Custom event name ──────────────────────────────────────────────────

export const REQUESTER_CLEARED_EVENT = "requester:cleared";

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Read the current requester ID from localStorage.
 * Returns undefined if no requester is stored or if the data is invalid.
 */
function getStoredRequesterId(): number | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && typeof parsed.id === "number") {
      return parsed.id;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Wrapper around fetch that:
 *   - Prepends BASE_URL to relative paths
 *   - Attaches X-Dev-Requester-Id header if a requester is in localStorage
 *   - On 401 INVALID_REQUESTER_CONTEXT: clears localStorage, dispatches
 *     "requester:cleared" event, then throws
 *   - On non-ok responses: parses error body and throws
 */
export async function apiClient(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  // Resolve relative URLs against the API base
  const url =
    typeof input === "string" && !input.startsWith("http")
      ? `${BASE_URL}${input}`
      : input;

  // Build headers — merge with caller-provided headers
  const headers = new Headers(init?.headers);

  // Attach X-Dev-Requester-Id from localStorage (BR-05)
  const requesterId = getStoredRequesterId();
  if (requesterId !== undefined) {
    headers.set("X-Dev-Requester-Id", String(requesterId));
  }

  const response = await fetch(url, { ...init, headers });

  // BR-03: Handle 401 INVALID_REQUESTER_CONTEXT
  if (response.status === 401) {
    // Clone so we can read the body (the original response body is consumed)
    const cloned = response.clone();
    try {
      const body: ApiErrorResponse = await cloned.json();
      if (body.error?.code === "INVALID_REQUESTER_CONTEXT") {
        // BR-03: clear stored selection immediately
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // Storage blocked — proceed with event dispatch anyway
        }

        // Dispatch custom event for RequesterProvider to handle React state + navigation
        window.dispatchEvent(new CustomEvent(REQUESTER_CLEARED_EVENT));
      }
    } catch {
      // Could not parse body — not our expected shape, fall through
    }
  }

  return response;
}

/**
 * Check if a response is ok. If not, parse and throw the error body.
 * Usage: const data = await apiClient.parseJson<T>(response);
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
