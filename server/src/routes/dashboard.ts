/**
 * Dashboard API — api-spec.md §3 (FR-10, FR-11, FR-13, BR-13, BR-14, BR-15)
 *
 *   GET /api/dashboard/staff      (§3.1) IT Staff / Administrator
 *   GET /api/dashboard/requester  (§3.2) Requester
 *
 * Authorization is re-checked per request inside each route (BR-15) with the
 * route-local `FORBIDDEN_ROLE` code the api-spec names for these endpoints —
 * the same pattern the Actions Taken router uses instead of a mount-level
 * `requireRole`, which would emit Lab 3's generic `FORBIDDEN` (AUTH-03 asserts
 * FORBIDDEN_ROLE specifically). The aggregate math lives in
 * `lib/dashboard.ts`; this router is the thin HTTP translation of it.
 *
 * BR-13/FR-13: the response body is exactly the aggregate shape (counts,
 * deltas where documented, recentTickets ≤ 5) — never a full Ticket collection.
 * No request parameters exist: both endpoints are always scoped to the
 * session user, so there is no "view someone else's dashboard" state to guard.
 */

import { Router, Request, Response } from "express";
import { requireAuth, enforcePasswordChange } from "../middleware/auth.js";
import { getStaffDashboard, getRequesterDashboard } from "../lib/dashboard.js";
import type { ActorRole } from "../lib/ticketWorkflow.js";

export const dashboardRouter = Router();

/** Roles §3.1 authorizes for the staff dashboard. */
const STAFF_ROLES: ReadonlyArray<ActorRole> = ["IT_STAFF", "ADMINISTRATOR"];

function serverError(res: Response): void {
  // Safe failure (§5): never leak a stack trace, ORM error, or internal detail.
  res.status(500).json({
    error: { code: "SERVER_ERROR", message: "Something went wrong. Please try again." },
  });
}

// ─── GET /api/dashboard/staff (§3.1) ─────────────────────────────────────

dashboardRouter.get(
  "/staff",
  requireAuth,
  enforcePasswordChange,
  async (req: Request, res: Response) => {
    try {
      const user = req.currentUser!;
      if (!STAFF_ROLES.includes(user.role)) {
        // AUTH-03: a Requester reaching this endpoint is FORBIDDEN_ROLE —
        // independent of any UI routing, per BR-15.
        res.status(403).json({
          error: {
            code: "FORBIDDEN_ROLE",
            message: "Only IT Staff or an Administrator can view this dashboard.",
          },
        });
        return;
      }

      const dashboard = await getStaffDashboard(user.id);
      res.status(200).json(dashboard);
    } catch {
      serverError(res);
    }
  },
);

// ─── GET /api/dashboard/requester (§3.2) ─────────────────────────────────

dashboardRouter.get(
  "/requester",
  requireAuth,
  enforcePasswordChange,
  async (req: Request, res: Response) => {
    try {
      const user = req.currentUser!;
      if (user.role !== "REQUESTER") {
        // §3.2 authorizes Requester only; a staff caller gets the same
        // route-local role code as the mirrored endpoint.
        res.status(403).json({
          error: {
            code: "FORBIDDEN_ROLE",
            message: "Only a Requester can view this dashboard.",
          },
        });
        return;
      }

      const dashboard = await getRequesterDashboard(user.id);
      res.status(200).json(dashboard);
    } catch {
      serverError(res);
    }
  },
);

export default dashboardRouter;
