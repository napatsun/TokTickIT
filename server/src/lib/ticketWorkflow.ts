/**
 * Ticket status workflow — specification.md §5/§5.1, BR-07 … BR-10, BR-12,
 * FR-07 … FR-09, FR-16 (api-spec.md §2.1/§2.2, ui-spec.md §5).
 *
 * This module *extends* the Lab 3 matrix in `lib/statusTransitions.ts` rather
 * than replacing it. `statusTransitions.ts` owns the from→to shape of §5.1
 * (which target statuses exist and are reachable at all) and is still the single
 * source the Lab 3 staff queue projects to the client. Everything Lab 4 adds on
 * top lives here:
 *
 *   * the ROLE dimension of §5.1 — an (fromStatus × targetStatus) cell is not
 *     enough to decide authorization; the same cell can be staff-only, or
 *     staff-plus-owning-Requester (with a reopen window). A role that §5.1 does
 *     not list for a reachable cell is `403 FORBIDDEN_ROLE` (WORKFLOW-01 case
 *     b), while a cell that is not in the matrix at all is
 *     `409 INVALID_STATUS_TRANSITION` (BR-07, WORKFLOW-01 case a).
 *   * BR-09's resolution gate (≥1 non-voided ActionTaken with a non-empty
 *     `result`), queried live against the real table, never a cached count.
 *   * BR-10's reopen window (`REOPEN_WINDOW_DAYS = 7` from `resolvedAt`) for the
 *     owning Requester; IT Staff/Administrator reopen at any time.
 *   * BR-12/FR-16's optimistic concurrency: the caller submits the Ticket's
 *     last-known `version`; a mismatch is `409 STALE_VERSION` with the current
 *     authoritative state. The version is bumped only on a successful status
 *     transition and the write is a conditional `updateMany` so the check and
 *     the write cannot drift apart under two concurrent requests.
 *   * §7.3's audit trail — exactly one `TicketStatusHistory` row per successful
 *     transition, carrying the optional `note`.
 *   * FR-15/AC-14 idempotency for a replayed `Idempotency-Key`.
 *
 * The two HTTP entry points (`routes/ticket-workflow.ts` —
 * `PATCH /api/tickets/:ticketId/status`, and the re-pointed Lab 3
 * `PATCH /api/staff/tickets/:id/status`) are thin wrappers over
 * `performStatusTransition`, so the matrix can never drift between them.
 *
 * Parameter convention: `:ticketId` is the internal integer `Ticket.id`, the
 * same identifier the Actions Taken routes (api-spec.md §1) and the Lab 3 staff
 * routes use. `TicketStatusHistory.ticketId` is the matching integer FK.
 */

import { getPrisma } from "../prisma.js";
import {
  STATUS_TRANSITIONS,
  isTicketStatus,
  isTransitionAllowed,
  allowedStatusTransitions,
  type TicketStatusValue,
} from "./statusTransitions.js";
import { createIdempotencyStore } from "./actionTaken.js";

// ─── Constants (specification.md §11 decision 1: named, single-source) ───

/** BR-10: days after `resolvedAt` during which the owning Requester may reopen. */
export const REOPEN_WINDOW_DAYS = 7;
export const REOPEN_WINDOW_MS = REOPEN_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** api-spec.md §2.1: the optional status-change `note` is ≤500 characters. */
export const STATUS_NOTE_MAX_LENGTH = 500;

// ─── Role-aware matrix (specification.md §5.1) ───────────────────────────
//
// Every cell of §5.1 that is reachable at all lists "IT Staff/Admin", and a
// subset additionally lists the owning Requester. `staff` therefore mirrors
// `STATUS_TRANSITIONS` exactly (asserted by a unit test), while `requester`
// encodes the two extra privileges §5.1 grants:
//   * cancel own Ticket  — NEW → CANCELLED, OPEN → CANCELLED ("own Ticket")
//   * reopen own Ticket  — RESOLVED/CLOSED → REOPENED (BR-10's 7-day window)

export type ActorRole = "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR";

/** Whether a Requester may make this transition on their own Ticket. */
export type RequesterGrant =
  | "own"
  /** "own" plus BR-10: only while `resolvedAt` is within REOPEN_WINDOW_DAYS. */
  | "own-windowed";

interface CellPermission {
  staff: boolean;
  requester?: RequesterGrant;
}

