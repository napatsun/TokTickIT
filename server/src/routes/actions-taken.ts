/**
 * Actions Taken API — api-spec.md §1 (FR-01 … FR-06, BR-01 … BR-06, BR-11, FR-15)
 *
 *   POST  /api/tickets/:ticketId/actions                  create (§1.1)
 *   GET   /api/tickets/:ticketId/actions                  list, oldest first (§1.2)
 *   PATCH /api/tickets/:ticketId/actions/:actionId        edit / void (§1.3)
 *
 * Mounted at `/api/tickets` (see app.ts). The three routes deliberately have
 * different audiences, so `requireAuth` + `enforcePasswordChange` are attached
 * per route instead of at the mount point, and the role guard lives on the two
 * write routes:
 *
 *   §1.1 POST   IT Staff / Administrator only  → Requester gets 403 FORBIDDEN_ROLE
 *   §1.2 GET    any authenticated role         → Requester: own Ticket, read-only
 *   §1.3 PATCH  IT Staff / Administrator only  → Requester gets 403 FORBIDDEN_ROLE
 *
 * PARAMETER CONVENTION: `:ticketId` is the internal integer `Ticket.id` — the
 * same `:id` convention the Lab 3 staff routes use — and `:actionId` is the
 * `ActionTaken.id` cuid string. `specification.md` §7.1's Implementation Note
 * fixes `ActionTaken.ticketId` as an `Int` FK, so the two agree by construction.
 *
 * Ticket access for IT Staff/Administrator is the Lab 3 *shared queue*: any
 * active staff member may operate on any existing Ticket, which is also what
 * BR-02 assumes ("any active IT Staff/Administrator with access may author an
 * entry; `performedById` may differ from the Ticket's `ownerId`"). There is
 * therefore no staff-side `FORBIDDEN_TICKET_ACCESS`; that code belongs to §1.2's
 * Requester-not-owner case. Tickets carry no soft-delete column in the shipped
 * schema, so an unreachable Ticket is simply a non-existent one
 * (404 TICKET_NOT_FOUND).
 *
 * Every write is re-validated server-side on each request: identity always comes
 * from the session (BR-03/BR-15), never from the payload.
 */

import { Router, Request, Response, NextFunction } from "express";
import { getPrisma } from "../prisma.js";
import { requireAuth, enforcePasswordChange, type SessionUser } from "../middleware/auth.js";
import {
  EDIT_WINDOW_MS,
  actionTakenIdempotencyStore,
  toActionTakenDto,
  validateCreateActionTaken,
  validateEditActionTaken,
  type ActionTakenRow,
} from "../lib/actionTaken.js";

export const actionsTakenRouter = Router();

// ─── Shared helpers ─────────────────────────────────────────────────────

/** Relation projection shared by every read in this router. */
const ACTION_INCLUDE = {
  performedBy: { select: { id: true, name: true } },
} as const;

/** Both roles authorized to author or edit an Actions Taken entry (§1.1/§1.3). */
const WRITE_ROLES: ReadonlyArray<SessionUser["role"]> = ["IT_STAFF", "ADMINISTRATOR"];

function serverError(res: Response): void {
  // Safe failure (§6): never leak a stack trace, ORM error, or internal detail.
  res.status(500).json({
    error: { code: "SERVER_ERROR", message: "Something went wrong. Please try again." },
  });
}

function ticketNotFound(res: Response): void {
  res.status(404).json({ error: { code: "TICKET_NOT_FOUND", message: "Ticket not found." } });
}

function actionNotFound(res: Response): void {
  res.status(404).json({
    error: { code: "ACTION_NOT_FOUND", message: "Actions Taken entry not found." },
  });
}

function forbidden(res: Response, code: string, message: string): void {
  res.status(403).json({ error: { code, message } });
}

function conflict(res: Response, code: string, message: string): void {
  res.status(409).json({ error: { code, message } });
}

