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
 * Public Comments — tests.md §3, api-spec.md §2
 *
 *   API-11  valid / empty / whitespace-only / > 2000 characters
 *
 * Public Comments are the Requester-facing half of this file. The staff-authored
 * Public Comment + Internal Note tests (API-27) belong to
 * feature/lab3-staff-ticketing and are intentionally absent here.
 *
 * Business rules:
 *   BR-03  identity is the session Requester (body `authorId` is ignored)
 *   BR-04  Public Comments are visible to the Requester who owns the ticket
 *   BR-13  cross-owner ticket → 404 (no existence leak)
 *   BR-16  append-only — no edit/delete endpoint exists
 *   BR-17  empty / whitespace-only content → 422
 *   BR-18  content limit is 2,000 characters
 */

let requesterA: TestUser;
let requesterB: TestUser;
let clientA: SessionClient;
let clientB: SessionClient;
let ticketA: { id: number; ticketNumber: string };
let ticketB: { id: number; ticketNumber: string };

beforeAll(async () => {
  await seed();

  requesterA = await createTestUser({ name: "Comments Requester A" });
  requesterB = await createTestUser({ name: "Comments Requester B" });
  clientA = await loginAs(app, requesterA.email);
  clientB = await loginAs(app, requesterB.email);

  const category = await prisma.category.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  const relatedSystem = await prisma.relatedSystem.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  expect(category).toBeDefined();
  expect(relatedSystem).toBeDefined();

  ticketA = await prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2026-COMMENT-A-${Date.now()}`,
      requesterId: requesterA.id,
      categoryId: category!.id,
      relatedSystemId: relatedSystem!.id,
      summary: "Public comment test ticket A",
      description: "This ticket is used for testing public comment endpoints thoroughly.",
      requestedPriority: "MEDIUM",
    },
    select: { id: true, ticketNumber: true },
  });

  ticketB = await prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2026-COMMENT-B-${Date.now()}`,
      requesterId: requesterB.id,
      categoryId: category!.id,
      relatedSystemId: relatedSystem!.id,
      summary: "Public comment test ticket B",
      description: "This ticket belongs to another Requester for cross-owner tests.",
      requestedPriority: "LOW",
    },
    select: { id: true, ticketNumber: true },
  });
});

afterAll(async () => {
  await cleanupTestUsers([requesterA.id, requesterB.id]);
  await prisma.$disconnect();
});

function postComment(client: SessionClient, ticketNumber: string, body: unknown) {
  return csrf(client, client.agent.post(`/api/tickets/${ticketNumber}/comments`)).send(
    body as object,
  );
}

// ─── API-11 ─────────────────────────────────────────────────────────────

