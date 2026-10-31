import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";
import { TICKET_STATUSES, type TicketStatusValue } from "../../src/lib/statusTransitions.js";
import { REOPEN_WINDOW_DAYS } from "../../src/lib/ticketWorkflow.js";
import {
  createTestUser,
  loginAs,
  cleanupTestUsers,
  csrf,
  type SessionClient,
  type TestUser,
} from "../helpers/session.js";

const prisma = getPrisma();

/**
 * Ticket Workflow & Resolution — tests.md §2, api-spec.md §2,
 * specification.md §5/§5.1, BR-07 … BR-10, BR-12, FR-07 … FR-09, FR-16.
 *
 *   API-15   resolve with zero Actions Taken                → 409 ACTIONS_REQUIRED
 *   API-16   resolve with ≥1 Actions Taken (result set)     → 200, RESOLVED, resolvedAt
 *   API-17   stale `version` on a second writer             → 409 STALE_VERSION + currentState
 *   API-18   owning Requester reopens 10 days after resolve → 403 REOPEN_WINDOW_EXPIRED
 *   API-19   owning Requester reopens 2 days after resolve  → 200, REOPENED
 *   API-20   IT Staff reopens at any time                   → 200, regardless of window
 *   API-21   Requester "looks resolved" acknowledgement     → 200, flag set, status unchanged
 *   API-21b  confirmation then a status change with the pre-confirmation version → 200
 *   API-32   replayed Idempotency-Key on PATCH /status      → one transition, identical 200
 *   API-33   a successful transition writes one history row → row matches
 *   AUTH-01  Requester attempts RESOLVED on their own Ticket → 403 FORBIDDEN_ROLE
 *   WORKFLOW-01 the exhaustive §5.1 (fromStatus × role × targetStatus) sweep
 *
 * WORKFLOW-01 asserts TWO distinct rejection reasons, never collapsed into one:
 *   (a) a blank §5.1 cell           → 409 INVALID_STATUS_TRANSITION for every role
 *   (b) a reachable cell, wrong role → 403 FORBIDDEN_ROLE
 * The expected role map below is transcribed from §5.1 by hand (it does not
 * import the implementation's matrix), so a bug in the matrix cannot pass its
 * own test.
 */

let requesterA: TestUser;
let requesterB: TestUser;
let staffA: TestUser;
let adminUser: TestUser;

let clientA: SessionClient;
let clientB: SessionClient;
let staffClient: SessionClient;
let adminClient: SessionClient;

let fixtureCategoryId: number;
let fixtureRelatedSystemId: number;
let ticketSeq = 0;

const MISSING_TICKET_ID = 9_999_999;

const DAY_MS = 24 * 60 * 60 * 1000;

