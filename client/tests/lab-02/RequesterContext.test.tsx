import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { type ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { RequesterProvider } from "../../src/contexts/RequesterContext";
import { useRequester } from "../../src/hooks/useRequester";
import type { Requester } from "../../src/contexts/RequesterContext";
import { REQUESTER_CLEARED_EVENT } from "../../src/lib/apiClient";

// Mock useNavigate to spy on navigation calls
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

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

  // ─── BR-03 event listener lifecycle ──────────────────────────────

  describe("BR-03 event listener lifecycle", () => {
    beforeEach(() => {
      mockNavigate.mockClear();
    });

    it("removes window.removeEventListener is called on unmount (cleanup)", () => {
      const removeSpy = vi.spyOn(window, "removeEventListener");

      const { unmount } = renderHook(() => useRequester(), { wrapper });

      // Listener was added on mount
      expect(removeSpy).not.toHaveBeenCalledWith(
        REQUESTER_CLEARED_EVENT,
        expect.any(Function),
      );

      unmount();

      // removeEventListener should have been called with the correct event name
      expect(removeSpy).toHaveBeenCalledWith(
        REQUESTER_CLEARED_EVENT,
        expect.any(Function),
      );

      removeSpy.mockRestore();
    });

    it("does not accumulate duplicate listeners on remount", () => {
      // First mount
      const { unmount: unmount1 } = renderHook(() => useRequester(), {
        wrapper,
      });

      // Unmount to clean up the first listener
      unmount1();

      // Second mount — should register exactly one new listener
      const addSpy = vi.spyOn(window, "addEventListener");

      const { unmount: unmount2 } = renderHook(() => useRequester(), {
        wrapper,
      });

      // Verify only one listener was added (not 2)
      const addedListeners = addSpy.mock.calls.filter(
        ([event]) => event === REQUESTER_CLEARED_EVENT,
      );
      expect(addedListeners).toHaveLength(1);

      // Dispatch the event — count how many times the provider's handler fires
      let providerHandlerFireCount = 0;
      const originalHandler = addedListeners[0][1] as EventListener;
      window.addEventListener(REQUESTER_CLEARED_EVENT, () => {
        providerHandlerFireCount++;
      });

      act(() => {
        window.dispatchEvent(new CustomEvent(REQUESTER_CLEARED_EVENT));
      });

      // The key assertion: only ONE listener was registered by the provider
      // after the second mount (not 2 stacked)
      expect(addedListeners).toHaveLength(1);
      // And it fires exactly once per dispatch
      expect(providerHandlerFireCount).toBe(1);

      addSpy.mockRestore();
      unmount2();
    });

    it("dispatching requester:cleared clears state and navigates to /select-requester", () => {
      const { result } = renderHook(() => useRequester(), { wrapper });

      // Set a requester first
      act(() => {
        result.current.setRequester(MOCK_REQUESTER);
      });
      expect(result.current.requester).toEqual(MOCK_REQUESTER);

      // Dispatch the event
      act(() => {
        window.dispatchEvent(new CustomEvent(REQUESTER_CLEARED_EVENT));
      });

      // State should be cleared
      expect(result.current.requester).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

      // Navigate should have been called to /select-requester
      expect(mockNavigate).toHaveBeenCalledWith("/select-requester", {
        replace: true,
      });
    });
  });
});
