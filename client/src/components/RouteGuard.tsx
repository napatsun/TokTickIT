/**
 * RequireRequester — AC-02 route guard
 *
 * Wraps protected routes (My Tickets, Create Ticket, Ticket Detail).
 * While isLoaded is false, renders nothing (prevents flash redirect).
 * When loaded:
 *   - requester = null  → redirect to /select-requester
 *   - requester present → render children normally
 *
 * In Lab 3, this guard is extended (or replaced) to check real
 * authentication instead of the dev-requester selection.
 */

import { Navigate } from "react-router-dom";
import { useRequester } from "../hooks/useRequester.js";

export default function RequireRequester({ children }: { children: React.ReactNode }) {
  const { requester, isLoaded } = useRequester();

  // Wait for localStorage read to complete — no flash redirect
  if (!isLoaded) {
    return null;
  }

  // No selected requester — redirect to selection screen (AC-02)
  if (!requester) {
    return <Navigate to="/select-requester" replace />;
  }

  // Valid requester — render the protected content
  return <>{children}</>;
}
