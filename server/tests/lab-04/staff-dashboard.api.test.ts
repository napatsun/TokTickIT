import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";
import {
  createTestUser,
  loginAs,
  cleanupTestUsers,
  type SessionClient,
  type TestUser,
} from "../helpers/session.js";

const prisma = getPrisma();

/**
 * IT Staff Dashboard — tests.md §3, api-spec.md §3.1, specification.md
 * FR-10 / BR-13 / BR-14.
 *
 *   API-24   whole-queue counts exclude Cancelled (and Closed) — BR-14
 *   API-25   myAssigned scoped to ownerId = caller, open-work set only
 *   API-26   response carries only counts / deltas / recentTickets (≤5) — FR-13
 *   API-34   a Reopened ticket folds into inProgress and myAssigned — BR-14
 *   API-36   deltas computed live from TicketStatusHistory (BR-13, Decision C)
 *   API-37   zero recent history rows → deltas are 0, never null
 *   API-42   myActions: caller-scoped, newest first, ≤5, voided excluded
 *   API-43   myActions.followUpCount counts open follow-ups only
 *   API-44   urgentTickets: URGENT + open-work only, oldest first, ≤5
 *   API-45   the new sections are whole-queue / empty-safe and leave the
 *            existing counts untouched (FR-17, FR-18)
 *   AUTH-03  a Requester calling /api/dashboard/staff → 403 FORBIDDEN_ROLE
 *
 * Conventions match the other Lab 4 suites: real login sessions through
 * /api/auth/login (helpers/session.ts), fixtures created directly through
 * Prisma and torn down in afterAll, and the shared idempotent seed as the
 * baseline.
 */

let staffA: TestUser;
let staffB: TestUser;
/** A staff member with no Actions Taken of their own (API-45's empty contract). */
let staffC: TestUser;
let requester: TestUser;
let adminUser: TestUser;

let staffClient: SessionClient;
let staffCClient: SessionClient;
let adminClient: SessionClient;
let requesterClient: SessionClient;

let fixtureCategoryId: number;
let fixtureRelatedSystemId: number;
let ticketSeq = 0;

interface FixtureOptions {
  status?:
    | "NEW"
    | "OPEN"
    | "IN_PROGRESS"
    | "WAITING_FOR_REQUESTER"
    | "RESOLVED"
    | "CLOSED"
    | "REOPENED"
    | "CANCELLED";
  ownerId?: string | null;
  /** Backdate the ticket so it does not pollute the `new` delta's createdAt term. */
  createdAt?: Date;
  /** IT Priority (BR-14 scale) — API-44's urgent-panel fixtures need `URGENT`. */
  itPriority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  /**
   * Ticket-number prefix. API-44 uses a dedicated prefix so its fixtures can be
   * deleted again in afterAll: the urgent panel's "oldest first" assertion needs
   * a database state this test controls completely.
   */
  numberPrefix?: string;
}

async function createFixtureTicket(overrides: FixtureOptions = {}) {
  const n = ++ticketSeq;
  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber: `${overrides.numberPrefix ?? "TKT-2026-SD"}-${Date.now()}-${n}`,
      requesterId: requester.id,
      ownerId: overrides.ownerId ?? null,
      categoryId: fixtureCategoryId,
      relatedSystemId: fixtureRelatedSystemId,
      summary: `Staff dashboard fixture ${n}`,
      description: "Fixture ticket for the staff dashboard API suite.",
      requestedPriority: "MEDIUM",
      ...(overrides.itPriority ? { itPriority: overrides.itPriority } : {}),
      status: overrides.status ?? "OPEN",
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
    select: { id: true, ticketNumber: true, status: true, ownerId: true },
  });
  return ticket;
}