describe("API-11 — POST /api/tickets/:ticketNumber/comments", () => {
  it("returns 201 with the documented comment shape for valid content", async () => {
    const res = await postComment(clientA, ticketA.ticketNumber, {
      content: "The battery diagnostic finished — happy to bring the laptop in.",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ticketId: ticketA.id,
      authorId: requesterA.id,
      authorName: requesterA.name,
      authorRole: "REQUESTER",
      content: "The battery diagnostic finished — happy to bring the laptop in.",
    });
    expect(typeof res.body.id).toBe("string");
    expect(typeof res.body.createdAt).toBe("string");
    expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt);
  });

  it("persists the comment against the ticket", async () => {
    const before = await prisma.publicComment.count({ where: { ticketId: ticketA.id } });

    const res = await postComment(clientA, ticketA.ticketNumber, {
      content: "A second public comment for persistence.",
    });
    expect(res.status).toBe(201);

    const after = await prisma.publicComment.count({ where: { ticketId: ticketA.id } });
    expect(after).toBe(before + 1);

    const stored = await prisma.publicComment.findUnique({ where: { id: res.body.id } });
    expect(stored?.content).toBe("A second public comment for persistence.");
    expect(stored?.authorId).toBe(requesterA.id);
  });

  it("returns 422 CONTENT_REQUIRED for empty content", async () => {
    const res = await postComment(clientA, ticketA.ticketNumber, { content: "" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("CONTENT_REQUIRED");
    expect(res.body.error.fieldErrors).toHaveProperty("content");
  });

  it("returns 422 CONTENT_REQUIRED for whitespace-only content (BR-17)", async () => {
    const res = await postComment(clientA, ticketA.ticketNumber, { content: "   \n\t  " });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("CONTENT_REQUIRED");
  });

  it("returns 422 CONTENT_REQUIRED for a missing content field", async () => {
    const res = await postComment(clientA, ticketA.ticketNumber, {});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("CONTENT_REQUIRED");
  });

  it("accepts content at exactly 2,000 characters (BR-18)", async () => {
    const res = await postComment(clientA, ticketA.ticketNumber, {
      content: "A".repeat(2000),
    });

    expect(res.status).toBe(201);
    expect(res.body.content).toHaveLength(2000);
  });

  it("returns 422 CONTENT_TOO_LONG for more than 2,000 characters (BR-18)", async () => {
    const res = await postComment(clientA, ticketA.ticketNumber, {
      content: "A".repeat(2001),
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("CONTENT_TOO_LONG");
    expect(res.body.error.fieldErrors).toHaveProperty("content");
  });

  it("trims surrounding whitespace before storing", async () => {
    const res = await postComment(clientA, ticketA.ticketNumber, {
      content: "   trimmed comment   ",
    });

    expect(res.status).toBe(201);
    expect(res.body.content).toBe("trimmed comment");
  });

  it("ignores a client-supplied author / requesterId (BR-03)", async () => {
    const res = await postComment(clientA, ticketA.ticketNumber, {
      content: "Author spoof attempt",
      authorId: requesterB.id,
      requesterId: requesterB.id,
    });

    expect(res.status).toBe(201);
    expect(res.body.authorId).toBe(requesterA.id);
  });

  it("returns 404 for another Requester's ticket (BR-13)", async () => {
    const res = await postComment(clientB, ticketA.ticketNumber, {
      content: "Trying to comment on someone else's ticket",
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
  });

  it("returns 401 without a session", async () => {
    const res = await request(app)
      .post(`/api/tickets/${ticketA.ticketNumber}/comments`)
      .send({ content: "no session" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 403 for an IT Staff session", async () => {
    const staff = await createTestUser({ role: "IT_STAFF" });
    const staffClient = await loginAs(app, staff.email);

    const res = await postComment(staffClient, ticketA.ticketNumber, {
      content: "staff comment on requester endpoint",
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");

    await cleanupTestUsers([staff.id]);
  });
});

// ─── GET comments ───────────────────────────────────────────────────────

describe("GET /api/tickets/:ticketNumber/comments", () => {
  it("returns 200 with items ordered oldest-first (api-spec.md §2)", async () => {
    const res = await clientA.agent.get(`/api/tickets/${ticketA.ticketNumber}/comments`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);

    const timestamps = res.body.items.map((c: { createdAt: string }) =>
      new Date(c.createdAt).getTime(),
    );
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i - 1]).toBeLessThanOrEqual(timestamps[i]);
    }

    // Newest comment (the spoof attempt) must be the last item.
    expect(res.body.items.at(-1).content).toBe("Author spoof attempt");
  });

  it("includes author name and role on every item", async () => {
    const res = await clientA.agent.get(`/api/tickets/${ticketA.ticketNumber}/comments`);

    expect(res.body.items.length).toBeGreaterThan(0);
    for (const comment of res.body.items) {
      expect(comment).toHaveProperty("authorName");
      expect(comment).toHaveProperty("authorRole", "REQUESTER");
      expect(comment).toHaveProperty("content");
      expect(comment).toHaveProperty("createdAt");
    }
  });

  it("returns 404 for another Requester's ticket (BR-13)", async () => {
    const res = await clientB.agent.get(`/api/tickets/${ticketA.ticketNumber}/comments`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
  });

  it("returns 401 without a session", async () => {
    const res = await request(app).get(`/api/tickets/${ticketA.ticketNumber}/comments`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("exposes no edit or delete endpoint (BR-16 append-only)", async () => {
    const list = await clientA.agent.get(`/api/tickets/${ticketA.ticketNumber}/comments`);
    const commentId = list.body.items[0].id;

    const patch = await csrf(
      clientA,
      clientA.agent.patch(
        `/api/tickets/${ticketA.ticketNumber}/comments/${commentId}`,
      ),
    ).send({ content: "edited" });
    const del = await csrf(
      clientA,
      clientA.agent.delete(
        `/api/tickets/${ticketA.ticketNumber}/comments/${commentId}`,
      ),
    );

    expect(patch.status).toBe(404);
    expect(del.status).toBe(404);
  });

  it("lists comments for another ticket independently", async () => {
    const res = await clientB.agent.get(`/api/tickets/${ticketB.ticketNumber}/comments`);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});
