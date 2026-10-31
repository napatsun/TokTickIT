/**
 * DashboardPage — ui-spec.md §2.4/§3.4: the SINGLE /dashboard route renders
 * one of the two dashboard components based on the authenticated session's
 * role. There is no route or parameter for viewing a different user's
 * dashboard, so "forbidden" is not a reachable client state — a Requester
 * always lands on the Requester Dashboard (§3), IT Staff/Administrator on the
 * Staff Dashboard (§2). Defense in depth is server-side: each dashboard
 * endpoint independently answers 403 FORBIDDEN_ROLE for the wrong role
 * (api-spec.md §3, AUTH-03), so no cross-role data can reach the client
 * regardless of what the client renders.
 */

import StaffDashboard from "./StaffDashboard";
import RequesterDashboard from "./RequesterDashboard";
import { useAuth } from "../hooks/useAuth";

function isStaffRole(role: string | undefined): boolean {
  return role === "IT_STAFF" || role === "ADMINISTRATOR";
}

export default function DashboardPage() {
  const { user } = useAuth();

  // RequireAuth wraps this route, so a user exists here; guard anyway so the
  // component stays safe in isolation (component tests render it directly).
  if (!user) return null;

  return isStaffRole(user.role) ? <StaffDashboard /> : <RequesterDashboard />;
}