/**
 * 422 with the Lab 2/3 `fieldErrors` map (api-spec.md §1's Implementation Note),
 * so the Lab 4 client reuses the error handling it already has.
 */
function validationError(res: Response, fieldErrors: Record<string, string>): void {
  res.status(422).json({
    error: {
      code: "VALIDATION_ERROR",
      message: "Please fix the highlighted fields.",
      fieldErrors,
    },
  });
}

/**
 * `:ticketId` is the internal numeric Ticket id. Anything that is not a
 * positive integer can never exist, so it answers with the same generic 404
 * rather than a distinguishable 400 (no existence leak, §1.1/§1.3).
 */
function parseTicketId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Role guard for the two write routes. Mirrors `requireRole` from
 * middleware/auth.ts but answers with §1.1's documented code `FORBIDDEN_ROLE`
 * for a Requester (the shared `rejectForbidden` emits Lab 3's generic
 * `FORBIDDEN`, which this contract names differently).
 */
function requireWriteRole(req: Request, res: Response, next: NextFunction): void {
  const user = req.currentUser;
  if (!user) {
    // Defensive: requireAuth runs first and answers 401.
    res.status(401).json({
      error: { code: "UNAUTHENTICATED", message: "Authentication required." },
    });
    return;
  }
  if (!WRITE_ROLES.includes(user.role)) {
    forbidden(res, "FORBIDDEN_ROLE", "Only IT Staff or an Administrator can record Actions Taken.");
    return;
  }
  next();
}

/** `includeVoided=true` (case-insensitive); anything else means "hide voided". */
function readIncludeVoided(raw: unknown): boolean {
  return typeof raw === "string" && raw.trim().toLowerCase() === "true";
}

/**
 * Scope an `Idempotency-Key` to the caller, the route, and the Ticket, so two
 * different users (or two different Tickets) can never replay each other's
 * response just by reusing a key string (FR-15, AC-11).
 */
function scopedIdempotencyKey(
  req: Request,
  userId: string,
  ticketId: number,
): string | null {
  const header = req.header("Idempotency-Key");
  if (typeof header !== "string") return null;
  const key = header.trim();
  if (key.length === 0) return null;
  return `${userId}:POST /api/tickets/${ticketId}/actions:${key}`;
}

// ─── POST /api/tickets/:ticketId/actions (§1.1) ─────────────────────────
//
// Business rules enforced:
//   BR-01  the entry belongs to the Ticket in the path, always
//   BR-02  the author may differ from the Ticket's owner (shared queue)
//   BR-03  `performedById` is the session user; a payload value is ignored
//   BR-04  `actionDateTime` required, ISO-8601, never in the future
//   BR-05  conditional follow-up note
//   BR-06  `attachmentNotes` is an optional pointer only
//   FR-15 / AC-11  replayed `Idempotency-Key` returns the original 201 body

actionsTakenRouter.post(
  "/:ticketId/actions",
  requireAuth,
  enforcePasswordChange,
  requireWriteRole,
  async (req: Request, res: Response) => {
    try {
      const ticketId = parseTicketId(req.params.ticketId);
      if (ticketId === null) {
        ticketNotFound(res);
        return;
      }

      const ticket = await getPrisma().ticket.findUnique({
        where: { id: ticketId },
        select: { id: true },
      });
      if (!ticket) {
        ticketNotFound(res);
        return;
      }

      const actor = req.currentUser!;

      // FR-15 / AC-11: replay the original 201 instead of creating a second row.
      // Checked before validation on purpose — the second click of a double
      // submit must not be re-interpreted, it must be recognised as a replay.
      const idempotencyKey = scopedIdempotencyKey(req, actor.id, ticketId);
      if (idempotencyKey) {
        const replay = actionTakenIdempotencyStore.lookup(idempotencyKey);
        if (replay) {
          res.status(replay.status).json(replay.body);
          return;
        }
      }

      const validation = validateCreateActionTaken(req.body ?? {});
      if (!validation.ok) {
        validationError(res, validation.fieldErrors);
        return;
      }

      const created = await getPrisma().actionTaken.create({
        data: {
          ticketId,
          actionDateTime: validation.value.actionDateTime,
          description: validation.value.description,
          result: validation.value.result,
          // BR-03: from the session only. No client-supplied identifier is read
          // here, so `id`, `performedById`, `createdAt`, `isVoided`, `editedAt`,
          // and `editedById` cannot be spoofed.
          performedById: actor.id,
          followUpRequired: validation.value.followUpRequired,
          followUpNote: validation.value.followUpNote,
          attachmentNotes: validation.value.attachmentNotes,
        },
        include: ACTION_INCLUDE,
      });

      const dto = toActionTakenDto(created as ActionTakenRow);
      if (idempotencyKey) {
        actionTakenIdempotencyStore.save(idempotencyKey, 201, dto);
      }

      res.status(201).json(dto);
    } catch {
      serverError(res);
    }
  },
);

