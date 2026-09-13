/**
 * useAuth — convenience hook for AuthContext.
 *
 * Returns { user, status, login, logout, changePassword, refresh }.
 * Throws if used outside an <AuthProvider>.
 */

import { useContext } from "react";
import { AuthContext, type AuthContextValue } from "../contexts/AuthContext.js";

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an <AuthProvider>");
  }
  return ctx;
}
