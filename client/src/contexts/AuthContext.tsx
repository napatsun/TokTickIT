/**
 * AuthContext — FR-01/FR-04/FR-05/FR-06
 *
 * Owns the authenticated user for the whole SPA. The browser never stores a
 * token: the session lives in the HTTP-only `sid` cookie and this context
 * only mirrors the safe user payload returned by the API.
 *
 * Bootstrapping:
 *   GET /api/auth/me on mount → status "authenticated" | "unauthenticated".
 *   While it resolves, `status` is "loading" and the shell renders a skeleton
 *   (ui-spec.md §1), so a refresh never flashes the Login screen.
 *
 * Global reactions (dispatched by lib/apiClient):
 *   auth:required                 → clear the user and go to /login
 *   auth:password-change-required → flag mustChangePassword so the route guard
 *                                   forces the Change Password screen (BR-02)
 */

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  apiClient,
  AUTH_REQUIRED_EVENT,
  PASSWORD_CHANGE_REQUIRED_EVENT,
  type ApiErrorResponse,
} from "../lib/apiClient.js";

// ─── Types ──────────────────────────────────────────────────────────────

export type Role = "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
}

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

/** Discriminated result so pages can render the exact failure banner (§2/§3). */
export type AuthResult =
  | { ok: true }
  | { ok: false; code: string; message: string; fields?: Record<string, string> };

export interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  changePassword: (newPassword: string, confirmPassword: string) => Promise<AuthResult>;
  /** Re-fetch the current user (used after a password change). */
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Response helpers ───────────────────────────────────────────────────

async function readError(response: Response): Promise<AuthResult> {
  let body: ApiErrorResponse | undefined;
  try {
    body = (await response.json()) as ApiErrorResponse;
  } catch {
    // Fall through to a generic message.
  }
  return {
    ok: false,
    code: body?.error?.code ?? "UNKNOWN",
    message: body?.error?.message ?? "Something went wrong. Please try again.",
    fields: body?.error?.fields ?? body?.error?.fieldErrors,
  };
}

// ─── Provider ───────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const navigate = useNavigate();

  // Keep navigate in a ref so the event listeners subscribe exactly once.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const refresh = useCallback(async () => {
    try {
      const response = await apiClient("/api/auth/me");
      if (!response.ok) {
        setUser(null);
        setStatus("unauthenticated");
        return;
      }
      const data = (await response.json()) as AuthUser;
      setUser(data);
      setStatus("authenticated");
    } catch {
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  // Initial bootstrap.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Global 401 → Session is gone/invalid; reset and head to Login.
  useEffect(() => {
    function handleAuthRequired() {
      setUser(null);
      setStatus("unauthenticated");
      navigateRef.current("/login", { replace: true });
    }
    function handlePasswordChangeRequired() {
      // The backend refuses every other route while the flag is set (BR-02).
      setUser((current) => (current ? { ...current, mustChangePassword: true } : current));
      navigateRef.current("/change-password", { replace: true });
    }

    window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
    window.addEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, handlePasswordChangeRequired);
    return () => {
      window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
      window.removeEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, handlePasswordChangeRequired);
    };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const response = await apiClient("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) return readError(response);

    const data = (await response.json()) as { user: AuthUser };
    setUser(data.user);
    setStatus("authenticated");
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiClient("/api/auth/logout", { method: "POST" });
    } catch {
      // Even if the call fails, drop local identity and go to Login.
    }
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const changePassword = useCallback(
    async (newPassword: string, confirmPassword: string): Promise<AuthResult> => {
      const response = await apiClient("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword, confirmPassword }),
      });

      if (!response.ok) return readError(response);

      // The server cleared mustChangePassword; mirror it locally so the route
      // guard releases the user into the app immediately.
      setUser((current) => (current ? { ...current, mustChangePassword: false } : current));
      return { ok: true };
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, logout, changePassword, refresh }),
    [user, status, login, logout, changePassword, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Role helpers ───────────────────────────────────────────────────────

export const ROLE_LABELS: Record<Role, string> = {
  REQUESTER: "Requester",
  IT_STAFF: "IT Staff",
  ADMINISTRATOR: "Administrator",
};

/** Landing route for each role (ui-spec.md §1). */
export function roleHome(role: Role): string {
  switch (role) {
    case "IT_STAFF":
      return "/staff/queue";
    case "ADMINISTRATOR":
      return "/admin/users";
    default:
      return "/tickets";
  }
}
