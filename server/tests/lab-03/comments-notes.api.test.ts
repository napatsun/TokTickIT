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
 * Public Comments & Internal Notes — tests.md §3 and §5, api-spec.md §2/§3
 *
 *   API-11  Requester Public Comment: valid / empty / whitespace-only / too long
 *   API-27  IT Staff Public Comment + Internal Note: valid / empty / too long
 *           (added in feature/lab3-04-staff-ticketing — section appended below,
 *           the API-11 blocks above are untouched)
 *
 * Business rules:
 *   BR-03  identity is the session user (body `authorId` is ignored)
 *   BR-04  Public Comments visible to Requester/IT Staff/Administrator;
 *          Internal Notes visible ONLY to IT Staff/Administrator
 *   BR-13  cross-owner ticket → 404 for the Requester-facing routes
 *   BR-16  append-only — no edit/delete endpoint exists
 *   BR-17  empty / whitespace-only content → 422
 *   BR-18  content limit is 2,000 characters
 *
 * API-27 also proves the staff endpoints REUSE the Requester validation path:
 * the staff comment/note error codes and messages for the same invalid input
 * must match the Requester comment endpoint exactly (lib/content.ts).
 */

let requesterA: TestUser;
let requesterB: TestUser;
let staffUser: TestUser;
let adminUser: TestUser;
let clientA: SessionClient;
let clientB: SessionClient;
let staffClient: SessionClient;
let adminClient: SessionClient;
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

  // IT Staff/Administrator fixtures for API-27.
  staffUser = await createTestUser({ name: "Comments Staff", role: "IT_STAFF" });
  adminUser = await createTestUser({ name: "Comments Admin", role: "ADMINISTRATOR" });
  staffClient = await loginAs(app, staffUser.email);
  adminClient = await loginAs(app, adminUser.email);
});