async function createTicket(overrides: {
  status?: TicketStatusValue;
  requesterId?: string;
  ownerId?: string | null;
  resolvedAt?: Date | null;
  withResolvableAction?: boolean;
}): Promise<{ id: number; ticketNumber: string; version: number; status: TicketStatusValue }> {
  const n = ++ticketSeq;
  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2026-WF-${Date.now()}-${n}`,
      requesterId: overrides.requesterId ?? requesterA.id,
      ownerId: overrides.ownerId ?? null,
      categoryId: fixtureCategoryId,
      relatedSystemId: fixtureRelatedSystemId,
      summary: `Workflow fixture ${n}`,
      description: "Fixture ticket for the Lab 4 ticket workflow API suite.",
      requestedPriority: "MEDIUM",
      status: overrides.status ?? "IN_PROGRESS",
      resolvedAt: overrides.resolvedAt ?? null,
    },
    select: { id: true, ticketNumber: true, version: true, status: true },
  });

  if (overrides.withResolvableAction) {
    await prisma.actionTaken.create({
      data: {
        ticketId: ticket.id,
        actionDateTime: new Date(),
        description: "Seeded action that satisfies BR-09's resolution gate.",
        result: "Work completed and verified.",
        performedById: staffA.id,
      },
    });
  }

  return ticket;
}

function patchStatus(
  client: SessionClient,
  ticketId: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  const req = csrf(client, client.agent.patch(`/api/tickets/${ticketId}/status`)).send(body);
  return Object.keys(headers).length > 0 ? req.set(headers) : req;
}

function confirmRequester(client: SessionClient, ticketId: number) {
  return csrf(client, client.agent.post(`/api/tickets/${ticketId}/requester-confirmation`));
}

async function storedStatus(ticketId: number) {
  return prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { status: true, version: true, resolvedAt: true, requesterConfirmedResolved: true },
  });
}

beforeAll(async () => {
  await seed();

  requesterA = await createTestUser({ name: "Workflow Requester A" });
  requesterB = await createTestUser({ name: "Workflow Requester B" });
  staffA = await createTestUser({ name: "Workflow Staff", role: "IT_STAFF" });
  adminUser = await createTestUser({ name: "Workflow Admin", role: "ADMINISTRATOR" });

  clientA = await loginAs(app, requesterA.email);
  clientB = await loginAs(app, requesterB.email);
  staffClient = await loginAs(app, staffA.email);
  adminClient = await loginAs(app, adminUser.email);

  const category = await prisma.category.findFirst({ where: { isActive: true }, select: { id: true } });
  const relatedSystem = await prisma.relatedSystem.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  expect(category).toBeDefined();
  expect(relatedSystem).toBeDefined();
  fixtureCategoryId = category!.id;
  fixtureRelatedSystemId = relatedSystem!.id;
});

afterAll(async () => {
  await cleanupTestUsers([requesterA.id, requesterB.id, staffA.id, adminUser.id]);
  await prisma.$disconnect();
});

// ─── API-15 / API-16 — the BR-09 resolution gate ─────────────────────────

describe("API-15 — resolve attempt with zero Actions Taken (BR-09, AC-04)", () => {
  it("returns 409 ACTIONS_REQUIRED and does not change status, version, or history", async () => {
    const ticket = await createTicket({ status: "IN_PROGRESS" });

    const res = await patchStatus(staffClient, ticket.id, {
      targetStatus: "RESOLVED",
      version: ticket.version,
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ACTIONS_REQUIRED");

    const stored = await storedStatus(ticket.id);
    expect(stored?.status).toBe("IN_PROGRESS");
    expect(stored?.version).toBe(0);
    expect(stored?.resolvedAt).toBeNull();
    expect(await prisma.ticketStatusHistory.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it("ignores voided entries and empty results when deciding the gate", async () => {
    const ticket = await createTicket({ status: "IN_PROGRESS" });
    const performed = staffA.id;

    // A voided entry with a result must not satisfy BR-09.
    await prisma.actionTaken.create({
      data: {
        ticketId: ticket.id,
        actionDateTime: new Date(),
        description: "Voided work log entry.",
        result: "This result must not count.",
        performedById: performed,
        isVoided: true,
        voidReason: "Voided for the BR-09 gate test.",
      },
    });

    const blocked = await patchStatus(staffClient, ticket.id, {
      targetStatus: "RESOLVED",
      version: ticket.version,
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("ACTIONS_REQUIRED");

    // Adding one live entry with a result satisfies it.
    await prisma.actionTaken.create({
      data: {
        ticketId: ticket.id,
        actionDateTime: new Date(),
        description: "Live work log entry.",
        result: "Verified fix in place.",
        performedById: performed,
      },
    });

    const allowed = await patchStatus(staffClient, ticket.id, {
      targetStatus: "RESOLVED",
      version: ticket.version,
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body.ticket.status).toBe("RESOLVED");
  });
});

describe("API-16 — resolve with ≥1 Actions Taken (BR-09, AC-03)", () => {
  it("returns 200 with status RESOLVED, resolvedAt set, and version incremented", async () => {
    const ticket = await createTicket({ status: "IN_PROGRESS", withResolvableAction: true });

    const res = await patchStatus(staffClient, ticket.id, {
      targetStatus: "RESOLVED",
      version: ticket.version,
    });

    expect(res.status).toBe(200);
    expect(res.body.ticket.status).toBe("RESOLVED");
    expect(res.body.ticket.version).toBe(ticket.version + 1);
    expect(typeof res.body.ticket.resolvedAt).toBe("string");

    const stored = await storedStatus(ticket.id);
    expect(stored?.status).toBe("RESOLVED");
    expect(stored?.version).toBe(1);
    expect(stored?.resolvedAt).not.toBeNull();
  });

  it("is also permitted from WAITING_FOR_REQUESTER (BR-09's other source status)", async () => {
    const ticket = await createTicket({
      status: "WAITING_FOR_REQUESTER",
      withResolvableAction: true,
    });

    const res = await patchStatus(adminClient, ticket.id, {
      targetStatus: "RESOLVED",
      version: ticket.version,
    });

    expect(res.status).toBe(200);
    expect(res.body.ticket.status).toBe("RESOLVED");
  });
});

// ─── AUTH-01 — the transition a Requester is most likely to attempt ──────

describe("AUTH-01 — a Requester cannot resolve their own Ticket (BR-15)", () => {
  it("returns 403 FORBIDDEN_ROLE even with the Actions Taken gate satisfied", async () => {
    const ticket = await createTicket({
      status: "IN_PROGRESS",
      requesterId: requesterA.id,
      withResolvableAction: true,
    });

    const res = await patchStatus(clientA, ticket.id, {
      targetStatus: "RESOLVED",
      version: ticket.version,
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_ROLE");

    const stored = await storedStatus(ticket.id);
    expect(stored?.status).toBe("IN_PROGRESS");
  });
});

// ─── API-17 — optimistic concurrency (BR-12, FR-16, AC-08) ──────────────

describe("API-17 — concurrent status change with a stale version (BR-12, AC-08)", () => {
  it("lets the first writer win and rejects the second with 409 STALE_VERSION + currentState", async () => {
    const ticket = await createTicket({ status: "IN_PROGRESS", withResolvableAction: true });

    const first = await patchStatus(staffClient, ticket.id, {
      targetStatus: "RESOLVED",
      version: ticket.version,
    });
    expect(first.status).toBe(200);
    expect(first.body.ticket.version).toBe(1);

    // The second writer still holds version 0.
    const second = await patchStatus(adminClient, ticket.id, {
      targetStatus: "RESOLVED",
      version: ticket.version,
    });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("STALE_VERSION");
    expect(second.body.currentState).toMatchObject({
      id: ticket.id,
      status: "RESOLVED",
      version: 1,
    });

    // One transition happened, not two.
    expect(await prisma.ticketStatusHistory.count({ where: { ticketId: ticket.id } })).toBe(1);
    const stored = await storedStatus(ticket.id);
    expect(stored?.version).toBe(1);
  });

  it("rejects a missing or malformed version with 422 (distinct from a mismatch)", async () => {
    const ticket = await createTicket({ status: "OPEN" });

    const missing = await patchStatus(staffClient, ticket.id, { targetStatus: "IN_PROGRESS" });
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe("VALIDATION_ERROR");
    expect(missing.body.error.fieldErrors).toHaveProperty("version");

    const malformed = await patchStatus(staffClient, ticket.id, {
      targetStatus: "IN_PROGRESS",
      version: "not-a-number",
    });
    expect(malformed.status).toBe(422);
    expect(malformed.body.error.fieldErrors).toHaveProperty("version");
  });
});

// ─── API-18 / API-19 / API-20 — BR-10 reopen window ──────────────────────

describe("API-18 — owning Requester reopens 10 days after resolve (BR-10, AC-09)", () => {
  it("returns 403 REOPEN_WINDOW_EXPIRED and leaves the Ticket RESOLVED", async () => {
    const ticket = await createTicket({
      status: "RESOLVED",
      requesterId: requesterA.id,
      resolvedAt: new Date(Date.now() - 10 * DAY_MS),
    });

    const res = await patchStatus(clientA, ticket.id, {
      targetStatus: "REOPENED",
      version: ticket.version,
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("REOPEN_WINDOW_EXPIRED");

    const stored = await storedStatus(ticket.id);
    expect(stored?.status).toBe("RESOLVED");
  });
});

describe("API-19 — owning Requester reopens 2 days after resolve (BR-10)", () => {
  it("returns 200 and moves the Ticket to REOPENED", async () => {
    const ticket = await createTicket({
      status: "RESOLVED",
      requesterId: requesterA.id,
      resolvedAt: new Date(Date.now() - 2 * DAY_MS),
    });

    const res = await patchStatus(clientA, ticket.id, {
      targetStatus: "REOPENED",
      version: ticket.version,
    });

    expect(res.status).toBe(200);
    expect(res.body.ticket.status).toBe("REOPENED");

    const stored = await storedStatus(ticket.id);
    expect(stored?.status).toBe("REOPENED");
  });

  it("uses the documented REOPEN_WINDOW_DAYS boundary (just inside vs just outside)", async () => {
    const inside = await createTicket({
      status: "RESOLVED",
      requesterId: requesterA.id,
      resolvedAt: new Date(Date.now() - (REOPEN_WINDOW_DAYS * DAY_MS - 60 * 60 * 1000)),
    });
    const outside = await createTicket({
      status: "RESOLVED",
      requesterId: requesterA.id,
      resolvedAt: new Date(Date.now() - (REOPEN_WINDOW_DAYS * DAY_MS + 60 * 60 * 1000)),
    });

    expect((await patchStatus(clientA, inside.id, { targetStatus: "REOPENED", version: 0 })).status).toBe(200);
    expect((await patchStatus(clientA, outside.id, { targetStatus: "REOPENED", version: 0 })).status).toBe(403);
  });
});

describe("API-20 — IT Staff reopens at any time (BR-10)", () => {
  it("returns 200 well outside the Requester window", async () => {
    const ticket = await createTicket({
      status: "RESOLVED",
      resolvedAt: new Date(Date.now() - 60 * DAY_MS),
    });

    const res = await patchStatus(staffClient, ticket.id, {
      targetStatus: "REOPENED",
      version: ticket.version,
    });

    expect(res.status).toBe(200);
    expect(res.body.ticket.status).toBe("REOPENED");
  });

  it("also lets an Administrator reopen a CLOSED ticket outside the window", async () => {
    const ticket = await createTicket({
      status: "CLOSED",
      resolvedAt: new Date(Date.now() - 60 * DAY_MS),
    });

    const res = await patchStatus(adminClient, ticket.id, {
      targetStatus: "REOPENED",
      version: ticket.version,
    });

    expect(res.status).toBe(200);
    expect(res.body.ticket.status).toBe("REOPENED");
  });
});

// ─── API-21 / API-21b — requester confirmation (FR-08, BR-08) ────────────

describe("API-21 — Requester submits 'looks resolved' (FR-08, BR-08, AC-05)", () => {
  it("sets the flag + timestamp and never changes status or version", async () => {
    const ticket = await createTicket({ status: "OPEN", requesterId: requesterA.id });

    const res = await confirmRequester(clientA, ticket.id);

    expect(res.status).toBe(200);
    expect(res.body.requesterConfirmedResolved).toBe(true);
    expect(typeof res.body.requesterConfirmedResolvedAt).toBe("string");
    expect(new Date(res.body.requesterConfirmedResolvedAt).toISOString()).toBe(
      res.body.requesterConfirmedResolvedAt,
    );

    const stored = await storedStatus(ticket.id);
    expect(stored?.requesterConfirmedResolved).toBe(true);
    // BR-08: advisory only.
    expect(stored?.status).toBe("OPEN");
    expect(stored?.version).toBe(0);
  });

  it("returns 403 NOT_TICKET_OWNER for a different Requester and for IT Staff", async () => {
    const ticket = await createTicket({ status: "OPEN", requesterId: requesterA.id });

    const otherRequester = await confirmRequester(clientB, ticket.id);
    expect(otherRequester.status).toBe(403);
    expect(otherRequester.body.error.code).toBe("NOT_TICKET_OWNER");

    const staff = await confirmRequester(staffClient, ticket.id);
    expect(staff.status).toBe(403);
    expect(staff.body.error.code).toBe("NOT_TICKET_OWNER");

    const stored = await storedStatus(ticket.id);
    expect(stored?.requesterConfirmedResolved).toBe(false);
  });

  it("returns 404 for a non-existent Ticket", async () => {
    const res = await confirmRequester(clientA, MISSING_TICKET_ID);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
  });
});

describe("API-21b — confirmation never blocks a following status transition (§7.2)", () => {
  it("lets IT Staff transition with the pre-confirmation version", async () => {
    const ticket = await createTicket({ status: "OPEN", requesterId: requesterA.id });

    const confirmed = await confirmRequester(clientA, ticket.id);
    expect(confirmed.status).toBe(200);

    // Same version the Requester already had before confirming — the two writes
    // touch different columns, so there is no conflict.
    const transition = await patchStatus(staffClient, ticket.id, {
      targetStatus: "IN_PROGRESS",
      version: ticket.version,
    });

    expect(transition.status).toBe(200);
    expect(transition.body.ticket.status).toBe("IN_PROGRESS");
    expect(transition.body.ticket.version).toBe(1);
  });
});

// ─── API-32 — idempotent status transitions (FR-15, AC-14) ───────────────

describe("API-32 — a replayed Idempotency-Key transitions exactly once (AC-14)", () => {
  it("returns the identical 200 body twice and records a single transition", async () => {
    const ticket = await createTicket({ status: "IN_PROGRESS", withResolvableAction: true });
    const key = `api32-${Date.now()}-${Math.random()}`;
    const body = { targetStatus: "RESOLVED", version: ticket.version };

    const first = await patchStatus(staffClient, ticket.id, body, { "Idempotency-Key": key });
    const second = await patchStatus(staffClient, ticket.id, body, { "Idempotency-Key": key });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);

    const stored = await storedStatus(ticket.id);
    expect(stored?.version).toBe(1); // exactly one increment
    expect(await prisma.ticketStatusHistory.count({ where: { ticketId: ticket.id } })).toBe(1);
  });
});

// ─── API-33 — the §7.3 audit row ────────────────────────────────────────

describe("API-33 — a successful transition writes exactly one TicketStatusHistory row (§7.3)", () => {
  it("records the correct fromStatus/toStatus/changedById and the optional note", async () => {
    const ticket = await createTicket({ status: "OPEN" });
    await prisma.ticketStatusHistory.deleteMany({ where: { ticketId: ticket.id } });

    const res = await patchStatus(staffClient, ticket.id, {
      targetStatus: "IN_PROGRESS",
      version: ticket.version,
      note: "Started work on the reported issue.",
    });
    expect(res.status).toBe(200);

    const rows = await prisma.ticketStatusHistory.findMany({ where: { ticketId: ticket.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ticketId: ticket.id,
      fromStatus: "OPEN",
      toStatus: "IN_PROGRESS",
      changedById: staffA.id,
      note: "Started work on the reported issue.",
    });
  });
});

// ─── WORKFLOW-01 — the exhaustive §5.1 sweep ────────────────────────────

type RoleKey = "requester" | "staff" | "admin";

/**
 * specification.md §5.1 transcribed by hand: for each (fromStatus → targetStatus)
 * cell that is reachable at all, which roles may make it. A cell absent from
 * both maps is a `—` (blank) cell.
 */
const EXPECTED_PERMITTED: Record<string, Partial<Record<string, RoleKey[]>>> = {
  NEW: {
    OPEN: ["staff", "admin"],
    IN_PROGRESS: ["staff", "admin"],
    CANCELLED: ["staff", "admin", "requester"],
  },
  OPEN: {
    IN_PROGRESS: ["staff", "admin"],
    WAITING_FOR_REQUESTER: ["staff", "admin"],
    CANCELLED: ["staff", "admin", "requester"],
  },
  IN_PROGRESS: {
    WAITING_FOR_REQUESTER: ["staff", "admin"],
    RESOLVED: ["staff", "admin"],
    CANCELLED: ["staff", "admin"],
  },
  WAITING_FOR_REQUESTER: {
    IN_PROGRESS: ["staff", "admin"],
    RESOLVED: ["staff", "admin"],
    CANCELLED: ["staff", "admin"],
  },
  RESOLVED: {
    CLOSED: ["staff", "admin"],
    REOPENED: ["staff", "admin", "requester"],
  },
  CLOSED: {
    REOPENED: ["staff", "admin", "requester"],
  },
  REOPENED: {
    IN_PROGRESS: ["staff", "admin"],
    WAITING_FOR_REQUESTER: ["staff", "admin"],
    CANCELLED: ["staff", "admin"],
  },
  CANCELLED: {},
};

describe("WORKFLOW-01 — exhaustive §5.1 (fromStatus × role × targetStatus) sweep", () => {
  it("permits every listed role and rejects every other combination with the right reason", async () => {
    const combos = TICKET_STATUSES.flatMap((from) =>
      TICKET_STATUSES.flatMap((to) => (["requester", "staff", "admin"] as RoleKey[]).map((role) => ({ from, to, role }))),
    );

    // Guard the fixture: 8 statuses × 8 targets × 3 roles.
    expect(combos).toHaveLength(8 * 8 * 3);

    let permitted = 0;
    let roleRejected = 0;
    let blankCell = 0;

    for (const { from, to, role } of combos) {
      const allowedRoles = EXPECTED_PERMITTED[from]?.[to] ?? [];

      // A fresh Ticket per attempt, so a permitted transition can't leak state
      // into the next one. A resolve target needs BR-09 satisfied; a Requester
      // reopen needs a recent resolvedAt.
      const ticket = await createTicket({
        status: from,
        requesterId: requesterA.id,
        withResolvableAction: to === "RESOLVED",
        resolvedAt: to === "REOPENED" ? new Date(Date.now() - 1 * DAY_MS) : null,
      });

      const client = role === "requester" ? clientA : role === "staff" ? staffClient : adminClient;
      const res = await patchStatus(client, ticket.id, {
        targetStatus: to,
        version: ticket.version,
      });

      const label = `${from} → ${to} as ${role}`;

      if (allowedRoles.length === 0) {
        // Case (a): the cell is `—`; every role gets the matrix rejection.
        expect(res.status, label).toBe(409);
        expect(res.body.error.code, label).toBe("INVALID_STATUS_TRANSITION");
        blankCell += 1;
      } else if (allowedRoles.includes(role)) {
        expect(res.status, label).toBe(200);
        expect(res.body.ticket.status, label).toBe(to);
        permitted += 1;
      } else {
        // Case (b): reachable cell, but this role is not listed → role mismatch.
        expect(res.status, label).toBe(403);
        expect(res.body.error.code, label).toBe("FORBIDDEN_ROLE");
        roleRejected += 1;
      }
    }

    // §5.1 has 18 reachable cells; with 3 roles each that is 54 "reachable cell"
    // attempts, of which the Requester is a listed role for exactly 4 cells.
    expect(permitted).toBe(18 * 2 + 4); // staff + admin for all 18, plus requester for 4
    expect(roleRejected).toBe(18 * 3 - (18 * 2 + 4)); // the remaining reachable-cell attempts
    expect(blankCell).toBe((64 - 18) * 3); // the 46 blank cells × 3 roles
  });
});

// ─── Cross-cutting: auth + access ───────────────────────────────────────

describe("workflow routes — authentication and access (BR-15)", () => {
  it("returns 401 without a session for both endpoints", async () => {
    const statusRes = await request(app)
      .patch(`/api/tickets/${MISSING_TICKET_ID}/status`)
      .send({ targetStatus: "OPEN", version: 0 });
    expect(statusRes.status).toBe(401);

    const confirmRes = await request(app).post(
      `/api/tickets/${MISSING_TICKET_ID}/requester-confirmation`,
    );
    expect(confirmRes.status).toBe(401);
  });

  it("gives a Requester acting on someone else's Ticket 403 FORBIDDEN_TICKET_ACCESS", async () => {
    const ticket = await createTicket({ status: "NEW", requesterId: requesterB.id });

    const res = await patchStatus(clientA, ticket.id, {
      targetStatus: "CANCELLED",
      version: ticket.version,
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_TICKET_ACCESS");
  });

  it("returns 404 TICKET_NOT_FOUND for a Ticket that does not exist", async () => {
    const res = await patchStatus(staffClient, MISSING_TICKET_ID, {
      targetStatus: "OPEN",
      version: 0,
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
  });
});