// ─── GET /api/tickets/:ticketId/actions (§1.2) ──────────────────────────
//
// Business rules enforced:
//   BR-15  role + Ticket access re-checked here, not in the UI
//   FR-03  `actionDateTime` ASC, tie-broken by `createdAt` then `id`
//   FR-06  a Requester reads only their own Ticket's entries (read-only)
//
// `includeVoided=true` is an explicit rejection for a Requester
// (403 FORBIDDEN_QUERY_PARAM) rather than a silent ignore, so the access
// decision stays testable and a client can never mistake a filtered view for an
// unfiltered one.

actionsTakenRouter.get(
  "/:ticketId/actions",
  requireAuth,
  enforcePasswordChange,
  async (req: Request, res: Response) => {
    try {
      const ticketId = parseTicketId(req.params.ticketId);
      if (ticketId === null) {
        ticketNotFound(res);
        return;
      }

      const ticket = await getPrisma().ticket.findUnique({
        where: { id: ticketId },
        select: { id: true, requesterId: true },
      });
      if (!ticket) {
        ticketNotFound(res);
        return;
      }

      const actor = req.currentUser!;
      const includeVoided = readIncludeVoided(req.query.includeVoided);

      if (actor.role === "REQUESTER") {
        // FR-06 / BR-15: a Requester's Tickets are the ones they *own* —
        // `requesterId`, not `ownerId` (which is the IT Staff coordinator,
        // BR-02). Ownership is the access check, and it fails closed.
        if (ticket.requesterId !== actor.id) {
          forbidden(
            res,
            "FORBIDDEN_TICKET_ACCESS",
            "You don't have access to this ticket's Actions Taken.",
          );
          return;
        }
        if (includeVoided) {
          forbidden(
            res,
            "FORBIDDEN_QUERY_PARAM",
            "Voided entries are only visible to IT Staff and Administrators.",
          );
          return;
        }
      }

      const items = await getPrisma().actionTaken.findMany({
        where: {
          ticketId,
          // Voided entries are hidden by default; an Administrator reviewing the
          // audit trail opts in with `includeVoided=true`.
          ...(includeVoided ? {} : { isVoided: false }),
        },
        // FR-03: primary sort is the business-meaningful action time; the two
        // trailing keys exist purely so repeated identical queries are
        // deterministically ordered.
        orderBy: [{ actionDateTime: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        include: ACTION_INCLUDE,
      });

      res.status(200).json({
        ticketId,
        count: items.length,
        items: items.map((item) => toActionTakenDto(item as ActionTakenRow)),
      });
    } catch {
      serverError(res);
    }
  },
);

// ─── PATCH /api/tickets/:ticketId/actions/:actionId (§1.3) ──────────────
//
// Business rules enforced:
//   BR-03  `performedById` is never editable (it is not even in the edit input)
//   BR-04  an edited `actionDateTime` is re-validated against the same rule
//   BR-05  the effective follow-up pair is re-validated on edit
//   BR-11  15-minute author window; only an Administrator may edit past it, and
//          only an Administrator may void; every edit records editedAt/editedById
//   §1.3   voiding is one-way: any PATCH against an already-voided entry → 409
//
// Check order (documented in api-spec.md §1's Implementation Note, and asserted
// by API-39/API-39b): role → Ticket existence → Action existence → permission →
// frozen-entry → field validation.

actionsTakenRouter.patch(
  "/:ticketId/actions/:actionId",
  requireAuth,
  enforcePasswordChange,
  requireWriteRole,
  async (req: Request, res: Response) => {
    try {
      const ticketId = parseTicketId(req.params.ticketId);
      if (ticketId === null) {
        ticketNotFound(res);
        return;
      }

      // §1.3: the Ticket-existence check runs — and rejects — before any Action
      // lookup, so a request with both a bad `ticketId` and a bad `actionId`
      // answers TICKET_NOT_FOUND, never ACTION_NOT_FOUND.
      const ticket = await getPrisma().ticket.findUnique({
        where: { id: ticketId },
        select: { id: true },
      });
      if (!ticket) {
        ticketNotFound(res);
        return;
      }

      const actionId = req.params.actionId ?? "";
      const existing = await getPrisma().actionTaken.findFirst({
        where: { id: actionId, ticketId },
        include: ACTION_INCLUDE,
      });
      if (!existing) {
        actionNotFound(res);
        return;
      }

      const actor = req.currentUser!;
      const isAdministrator = actor.role === "ADMINISTRATOR";

      // BR-11: the author may correct their own entry inside the window; anyone
      // else in IT Staff may not touch it at all; an Administrator may.
      if (!isAdministrator) {
        if (existing.performedById !== actor.id) {
          forbidden(res, "NOT_AUTHOR", "Only the author or an Administrator can change this entry.");
          return;
        }
        if (Date.now() - existing.createdAt.getTime() > EDIT_WINDOW_MS) {
          forbidden(res, "EDIT_WINDOW_EXPIRED", "The edit window for this entry has expired.");
          return;
        }
      }

      // §1.3 / BR-11: a voided entry is permanently frozen — no edit of any
      // field, an explicit un-void, or even a `voidReason`-only tweak arrives
      // here, and 409 (not 422) is the documented answer because the entry's own
      // state, not the request body, is what makes the operation invalid.
      if (existing.isVoided) {
        conflict(
          res,
          "ENTRY_VOIDED",
          "This entry has been voided and can no longer be changed.",
        );
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;

      // BR-11 / assumption 2: `isVoided` is the one field reserved to the
      // Administrator role, so a non-Administrator reaching for it is a role
      // rejection rather than a field rejection. `voidReason` on its own is
      // ignored (validateEditActionTaken never reads it without `isVoided`).
      if (!isAdministrator && body.isVoided !== undefined) {
        forbidden(res, "FORBIDDEN_ROLE", "Only an Administrator can void an Actions Taken entry.");
        return;
      }

      const validation = validateEditActionTaken(body, {
        actionDateTime: existing.actionDateTime,
        description: existing.description,
        result: existing.result,
        followUpRequired: existing.followUpRequired,
        followUpNote: existing.followUpNote,
        attachmentNotes: existing.attachmentNotes,
      });
      if (!validation.ok) {
        validationError(res, validation.fieldErrors);
        return;
      }

      const updated = await getPrisma().actionTaken.update({
        where: { id: existing.id },
        data: {
          ...validation.value,
          // BR-11: the audit pair is stamped on every successful edit, voiding
          // included.
          editedAt: new Date(),
          editedById: actor.id,
        },
        include: ACTION_INCLUDE,
      });

      res.status(200).json(toActionTakenDto(updated as ActionTakenRow));
    } catch {
      serverError(res);
    }
  },
);

export default actionsTakenRouter;
