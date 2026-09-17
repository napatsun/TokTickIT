import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";
import {
  TICKET_STATUSES,
  allowedStatusTransitions,
  isTransitionAllowed,
} from "../../src/lib/statusTransitions.js";
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
 * Ticket operations — tests.md §3 (Requester) and §5 (IT Staff)
 *
 * Requester-side (feature/lab3-03-requester-regression):
 *   API-12  "Problem Appears Resolved" (FR-15, AC-11, BR-05, BR-20)
 *   API-13  a Requester cannot change Ticket status directly (BR-05)
 *
 * IT Staff side (feature/lab3-04-staff-ticketing), added below in its own
 * describe blocks so the Requester tests above are extended, never overwritten:
 *   API-20  claim an unassigned ticket            (AC-07, BR-12, BR-13)
 *   API-21  claim an already-assigned ticket      (AC-08, BR-13)
 *   API-22  reassign to another active IT Staff   (FR-19)
 *   API-23  reassign to an inactive user or Requester (BR-12)
 *   API-24  IT Priority update, Requested Priority untouched (AC-09, BR-14/15)
 *   API-25  disallowed status transition          (AC-10, BR-19)
 *   API-26  EVERY permitted matrix transition (parameterized, BR-19)
 *           + every blocked cell in ui-spec.md §6.1
 *
 * Route convention: the staff endpoints use `:id` (internal Ticket id), not
 * the Requester-facing `:ticketNumber` (api-spec.md §3).
 */

let requesterA: TestUser;
let requesterB: TestUser;
let clientA: SessionClient;
let clientB: SessionClient;

// ─── IT Staff fixtures (feature/lab3-04-staff-ticketing) ────────────────
let staffA: TestUser;
let staffB: TestUser;
let inactiveStaff: TestUser;
let admin: TestUser;
let staffClientA: SessionClient;
let staffClientB: SessionClient;
let adminClient: SessionClient;

