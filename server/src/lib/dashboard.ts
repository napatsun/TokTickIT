/**
 * Dashboard aggregates — api-spec.md §3 (FR-10, FR-11, FR-13, BR-13, BR-14)
 *
 *   GET /api/dashboard/staff      (§3.1) IT Staff / Administrator
 *   GET /api/dashboard/requester  (§3.2) Requester
 *
 * BR-13 / Decision C: every number below is computed LIVE at request time from
 * the authoritative `Ticket` and `TicketStatusHistory` tables. There is no
 * cached counter, no snapshot table, and no background job — the "delta vs.
 * yesterday" value is a live event-count query over the audit rows the status
 * workflow already writes (one row per successful transition, §7.3):
 *
 *   deltas.<key> =
 *       (# history rows where toStatus   ∈ group AND changedAt >= now − 24h)
 *     − (# history rows where fromStatus ∈ group AND changedAt >= now − 24h)
 *     + (# Tickets where createdAt >= now − 24h)   — for `new` only
 *
 * The extra `new` term exists because Ticket creation writes no history row
 * (no fromStatus to record) — without it, newly submitted Tickets would
 * silently vanish from the New delta even though they visibly raise
 * counts.new. Because every term is a live count, `deltas.<key>` is always a
 * well-defined integer, including `0` when nothing happened in the window
 * (api-spec.md §3.1: "there is no null case").
 *
 * BR-14: the canonical open-work status set is
 * {NEW, OPEN, IN_PROGRESS, WAITING_FOR_REQUESTER, REOPENED}. CANCELLED is
 * excluded from every open-work count; CLOSED is excluded as well. REOPENED is
 * folded into the staff "In Progress" card and the requester "My Open" card
 * (specification.md §11 decision 5) rather than given a separate card.
 *
 * FR-13: the recent lists are bounded (5 rows) and project only the columns
 * the UI renders — never a full Ticket collection.
 */

import { getPrisma } from "../prisma.js";
import type { TicketStatusValue } from "./statusTransitions.js";

// ─── Status groups (BR-14; the exact sets api-spec.md §3 names) ──────────

/** The full open-work set (BR-14). */
export const OPEN_WORK_STATUSES = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_REQUESTER",
  "REOPENED",
] as const;

/** The staff "In Progress" card folds REOPENED in (§3.1, BR-14). */
export const IN_PROGRESS_GROUP = ["IN_PROGRESS", "REOPENED"] as const;

/** The requester "My Open Tickets" card deliberately excludes IN_PROGRESS (§3.2). */
export const MY_OPEN_GROUP = ["NEW", "OPEN", "WAITING_FOR_REQUESTER", "REOPENED"] as const;

/** The staff cards that carry a delta; `myAssigned` never does (§3.1). */
const DELTA_GROUPS: Record<string, readonly string[]> = {
  new: ["NEW"],
  open: ["OPEN"],
  inProgress: IN_PROGRESS_GROUP,
  waitingForRequester: ["WAITING_FOR_REQUESTER"],
};

const RECENT_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Shared projections ──────────────────────────────────────────────────

/** The recent-list row shape both dashboards project (§3.1/§3.2 examples). */
const RECENT_SELECT = {
  id: true,
  ticketNumber: true,
  summary: true,
  status: true,
  updatedAt: true,
} as const;

interface RecentRow {
  id: number;
  ticketNumber: string;
  summary: string;
  status: string;
  updatedAt: Date;
}

