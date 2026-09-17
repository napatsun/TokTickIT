/**
 * IT Staff ticketing API — api-spec.md §3 (FR-16 … FR-22, BR-12 … BR-20)
 *
 * Mounted at `/api/staff` behind requireAuth + enforcePasswordChange +
 * requireRole(["IT_STAFF", "ADMINISTRATOR"]) (see app.ts), so every route in
 * this file is a shared-queue route: any IT Staff member or Administrator may
 * operate on any Ticket. There is deliberately NO ownership restriction here —
 * that is the Requester-facing rule from §2 and it does not apply to the
 * shared queue.
 *
 * ROUTE PARAM CONVENTION (api-spec.md §3, do not deviate):
 *   This router uses `:id` — the internal Ticket `id` returned by
 *   GET /api/staff/tickets. The Requester-facing routes in §2 use
 *   `:ticketNumber`; the two conventions are never mixed.
 *
 * Routes:
 *   GET    /api/staff/tickets                 Queue (search/filter/sort/page)
 *   GET    /api/staff/owners                  active IT Staff/Administrator picker
 *   GET    /api/staff/tickets/:id             Ticket detail (any ticket)
 *   POST   /api/staff/tickets/:id/claim       BR-13: only when unassigned
 *   POST   /api/staff/tickets/:id/assign      BR-12: reassign to active staff
 *   PATCH  /api/staff/tickets/:id/priority    BR-14/BR-15: IT Priority only
 *   PATCH  /api/staff/tickets/:id/status      BR-19: matrix-enforced transitions
 *   POST   /api/staff/tickets/:id/comments    Public Comment, staff-authored
 *   GET    /api/staff/tickets/:id/comments    Public Comments, any ticket
 *   POST   /api/staff/tickets/:id/notes       Internal Note (staff/admin only)
 *   GET    /api/staff/tickets/:id/notes       Internal Notes (staff/admin only)
 */

import { Router, Request, Response } from "express";
import { getPrisma } from "../prisma.js";
import { toContentDto, validateContent } from "../lib/content.js";
import {
  allowedStatusTransitions,
  isTicketStatus,
  isTransitionAllowed,
} from "../lib/statusTransitions.js";

export const staffRouter = Router();

// ─── Shared constants ───────────────────────────────────────────────────

/** BR-14: IT Priority scale — includes URGENT, unlike requestedPriority. */
const IT_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

/** api-spec.md §3 queue contract. */
const QUEUE_SORT_BY = ["createdAt", "itPriority", "status"] as const;
const QUEUE_SORT_DIR = ["asc", "desc"] as const;
const QUEUE_DEFAULT_PAGE_SIZE = 10;
const QUEUE_MIN_PAGE_SIZE = 1;
const QUEUE_MAX_PAGE_SIZE = 50;
const SEARCH_MIN_LENGTH = 2;

/** Relation projection shared by every ticket read in this router. */
const TICKET_INCLUDE = {
  requester: { select: { id: true, name: true, email: true } },
  owner: { select: { id: true, name: true, email: true } },
  category: { select: { id: true, name: true } },
  relatedSystem: { select: { id: true, name: true } },
} as const;

// ─── Helpers ────────────────────────────────────────────────────────────

function serverError(res: Response): void {
  // api-spec.md §6: never leak a stack trace, ORM error, or internal detail.
  res.status(500).json({
    error: { code: "SERVER_ERROR", message: "Something went wrong. Please try again." },
  });
}

function ticketNotFound(res: Response): void {
  res.status(404).json({ error: { code: "TICKET_NOT_FOUND", message: "Ticket not found." } });
}

/**
 * `:id` is the internal numeric Ticket id (the shipped schema uses an
 * autoincrement Int; the spec prose said "cuid" — code wins). Anything that is
 * not a positive integer is a non-existent ticket, so it answers with the same
 * generic 404 rather than a distinguishable 400 (SEC-06 saved-error rules).
 */
function parseTicketId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

interface StaffTicketRow {
  id: number;
  ticketNumber: string;
  createdAt: Date;
  updatedAt: Date;
  summary: string;
  description: string;
  requestedPriority: string;
  itPriority: string;
  status: string;
  ownerId: string | null;
  requesterMarkedResolved: boolean;
  requesterMarkedResolvedAt: Date | null;
  resolutionSummary: string | null;
  requester: { id: string; name: string; email: string };
  owner: { id: string; name: string; email: string } | null;
  category: { id: number; name: string };
  relatedSystem: { id: number; name: string };
}