const ROLE_MATRIX: Record<TicketStatusValue, Partial<Record<TicketStatusValue, CellPermission>>> = {
  NEW: {
    OPEN: { staff: true },
    IN_PROGRESS: { staff: true },
    CANCELLED: { staff: true, requester: "own" },
  },
  OPEN: {
    IN_PROGRESS: { staff: true },
    WAITING_FOR_REQUESTER: { staff: true },
    CANCELLED: { staff: true, requester: "own" },
  },
  IN_PROGRESS: {
    WAITING_FOR_REQUESTER: { staff: true },
    RESOLVED: { staff: true },
    CANCELLED: { staff: true },
  },
  WAITING_FOR_REQUESTER: {
    IN_PROGRESS: { staff: true },
    RESOLVED: { staff: true },
    CANCELLED: { staff: true },
  },
  RESOLVED: {
    CLOSED: { staff: true },
    REOPENED: { staff: true, requester: "own-windowed" },
  },
  CLOSED: {
    REOPENED: { staff: true, requester: "own-windowed" },
  },
  REOPENED: {
    IN_PROGRESS: { staff: true },
    WAITING_FOR_REQUESTER: { staff: true },
    CANCELLED: { staff: true },
  },
  // §5.1: Cancelled is the only fully terminal status.
  CANCELLED: {},
};

/** True for the two roles §5.1 treats as IT Staff ("IT Staff/Admin"). */
export function isStaffRole(role: ActorRole): boolean {
  return role === "IT_STAFF" || role === "ADMINISTRATOR";
}

/** The §5.1 permission for a reachable cell, or `undefined` for a blank cell. */
export function cellPermission(from: string, to: string): CellPermission | undefined {
  if (!isTicketStatus(from) || !isTicketStatus(to)) return undefined;
  return ROLE_MATRIX[from as TicketStatusValue][to as TicketStatusValue];
}

// ─── BR-09 — resolution gate ─────────────────────────────────────────────

/**
 * BR-09(c): at least one non-voided ActionTaken entry with a non-empty `result`.
 *
 * Queried live against the authoritative `ActionTaken` table on every resolve
 * attempt (BR-13's "no cached counters" spirit) — a voided entry never satisfies
 * the gate, and neither does a whitespace-only / empty result.
 */
export async function hasResolvableAction(ticketId: number): Promise<boolean> {
  const entry = await getPrisma().actionTaken.findFirst({
    where: { ticketId, isVoided: false, result: { not: "" } },
    select: { id: true },
  });
  return entry !== null;
}

// ─── BR-10 — reopen window ───────────────────────────────────────────────

/** True while `resolvedAt` is within REOPEN_WINDOW_DAYS of `now`. */
export function isReopenWindowOpen(resolvedAt: Date | null, now: Date = new Date()): boolean {
  if (!resolvedAt) return false;
  const elapsed = now.getTime() - resolvedAt.getTime();
  return elapsed >= 0 && elapsed <= REOPEN_WINDOW_MS;
}

/**
 * The transitions a Requester may make on their OWN Ticket, given the Ticket's
 * current status and `resolvedAt`.
 *
 * This is the projection ui-spec.md §5 relies on for its "hidden, not disabled"
 * rule: a reopen that has fallen outside BR-10's window is simply absent, not
 * rendered-then-rejected. The server re-checks all of it on every request
 * (BR-15); the projection exists so the UI never fabricates an option.
 */
export function requesterTransitions(
  from: string,
  resolvedAt: Date | null,
): TicketStatusValue[] {
  if (!isTicketStatus(from)) return [];
  const windowOpen = isReopenWindowOpen(resolvedAt);
  const targets = STATUS_TRANSITIONS[from as TicketStatusValue] ?? [];

  return targets.filter((to) => {
    const permission = cellPermission(from, to);
    if (!permission?.requester) return false;
    if (permission.requester === "own-windowed" && !windowOpen) return false;
    return true;
  });
}

/**
 * The transitions a caller may actually make, for the (role × current status)
 * pair — the exact list ui-spec.md §5 requires the control to render.
 *
 * IT Staff/Administrator get the full §5.1 matrix (they are permitted for every
 * reachable cell); a Requester gets only the two own-Ticket privileges, with
 * BR-10's window already applied.
 */
export function allowedTransitionsFor(
  role: ActorRole,
  from: string,
  resolvedAt: Date | null,
): TicketStatusValue[] {
  return isStaffRole(role) ? allowedStatusTransitions(from) : requesterTransitions(from, resolvedAt);
}

// ─── Pure request validation ─────────────────────────────────────────────