async function createTicket(
  requesterId: string,
  status:
    | "NEW"
    | "OPEN"
    | "IN_PROGRESS"
    | "WAITING_FOR_REQUESTER"
    | "RESOLVED"
    | "CLOSED"
    | "REOPENED"
    | "CANCELLED",
  suffix: string,
  requesterMarkedResolved = false,
) {
  const category = await prisma.category.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  const relatedSystem = await prisma.relatedSystem.findFirst({
    where: { isActive: true },
    select: { id: true },
  });

  return prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2026-RESOLVE-${suffix}-${Date.now()}`,
      requesterId,
      categoryId: category!.id,
      relatedSystemId: relatedSystem!.id,
      summary: `Resolve-mark test ticket ${suffix}`,
      description: "This ticket is used for testing the appears-resolved flow thoroughly.",
      requestedPriority: "MEDIUM",
      status,
      requesterMarkedResolved,
      requesterMarkedResolvedAt: requesterMarkedResolved ? new Date() : null,
    },
    select: { id: true, ticketNumber: true, status: true },
  });
}

beforeAll(async () => {
  await seed();
  requesterA = await createTestUser({ name: "Resolve Requester A" });
  requesterB = await createTestUser({ name: "Resolve Requester B" });
  clientA = await loginAs(app, requesterA.email);
  clientB = await loginAs(app, requesterB.email);

  // IT Staff fixtures for the API-20…API-26 half of this file.
  staffA = await createTestUser({ name: "Detail Staff A", role: "IT_STAFF" });
  staffB = await createTestUser({ name: "Detail Staff B", role: "IT_STAFF" });
  inactiveStaff = await createTestUser({
    name: "Detail Staff Inactive",
    role: "IT_STAFF",
    isActive: false,
  });
  admin = await createTestUser({ name: "Detail Admin", role: "ADMINISTRATOR" });

  staffClientA = await loginAs(app, staffA.email);
  staffClientB = await loginAs(app, staffB.email);
  adminClient = await loginAs(app, admin.email);
});

afterAll(async () => {
  await cleanupTestUsers([
    requesterA.id,
    requesterB.id,
    staffA.id,
    staffB.id,
    inactiveStaff.id,
    admin.id,
  ]);
  await prisma.$disconnect();
});

function markResolved(client: SessionClient, ticketNumber: string) {
  return csrf(client, client.agent.post(`/api/tickets/${ticketNumber}/resolve-mark`));
}

// ─── API-12 ─────────────────────────────────────────────────────────────

describe("API-12 — Requester marks a Ticket as appears-resolved", () => {
  it("returns 200 for an eligible OPEN ticket and never touches status (BR-05/BR-20)", async () => {
    const ticket = await createTicket(requesterA.id, "OPEN", "open");

    const res = await markResolved(clientA, ticket.ticketNumber);

    expect(res.status).toBe(200);
    expect(res.body.requesterMarkedResolved).toBe(true);
    expect(typeof res.body.requesterMarkedResolvedAt).toBe("string");
    expect(new Date(res.body.requesterMarkedResolvedAt).toISOString()).toBe(
      res.body.requesterMarkedResolvedAt,
    );

    const stored = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      select: { status: true, requesterMarkedResolved: true },
    });
    expect(stored?.requesterMarkedResolved).toBe(true);
    // BR-20: the formal status is unchanged — only IT Staff may change it.
    expect(stored?.status).toBe("OPEN");
  });

  it("is eligible for IN_PROGRESS and WAITING_FOR_REQUESTER tickets", async () => {
    for (const status of ["IN_PROGRESS", "WAITING_FOR_REQUESTER"] as const) {
      const ticket = await createTicket(requesterA.id, status, status.toLowerCase());

      const res = await markResolved(clientA, ticket.ticketNumber);
      expect(res.status, status).toBe(200);
      expect(res.body.requesterMarkedResolved).toBe(true);

      const stored = await prisma.ticket.findUnique({
        where: { id: ticket.id },
        select: { status: true },
      });
      expect(stored?.status).toBe(status);
    }
  });

  it("reflects the marker in the ticket detail response without changing status", async () => {
    const ticket = await createTicket(requesterA.id, "OPEN", "detail");
    await markResolved(clientA, ticket.ticketNumber);

    const res = await clientA.agent.get(`/api/tickets/${ticket.ticketNumber}`);

    expect(res.status).toBe(200);
    expect(res.body.ticket.requesterMarkedResolved).toBe(true);
    expect(res.body.ticket.requesterMarkedResolvedAt).toBeTruthy();
    expect(res.body.ticket.currentStatus).toBe("OPEN");
  });

  it("returns 409 INVALID_STATE when the ticket is already marked", async () => {
    const ticket = await createTicket(requesterA.id, "OPEN", "already", true);

    const res = await markResolved(clientA, ticket.ticketNumber);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_STATE");
  });

  it("returns 409 INVALID_STATE on a second consecutive mark", async () => {
    const ticket = await createTicket(requesterA.id, "OPEN", "twice");

    expect((await markResolved(clientA, ticket.ticketNumber)).status).toBe(200);

    const res = await markResolved(clientA, ticket.ticketNumber);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_STATE");
  });

  it("returns 409 INVALID_STATE for ineligible statuses", async () => {
    for (const status of ["NEW", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"] as const) {
      const ticket = await createTicket(requesterA.id, status, status.toLowerCase());

      const res = await markResolved(clientA, ticket.ticketNumber);
      expect(res.status, status).toBe(409);
      expect(res.body.error.code).toBe("INVALID_STATE");

      const stored = await prisma.ticket.findUnique({
        where: { id: ticket.id },
        select: { requesterMarkedResolved: true, status: true },
      });
      expect(stored?.requesterMarkedResolved).toBe(false);
      expect(stored?.status).toBe(status);
    }
  });

  it("returns 404 for another Requester's ticket (no existence leak)", async () => {
    const ticket = await createTicket(requesterA.id, "OPEN", "cross");

    const res = await markResolved(clientB, ticket.ticketNumber);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
  });

  it("returns 404 for a non-existent ticket", async () => {
    const res = await markResolved(clientA, "TKT-2026-999999-NONEXISTENT");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
  });

  it("returns 401 without a session", async () => {
    const ticket = await createTicket(requesterA.id, "OPEN", "nosession");

    const res = await request(app).post(`/api/tickets/${ticket.ticketNumber}/resolve-mark`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 403 for an IT Staff session", async () => {
    const ticket = await createTicket(requesterA.id, "OPEN", "staff");
    const staff = await createTestUser({ role: "IT_STAFF" });
    const staffClient = await loginAs(app, staff.email);

    const res = await markResolved(staffClient, ticket.ticketNumber);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");

    await cleanupTestUsers([staff.id]);
  });

  it("returns 403 PASSWORD_CHANGE_REQUIRED before the password change gate clears", async () => {
    const ticket = await createTicket(requesterA.id, "OPEN", "gate");
    const gated = await createTestUser({
      role: "REQUESTER",
      mustChangePassword: true,
    });
    const gatedClient = await loginAs(app, gated.email);

    const res = await markResolved(gatedClient, ticket.ticketNumber);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    await cleanupTestUsers([gated.id]);
  });
});

// ─── API-13 ─────────────────────────────────────────────────────────────

describe("API-13 — a Requester cannot change Ticket status (BR-05, BR-20)", () => {
  it("does not expose a Requester-facing status transition endpoint", async () => {
    const ticket = await createTicket(requesterA.id, "OPEN", "nopatch");

    const res = await csrf(
      clientA,
      clientA.agent.patch(`/api/tickets/${ticket.ticketNumber}`),
    ).send({ status: "RESOLVED" });

    expect(res.status).toBe(404);

    const stored = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      select: { status: true },
    });
    expect(stored?.status).toBe("OPEN");
  });

  it("keeps the ticket's status unchanged when a Requester posts to the staff status route", async () => {
    // The staff status endpoint itself is implemented in the next branch
    // (feature/lab3-staff-ticketing) behind requireRole(['IT_STAFF',
    // 'ADMINISTRATOR']). Until then it is simply not mounted, so a Requester
    // attempt cannot reach it at all.
    const ticket = await createTicket(requesterA.id, "OPEN", "staffroute");

    const res = await csrf(
      clientA,
      clientA.agent.patch(`/api/staff/tickets/${ticket.id}/status`),
    ).send({ status: "RESOLVED" });

    expect([403, 404]).toContain(res.status);

    const stored = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      select: { status: true },
    });
    expect(stored?.status).toBe("OPEN");
  });

  it("never lets the appears-resolved action stand in for a status change", async () => {
    const ticket = await createTicket(requesterA.id, "IN_PROGRESS", "notstatus");

    await markResolved(clientA, ticket.ticketNumber);

    const stored = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      select: { status: true, requesterMarkedResolved: true },
    });
    expect(stored?.requesterMarkedResolved).toBe(true);
    expect(stored?.status).toBe("IN_PROGRESS");
    expect(stored?.status).not.toBe("RESOLVED");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// IT Staff half — feature/lab3-04-staff-ticketing (API-20 … API-26)
// ══════════════════════════════════════════════════════════════════════════

const IT_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
type StatusValue = (typeof TICKET_STATUSES)[number];
type ItPriorityValue = (typeof IT_PRIORITIES)[number];

let staffTicketSeq = 0;

/** Create a ticket owned by requesterA with full control over staff fields. */
async function createStaffTicket(
  overrides: {
    status?: StatusValue;
    itPriority?: ItPriorityValue;
    ownerId?: string | null;
    requestedPriority?: "LOW" | "MEDIUM" | "HIGH";
  } = {},
) {
  const category = await prisma.category.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  const relatedSystem = await prisma.relatedSystem.findFirst({
    where: { isActive: true },
    select: { id: true },
  });

  const n = ++staffTicketSeq;

  return prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2026-STF-${Date.now()}-${n}`,
      requesterId: requesterA.id,
      ownerId: overrides.ownerId ?? null,
      categoryId: category!.id,
      relatedSystemId: relatedSystem!.id,
      summary: `Staff detail fixture ${n}`,
      description: "Fixture ticket for the IT Staff ticket detail API suite.",
      requestedPriority: overrides.requestedPriority ?? "MEDIUM",
      itPriority: overrides.itPriority ?? "MEDIUM",
      status: overrides.status ?? "NEW",
    },
    select: {
      id: true,
      ticketNumber: true,
      status: true,
      itPriority: true,
      ownerId: true,
      requestedPriority: true,
    },
  });
}