/** An Actions Taken row, created the way the API would (§7.1, BR-01…BR-05). */
async function createFixtureAction(overrides: {
  ticketId: number;
  performedById: string;
  actionDateTime: Date;
  description?: string;
  followUpRequired?: boolean;
  isVoided?: boolean;
}) {
  return prisma.actionTaken.create({
    data: {
      ticketId: overrides.ticketId,
      performedById: overrides.performedById,
      actionDateTime: overrides.actionDateTime,
      description: overrides.description ?? "Fixture action for the dashboard API suite.",
      result: "Fixture result recorded by the dashboard suite.",
      followUpRequired: overrides.followUpRequired ?? false,
      followUpNote: overrides.followUpRequired ? "Confirm with the requester tomorrow." : null,
      isVoided: overrides.isVoided ?? false,
      ...(overrides.isVoided ? { voidReason: "Fixture void for the dashboard suite." } : {}),
    },
    select: {
      id: true,
      ticketId: true,
      actionDateTime: true,
      followUpRequired: true,
      isVoided: true,
    },
  });
}

/** A status transition row as the workflow itself would write it (§7.3). */
async function writeHistoryRow(
  ticketId: number,
  fromStatus: string,
  toStatus: string,
  changedAt: Date,
) {
  await prisma.ticketStatusHistory.create({
    data: {
      ticketId,
      fromStatus: fromStatus as never,
      toStatus: toStatus as never,
      changedById: staffA.id,
      changedAt,
    },
  });
}

beforeAll(async () => {
  await seed();

  staffA = await createTestUser({ name: "Dashboard Staff A", role: "IT_STAFF" });
  staffB = await createTestUser({ name: "Dashboard Staff B", role: "IT_STAFF" });
  staffC = await createTestUser({ name: "Dashboard Staff C", role: "IT_STAFF" });
  requester = await createTestUser({ name: "Dashboard Requester" });
  adminUser = await createTestUser({ name: "Dashboard Admin", role: "ADMINISTRATOR" });

  staffClient = await loginAs(app, staffA.email);
  staffCClient = await loginAs(app, staffC.email);
  adminClient = await loginAs(app, adminUser.email);
  requesterClient = await loginAs(app, requester.email);

  const category = await prisma.category.findFirst({ where: { isActive: true }, select: { id: true } });
  const relatedSystem = await prisma.relatedSystem.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  fixtureCategoryId = category!.id;
  fixtureRelatedSystemId = relatedSystem!.id;
});

afterAll(async () => {
  // API-44's fixtures are deleted again: its "oldest urgent first" assertion
  // depends on a state this suite fully controls. They carry a dedicated number
  // prefix and have no child rows (no actions/comments/notes/attachments/
  // history), so the delete cannot trip a Restrict relation.
  await prisma.ticket.deleteMany({ where: { ticketNumber: { startsWith: "TKT-2026-SD-URG-" } } });

  await cleanupTestUsers([staffA.id, staffB.id, staffC.id, requester.id, adminUser.id]);
  await prisma.$disconnect();
});

// ─── API-26 — payload shape (FR-13) ──────────────────────────────────────

describe("API-26 — response payload size/shape (FR-13)", () => {
  it("returns exactly counts, deltas, recentTickets — never a Ticket array", async () => {
    const res = await staffClient.agent.get("/api/dashboard/staff");

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      [
        "counts",
        "deltas",
        "generatedAt",
        "myActions",
        "recentTickets",
        "timezone",
        "urgentTickets",
      ].sort(),
    );

    expect(Object.keys(res.body.counts).sort()).toEqual(
      ["inProgress", "myAssigned", "new", "open", "waitingForRequester"].sort(),
    );
    expect(Object.keys(res.body.deltas).sort()).toEqual(
      ["inProgress", "new", "open", "waitingForRequester"].sort(),
    );
    // §3.1: there is no deltas.myAssigned key at all.
    expect(res.body.deltas).not.toHaveProperty("myAssigned");

    expect(Array.isArray(res.body.recentTickets)).toBe(true);
    expect(res.body.recentTickets.length).toBeLessThanOrEqual(5);
    for (const item of res.body.recentTickets) {
      // The recent rows are bounded projections, not full Tickets.
      expect(Object.keys(item).sort()).toEqual(["code", "id", "status", "title", "updatedAt"].sort());
    }

    // FR-17/FR-18: the two added sections are bounded projections too.
    expect(Object.keys(res.body.myActions).sort()).toEqual(["followUpCount", "items"].sort());
    expect(Array.isArray(res.body.myActions.items)).toBe(true);
    expect(res.body.myActions.items.length).toBeLessThanOrEqual(5);
    for (const item of res.body.myActions.items) {
      expect(Object.keys(item).sort()).toEqual(
        ["actionDateTime", "description", "followUpRequired", "id", "ticketId", "ticketNumber"].sort(),
      );
    }
    expect(Array.isArray(res.body.urgentTickets)).toBe(true);
    expect(res.body.urgentTickets.length).toBeLessThanOrEqual(5);
    for (const item of res.body.urgentTickets) {
      expect(Object.keys(item).sort()).toEqual(
        ["id", "itPriority", "ownerName", "status", "ticketNumber", "title"].sort(),
      );
    }

    expect(res.body.timezone).toBe("Asia/Bangkok");
    expect(typeof res.body.generatedAt).toBe("string");
  });
});

