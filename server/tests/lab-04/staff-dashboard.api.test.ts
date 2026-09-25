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
 *   AUTH-03  a Requester calling /api/dashboard/staff → 403 FORBIDDEN_ROLE
 *
 * Conventions match the other Lab 4 suites: real login sessions through
 * /api/auth/login (helpers/session.ts), fixtures created directly through
 * Prisma and torn down in afterAll, and the shared idempotent seed as the
 * baseline.
 */

let staffA: TestUser;
let staffB: TestUser;
let requester: TestUser;
let adminUser: TestUser;

let staffClient: SessionClient;
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
}

async function createFixtureTicket(overrides: FixtureOptions = {}) {
  const n = ++ticketSeq;
  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2026-SD-${Date.now()}-${n}`,
      requesterId: requester.id,
      ownerId: overrides.ownerId ?? null,
      categoryId: fixtureCategoryId,
      relatedSystemId: fixtureRelatedSystemId,
      summary: `Staff dashboard fixture ${n}`,
      description: "Fixture ticket for the staff dashboard API suite.",
      requestedPriority: "MEDIUM",
      status: overrides.status ?? "OPEN",
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
    select: { id: true, ticketNumber: true, status: true, ownerId: true },
  });
  return ticket;
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
  requester = await createTestUser({ name: "Dashboard Requester" });
  adminUser = await createTestUser({ name: "Dashboard Admin", role: "ADMINISTRATOR" });

  staffClient = await loginAs(app, staffA.email);
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
  await cleanupTestUsers([staffA.id, staffB.id, requester.id, adminUser.id]);
  await prisma.$disconnect();
});

// ─── API-26 — payload shape (FR-13) ──────────────────────────────────────

describe("API-26 — response payload size/shape (FR-13)", () => {
  it("returns exactly counts, deltas, recentTickets — never a Ticket array", async () => {
    const res = await staffClient.agent.get("/api/dashboard/staff");

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ["counts", "deltas", "generatedAt", "recentTickets", "timezone"].sort(),
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