/** The single Ticket projection returned by every §3 endpoint. */
function toStaffTicketDto(ticket: StaffTicketRow) {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    summary: ticket.summary,
    description: ticket.description,
    category: ticket.category,
    relatedSystem: ticket.relatedSystem,
    requester: ticket.requester,
    owner: ticket.owner,
    requestedPriority: ticket.requestedPriority,
    itPriority: ticket.itPriority,
    status: ticket.status,
    // BR-05/BR-20: a separate signal — never presented as the formal status.
    requesterMarkedResolved: ticket.requesterMarkedResolved,
    requesterMarkedResolvedAt: ticket.requesterMarkedResolvedAt?.toISOString() ?? null,
    resolutionSummary: ticket.resolutionSummary,
    // BR-19: the UI renders only these, straight from the matrix in §6.1.
    allowedStatusTransitions: allowedStatusTransitions(ticket.status),
  };
}

async function loadTicket(id: number) {
  return getPrisma().ticket.findUnique({ where: { id }, include: TICKET_INCLUDE });
}

/** Attachment projection — same shape the Requester detail screen consumes. */
async function loadAttachments(ticketId: number) {
  const all = await getPrisma().attachment.findMany({
    where: { ticketId },
    orderBy: { uploadedAt: "asc" },
    select: {
      id: true,
      originalFileName: true,
      fileSizeBytes: true,
      mimeType: true,
      uploadedAt: true,
      isRemoved: true,
      removedAt: true,
      removedReason: true,
    },
  });

  return {
    active: all
      .filter((a) => !a.isRemoved)
      .map((a) => ({
        id: a.id,
        originalFileName: a.originalFileName,
        fileSizeBytes: a.fileSizeBytes,
        mimeType: a.mimeType,
        uploadedAt: a.uploadedAt.toISOString(),
      })),
    removed: all
      .filter((a) => a.isRemoved)
      .map((a) => ({
        id: a.id,
        originalFileName: a.originalFileName,
        fileSizeBytes: a.fileSizeBytes,
        removedAt: a.removedAt?.toISOString() ?? null,
        removedReason: a.removedReason,
      })),
  };
}

// ─── GET /api/staff/owners ──────────────────────────────────────────────
// Supporting read for the Ticket Detail "Reassign" control (ui-spec.md §6
// requires a dropdown of active IT Staff/Administrator users). BR-12 says an
// owner must be an active IT Staff or Administrator, so this endpoint returns
// exactly that set and nothing else — it is not a general user directory and it
// is not the Administrator User Management API (a later branch).
//
// Documented deviation: api-spec.md §3 lists `POST /assign` but no source for
// the owner picker; this endpoint fills that gap without exposing any user
// field beyond id/name/email.

