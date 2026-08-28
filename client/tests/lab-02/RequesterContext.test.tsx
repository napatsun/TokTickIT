import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { RequesterProvider } from "../../src/contexts/RequesterContext";
import { useRequester } from "../../src/hooks/useRequester";
import type { Requester } from "../../src/contexts/RequesterContext";

/**
 * RequesterContext — BR-01 / FR-02
 *
 * Tests:
 * - Reads persisted selection from localStorage on mount
 * - setRequester writes to both React state and localStorage
 * - clearRequester clears both state and localStorage
 * - Handles corrupted localStorage gracefully
 * - Throws when used outside provider
 */

// ─── Constants ──────────────────────────────────────────────────────────

const STORAGE_KEY = "tkt_current_requester";

const MOCK_REQUESTER: Requester = {
  id: 1,
  fullName: "Jennifer Anderson",
  email: "jennifer.anderson@example.com",
};

const MOCK_REQUESTER_2: Requester = {
  id: 2,
  fullName: "Sarah Johnson",
  email: "sarah.johnson@example.com",
};

// ─── Helpers ────────────────────────────────────────────────────────────

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <RequesterProvider>{children}</RequesterProvider>
    </MemoryRouter>
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("RequesterContext + useRequester", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ─── Initial state ──────────────────────────────────────────────────

  describe("initial state", () => {
    it("starts with requester=null when localStorage is empty", () => {
      const { result } = renderHook(() => useRequester(), { wrapper });

      expect(result.current.requester).toBeNull();
      expect(result.current.isLoaded).toBe(true);
    });

    it("restores requester from localStorage on mount", () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_REQUESTER));

      const { result } = renderHook(() => useRequester(), { wrapper });

      expect(result.current.requester).toEqual(MOCK_REQUESTER);
      expect(result.current.isLoaded).toBe(true);
    });

    it("returns null for corrupted localStorage data", () => {
      localStorage.setItem(STORAGE_KEY, "not-valid-json");

      const { result } = renderHook(() => useRequester(), { wrapper });

      expect(result.current.requester).toBeNull();
      expect(result.current.isLoaded).toBe(true);
    });

    it("returns null when localStorage has wrong shape (missing fields)", () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: 1 }));

      const { result } = renderHook(() => useRequester(), { wrapper });

      expect(result.current.requester).toBeNull();
    });
  });

  // ─── setRequester ──────────────────────────────────────────────────

  describe("setRequester", () => {
    it("updates requester in React state", () => {
      const { result } = renderHook(() => useRequester(), { wrapper });

      act(() => {
        result.current.setRequester(MOCK_REQUESTER);
      });

      expect(result.current.requester).toEqual(MOCK_REQUESTER);
    });

    it("persists to localStorage", () => {
      const { result } = renderHook(() => useRequester(), { wrapper });

      act(() => {
        result.current.setRequester(MOCK_REQUESTER);
      });

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored).toEqual(MOCK_REQUESTER);
    });

    it("replaces previous requester (BR-04: no stale data)", () => {
      const { result } = renderHook(() => useRequester(), { wrapper });

      act(() => {
        result.current.setRequester(MOCK_REQUESTER);
      });
      expect(result.current.requester).toEqual(MOCK_REQUESTER);

      act(() => {
        result.current.setRequester(MOCK_REQUESTER_2);
      });
      expect(result.current.requester).toEqual(MOCK_REQUESTER_2);

      // localStorage also updated
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored).toEqual(MOCK_REQUESTER_2);
    });
  });

  // ─── clearRequester ────────────────────────────────────────────────

  describe("clearRequester", () => {
    it("sets requester to null", () => {
      const { result } = renderHook(() => useRequester(), { wrapper });

      act(() => {
        result.current.setRequester(MOCK_REQUESTER);
      });
      expect(result.current.requester).toEqual(MOCK_REQUESTER);

      act(() => {
        result.current.clearRequester();
      });
      expect(result.current.requester).toBeNull();
    });

    it("removes from localStorage", () => {
      const { result } = renderHook(() => useRequester(), { wrapper });

      act(() => {
        result.current.setRequester(MOCK_REQUESTER);
      });
      expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

      act(() => {
        result.current.clearRequester();
      });
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("is safe to call when nothing is stored", () => {
      const { result } = renderHook(() => useRequester(), { wrapper });

      // Should not throw
      act(() => {
        result.current.clearRequester();
      });
      expect(result.current.requester).toBeNull();
    });
  });

  // ─── Error boundary ────────────────────────────────────────────────

  describe("error handling", () => {
    it("throws when useRequester is used outside provider", () => {
      // Suppress React console.error for expected error
      const spy = console.error;
      console.error = () => {};

      expect(() => {
        renderHook(() => useRequester());
      }).toThrow("useRequester must be used within a <RequesterProvider>");

      console.error = spy;
    });
  });
});
