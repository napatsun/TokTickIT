import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";
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
 * Requester-side ticket operations — tests.md §3
 *
 *   API-12  "Problem Appears Resolved" (FR-15, AC-11, BR-05, BR-20)
 *   API-13  a Requester cannot change Ticket status directly (BR-05)
 *
 * The IT Staff half of this file (role-guarded status transitions, queue,
 * claim/assign, priority, internal notes) is added in
 * feature/lab3-staff-ticketing. Only the Requester-relevant tests live here now.
 */

let requesterA: TestUser;
let requesterB: TestUser;
let clientA: SessionClient;
let clientB: SessionClient;

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
});

afterAll(async () => {
  await cleanupTestUsers([requesterA.id, requesterB.id]);
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