export interface StatusTransitionRequest {
  targetStatus: TicketStatusValue;
  version: number;
  note: string | null;
}

/**
 * Validate the api-spec.md §2.1 body *without* touching the database.
 *
 * A `targetStatus` that is not a member of the enum at all is a 422
 * field-level problem (`VALIDATION_ERROR`) — distinct from a well-formed but
 * non-permitted transition, which is BR-07's 409 `INVALID_STATUS_TRANSITION`.
 * The version must be a non-negative integer; a mismatch against the stored
 * value is the state-level 409 `STALE_VERSION`, decided by the caller.
 */
export function validateStatusTransitionBody(
  raw: unknown,
): { ok: true; value: StatusTransitionRequest } | { ok: false; fieldErrors: Record<string, string> } {
  const body = (raw ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};

  const rawTarget = typeof body.targetStatus === "string" ? body.targetStatus.trim().toUpperCase() : "";
  if (!isTicketStatus(rawTarget)) {
    fieldErrors.targetStatus = "targetStatus must be a valid ticket status.";
  }

  // Accept a JSON number or a numeric string, but never a fraction or a
  // negative — `version` is an opaque non-negative counter (BR-12).
  const rawVersion = typeof body.version === "string" ? Number(body.version) : body.version;
  const version = typeof rawVersion === "number" ? rawVersion : NaN;
  if (!Number.isInteger(version) || version < 0) {
    fieldErrors.version = "version must be a non-negative integer.";
  }

  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string") {
      fieldErrors.note = "note must be text.";
    } else if (body.note.trim().length > STATUS_NOTE_MAX_LENGTH) {
      fieldErrors.note = `note cannot exceed ${STATUS_NOTE_MAX_LENGTH} characters.`;
    } else {
      note = body.note.trim().length === 0 ? null : body.note.trim();
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return {
    ok: true,
    value: { targetStatus: rawTarget as TicketStatusValue, version, note },
  };
}

// ─── Response projection ─────────────────────────────────────────────────

/** The Ticket columns every workflow response projects. */
const WORKFLOW_TICKET_SELECT = {
  id: true,
  ticketNumber: true,
  status: true,
  version: true,
  resolvedAt: true,
  requesterId: true,
  ownerId: true,
  requesterConfirmedResolved: true,
  requesterConfirmedResolvedAt: true,
  updatedAt: true,
} as const;

interface WorkflowTicketRow {
  id: number;
  ticketNumber: string;
  status: string;
  version: number;
  resolvedAt: Date | null;
  requesterId: string;
  ownerId: string | null;
  requesterConfirmedResolved: boolean;
  requesterConfirmedResolvedAt: Date | null;
  updatedAt: Date;
}

/**
 * The authoritative Ticket state carried by a 200 and by a `STALE_VERSION`
 * `currentState`. `allowedStatusTransitions` is computed for the *calling*
 * actor, so a client that reconciles from this body gets the same role-aware
 * list a fresh GET would produce.
 */
export function toWorkflowTicketDto(row: WorkflowTicketRow, role: ActorRole) {
  return {
    id: row.id,
    ticketNumber: row.ticketNumber,
    status: row.status,
    version: row.version,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    ownerId: row.ownerId,
    requesterId: row.requesterId,
    requesterConfirmedResolved: row.requesterConfirmedResolved,
    requesterConfirmedResolvedAt: row.requesterConfirmedResolvedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    allowedStatusTransitions: allowedTransitionsFor(role, row.status, row.resolvedAt),
  };
}

// ─── Idempotency (FR-15, AC-14) ──────────────────────────────────────────

/**
 * Replay cache for `PATCH …/status`. Scoped by caller + route + key by the HTTP
 * layer, exactly like the Actions Taken store (§1.1), so two users (or the two
 * status routes) can never replay each other's response. Only successful
 * transitions are remembered: a rejected attempt has no result to replay, so a
 * corrected retry with the same key must still be able to go through.
 */
export const statusTransitionIdempotencyStore = createIdempotencyStore();

// ─── Shared error helpers ────────────────────────────────────────────────

function error(status: number, code: string, message: string): WorkflowOutcome {
  return { status, body: { error: { code, message } } };
}

const ticketNotFound = (): WorkflowOutcome => error(404, "TICKET_NOT_FOUND", "Ticket not found.");

// ─── PATCH …/status — the one transition implementation ──────────────────

export interface WorkflowOutcome {
  status: number;
  body: unknown;
}

