/**
 * RequesterContext — BR-01 / FR-02
 *
 * Stores the currently selected Development Requester in React state
 * AND localStorage (key: "tkt_current_requester"). The localStorage
 * copy survives page refreshes; the React state drives UI rendering.
 *
 * BR-01 compliance: this is client-side only, never sent as an auth
 * token. The backend re-verifies on every request via the middleware.
 *
 * BR-03 compliance: listens for "requester:cleared" CustomEvent dispatched
 * by apiClient when the backend returns 401 INVALID_REQUESTER_CONTEXT.
 * On receiving the event, clears React state and navigates to
 * /select-requester (via React Router's navigate).
 *
 * BR-04 compliance: setRequester() replaces the entire object, so any
 * downstream data-fetching hooks see a new context value and refetch.
 */

import { createContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { REQUESTER_CLEARED_EVENT } from "../lib/apiClient.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface Requester {
  id: number;
  fullName: string;
  email: string;
}

export interface RequesterContextValue {
  /** Currently selected Requester, or null if none selected. */
  requester: Requester | null;
  /** Whether the initial localStorage read has completed. */
  isLoaded: boolean;
  /** Store a Requester selection (writes to state + localStorage). */
  setRequester: (requester: Requester) => void;
  /** Clear the selection (clears state + localStorage). Used by BR-03 and Change Requester. */
  clearRequester: () => void;
}

// ─── Constants ──────────────────────────────────────────────────────────

const STORAGE_KEY = "tkt_current_requester";

// ─── Context ────────────────────────────────────────────────────────────

export const RequesterContext = createContext<RequesterContextValue | null>(null);

// ─── localStorage helpers ───────────────────────────────────────────────

function readFromStorage(): Requester | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Validate shape — corrupted storage returns null
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.id === "number" &&
      typeof parsed.fullName === "string" &&
      typeof parsed.email === "string"
    ) {
      return parsed as Requester;
    }
    return null;
  } catch {
    return null;
  }
}

function writeToStorage(requester: Requester): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(requester));
  } catch {
    // Storage full or blocked — silently fail; state is still updated
  }
}

function clearStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Silently fail
  }
}

// ─── Provider ───────────────────────────────────────────────────────────

export function RequesterProvider({ children }: { children: ReactNode }) {
  const [requester, setRequesterState] = useState<Requester | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const navigate = useNavigate();

  // Store navigate in a ref so the BR-03 event listener effect below has a
  // stable dependency array and never re-subscribes due to navigate reference
  // changes (which can happen with React Router internals even though the
  // function itself is stable). This avoids unnecessary cleanup/recreate
  // cycles if the component were to remount unexpectedly.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // Read from localStorage on mount (once)
  useEffect(() => {
    setRequesterState(readFromStorage());
    setIsLoaded(true);
  }, []);

  // BR-03: Listen for "requester:cleared" event dispatched by apiClient
  // when the backend rejects with INVALID_REQUESTER_CONTEXT.
  // This clears React state and navigates to the selection screen.
  //
  // NOTE: RequesterProvider wraps <Routes> in App.tsx, so route changes do
  // NOT cause this component to remount — only the route children change.
  // The navigate ref ensures this effect subscribes exactly once on mount
  // and cleans up exactly once on unmount, regardless of navigate stability.
  useEffect(() => {
    function handleRequesterCleared() {
      setRequesterState(null);
      clearStorage();
      navigateRef.current("/select-requester", { replace: true });
    }

    window.addEventListener(REQUESTER_CLEARED_EVENT, handleRequesterCleared);
    return () => {
      window.removeEventListener(REQUESTER_CLEARED_EVENT, handleRequesterCleared);
    };
  }, []);

  const setRequester = useCallback((req: Requester) => {
    setRequesterState(req);
    writeToStorage(req);
  }, []);

  const clearRequester = useCallback(() => {
    setRequesterState(null);
    clearStorage();
  }, []);

  const value: RequesterContextValue = {
    requester,
    isLoaded,
    setRequester,
    clearRequester,
  };

  return (
    <RequesterContext.Provider value={value}>
      {children}
    </RequesterContext.Provider>
  );
}