staffRouter.get("/owners", async (_req: Request, res: Response) => {
  try {
    const items = await getPrisma().user.findMany({
      where: { isActive: true, role: { in: ["IT_STAFF", "ADMINISTRATOR"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    });
    res.status(200).json({ items });
  } catch {
    serverError(res);
  }
});

// ─── GET /api/staff/tickets (Queue) ─────────────────────────────────────

staffRouter.get("/tickets", async (req: Request, res: Response) => {
  try {
    const fieldErrors: Record<string, string> = {};

    // `q` — min 2 chars; shorter values are IGNORED, not rejected (§3).
    const rawSearch = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const search = rawSearch.length >= SEARCH_MIN_LENGTH ? rawSearch : "";

    // `status` — TicketStatus enum.
    let status: string | null = null;
    if (req.query.status != null && req.query.status !== "") {
      const raw = String(req.query.status).trim().toUpperCase();
      if (!isTicketStatus(raw)) {
        fieldErrors.status = "status must be a valid ticket status.";
      } else {
        status = raw;
      }
    }

    // `priority` — filters on itPriority (BR-14 scale, includes URGENT).
    let priority: string | null = null;
    if (req.query.priority != null && req.query.priority !== "") {
      const raw = String(req.query.priority).trim().toUpperCase();
      if (!(IT_PRIORITIES as readonly string[]).includes(raw)) {
        fieldErrors.priority = "priority must be one of LOW, MEDIUM, HIGH, URGENT.";
      } else {
        priority = raw;
      }
    }

    // `owner` — unassigned | me | a specific userId.
    let owner: string | null = null;
    if (req.query.owner != null && req.query.owner !== "") {
      owner = String(req.query.owner).trim();
    }

    // `sortBy` / `sortDir`.
    let sortBy: (typeof QUEUE_SORT_BY)[number] = "createdAt";
    if (req.query.sortBy != null && req.query.sortBy !== "") {
      const raw = String(req.query.sortBy).trim();
      if (!(QUEUE_SORT_BY as readonly string[]).includes(raw)) {
        fieldErrors.sortBy = "sortBy must be one of createdAt, itPriority, status.";
      } else {
        sortBy = raw as (typeof QUEUE_SORT_BY)[number];
      }
    }

    let sortDir: (typeof QUEUE_SORT_DIR)[number] = "desc";
    if (req.query.sortDir != null && req.query.sortDir !== "") {
      const raw = String(req.query.sortDir).trim().toLowerCase();
      if (!(QUEUE_SORT_DIR as readonly string[]).includes(raw)) {
        fieldErrors.sortDir = "sortDir must be one of asc, desc.";
      } else {
        sortDir = raw as (typeof QUEUE_SORT_DIR)[number];
      }
    }

    // `page` / `pageSize` — out-of-range values are a 400 (§3). NOTE: a page
    // number past the last page is NOT out of range — it is a valid request
    // that yields an empty `items` (API-18).
    let page = 1;
    if (req.query.page != null && req.query.page !== "") {
      const parsed = Number(req.query.page);
      if (!Number.isInteger(parsed) || parsed < 1) {
        fieldErrors.page = "page must be a positive integer.";
      } else {
        page = parsed;
      }
    }

    let pageSize = QUEUE_DEFAULT_PAGE_SIZE;
    if (req.query.pageSize != null && req.query.pageSize !== "") {
      const parsed = Number(req.query.pageSize);
      if (
        !Number.isInteger(parsed) ||
        parsed < QUEUE_MIN_PAGE_SIZE ||
        parsed > QUEUE_MAX_PAGE_SIZE
      ) {
        fieldErrors.pageSize = `pageSize must be between ${QUEUE_MIN_PAGE_SIZE} and ${QUEUE_MAX_PAGE_SIZE}.`;
      } else {
        pageSize = parsed;
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid query parameter.",
          fieldErrors,
        },
      });
      return;
    }

    // ─── Where clause ───────────────────────────────────────────────────
    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { ticketNumber: { contains: search, mode: "insensitive" } },
        { summary: { contains: search, mode: "insensitive" } },
      ];
    }
    if (status) where.status = status;
    if (priority) where.itPriority = priority;
    if (owner === "unassigned") {
      where.ownerId = null;
    } else if (owner === "me") {
      where.ownerId = req.currentUser!.id;
    } else if (owner) {
      where.ownerId = owner;
    }

    const [tickets, total] = await Promise.all([
      getPrisma().ticket.findMany({
        where,
        orderBy: [{ [sortBy]: sortDir }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          ticketNumber: true,
          createdAt: true,
          summary: true,
          requestedPriority: true,
          itPriority: true,
          status: true,
          category: { select: { name: true } },
          owner: { select: { id: true, name: true } },
        },
      }),
      getPrisma().ticket.count({ where }),
    ]);

    // Consistent with the shipped Requester list, which floors at 1 page.
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    res.status(200).json({
      items: tickets.map((t) => ({
        id: t.id,
        ticketNumber: t.ticketNumber,
        createdAt: t.createdAt.toISOString(),
        summary: t.summary,
        category: t.category.name,
        requestedPriority: t.requestedPriority,
        itPriority: t.itPriority,
        status: t.status,
        owner: t.owner,
      })),
      page,
      pageSize,
      total,
      totalPages,
    });
  } catch {
    serverError(res);
  }
});

// ─── GET /api/staff/tickets/:id ─────────────────────────────────────────
// Shared queue: any IT Staff/Administrator may open any Ticket (no ownership
// restriction beyond the role guard on the router).

staffRouter.get("/tickets/:id", async (req: Request, res: Response) => {
  try {
    const id = parseTicketId(req.params.id);
    if (id === null) {
      ticketNotFound(res);
      return;
    }

    const ticket = await loadTicket(id);
    if (!ticket) {
      ticketNotFound(res);
      return;
    }

    const attachments = await loadAttachments(id);

    res.status(200).json({
      ticket: toStaffTicketDto(ticket as StaffTicketRow),
      attachments,
    });
  } catch {
    serverError(res);
  }
});

// ─── POST /api/staff/tickets/:id/claim (BR-13, AC-07/AC-08) ─────────────