export interface PerformStatusTransitionInput {
  ticketId: number;
  actor: { id: string; role: ActorRole };
  body: unknown;
  /** Caller+route+key scoped replay key, or null when no header was sent. */
  idempotencyKey?: string | null;
}

/**
 * Apply one status transition, enforcing BR-07, BR-09, BR-10, BR-12, BR-15 and
 * writing §7.3's audit row. Returns an HTTP `{ status, body }` pair so both
 * routes stay a two-line translation of the outcome.
 *
 * Check order (documented so the tests can assert it):
 *   ticket existence (404) → idempotent replay → body shape (422)
 *   → version (409 STALE_VERSION) → Requester ownership (403)
 *   → transition exists (409 INVALID_STATUS_TRANSITION) → role (403)
 *   → BR-10 reopen window (403 REOPEN_WINDOW_EXPIRED)
 *   → BR-09 gate (409 ACTIONS_REQUIRED) → apply.
 */
export async function performStatusTransition(
  input: PerformStatusTransitionInput,
): Promise<WorkflowOutcome> {
  const prisma = getPrisma();
  const { ticketId, actor } = input;

  // 1. Ticket existence. A Prisma range error (e.g. an int4 overflow probe) is
  //    intentionally NOT caught here — the route's try/catch turns it into the
  //    generic 500 that SEC-10 asserts.
  const ticket = (await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: WORKFLOW_TICKET_SELECT,
  })) as WorkflowTicketRow | null;
  if (!ticket) return ticketNotFound();

  // 2. Replay wins over the version check: the second click of a double submit
  //    must receive the original 200, not a spurious STALE_VERSION (AC-14).
  const key = input.idempotencyKey ?? null;
  if (key) {
    const replay = statusTransitionIdempotencyStore.lookup(key);
    if (replay) return { status: replay.status, body: replay.body };
  }

  // 3. Request shape.
  const validation = validateStatusTransitionBody(input.body);
  if (!validation.ok) {
    return {
      status: 422,
      body: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Please fix the highlighted fields.",
          fieldErrors: validation.fieldErrors,
        },
      },
    };
  }
  const { targetStatus, version, note } = validation.value;

  // 4. Optimistic concurrency (BR-12/FR-16). `currentState` lets the client
  //    reload-and-redecide rather than silently overwrite.
  if (version !== ticket.version) {
    return {
      status: 409,
      body: {
        error: {
          code: "STALE_VERSION",
          message: "This ticket was updated by someone else. Reload it and try again.",
        },
        currentState: toWorkflowTicketDto(ticket, actor.role),
      },
    };
  }

  // 5. Requester access (BR-15). A Requester may only ever act on their own
  //    Ticket — the matrix's "own" grants are meaningless otherwise.
  const staff = isStaffRole(actor.role);
  if (!staff && ticket.requesterId !== actor.id) {
    return error(403, "FORBIDDEN_TICKET_ACCESS", "You don't have access to this ticket.");
  }

  const from = ticket.status;

  // 6. BR-07: a blank §5.1 cell is rejected regardless of role.
  if (!isTransitionAllowed(from, targetStatus)) {
    // `from`/`to`/`allowed` sit inside the standard error envelope AND mirrored
    // at the top level, so a client reading either shape resolves the state
    // without a guess (the Lab 3 contract nested them in `error`).
    const allowed = allowedTransitionsFor(actor.role, from, ticket.resolvedAt);
    return {
      status: 409,
      body: {
        error: {
          code: "INVALID_STATUS_TRANSITION",
          message: `A ticket in ${from} cannot move to ${targetStatus}.`,
          from,
          to: targetStatus,
          allowed,
        },
        from,
        to: targetStatus,
        allowed,
      },
    };
  }

  // 7. Role dimension of the same cell. §5.1 lists no Requester grant for most
  //    cells, so a Requester reaching one is a role mismatch (WORKFLOW-01 b).
  const permission = cellPermission(from, targetStatus)!;
  const permittedByRole = staff ? permission.staff : permission.requester !== undefined;
  if (!permittedByRole) {
    return error(403, "FORBIDDEN_ROLE", `Your role cannot move this ticket to ${targetStatus}.`);
  }

  // 8. BR-10: a Requester's reopen is only valid inside the window. IT
  //    Staff/Administrator reopen at any time, so this only applies to "own-windowed".
  if (!staff && permission.requester === "own-windowed" && !isReopenWindowOpen(ticket.resolvedAt)) {
    return error(
      403,
      "REOPEN_WINDOW_EXPIRED",
      `A ticket can only be reopened within ${REOPEN_WINDOW_DAYS} days of being resolved.`,
    );
  }

  // 9. BR-09: only into RESOLVED, and only with a usable Actions Taken entry.
  if (targetStatus === "RESOLVED" && !staff) {
    // Unreachable: RESOLVED has no Requester grant, so step 7 already rejected.
    return error(403, "FORBIDDEN_ROLE", "Only IT Staff or an Administrator can resolve a ticket.");
  }
  if (targetStatus === "RESOLVED" && !(await hasResolvableAction(ticketId))) {
    return {
      status: 409,
      body: {
        error: {
          code: "ACTIONS_REQUIRED",
          message: "Record at least one Actions Taken with a result before resolving.",
        },
      },
    };
  }

  // 10. Apply. The conditional `updateMany` re-asserts the version atomically —
  //     if another writer changed the Ticket between step 4 and here, no row is
  //     matched and the caller gets the same STALE_VERSION answer.
  const data: Record<string, unknown> = {
    status: targetStatus,
    version: { increment: 1 },
  };
  // §7.2: resolvedAt is (re)stamped every time the Ticket enters RESOLVED and
  // persists unchanged through RESOLVED → CLOSED.
  if (targetStatus === "RESOLVED") data.resolvedAt = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const applied = await tx.ticket.updateMany({
      where: { id: ticketId, version: ticket.version },
      data,
    });
    if (applied.count === 0) return null;

    // §7.3: exactly one append-only audit row per successful transition.
    await tx.ticketStatusHistory.create({
      data: {
        ticketId,
        fromStatus: from as TicketStatusValue,
        toStatus: targetStatus,
        changedById: actor.id,
        note,
      },
    });

    return (await tx.ticket.findUnique({
      where: { id: ticketId },
      select: WORKFLOW_TICKET_SELECT,
    })) as WorkflowTicketRow | null;
  });

  if (!updated) {
    const current = (await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: WORKFLOW_TICKET_SELECT,
    })) as WorkflowTicketRow | null;
    return {
      status: 409,
      body: {
        error: {
          code: "STALE_VERSION",
          message: "This ticket was updated by someone else. Reload it and try again.",
        },
        currentState: current ? toWorkflowTicketDto(current, actor.role) : null,
      },
    };
  }

  const responseBody = { ticket: toWorkflowTicketDto(updated, actor.role) };
  if (key) statusTransitionIdempotencyStore.save(key, 200, responseBody);
  return { status: 200, body: responseBody };
}