function toRecentDto(row: RecentRow) {
  return {
    id: row.id,
    code: row.ticketNumber,
    title: row.summary,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Staff dashboard (§3.1) ──────────────────────────────────────────────

export interface StaffDashboard {
  generatedAt: string;
  timezone: "Asia/Bangkok";
  counts: {
    new: number;
    open: number;
    inProgress: number;
    waitingForRequester: number;
    myAssigned: number;
  };
  deltas: {
    new: number;
    open: number;
    inProgress: number;
    waitingForRequester: number;
  };
  recentTickets: ReturnType<typeof toRecentDto>[];
}

/**
 * The IT Staff / Administrator dashboard aggregate.
 *
 * The four queue counts span the WHOLE queue (not scoped to one assignee) but
 * never include CANCELLED or CLOSED — enforced by construction, since each
 * where clause names only BR-14 open-work statuses (API-24). `myAssigned` adds
 * the owner scope and the full open-work set (API-25).
 */
export async function getStaffDashboard(currentUserId: string): Promise<StaffDashboard> {
  const prisma = getPrisma();
  const since24h = new Date(Date.now() - DAY_MS);

  // counts.myAssigned / recentTickets scope; the four queue cards are unscoped.
  const openWork = { in: [...OPEN_WORK_STATUSES] as TicketStatusValue[] };

  const [
    countNew,
    countOpen,
    countInProgress,
    countWaiting,
    countMyAssigned,
    recentRows,
    createdAtSince,
    ...deltaTerms
  ] = await Promise.all([
    prisma.ticket.count({ where: { status: "NEW" } }),
    prisma.ticket.count({ where: { status: "OPEN" } }),
    prisma.ticket.count({ where: { status: { in: [...IN_PROGRESS_GROUP] } } }),
    prisma.ticket.count({ where: { status: "WAITING_FOR_REQUESTER" } }),
    prisma.ticket.count({ where: { ownerId: currentUserId, status: { in: openWork.in } } }),
    prisma.ticket.findMany({
      // §3.1: assigned to me OR unassigned, excluding Cancelled. Every
      // non-Cancelled status is eligible — including CLOSED, which the counts
      // exclude but the recent list (the "queue at a glance" view) does not.
      where: { OR: [{ ownerId: currentUserId }, { ownerId: null }], status: { not: "CANCELLED" } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: RECENT_LIMIT,
      select: RECENT_SELECT,
    }),
    // The `new` delta's extra term (§3.1): creation writes no history row.
    prisma.ticket.count({ where: { createdAt: { gte: since24h } } }),

    // Deltas, term by term, computed live from TicketStatusHistory (BR-13).
    prisma.ticketStatusHistory.count({ where: { toStatus: "NEW", changedAt: { gte: since24h } } }),
    prisma.ticketStatusHistory.count({ where: { fromStatus: "NEW", changedAt: { gte: since24h } } }),
    prisma.ticketStatusHistory.count({ where: { toStatus: "OPEN", changedAt: { gte: since24h } } }),
    prisma.ticketStatusHistory.count({ where: { fromStatus: "OPEN", changedAt: { gte: since24h } } }),
    prisma.ticketStatusHistory.count({
      where: { toStatus: { in: [...IN_PROGRESS_GROUP] }, changedAt: { gte: since24h } },
    }),
    prisma.ticketStatusHistory.count({
      where: { fromStatus: { in: [...IN_PROGRESS_GROUP] }, changedAt: { gte: since24h } },
    }),
    prisma.ticketStatusHistory.count({
      where: { toStatus: "WAITING_FOR_REQUESTER", changedAt: { gte: since24h } },
    }),
    prisma.ticketStatusHistory.count({
      where: { fromStatus: "WAITING_FOR_REQUESTER", changedAt: { gte: since24h } },
    }),
  ]);

  const [
    toNew,
    fromNew,
    toOpen,
    fromOpen,
    toInProgress,
    fromInProgress,
    toWaiting,
    fromWaiting,
  ] = deltaTerms;

  return {
    generatedAt: new Date().toISOString(),
    timezone: "Asia/Bangkok",
    counts: {
      new: countNew,
      open: countOpen,
      inProgress: countInProgress,
      waitingForRequester: countWaiting,
      myAssigned: countMyAssigned,
    },
    deltas: {
      new: toNew - fromNew + createdAtSince,
      open: toOpen - fromOpen,
      inProgress: toInProgress - fromInProgress,
      waitingForRequester: toWaiting - fromWaiting,
    },
    recentTickets: recentRows.map(toRecentDto),
  };
}

// ─── Requester dashboard (§3.2) ──────────────────────────────────────────

export interface RequesterDashboard {
  generatedAt: string;
  timezone: "Asia/Bangkok";
  counts: {
    myOpen: number;
    inProgress: number;
    resolved: number;
    closed: number;
  };
  recentTickets: ReturnType<typeof toRecentDto>[];
}

/**
 * The Requester dashboard aggregate. Scope is enforced HERE, in the query's
 * where clause (`requesterId = :sessionUserId`) — never by filtering a wider
 * fetch after the fact (AC-02, AC-06).
 *
 * There is deliberately no `deltas` key in this response (§3.2): the Requester
 * Dashboard shows no delta indicators (ui-spec.md §3.1).
 */
export async function getRequesterDashboard(currentUserId: string): Promise<RequesterDashboard> {
  const prisma = getPrisma();
  const own = { requesterId: currentUserId } as const;

  const [myOpen, inProgress, resolved, closed, recentRows] = await Promise.all([
    // §3.2: the four-status set that excludes IN_PROGRESS (its own card) but
    // includes REOPENED (BR-14) so a reopened Ticket is not invisible here.
    prisma.ticket.count({ where: { ...own, status: { in: [...MY_OPEN_GROUP] } } }),
    prisma.ticket.count({ where: { ...own, status: "IN_PROGRESS" } }),
    prisma.ticket.count({ where: { ...own, status: "RESOLVED" } }),
    prisma.ticket.count({ where: { ...own, status: "CLOSED" } }),
    prisma.ticket.findMany({
      // Any non-Cancelled status; scope is part of the query itself.
      where: { ...own, status: { not: "CANCELLED" } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: RECENT_LIMIT,
      select: RECENT_SELECT,
    }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    timezone: "Asia/Bangkok",
    counts: { myOpen, inProgress, resolved, closed },
    recentTickets: recentRows.map(toRecentDto),
  };
}