staffRouter.post("/tickets/:id/claim", async (req: Request, res: Response) => {
  try {
    const id = parseTicketId(req.params.id);
    if (id === null) {
      ticketNotFound(res);
      return;
    }

    const existing = await getPrisma().ticket.findUnique({
      where: { id },
      select: { id: true, ownerId: true },
    });
    if (!existing) {
      ticketNotFound(res);
      return;
    }

    // BR-13: claiming is only valid while the ticket is unassigned; moving
    // ownership between two assigned staff members is always /assign.
    if (existing.ownerId) {
      res.status(409).json({
        error: {
          code: "ALREADY_ASSIGNED",
          message: "This ticket already has an owner. Use reassign instead.",
        },
      });
      return;
    }

    const updated = await getPrisma().ticket.update({
      where: { id },
      data: { ownerId: req.currentUser!.id },
      include: TICKET_INCLUDE,
    });

    res.status(200).json({ ticket: toStaffTicketDto(updated as StaffTicketRow) });
  } catch {
    serverError(res);
  }
});

// ─── POST /api/staff/tickets/:id/assign (BR-12, FR-19) ──────────────────

staffRouter.post("/tickets/:id/assign", async (req: Request, res: Response) => {
  try {
    const id = parseTicketId(req.params.id);
    if (id === null) {
      ticketNotFound(res);
      return;
    }

    const body = (req.body ?? {}) as { ownerId?: unknown };
    const ownerId = typeof body.ownerId === "string" ? body.ownerId.trim() : "";

    // Missing/non-string ownerId is a bad owner target, not a server fault.
    if (!ownerId) {
      res.status(422).json({
        error: {
          code: "INVALID_OWNER",
          message: "Select an active IT Staff member or Administrator.",
          fieldErrors: { ownerId: "An owner is required." },
        },
      });
      return;
    }

    const existing = await getPrisma().ticket.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      ticketNotFound(res);
      return;
    }

    const target = await getPrisma().user.findUnique({
      where: { id: ownerId },
      select: { id: true, role: true, isActive: true },
    });
    // api-spec.md §3: an unknown owner id is a 404 resource miss.
    if (!target) {
      res.status(404).json({
        error: { code: "USER_NOT_FOUND", message: "Owner not found." },
      });
      return;
    }

    // BR-12: the owner must be an ACTIVE IT Staff member or Administrator.
    if (!target.isActive || !["IT_STAFF", "ADMINISTRATOR"].includes(target.role)) {
      res.status(422).json({
        error: {
          code: "INVALID_OWNER",
          message: "Select an active IT Staff member or Administrator.",
          fieldErrors: { ownerId: "That user cannot own a ticket." },
        },
      });
      return;
    }

    const updated = await getPrisma().ticket.update({
      where: { id },
      data: { ownerId },
      include: TICKET_INCLUDE,
    });

    res.status(200).json({ ticket: toStaffTicketDto(updated as StaffTicketRow) });
  } catch {
    serverError(res);
  }
});

// ─── PATCH /api/staff/tickets/:id/priority (BR-14, BR-15, AC-09) ────────

staffRouter.patch("/tickets/:id/priority", async (req: Request, res: Response) => {
  try {
    const id = parseTicketId(req.params.id);
    if (id === null) {
      ticketNotFound(res);
      return;
    }

    const body = (req.body ?? {}) as { itPriority?: unknown };
    const itPriority =
      typeof body.itPriority === "string" ? body.itPriority.trim().toUpperCase() : "";

    if (!(IT_PRIORITIES as readonly string[]).includes(itPriority)) {
      res.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "IT priority must be one of LOW, MEDIUM, HIGH, URGENT.",
          fieldErrors: { itPriority: "IT priority must be one of LOW, MEDIUM, HIGH, URGENT." },
        },
      });
      return;
    }

    const existing = await getPrisma().ticket.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      ticketNotFound(res);
      return;
    }

    // BR-15: `requestedPriority` is immutable after creation, so this update
    // deliberately names only `itPriority`.
    const updated = await getPrisma().ticket.update({
      where: { id },
      data: { itPriority: itPriority as (typeof IT_PRIORITIES)[number] },
      include: TICKET_INCLUDE,
    });

    res.status(200).json({ ticket: toStaffTicketDto(updated as StaffTicketRow) });
  } catch {
    serverError(res);
  }
});

// ─── PATCH /api/staff/tickets/:id/status (BR-19, AC-10) ─────────────────