afterAll(async () => {
  await cleanupTestUsers([
    requesterA.id,
    requesterB.id,
    staffUser.id,
    adminUser.id,
  ]);
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

// ══════════════════════════════════════════════════════════════════════════
// API-27 — IT Staff Public Comments + Internal Notes
//           (feature/lab3-04-staff-ticketing)
// ══════════════════════════════════════════════════════════════════════════

// Route convention: staff endpoints take the internal Ticket `id`, the
// Requester endpoints take `:ticketNumber` (api-spec.md §3).

function postStaffComment(client: SessionClient, ticketId: number, body: unknown) {
  return csrf(client, client.agent.post(`/api/staff/tickets/${ticketId}/comments`)).send(
    body as object,
  );
}

function getStaffComments(client: SessionClient, ticketId: number) {
  return client.agent.get(`/api/staff/tickets/${ticketId}/comments`);
}

function postNote(client: SessionClient, ticketId: number, body: unknown) {
  return csrf(client, client.agent.post(`/api/staff/tickets/${ticketId}/notes`)).send(
    body as object,
  );
}

function getNotes(client: SessionClient, ticketId: number) {
  return client.agent.get(`/api/staff/tickets/${ticketId}/notes`);
}

const INTERNAL_ONLY_MARKER = `INTERNAL-ONLY-${Date.now()}`;

describe("API-27 — IT Staff Public Comments on any ticket (FR-22, BR-04)", () => {
  it("posts a Public Comment on a ticket the staff member does not own", async () => {
    const res = await postStaffComment(staffClient, ticketA.id, {
      content: "We have reproduced this on a spare laptop.",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ticketId: ticketA.id,
      authorId: staffUser.id,
      authorName: staffUser.name,
      authorRole: "IT_STAFF",
      content: "We have reproduced this on a spare laptop.",
    });
    expect(typeof res.body.id).toBe("string");
    expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt);
  });

  it("makes the staff comment visible to the Requester on the same ticket (BR-04)", async () => {
    const requesterView = await clientA.agent.get(
      `/api/tickets/${ticketA.ticketNumber}/comments`,
    );

    expect(requesterView.status).toBe(200);
    expect(
      requesterView.body.items.some(
        (c: { content: string; authorRole: string }) =>
          c.content === "We have reproduced this on a spare laptop." &&
          c.authorRole === "IT_STAFF",
      ),
    ).toBe(true);
  });

  it("reads Public Comments on any ticket via the staff endpoint", async () => {
    const res = await getStaffComments(staffClient, ticketB.id);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("lets a staff member comment on a ticket owned by a different Requester", async () => {
    const res = await postStaffComment(adminClient, ticketB.id, {
      content: "Administrator note on another Requester's ticket.",
    });

    expect(res.status).toBe(201);
    expect(res.body.ticketId).toBe(ticketB.id);
    expect(res.body.authorRole).toBe("ADMINISTRATOR");
  });

  it("ignores a client-supplied authorId (BR-03)", async () => {
    const res = await postStaffComment(staffClient, ticketA.id, {
      content: "Author spoof attempt from staff",
      authorId: requesterA.id,
    });

    expect(res.status).toBe(201);
    expect(res.body.authorId).toBe(staffUser.id);
  });
});

describe("API-27 — staff Public Comment validation uses the shared rules (BR-17/18)", () => {
  it("returns 422 CONTENT_REQUIRED for empty and whitespace-only content", async () => {
    for (const content of ["", "   \n\t  "]) {
      const res = await postStaffComment(staffClient, ticketA.id, { content });

      expect(res.status, JSON.stringify(content)).toBe(422);
      expect(res.body.error.code).toBe("CONTENT_REQUIRED");
      expect(res.body.error.fieldErrors).toHaveProperty("content");
    }
  });

  it("returns 422 CONTENT_REQUIRED for a missing content field", async () => {
    const res = await postStaffComment(staffClient, ticketA.id, {});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("CONTENT_REQUIRED");
  });

  it("accepts exactly 2,000 characters and rejects 2,001", async () => {
    const ok = await postStaffComment(staffClient, ticketA.id, {
      content: "S".repeat(2000),
    });
    expect(ok.status).toBe(201);
    expect(ok.body.content).toHaveLength(2000);

    const tooLong = await postStaffComment(staffClient, ticketA.id, {
      content: "S".repeat(2001),
    });
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.error.code).toBe("CONTENT_TOO_LONG");
  });

  it("returns the SAME error code/message as the Requester endpoint for the same input", async () => {
    // Proves the staff route reuses lib/content.ts rather than a copy.
    const requesterSide = await csrf(
      clientA,
      clientA.agent.post(`/api/tickets/${ticketA.ticketNumber}/comments`),
    ).send({ content: "   " });
    const staffSide = await postStaffComment(staffClient, ticketA.id, { content: "   " });

    expect(staffSide.status).toBe(requesterSide.status);
    expect(staffSide.body.error.code).toBe(requesterSide.body.error.code);
    expect(staffSide.body.error.message).toBe(requesterSide.body.error.message);

    const requesterTooLong = await csrf(
      clientA,
      clientA.agent.post(`/api/tickets/${ticketA.ticketNumber}/comments`),
    ).send({ content: "X".repeat(2001) });
    const staffTooLong = await postStaffComment(staffClient, ticketA.id, {
      content: "X".repeat(2001),
    });

    expect(staffTooLong.body.error.code).toBe(requesterTooLong.body.error.code);
    expect(staffTooLong.body.error.message).toBe(requesterTooLong.body.error.message);
  });

  it("trims surrounding whitespace before storing", async () => {
    const res = await postStaffComment(staffClient, ticketA.id, {
      content: "   trimmed staff comment   ",
    });

    expect(res.status).toBe(201);
    expect(res.body.content).toBe("trimmed staff comment");
  });

  it("returns 404 for a non-existent ticket id", async () => {
    const post = await postStaffComment(staffClient, 9_999_999, { content: "hi" });
    const get = await getStaffComments(staffClient, 9_999_999);

    expect(post.status).toBe(404);
    expect(post.body.error.code).toBe("TICKET_NOT_FOUND");
    expect(get.status).toBe(404);
  });
});

describe("API-27 — Internal Notes (FR-22, BR-16/17/18, BR-04)", () => {
  it("creates a note with the documented shape", async () => {
    const res = await postNote(staffClient, ticketA.id, {
      content: `${INTERNAL_ONLY_MARKER}: escalation contact is the vendor TAM.`,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ticketId: ticketA.id,
      authorId: staffUser.id,
      authorName: staffUser.name,
      authorRole: "IT_STAFF",
    });
    expect(typeof res.body.id).toBe("string");
    expect(typeof res.body.createdAt).toBe("string");
  });

  it("lists notes oldest-first and appends new ones", async () => {
    const second = await postNote(adminClient, ticketA.id, {
      content: "Administrator follow-up on the same ticket.",
    });
    expect(second.status).toBe(201);

    const res = await getNotes(staffClient, ticketA.id);

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);

    const timestamps = res.body.items.map((n: { createdAt: string }) =>
      new Date(n.createdAt).getTime(),
    );
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i - 1]).toBeLessThanOrEqual(timestamps[i]);
    }
    expect(res.body.items.at(-1).content).toBe(
      "Administrator follow-up on the same ticket.",
    );
  });

  it("ignores a client-supplied authorId on notes too (BR-03)", async () => {
    const res = await postNote(staffClient, ticketA.id, {
      content: "Note author spoof attempt",
      authorId: requesterA.id,
    });

    expect(res.status).toBe(201);
    expect(res.body.authorId).toBe(staffUser.id);
  });

  it("applies the shared empty/too-long validation to notes", async () => {
    const empty = await postNote(staffClient, ticketA.id, { content: "   " });
    expect(empty.status).toBe(422);
    expect(empty.body.error.code).toBe("CONTENT_REQUIRED");
    expect(empty.body.error.message).toBe("Note cannot be empty.");

    const tooLong = await postNote(staffClient, ticketA.id, { content: "N".repeat(2001) });
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.error.code).toBe("CONTENT_TOO_LONG");

    const boundary = await postNote(staffClient, ticketA.id, { content: "N".repeat(2000) });
    expect(boundary.status).toBe(201);
  });

  it("returns 404 for a non-existent ticket id", async () => {
    const post = await postNote(staffClient, 9_999_999, { content: "hi" });
    const get = await getNotes(staffClient, 9_999_999);

    expect(post.status).toBe(404);
    expect(get.status).toBe(404);
  });

  it("returns 401 without a session", async () => {
    const res = await request(app).get(`/api/staff/tickets/${ticketA.id}/notes`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("NEVER exposes note content through the Requester comments list (BR-04)", async () => {
    const res = await clientA.agent.get(`/api/tickets/${ticketA.ticketNumber}/comments`);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(INTERNAL_ONLY_MARKER);
    // Neither the marker content nor an internal-notes key may appear.
    expect(JSON.stringify(res.body)).not.toMatch(/internalNote/i);
  });

  it("returns an empty list (not an error) for a ticket with no notes", async () => {
    const res = await getNotes(staffClient, ticketB.id);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});

describe("API-27 — note endpoints are append-only (BR-16)", () => {
  it("exposes no edit or delete endpoint for notes", async () => {
    const list = await getNotes(staffClient, ticketA.id);
    const noteId = list.body.items[0].id;

    const patch = await csrf(
      staffClient,
      staffClient.agent.patch(`/api/staff/tickets/${ticketA.id}/notes/${noteId}`),
    ).send({ content: "edited" });
    const del = await csrf(
      staffClient,
      staffClient.agent.delete(`/api/staff/tickets/${ticketA.id}/notes/${noteId}`),
    );

    expect(patch.status).toBe(404);
    expect(del.status).toBe(404);

    const stillThere = await prisma.internalNote.findUnique({ where: { id: noteId } });
    expect(stillThere).not.toBeNull();
  });
});