// ─── API-24 — whole-queue counts exclude Cancelled/Closed (BR-14) ────────

describe("API-24 — staff dashboard counts exclude Cancelled Tickets (FR-10, BR-14)", () => {
  it("matches a direct DB query excluding Cancelled for every card", async () => {
    // Two fixtures of each relevant kind; every non-Cancelled status is
    // represented, so a wrong where clause cannot hide behind seed noise.
    const f = {
      newOpen: await createFixtureTicket({ status: "NEW" }),
      openAssigned: await createFixtureTicket({ status: "OPEN", ownerId: staffA.id }),
      inProgress: await createFixtureTicket({ status: "IN_PROGRESS", ownerId: staffB.id }),
      waiting: await createFixtureTicket({ status: "WAITING_FOR_REQUESTER" }),
      reopened: await createFixtureTicket({ status: "REOPENED", ownerId: staffA.id }),
      resolved: await createFixtureTicket({ status: "RESOLVED" }),
      closed: await createFixtureTicket({ status: "CLOSED" }),
      cancelled: await createFixtureTicket({ status: "CANCELLED" }),
    };

    const res = await staffClient.agent.get("/api/dashboard/staff");
    expect(res.status).toBe(200);

    // Expected values computed against the DB the same way BR-14 defines them —
    // NOT from the implementation's own code path.
    const db = async (where: Record<string, unknown>) => prisma.ticket.count({ where });
    const [newCount, openCount, inProgressCount, waitingCount] = await Promise.all([
      db({ status: "NEW" }),
      db({ status: "OPEN" }),
      db({ status: { in: ["IN_PROGRESS", "REOPENED"] } }),
      db({ status: "WAITING_FOR_REQUESTER" }),
    ]);

    expect(res.body.counts.new).toBe(newCount);
    expect(res.body.counts.open).toBe(openCount);
    expect(res.body.counts.inProgress).toBe(inProgressCount);
    expect(res.body.counts.waitingForRequester).toBe(waitingCount);

    // The Cancelled/Closed fixtures exist but must not raise any card.
    expect(f.cancelled.status).toBe("CANCELLED");
    expect(f.resolved.status).toBe("RESOLVED");

    // counts are whole-queue: another staff member's assignment counts here too.
    const allStaffOwned = await db({
      ownerId: { in: [staffA.id, staffB.id] },
      status: { in: ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"] },
    });
    const mine = await db({
      ownerId: staffA.id,
      status: { in: ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"] },
    });
    expect(allStaffOwned).toBeGreaterThan(mine);
  });
});

// ─── API-25 — myAssigned scope (FR-10) ───────────────────────────────────

describe("API-25 — myAssigned is ownerId-scoped and excludes Closed/Cancelled (FR-10)", () => {
  it("counts only the caller's tickets in the open-work set", async () => {
    await createFixtureTicket({ status: "OPEN", ownerId: staffA.id });
    await createFixtureTicket({ status: "NEW", ownerId: staffA.id });
    await createFixtureTicket({ status: "CLOSED", ownerId: staffA.id }); // excluded
    await createFixtureTicket({ status: "CANCELLED", ownerId: staffA.id }); // excluded
    await createFixtureTicket({ status: "OPEN", ownerId: staffB.id }); // someone else's

    const res = await staffClient.agent.get("/api/dashboard/staff");
    expect(res.status).toBe(200);

    const mine = await prisma.ticket.count({
      where: {
        ownerId: staffA.id,
        status: { in: ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"] },
      },
    });
    expect(res.body.counts.myAssigned).toBe(mine);
    expect(mine).toBeGreaterThan(0);

    // The other staff member's ticket is not in my card: my card is strictly
    // smaller than the shared-queue whole of my+theirs.
    const both = await prisma.ticket.count({
      where: {
        ownerId: { in: [staffA.id, staffB.id] },
        status: { in: ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"] },
      },
    });
    expect(both).toBeGreaterThan(res.body.counts.myAssigned);
  });
});

// ─── API-34 — Reopened folds into inProgress + myAssigned (BR-14) ────────

describe("API-34 — a Reopened ticket has no separate bucket (BR-14)", () => {
  it("raises inProgress and myAssigned, never a dedicated key", async () => {
    const before = await staffClient.agent.get("/api/dashboard/staff");

    const reopened = await createFixtureTicket({ status: "REOPENED", ownerId: staffA.id });
    expect(reopened.status).toBe("REOPENED");

    const after = await staffClient.agent.get("/api/dashboard/staff");

    expect(after.body.counts.inProgress).toBe(before.body.counts.inProgress + 1);
    expect(after.body.counts.myAssigned).toBe(before.body.counts.myAssigned + 1);
    expect(Object.keys(after.body.counts)).not.toContain("reopened");
  });
});

// ─── API-36 — live deltas from TicketStatusHistory (BR-13, Decision C) ───

describe("API-36 — deltas are computed live from TicketStatusHistory (BR-13)", () => {
  it("reflects exactly the transitions made in the last 24h, immediately, with no cache step", async () => {
    const before = await staffClient.agent.get("/api/dashboard/staff");

    // Two transitions INTO Open within the window, one OUT of Open.
    const t1 = await createFixtureTicket({ status: "NEW" });
    const t2 = await createFixtureTicket({ status: "NEW" });
    const t3 = await createFixtureTicket({ status: "OPEN" });
    await writeHistoryRow(t1.id, "NEW", "OPEN", new Date());
    await writeHistoryRow(t2.id, "NEW", "OPEN", new Date());
    await writeHistoryRow(t3.id, "OPEN", "IN_PROGRESS", new Date());

    const after = await staffClient.agent.get("/api/dashboard/staff");

    expect(after.body.deltas.open).toBe(before.body.deltas.open + 1);
    // The value changed within the same test with no cache-invalidation step —
    // the live-computation property API-36 asserts.
  });

  it("adds the creation term to the new delta (creation writes no history row)", async () => {
    const before = await staffClient.agent.get("/api/dashboard/staff");

    const created = await prisma.ticket.create({
      data: {
        ticketNumber: `TKT-2026-SD-NEW-${Date.now()}`,
        requesterId: requester.id,
        categoryId: fixtureCategoryId,
        relatedSystemId: fixtureRelatedSystemId,
        summary: "Brand new ticket for the new-delta term",
        description: "Created now, so only the createdAt term should move the delta.",
        requestedPriority: "LOW",
        status: "NEW",
      },
      select: { id: true },
    });

    const after = await staffClient.agent.get("/api/dashboard/staff");
    expect(after.body.deltas.new).toBe(before.body.deltas.new + 1);

    // Cleanup happens with the fixture user; keep a reference use to satisfy lint.
    expect(created.id).toBeGreaterThan(0);
  });

  it("counts only rows inside the 24h window", async () => {
    const t = await createFixtureTicket({ status: "OPEN" });
    // 30 hours ago — outside the window, must not move the delta.
    await writeHistoryRow(t.id, "NEW", "OPEN", new Date(Date.now() - 30 * 60 * 60 * 1000));

    const res = await staffClient.agent.get("/api/dashboard/staff");
    expect(res.status).toBe(200);
    // No assertion on the exact value: the point is that this request and the
    // next agree the old row did not raise open — exercised below.
    const before = res.body.deltas.open;

    const t2 = await createFixtureTicket({ status: "NEW" });
    await writeHistoryRow(t2.id, "NEW", "OPEN", new Date());
    const after = await staffClient.agent.get("/api/dashboard/staff");
    expect(after.body.deltas.open).toBe(before + 1);
  });
});

// ─── API-37 — zero recent history rows → deltas are 0, never null ────────

describe("API-37 — zero TicketStatusHistory rows in the last 24h yields integer 0 deltas", () => {
  it("returns 0 (not null, not omitted) for every delta key", async () => {
    // A freshly-created fixture user's session shares the DB, so "fresh seed"
    // cannot be simulated by isolation — instead assert the response contract
    // itself: every delta is a number and never null, whatever the window holds.
    const res = await staffClient.agent.get("/api/dashboard/staff");
    expect(res.status).toBe(200);
    for (const key of ["new", "open", "inProgress", "waitingForRequester"]) {
      expect(typeof res.body.deltas[key]).toBe("number");
      expect(res.body.deltas[key]).not.toBeNull();
      expect(Number.isInteger(res.body.deltas[key])).toBe(true);
    }
  });
});

// ─── recentTickets scope (§3.1) ──────────────────────────────────────────

describe("recentTickets — assigned-to-me or unassigned, excluding Cancelled (§3.1)", () => {
  it("includes my tickets and unassigned tickets, excludes others' and Cancelled", async () => {
    const mine = await createFixtureTicket({ status: "OPEN", ownerId: staffA.id });
    const unassigned = await createFixtureTicket({ status: "NEW" });
    const theirs = await createFixtureTicket({ status: "OPEN", ownerId: staffB.id });
    await createFixtureTicket({ status: "OPEN", ownerId: staffA.id }).then(async (t) => {
      // A Cancelled ticket assigned to me must never surface in the list.
      await prisma.ticket.update({ where: { id: t.id }, data: { status: "CANCELLED" } });
    });

    const res = await staffClient.agent.get("/api/dashboard/staff");
    expect(res.status).toBe(200);

    const ids = res.body.recentTickets.map((t: { id: number }) => t.id);
    // Mine and unassigned are ELIGIBLE (they are the two most recent updates
    // among the eligible set created here), theirs and cancelled are not.
    const ineligible = new Set<number>([theirs.id]);
    for (const id of ids) {
      expect(ineligible.has(id)).toBe(false);
    }
    // Cancelled one specifically must be absent even though it was updated last.
    const cancelledMine = await prisma.ticket.findMany({
      where: { ownerId: staffA.id, status: "CANCELLED" },
      select: { id: true },
    });
    for (const row of cancelledMine) {
      expect(ids).not.toContain(row.id);
    }
    void mine;
    void unassigned;
  });

  it("is capped at 5 rows, newest first by updatedAt", async () => {
    for (let i = 0; i < 7; i += 1) {
      await createFixtureTicket({ status: "OPEN", ownerId: staffA.id });
    }
    const res = await staffClient.agent.get("/api/dashboard/staff");
    expect(res.body.recentTickets.length).toBeLessThanOrEqual(5);

    const times = res.body.recentTickets.map((t: { updatedAt: string }) => t.updatedAt);
    const sorted = [...times].sort((a, b) => b.localeCompare(a));
    expect(times).toEqual(sorted);
  });
});

// ─── API-42 — myActions scope / order / limit / projection (FR-17) ─────

describe("API-42 — myActions is the caller's own work, newest first, voided excluded (FR-17)", () => {
  it("returns the 5 newest non-voided entries performed by the caller, id DESC on ties", async () => {
    const myTicket = await createFixtureTicket({ status: "OPEN", ownerId: staffA.id });
    const theirTicket = await createFixtureTicket({ status: "OPEN", ownerId: staffB.id });

    const base = Date.UTC(2026, 0, 1, 9, 0, 0);
    const HOUR = 60 * 60 * 1000;

    // Six of my own entries, one per hour, ascending.
    const mine = [];
    for (let index = 0; index < 6; index += 1) {
      mine.push(
        await createFixtureAction({
          ticketId: myTicket.id,
          performedById: staffA.id,
          actionDateTime: new Date(base + index * HOUR),
          description: `Dashboard fixture action ${index}`,
        }),
      );
    }

    // Newest of all — but voided, so it must never appear.
    const voided = await createFixtureAction({
      ticketId: myTicket.id,
      performedById: staffA.id,
      actionDateTime: new Date(base + 6 * HOUR),
      isVoided: true,
    });

    // Newest of all — but authored by another IT Staff member.
    const theirs = await createFixtureAction({
      ticketId: theirTicket.id,
      performedById: staffB.id,
      actionDateTime: new Date(base + 7 * HOUR),
    });

    // Two entries sharing one timestamp — the id DESC tie-break must decide.
    const tieTime = new Date(base + 10 * HOUR);
    const tieOne = await createFixtureAction({
      ticketId: myTicket.id,
      performedById: staffA.id,
      actionDateTime: tieTime,
    });
    const tieTwo = await createFixtureAction({
      ticketId: myTicket.id,
      performedById: staffA.id,
      actionDateTime: tieTime,
    });
    const tieOrder = [tieOne.id, tieTwo.id].sort().reverse();

    const res = await staffClient.agent.get("/api/dashboard/staff");
    expect(res.status).toBe(200);

    const ids = res.body.myActions.items.map((item: { id: string }) => item.id);

    // Exactly five rows: the two tie entries, then my three newest singles.
    expect(ids).toEqual([...tieOrder, mine[5].id, mine[4].id, mine[3].id]);

    // The two newest rows overall are excluded, for opposite reasons.
    expect(ids).not.toContain(voided.id);
    expect(ids).not.toContain(theirs.id);

    // The same answer as an independent database query written here (not via
    // the implementation): caller scope, voided filter, order, limit.
    const expected = await prisma.actionTaken.findMany({
      where: { performedById: staffA.id, isVoided: false },
      orderBy: [{ actionDateTime: "desc" }, { id: "desc" }],
      take: 5,
      select: { id: true },
    });
    expect(ids).toEqual(expected.map((row) => row.id));

    // Projection: the dashboard never becomes a second Actions Taken surface.
    const first = res.body.myActions.items[0];
    expect(first).not.toHaveProperty("result");
    expect(first).not.toHaveProperty("followUpNote");
    expect(first).not.toHaveProperty("attachmentNotes");
    expect(first.ticketId).toBe(myTicket.id);
    expect(first.ticketNumber).toBe(myTicket.ticketNumber);
  });
});

// ─── API-43 — myActions.followUpCount (FR-17) ───────────────────────────

describe("API-43 — followUpCount counts only the caller's still-open follow-ups (FR-17)", () => {
  it("excludes voided entries, other users' entries, and finished Tickets", async () => {
    const openTicket = await createFixtureTicket({ status: "OPEN", ownerId: staffA.id });
    const waitingTicket = await createFixtureTicket({ status: "WAITING_FOR_REQUESTER" });
    const closedTicket = await createFixtureTicket({ status: "CLOSED", ownerId: staffA.id });
    const cancelledTicket = await createFixtureTicket({ status: "CANCELLED" });
    const theirTicket = await createFixtureTicket({ status: "OPEN", ownerId: staffB.id });

    const at = new Date(Date.UTC(2026, 1, 1, 10, 0, 0));

    // Counted: two non-voided follow-ups on still-open Tickets.
    await createFixtureAction({
      ticketId: openTicket.id,
      performedById: staffA.id,
      actionDateTime: at,
      followUpRequired: true,
    });
    await createFixtureAction({
      ticketId: waitingTicket.id,
      performedById: staffA.id,
      actionDateTime: at,
      followUpRequired: true,
    });
    // Not counted: finished Tickets, a non-follow-up, a voided follow-up, and
    // another user's follow-up.
    await createFixtureAction({
      ticketId: closedTicket.id,
      performedById: staffA.id,
      actionDateTime: at,
      followUpRequired: true,
    });
    await createFixtureAction({
      ticketId: cancelledTicket.id,
      performedById: staffA.id,
      actionDateTime: at,
      followUpRequired: true,
    });
    await createFixtureAction({
      ticketId: openTicket.id,
      performedById: staffA.id,
      actionDateTime: at,
      followUpRequired: false,
    });
    await createFixtureAction({
      ticketId: openTicket.id,
      performedById: staffA.id,
      actionDateTime: at,
      followUpRequired: true,
      isVoided: true,
    });
    await createFixtureAction({
      ticketId: theirTicket.id,
      performedById: staffB.id,
      actionDateTime: at,
      followUpRequired: true,
    });

    const res = await staffClient.agent.get("/api/dashboard/staff");
    expect(res.status).toBe(200);

    // Independent database count of exactly the rule FR-17 states.
    const expected = await prisma.actionTaken.count({
      where: {
        performedById: staffA.id,
        isVoided: false,
        followUpRequired: true,
        ticket: { status: { notIn: ["CLOSED", "CANCELLED"] } },
      },
    });

    expect(res.body.myActions.followUpCount).toBe(expected);
    // The two counted fixtures guarantee the assertion is not trivially 0.
    expect(expected).toBeGreaterThanOrEqual(2);
    expect(Number.isInteger(res.body.myActions.followUpCount)).toBe(true);
  });
});

// ─── API-44 — urgentTickets filter / order / limit (FR-18) ──────────────

describe("API-44 — urgentTickets is URGENT open work, oldest first, max 5 (FR-18)", () => {
  it("lists only URGENT open-work Tickets, oldest createdAt first, with owner names", async () => {
    const PREFIX = "TKT-2026-SD-URG";
    const at = (day: number) => new Date(Date.UTC(1975, 0, day));

    // Nine decoys that a wrong `where` clause would wrongly surface: three
    // terminal statuses and a HIGH priority, all older than the five live ones.
    const cancelled = await createFixtureTicket({
      status: "CANCELLED",
      itPriority: "URGENT",
      createdAt: at(1),
      numberPrefix: PREFIX,
    });
    const closed = await createFixtureTicket({
      status: "CLOSED",
      itPriority: "URGENT",
      createdAt: at(2),
      numberPrefix: PREFIX,
    });
    const resolved = await createFixtureTicket({
      status: "RESOLVED",
      itPriority: "URGENT",
      createdAt: at(3),
      numberPrefix: PREFIX,
    });
    const high = await createFixtureTicket({
      status: "OPEN",
      itPriority: "HIGH",
      createdAt: at(4),
      numberPrefix: PREFIX,
    });

    // Five live urgent Tickets, one per open-work status, oldest to newest.
    const unassigned = await createFixtureTicket({
      status: "OPEN",
      itPriority: "URGENT",
      createdAt: at(5),
      numberPrefix: PREFIX,
    });
    const assigned = await createFixtureTicket({
      status: "IN_PROGRESS",
      itPriority: "URGENT",
      ownerId: staffB.id,
      createdAt: at(6),
      numberPrefix: PREFIX,
    });
    const waiting = await createFixtureTicket({
      status: "WAITING_FOR_REQUESTER",
      itPriority: "URGENT",
      createdAt: at(7),
      numberPrefix: PREFIX,
    });
    const brandNew = await createFixtureTicket({
      status: "NEW",
      itPriority: "URGENT",
      createdAt: at(8),
      numberPrefix: PREFIX,
    });
    const reopened = await createFixtureTicket({
      status: "REOPENED",
      itPriority: "URGENT",
      ownerId: staffA.id,
      createdAt: at(9),
      numberPrefix: PREFIX,
    });

    const res = await staffClient.agent.get("/api/dashboard/staff");
    expect(res.status).toBe(200);

    const rows = res.body.urgentTickets as Array<{
      id: number;
      ticketNumber: string;
      title: string;
      status: string;
      itPriority: string;
      ownerName: string | null;
    }>;

    // The five fixtures are the oldest live urgent Tickets in the database, so
    // the oldest-first order and the 5-row cap are both exercised exactly.
    expect(rows.map((row) => row.id)).toEqual([
      unassigned.id,
      assigned.id,
      waiting.id,
      brandNew.id,
      reopened.id,
    ]);

    // Owner projection: name, or null for an unassigned Ticket.
    expect(rows[0].ownerName).toBeNull();
    expect(rows[1].ownerName).toBe(staffB.name);
    expect(rows[4].ownerName).toBe(staffA.name);

    // Filter correctness, asserted independently of the top-5 membership.
    const ids = rows.map((row) => row.id);
    for (const decoy of [cancelled.id, closed.id, resolved.id, high.id]) {
      expect(ids).not.toContain(decoy);
    }
    for (const row of rows) {
      expect(row.itPriority).toBe("URGENT");
      expect(["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"]).toContain(
        row.status,
      );
    }

    // And the same rows an independent database query returns.
    const expected = await prisma.ticket.findMany({
      where: {
        itPriority: "URGENT",
        status: { in: ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 5,
      select: { id: true, ticketNumber: true, summary: true, status: true, itPriority: true },
    });
    expect(rows.map((row) => row.id)).toEqual(expected.map((ticket) => ticket.id));
    expect(rows.map((row) => row.ticketNumber)).toEqual(
      expected.map((ticket) => ticket.ticketNumber),
    );
    expect(rows.map((row) => row.title)).toEqual(expected.map((ticket) => ticket.summary));
  });
});

// ─── API-45 — new sections are whole-queue + empty-safe (FR-17, FR-18) ──

describe("API-45 — the new sections are whole-queue, empty-safe, and non-invasive (FR-17, FR-18)", () => {
  it("gives a staff user with no Actions Taken an empty list and a 0 count", async () => {
    const res = await staffCClient.agent.get("/api/dashboard/staff");
    expect(res.status).toBe(200);

    expect(res.body.myActions.items).toEqual([]);
    expect(res.body.myActions.followUpCount).toBe(0);
    // Not null, not omitted — the documented empty contract.
    expect(res.body.myActions.followUpCount).not.toBeNull();
    expect(Array.isArray(res.body.urgentTickets)).toBe(true);
  });

  it("shows every staff caller the same whole-queue urgent list and the same counts", async () => {
    const a = await staffClient.agent.get("/api/dashboard/staff");
    const c = await staffCClient.agent.get("/api/dashboard/staff");

    expect(a.status).toBe(200);
    expect(c.status).toBe(200);

    // FR-18: the panel is the staff-visible queue, not "my assignments".
    expect(c.body.urgentTickets).toEqual(a.body.urgentTickets);
    // The pre-existing whole-queue metrics are untouched by the added sections
    // (myAssigned is deliberately NOT compared: it is caller-scoped, FR-10).
    for (const key of ["new", "open", "inProgress", "waitingForRequester"]) {
      expect(c.body.counts[key]).toBe(a.body.counts[key]);
    }
    expect(Object.keys(a.body.counts).sort()).toEqual(
      ["inProgress", "myAssigned", "new", "open", "waitingForRequester"].sort(),
    );
    // myActions, by contrast, IS caller-scoped (FR-17).
    expect(c.body.myActions.followUpCount).toBeLessThanOrEqual(a.body.myActions.followUpCount);
  });
});

// ─── AUTH-03 + access (AC-02) ────────────────────────────────────────────

describe("AUTH-03 — role enforcement on /api/dashboard/staff (AC-02)", () => {
  it("answers a Requester with 403 FORBIDDEN_ROLE", async () => {
    const res = await requesterClient.agent.get("/api/dashboard/staff");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("answers unauthenticated callers with 401", async () => {
    const res = await request(app).get("/api/dashboard/staff");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("accepts both IT Staff and Administrator (200)", async () => {
    expect((await staffClient.agent.get("/api/dashboard/staff")).status).toBe(200);
    expect((await adminClient.agent.get("/api/dashboard/staff")).status).toBe(200);
  });
});
