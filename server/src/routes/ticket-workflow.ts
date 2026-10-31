/**
 * Ticket workflow API — api-spec.md §2 (BR-07 … BR-10, BR-12, BR-15,
 * FR-07 … FR-09, FR-16).
 *
 *   PATCH /api/tickets/:ticketId/status                  transition (§2.1)
 *   POST  /api/tickets/:ticketId/requester-confirmation  advisory (§2.2)
 *
 * Mounted at `/api/tickets` (see app.ts), alongside the Actions Taken router.
 * Unlike `/api/staff`, this router is NOT behind a role guard: the two
 * endpoints have different audiences — §2.1 is reachable by every role
 * (Requesters cancel/reopen their own Ticket), §2.2 by the owning Requester
 * only — so each is authorized inside the shared workflow library against the
 * §5.1 role matrix instead of at the mount point (BR-15: the server decides,
 * never the UI).
 *
 * `:ticketId` is the internal integer `Ticket.id`, matching the Actions Taken
 * routes and the Lab 3 staff routes.
 */

import { Router, Request, Response } from "express";
import { requireAuth, enforcePasswordChange } from "../middleware/auth.js";
import { performRequesterConfirmation, performStatusTransition } from "../lib/ticketWorkflow.js";

export const ticketWorkflowRouter = Router();

// ─── Helpers ────────────────────────────────────────────────────────────

function serverError(res: Response): void {
  // Safe failure: never leak a stack trace, ORM error, or internal detail.
  res.status(500).json({
    error: { code: "SERVER_ERROR", message: "Something went wrong. Please try again." },
  });
}

function ticketNotFound(res: Response): void {
  res.status(404).json({ error: { code: "TICKET_NOT_FOUND", message: "Ticket not found." } });
}

/**
 * `:ticketId` is the internal numeric Ticket id. Anything that is not a positive
 * integer can never exist, so it answers with the same generic 404 rather than a
 * distinguishable 400 (no existence leak).
 */
function parseTicketId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Scope an `Idempotency-Key` to the caller, the route, and the Ticket so two
 * different users — or the two status routes — can never replay each other's
 * response just by reusing a key string (FR-15, AC-14).
 */
function scopedIdempotencyKey(req: Request, userId: string, route: string): string | null {
  const header = req.header("Idempotency-Key");
  if (typeof header !== "string") return null;
  const key = header.trim();
  if (key.length === 0) return null;
  return `${userId}:${route}:${key}`;
}

// ─── PATCH /api/tickets/:ticketId/status (§2.1) ──────────────────────────

ticketWorkflowRouter.patch(
  "/:ticketId/status",
  requireAuth,
  enforcePasswordChange,
  async (req: Request, res: Response) => {
    const ticketId = parseTicketId(req.params.ticketId);
    if (ticketId === null) {
      ticketNotFound(res);
      return;
    }

    try {
      const actor = req.currentUser!;
      const outcome = await performStatusTransition({
        ticketId,
        actor: { id: actor.id, role: actor.role },
        body: req.body,
        idempotencyKey: scopedIdempotencyKey(req, actor.id, `PATCH /api/tickets/${ticketId}/status`),
      });
      res.status(outcome.status).json(outcome.body);
    } catch {
      serverError(res);
    }
  },
);

// ─── POST /api/tickets/:ticketId/requester-confirmation (§2.2) ───────────

ticketWorkflowRouter.post(
  "/:ticketId/requester-confirmation",
  requireAuth,
  enforcePasswordChange,
  async (req: Request, res: Response) => {
    const ticketId = parseTicketId(req.params.ticketId);
    if (ticketId === null) {
      ticketNotFound(res);
      return;
    }

    try {
      const actor = req.currentUser!;
      const outcome = await performRequesterConfirmation({
        ticketId,
        actor: { id: actor.id, role: actor.role },
      });
      res.status(outcome.status).json(outcome.body);
    } catch {
      serverError(res);
    }
  },
);

export default ticketWorkflowRouter;