staffRouter.patch("/tickets/:id/status", async (req: Request, res: Response) => {
  try {
    const id = parseTicketId(req.params.id);
    if (id === null) {
      ticketNotFound(res);
      return;
    }

    const body = (req.body ?? {}) as { status?: unknown };
    const status = typeof body.status === "string" ? body.status.trim().toUpperCase() : "";

    // Not a member of the enum at all → field-level 422 (distinct from a
    // well-formed but non-permitted transition, which is a 409).
    if (!isTicketStatus(status)) {
      res.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "status must be a valid ticket status.",
          fieldErrors: { status: "status must be a valid ticket status." },
        },
      });
      return;
    }

    const existing = await getPrisma().ticket.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!existing) {
      ticketNotFound(res);
      return;
    }

    const from = existing.status as string;
    const allowed = allowedStatusTransitions(from);

    // BR-19: every blank cell in the §6.1 matrix lands here. This covers
    // self-transitions (e.g. OPEN → OPEN) too, because the matrix has no
    // diagonal entries.
    if (!isTransitionAllowed(from, status)) {
      // `from`/`to`/`allowed` are echoed inside the standard error envelope and
      // mirrored at the top level so either reading of api-spec.md §3's
      // "{ from, to, allowed }" resolves without a client-side guess.
      res.status(409).json({
        error: {
          code: "INVALID_TRANSITION",
          message: `A ticket in ${from} cannot move to ${status}.`,
          from,
          to: status,
          allowed,
        },
        from,
        to: status,
        allowed,
      });
      return;
    }

    const updated = await getPrisma().ticket.update({
      where: { id },
      data: { status },
      include: TICKET_INCLUDE,
    });

    res.status(200).json({ ticket: toStaffTicketDto(updated as StaffTicketRow) });
  } catch {
    serverError(res);
  }
});

// ─── Public Comments, staff-authored (BR-04, api-spec.md §3) ────────────
// Same contract and same validation code path as the Requester endpoints in
// app.ts (lib/content.ts), but callable on ANY ticket.

staffRouter.post("/tickets/:id/comments", async (req: Request, res: Response) => {
  try {
    const id = parseTicketId(req.params.id);
    if (id === null) {
      ticketNotFound(res);
      return;
    }

    const existing = await getPrisma().ticket.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      ticketNotFound(res);
      return;
    }

    // Shared BR-17/BR-18 validation — never re-implemented per endpoint.
    const result = validateContent(req.body, "Comment");
    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }

    const comment = await getPrisma().publicComment.create({
      data: { ticketId: id, authorId: req.currentUser!.id, content: result.content },
      include: { author: { select: { name: true, role: true } } },
    });

    res.status(201).json(toContentDto(comment));
  } catch {
    serverError(res);
  }
});

staffRouter.get("/tickets/:id/comments", async (req: Request, res: Response) => {
  try {
    const id = parseTicketId(req.params.id);
    if (id === null) {
      ticketNotFound(res);
      return;
    }

    const existing = await getPrisma().ticket.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      ticketNotFound(res);
      return;
    }

    // api-spec.md §2: chronological (oldest-first), newest last.
    const comments = await getPrisma().publicComment.findMany({
      where: { ticketId: id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { author: { select: { name: true, role: true } } },
    });

    res.status(200).json({ items: comments.map(toContentDto) });
  } catch {
    serverError(res);
  }
});

// ─── Internal Notes (BR-04, BR-16/17/18, AC-04, AC-17) ──────────────────
// Reachable only by IT_STAFF/ADMINISTRATOR: the router-level requireRole
// already answers a Requester with 403 FORBIDDEN before any handler runs, and
// that response body contains no note content (SEC-03 / SEC-06b).

staffRouter.post("/tickets/:id/notes", async (req: Request, res: Response) => {
  try {
    const id = parseTicketId(req.params.id);
    if (id === null) {
      ticketNotFound(res);
      return;
    }

    const existing = await getPrisma().ticket.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      ticketNotFound(res);
      return;
    }

    const result = validateContent(req.body, "Note");
    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }

    const note = await getPrisma().internalNote.create({
      data: { ticketId: id, authorId: req.currentUser!.id, content: result.content },
      include: { author: { select: { name: true, role: true } } },
    });

    res.status(201).json(toContentDto(note));
  } catch {
    serverError(res);
  }
});

staffRouter.get("/tickets/:id/notes", async (req: Request, res: Response) => {
  try {
    const id = parseTicketId(req.params.id);
    if (id === null) {
      ticketNotFound(res);
      return;
    }

    const existing = await getPrisma().ticket.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      ticketNotFound(res);
      return;
    }

    const notes = await getPrisma().internalNote.findMany({
      where: { ticketId: id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { author: { select: { name: true, role: true } } },
    });

    res.status(200).json({ items: notes.map(toContentDto) });
  } catch {
    serverError(res);
  }
});

export default staffRouter;