// ─── POST …/requester-confirmation (api-spec.md §2.2, FR-08, BR-08) ──────

/**
 * The owning Requester's advisory "looks resolved" acknowledgement.
 *
 * BR-08: it sets the two advisory columns and NOTHING else — `status` is
 * untouched, and so is `version` (§7.2/Decision B: only a status transition
 * bumps `version`). Because it never reads or writes `version`, it can never be
 * blocked by — nor cause — a `STALE_VERSION` conflict with a concurrent
 * `PATCH /status` (API-21b).
 */
export async function performRequesterConfirmation(input: {
  ticketId: number;
  actor: { id: string; role: ActorRole };
}): Promise<WorkflowOutcome> {
  const prisma = getPrisma();

  const ticket = await prisma.ticket.findUnique({
    where: { id: input.ticketId },
    select: { id: true, requesterId: true },
  });
  if (!ticket) return ticketNotFound();

  // api-spec.md §2.2: "Requester who owns the Ticket only" — any other caller
  // (including IT Staff, who could otherwise resolve authoritatively) gets
  // 403 NOT_TICKET_OWNER.
  if (input.actor.role !== "REQUESTER" || ticket.requesterId !== input.actor.id) {
    return error(403, "NOT_TICKET_OWNER", "Only the Requester who owns this ticket can confirm it.");
  }

  const confirmedAt = new Date();
  await prisma.ticket.update({
    where: { id: input.ticketId },
    // Deliberately names no `status` and no `version` (BR-08, §7.2).
    data: { requesterConfirmedResolved: true, requesterConfirmedResolvedAt: confirmedAt },
  });

  return {
    status: 200,
    body: {
      ticketId: input.ticketId,
      requesterConfirmedResolved: true,
      requesterConfirmedResolvedAt: confirmedAt.toISOString(),
    },
  };
}
