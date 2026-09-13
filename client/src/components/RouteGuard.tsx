/**
 * Route guards — FR-06 / FR-08 / FR-10
 *
 * RequireAuth:
 *   1. status "loading"  → render the shell skeleton (never flash Login)
 *   2. no user           → redirect to /login
 *   3. mustChangePassword → redirect to /change-password from ANY other route
 *      (deep link, back button, direct URL) — the UX half of BR-02; the
 *      backend 403 PASSWORD_CHANGE_REQUIRED is the security half.
 *
 * RequireRole:
 *   Renders children only for the listed roles; otherwise sends the user to
 *   their own role home. This is UX only — every endpoint is separately
 *   enforced server-side (FR-09, and api-spec.md §5 authorization matrix).
 */

import { Navigate, useLocation } from "react-router-dom";
import { roleHome, type Role } from "../contexts/AuthContext.js";
import { useAuth } from "../hooks/useAuth.js";
import ShellSkeleton from "./layout/ShellSkeleton.js";

export const CHANGE_PASSWORD_PATH = "/change-password";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, status } = useAuth();
  const location = useLocation();

  // Bootstrapping GET /api/auth/me — show the full-shell skeleton (§1).
  if (status === "loading") {
    return <ShellSkeleton />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // BR-02: a user holding an initial password may only reach Change Password.
  if (user.mustChangePassword && location.pathname !== CHANGE_PASSWORD_PATH) {
    return <Navigate to={CHANGE_PASSWORD_PATH} replace />;
  }

  return <>{children}</>;
}

export function RequireRole({
  roles,
  children,
}: {
  roles: Role[];
  children: React.ReactNode;
}) {
  const { user, status } = useAuth();

  if (status === "loading") {
    return <ShellSkeleton />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!roles.includes(user.role)) {
    // Redirect to the caller's own landing page rather than a dead end.
    return <Navigate to={roleHome(user.role)} replace />;
  }
  return <>{children}</>;
}

/** Default export kept as RequireAuth so existing imports keep working. */
export default RequireAuth;