function getStaffDetail(client: SessionClient, id: number) {
  return client.agent.get(`/api/staff/tickets/${id}`);
}

function claim(client: SessionClient, id: number) {
  return csrf(client, client.agent.post(`/api/staff/tickets/${id}/claim`));
}

function assign(client: SessionClient, id: number, ownerId: unknown) {
  return csrf(client, client.agent.post(`/api/staff/tickets/${id}/assign`)).send({ ownerId });
}

function setItPriority(client: SessionClient, id: number, itPriority: unknown) {
  return csrf(client, client.agent.patch(`/api/staff/tickets/${id}/priority`)).send({
    itPriority,
  });
}

function setStatus(client: SessionClient, id: number, status: unknown) {
  return csrf(client, client.agent.patch(`/api/staff/tickets/${id}/status`)).send({ status });
}

async function storedTicket(id: number) {
  return prisma.ticket.findUnique({
    where: { id },
    select: { status: true, itPriority: true, requestedPriority: true, ownerId: true },
  });
}

// ─── Ticket Detail read (shared queue: no ownership restriction) ─────────

describe("GET /api/staff/tickets/:id — shared Ticket Detail", () => {
  it("returns the full staff detail projection for any ticket", async () => {
    const ticket = await createStaffTicket({ status: "OPEN", ownerId: staffA.id });

    const res = await getStaffDetail(staffClientB, ticket.id);

    expect(res.status).toBe(200);
    expect(res.body.ticket).toMatchObject({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      requester: { id: requesterA.id, name: requesterA.name, email: requesterA.email },
      owner: { id: staffA.id, name: staffA.name, email: staffA.email },
      requestedPriority: "MEDIUM",
      itPriority: "MEDIUM",
      status: "OPEN",
      requesterMarkedResolved: false,
      requesterMarkedResolvedAt: null,
    });
    expect(typeof res.body.ticket.createdAt).toBe("string");
    expect(res.body.attachments).toEqual({ active: [], removed: [] });
  });

  it("exposes the permitted next states straight from the §6.1 matrix", async () => {
    for (const status of TICKET_STATUSES) {
      const ticket = await createStaffTicket({ status });

      const res = await getStaffDetail(staffClientA, ticket.id);

      expect(res.status, status).toBe(200);
      expect(res.body.ticket.allowedStatusTransitions, status).toEqual(
        allowedStatusTransitions(status),
      );
    }
  });

  it("is readable by an Administrator as well as IT Staff", async () => {
    const ticket = await createStaffTicket();

    const res = await getStaffDetail(adminClient, ticket.id);

    expect(res.status).toBe(200);
    expect(res.body.ticket.id).toBe(ticket.id);
  });

  it("returns a generic 404 for a non-existent ticket id (API-36)", async () => {
    const res = await getStaffDetail(staffClientA, 9_999_999);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "TICKET_NOT_FOUND", message: "Ticket not found." },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:\d+/);
  });

  it("returns the same 404 body for a malformed id", async () => {
    const missing = await getStaffDetail(staffClientA, 9_999_999);
    const malformed = await staffClientA.agent.get("/api/staff/tickets/not-a-real-id");

    // Assert each response's status BEFORE comparing bodies: a bare
    // toEqual(missing.body) once masked a transient non-JSON 500 as a
    // confusing "expected { error } to deeply equal {}" body mismatch
    // (observed once on the first post-migrate-reset full run).
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({
      error: { code: "TICKET_NOT_FOUND", message: "Ticket not found." },
    });
    expect(malformed.status).toBe(404);
    expect(malformed.body).toEqual(missing.body);
  });

  it("returns 401 without a session", async () => {
    const ticket = await createStaffTicket();

    const res = await request(app).get(`/api/staff/tickets/${ticket.id}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });
});

// ─── API-20 / API-21 — Claim ────────────────────────────────────────────

describe("API-20 — claim an unassigned ticket (AC-07, BR-12, BR-13)", () => {
  it("sets ownerId to the calling IT Staff member and persists it", async () => {
    const ticket = await createStaffTicket({ ownerId: null });

    const res = await claim(staffClientA, ticket.id);

    expect(res.status).toBe(200);
    expect(res.body.ticket.owner).toMatchObject({ id: staffA.id, name: staffA.name });

    const stored = await storedTicket(ticket.id);
    expect(stored?.ownerId).toBe(staffA.id);
  });

  it("lets an Administrator claim too (shared queue)", async () => {
    const ticket = await createStaffTicket({ ownerId: null });

    const res = await claim(adminClient, ticket.id);

    expect(res.status).toBe(200);
    expect(res.body.ticket.owner.id).toBe(admin.id);
  });

  it("returns 404 for a non-existent ticket", async () => {
    const res = await claim(staffClientA, 9_999_999);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
  });

  it("returns 401 without a session", async () => {
    const ticket = await createStaffTicket({ ownerId: null });

    const res = await request(app).post(`/api/staff/tickets/${ticket.id}/claim`);

    expect(res.status).toBe(401);
  });
});

describe("API-21 — claim an already-assigned ticket (AC-08, BR-13)", () => {
  it("returns 409 ALREADY_ASSIGNED and leaves the owner untouched", async () => {
    const ticket = await createStaffTicket({ ownerId: staffB.id });

    const res = await claim(staffClientA, ticket.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_ASSIGNED");

    const stored = await storedTicket(ticket.id);
    expect(stored?.ownerId).toBe(staffB.id);
  });
});

// ─── API-22 / API-23 — Reassign ─────────────────────────────────────────

describe("API-22 — reassign to another active IT Staff (FR-19)", () => {
  it("updates ownerId from staff A to staff B", async () => {
    const ticket = await createStaffTicket({ ownerId: staffA.id });

    const res = await assign(staffClientA, ticket.id, staffB.id);

    expect(res.status).toBe(200);
    expect(res.body.ticket.owner).toMatchObject({ id: staffB.id });

    const stored = await storedTicket(ticket.id);
    expect(stored?.ownerId).toBe(staffB.id);
  });

  it("can assign an unassigned ticket without using claim", async () => {
    const ticket = await createStaffTicket({ ownerId: null });

    const res = await assign(staffClientA, ticket.id, staffB.id);

    expect(res.status).toBe(200);
    expect(res.body.ticket.owner.id).toBe(staffB.id);
  });

  it("accepts an active Administrator as the new owner (BR-12)", async () => {
    const ticket = await createStaffTicket({ ownerId: staffA.id });

    const res = await assign(staffClientB, ticket.id, admin.id);

    expect(res.status).toBe(200);
    expect(res.body.ticket.owner.id).toBe(admin.id);
  });

  it("returns 404 when the ticket does not exist", async () => {
    const res = await assign(staffClientA, 9_999_999, staffB.id);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
  });

  it("returns 404 when the target user does not exist", async () => {
    const ticket = await createStaffTicket();

    const res = await assign(staffClientA, ticket.id, "no-such-user-id");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("USER_NOT_FOUND");
  });
});

describe("API-23 — reassign to an invalid owner (BR-12)", () => {
  it("returns 422 INVALID_OWNER for an inactive IT Staff member", async () => {
    const ticket = await createStaffTicket({ ownerId: staffA.id });

    const res = await assign(staffClientA, ticket.id, inactiveStaff.id);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("INVALID_OWNER");

    const stored = await storedTicket(ticket.id);
    expect(stored?.ownerId).toBe(staffA.id);
  });

  it("returns 422 INVALID_OWNER for a Requester", async () => {
    const ticket = await createStaffTicket({ ownerId: null });

    const res = await assign(staffClientA, ticket.id, requesterB.id);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("INVALID_OWNER");

    const stored = await storedTicket(ticket.id);
    expect(stored?.ownerId).toBeNull();
  });

  it("returns 422 INVALID_OWNER when no owner is supplied", async () => {
    const ticket = await createStaffTicket({ ownerId: null });

    const res = await assign(staffClientA, ticket.id, undefined);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("INVALID_OWNER");
  });
});

// ─── API-24 — IT Priority ───────────────────────────────────────────────

describe("API-24 — update IT Priority (AC-09, BR-14, BR-15)", () => {
  it("changes itPriority and never touches requestedPriority", async () => {
    const ticket = await createStaffTicket({ itPriority: "LOW", requestedPriority: "HIGH" });

    const res = await setItPriority(staffClientA, ticket.id, "URGENT");

    expect(res.status).toBe(200);
    expect(res.body.ticket.itPriority).toBe("URGENT");
    expect(res.body.ticket.requestedPriority).toBe("HIGH");

    const stored = await storedTicket(ticket.id);
    expect(stored?.itPriority).toBe("URGENT");
    expect(stored?.requestedPriority).toBe("HIGH"); // BR-15: immutable
  });

  it("accepts every value on the IT scale including URGENT", async () => {
    for (const value of IT_PRIORITIES) {
      const ticket = await createStaffTicket({ itPriority: "MEDIUM" });

      const res = await setItPriority(staffClientA, ticket.id, value);

      expect(res.status, value).toBe(200);
      expect(res.body.ticket.itPriority).toBe(value);
    }
  });

  it("returns 422 for a value outside the IT scale", async () => {
    const ticket = await createStaffTicket();

    for (const invalid of ["CRITICAL", "", 7, null]) {
      const res = await setItPriority(staffClientA, ticket.id, invalid);
      expect(res.status, String(invalid)).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }

    const stored = await storedTicket(ticket.id);
    expect(stored?.itPriority).toBe("MEDIUM");
  });

  it("returns 404 for a non-existent ticket", async () => {
    const res = await setItPriority(staffClientA, 9_999_999, "HIGH");

    expect(res.status).toBe(404);
  });
});

// ─── API-25 — disallowed transition ─────────────────────────────────────

describe("API-25 — disallowed status transition (AC-10, BR-19)", () => {
  it("rejects NEW → CLOSED with 409 INVALID_TRANSITION and leaves status unchanged", async () => {
    const ticket = await createStaffTicket({ status: "NEW" });

    const res = await setStatus(staffClientA, ticket.id, "CLOSED");

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
    expect(res.body.error.from).toBe("NEW");
    expect(res.body.error.to).toBe("CLOSED");
    expect(res.body.error.allowed).toEqual(allowedStatusTransitions("NEW"));

    const stored = await storedTicket(ticket.id);
    expect(stored?.status).toBe("NEW");
  });

  it("rejects a transition out of the terminal CANCELLED status", async () => {
    const ticket = await createStaffTicket({ status: "CANCELLED" });

    const res = await setStatus(staffClientA, ticket.id, "OPEN");

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
    expect(res.body.error.allowed).toEqual([]);
  });

  it("returns 422 for a value that is not a ticket status at all", async () => {
    const ticket = await createStaffTicket({ status: "OPEN" });

    const res = await setStatus(staffClientA, ticket.id, "PENDING");

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");

    const stored = await storedTicket(ticket.id);
    expect(stored?.status).toBe("OPEN");
  });

  it("returns 404 for a non-existent ticket", async () => {
    const res = await setStatus(staffClientA, 9_999_999, "OPEN");

    expect(res.status).toBe(404);
  });
});

// ─── API-26 — the whole matrix, cell by cell ────────────────────────────

interface MatrixCase {
  from: StatusValue;
  to: StatusValue;
  permitted: boolean;
}

const MATRIX_CASES: MatrixCase[] = TICKET_STATUSES.flatMap((from) =>
  TICKET_STATUSES.map((to) => ({ from, to, permitted: isTransitionAllowed(from, to) })),
);
const PERMITTED_CASES = MATRIX_CASES.filter((c) => c.permitted);
const BLOCKED_CASES = MATRIX_CASES.filter((c) => !c.permitted);

describe("API-26 — every permitted transition in ui-spec.md §6.1 (parameterized)", () => {
  // Guard the fixture itself: the matrix must expose exactly the 18 permitted
  // cells of §6.1, so a typo in the table cannot silently pass this suite.
  it("covers all 64 from/to cells with exactly 18 permitted", () => {
    expect(MATRIX_CASES).toHaveLength(64);
    expect(PERMITTED_CASES).toHaveLength(18);
    expect(BLOCKED_CASES).toHaveLength(46);
  });

  it.each(PERMITTED_CASES)("$from → $to is permitted (200)", async ({ from, to }) => {
    const ticket = await createStaffTicket({ status: from });

    const res = await setStatus(staffClientA, ticket.id, to);

    expect(res.status).toBe(200);
    expect(res.body.ticket.status).toBe(to);
    expect(res.body.ticket.allowedStatusTransitions).toEqual(allowedStatusTransitions(to));

    const stored = await storedTicket(ticket.id);
    expect(stored?.status).toBe(to);
  });

  it.each(BLOCKED_CASES)(
    "$from → $to is blocked (409 INVALID_TRANSITION)",
    async ({ from, to }) => {
      const ticket = await createStaffTicket({ status: from });

      const res = await setStatus(staffClientA, ticket.id, to);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("INVALID_TRANSITION");
      expect(res.body.error.from).toBe(from);
      expect(res.body.error.to).toBe(to);
      expect(res.body.error.allowed).toEqual(allowedStatusTransitions(from));

      const stored = await storedTicket(ticket.id);
      expect(stored?.status).toBe(from);
    },
  );
});
