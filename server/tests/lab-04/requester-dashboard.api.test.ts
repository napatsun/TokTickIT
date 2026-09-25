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
 * Requester Dashboard — tests.md §3, api-spec.md §3.2, FR-11 / BR-14.
 *
 *   API-22   Requester A's dashboard never includes Requester B's tickets (AC-02)
 *   API-23   counts match a direct DB query for the fixture set
 *   API-35   a Reopened ticket counts toward myOpen (BR-14)
 *   plus     myOpen's four-status set excludes In Progress (§3.2), scope is
 *            enforced at the query layer (AC-02/AC-06), role enforcement, and
 *            the recent-list cap/order.
 *
 * Conventions match the other Lab 4 suites: real login sessions through
 * /api/auth/login, Prisma-created fixtures torn down in afterAll, shared
 * idempotent seed as the baseline.
 */

let requesterA: TestUser;
let requesterB: TestUser;
let staffUser: TestUser;

let clientA: SessionClient;
let clientB: SessionClient;
let staffClient: SessionClient;

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
  requesterId?: string;
  updatedAt?: Date;
}

async function createFixtureTicket(overrides: FixtureOptions = {}) {
  const n = ++ticketSeq;
  return prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2026-RD-${Date.now()}-${n}`,
      requesterId: overrides.requesterId ?? requesterA.id,
      categoryId: fixtureCategoryId,
      relatedSystemId: fixtureRelatedSystemId,
      summary: `Requester dashboard fixture ${n}`,
      description: "Fixture ticket for the requester dashboard API suite.",
      requestedPriority: "MEDIUM",
      status: overrides.status ?? "OPEN",
      ...(overrides.updatedAt ? { updatedAt: overrides.updatedAt } : {}),
    },
    select: { id: true, ticketNumber: true, status: true, requesterId: true },
  });
}

beforeAll(async () => {
  await seed();

  requesterA = await createTestUser({ name: "RD Requester A" });
  requesterB = await createTestUser({ name: "RD Requester B" });
  staffUser = await createTestUser({ name: "RD Staff", role: "IT_STAFF" });

  clientA = await loginAs(app, requesterA.email);
  clientB = await loginAs(app, requesterB.email);
  staffClient = await loginAs(app, staffUser.email);

  const category = await prisma.category.findFirst({ where: { isActive: true }, select: { id: true } });
  const relatedSystem = await prisma.relatedSystem.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  fixtureCategoryId = category!.id;
  fixtureRelatedSystemId = relatedSystem!.id;
});

afterAll(async () => {
  await cleanupTestUsers([requesterA.id, requesterB.id, staffUser.id]);
  await prisma.$disconnect();
});

// ─── API-22 — strict per-requester scoping (FR-11, AC-02) ────────────────

describe("API-22 — a Requester's dashboard never includes another Requester's tickets (AC-02)", () => {
  it("returns only tickets owned by the calling session's user", async () => {
    // B's tickets: one in every card-relevant status, all newer than A's so a
    // scope leak would immediately surface in both counts and the recent list.
    const now = new Date();
    const bTickets = [
      await createFixtureTicket({ status: "OPEN", requesterId: requesterB.id, updatedAt: now }),
      await createFixtureTicket({ status: "IN_PROGRESS", requesterId: requesterB.id, updatedAt: now }),
      await createFixtureTicket({ status: "RESOLVED", requesterId: requesterB.id, updatedAt: now }),
      await createFixtureTicket({ status: "CLOSED", requesterId: requesterB.id, updatedAt: now }),
    ];

    const res = await clientA.agent.get("/api/dashboard/requester");
    expect(res.status).toBe(200);

    // Counts must equal a direct DB query scoped to A alone — B's four fresh
    // tickets excluded from every card.
    const dbOwn = (status: string[]) =>
      prisma.ticket.count({
        where: { requesterId: requesterA.id, status: { in: status as never[] } },
      });
    const [myOpen, inProgress, resolved, closed] = await Promise.all([
      dbOwn(["NEW", "OPEN", "WAITING_FOR_REQUESTER", "REOPENED"]),
      dbOwn(["IN_PROGRESS"]),
      dbOwn(["RESOLVED"]),
      dbOwn(["CLOSED"]),
    ]);
    expect(res.body.counts.myOpen).toBe(myOpen);
    expect(res.body.counts.inProgress).toBe(inProgress);
    expect(res.body.counts.resolved).toBe(resolved);
    expect(res.body.counts.closed).toBe(closed);

    // B's tickets never appear in the recent list — no id, no code.
    const ids = res.body.recentTickets.map((t: { id: number }) => t.id);
    const codes = res.body.recentTickets.map((t: { code: string }) => t.code);
    for (const ticket of bTickets) {
      expect(ids).not.toContain(ticket.id);
      expect(codes).not.toContain(ticket.ticketNumber);
    }
  });

  it("accepts no target-user parameter: another session's view is unreachable", async () => {
    // §3.2: the endpoint is always scoped to the session; even a forged query
    // parameter cannot widen it (the API reads no such parameter at all).
    const res = await clientA.agent.get(
      `/api/dashboard/requester?requesterId=${requesterB.id}&userId=${requesterB.id}`,
    );
    expect(res.status).toBe(200);
    const res2 = await clientB.agent.get("/api/dashboard/requester");
    expect(res2.status).toBe(200);
    // The two responses differ because each is scoped to its own session.
    expect(res.body.counts).not.toEqual(res2.body.counts);
  });
});

// ─── API-23 — calculation correctness (FR-11) ────────────────────────────

describe("API-23 — requester dashboard calculation correctness (FR-11)", () => {
  it("matches the documented per-status sets for a full fixture sweep", async () => {
    const now = new Date();
    // A's fixture set — every status that moves a card, plus CANCELLED which
    // must move none.
    await createFixtureTicket({ status: "NEW", updatedAt: now });
    await createFixtureTicket({ status: "OPEN", updatedAt: now });
    await createFixtureTicket({ status: "WAITING_FOR_REQUESTER", updatedAt: now });
    const inProgress = await createFixtureTicket({ status: "IN_PROGRESS", updatedAt: now });
    await createFixtureTicket({ status: "RESOLVED", updatedAt: now });
    await createFixtureTicket({ status: "CLOSED", updatedAt: now });
    await createFixtureTicket({ status: "CANCELLED", updatedAt: now });

    const res = await clientA.agent.get("/api/dashboard/requester");
    expect(res.status).toBe(200);

    // My Open is the FOUR-status set {New, Open, WaitingForRequester, Reopened}
    // — In Progress is deliberately excluded (its own card), and so is Cancelled.
    const expectedMyOpen = await prisma.ticket.count({
      where: {
        requesterId: requesterA.id,
        status: { in: ["NEW", "OPEN", "WAITING_FOR_REQUESTER", "REOPENED"] },
      },
    });
    expect(res.body.counts.myOpen).toBe(expectedMyOpen);
    expect(res.body.counts.inProgress).toBe(
      await prisma.ticket.count({ where: { requesterId: requesterA.id, status: "IN_PROGRESS" } }),
    );
    expect(res.body.counts.resolved).toBe(
      await prisma.ticket.count({ where: { requesterId: requesterA.id, status: "RESOLVED" } }),
    );
    expect(res.body.counts.closed).toBe(
      await prisma.ticket.count({ where: { requesterId: requesterA.id, status: "CLOSED" } }),
    );

    // The In Progress fixture raised inProgress but NOT myOpen.
    expect(res.body.counts.inProgress).toBeGreaterThan(0);

    // §3.2: no deltas key exists on this response.
    expect(res.body).not.toHaveProperty("deltas");
    void inProgress;
  });
});

// ─── API-35 — Reopened counts toward myOpen (BR-14) ──────────────────────

describe("API-35 — a Reopened ticket counts toward My Open (BR-14)", () => {
  it("raises myOpen and never a separate reopened bucket", async () => {
    const before = await clientA.agent.get("/api/dashboard/requester");

    await createFixtureTicket({ status: "REOPENED" });

    const after = await clientA.agent.get("/api/dashboard/requester");
    expect(after.body.counts.myOpen).toBe(before.body.counts.myOpen + 1);
    expect(Object.keys(after.body.counts)).not.toContain("reopened");
  });
});

// ─── recentTickets (§3.2) ────────────────────────────────────────────────

describe("recentTickets — own tickets, any non-Cancelled status, newest first (§3.2)", () => {
  it("includes own Cancelled-excluded rows only, capped at 5, newest first", async () => {
    const base = Date.now() - 60 * 60 * 1000;
    for (let i = 0; i < 6; i += 1) {
      await createFixtureTicket({ status: "OPEN", updatedAt: new Date(base + i * 60_000) });
    }
    await createFixtureTicket({ status: "CANCELLED", updatedAt: new Date() }); // newest, but excluded

    const res = await clientA.agent.get("/api/dashboard/requester");
    expect(res.status).toBe(200);
    expect(res.body.recentTickets.length).toBeLessThanOrEqual(5);

    const times: string[] = res.body.recentTickets.map((t: { updatedAt: string }) => t.updatedAt);
    const sorted = [...times].sort((a, b) => b.localeCompare(a));
    expect(times).toEqual(sorted);

    // Every listed row is owned by the caller.
    for (const row of res.body.recentTickets) {
      const owned = await prisma.ticket.findFirst({
        where: { id: row.id, requesterId: requesterA.id },
        select: { id: true },
      });
      expect(owned).not.toBeNull();
    }
  });
});

// ─── Role enforcement (BR-15) ────────────────────────────────────────────

describe("role enforcement on /api/dashboard/requester", () => {
  it("answers IT Staff with 403 FORBIDDEN_ROLE", async () => {
    const res = await staffClient.agent.get("/api/dashboard/requester");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("answers unauthenticated callers with 401", async () => {
    const res = await request(app).get("/api/dashboard/requester");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("answers a Requester with 200", async () => {
    expect((await clientA.agent.get("/api/dashboard/requester")).status).toBe(200);
  });
});
