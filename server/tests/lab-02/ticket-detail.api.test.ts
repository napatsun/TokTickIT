import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";

const prisma = getPrisma();

/**
 * GET /api/tickets/:ticketNumber — api-spec.md §6
 *
 * Retrieve one Ticket owned by the current Requester, with its
 * Attachments split into active and removed arrays.
 *
 * Tests cover:
 *   API-15  AC-03  Cross-requester access → 404 (not 403)
 *   API-16  AC-16  Happy path — all fields present, attachments grouped
 *   BR-13   Identical 404 for non-existent and cross-requester
 *   BR-40   Ticket Detail re-fetches from backend, never trusts cache
 */

// ─── Helpers ─────────────────────────────────────────────────────────────

function get(path: string, requesterId?: number) {
  const req = request(app).get(path);
  if (requesterId !== undefined) {
    req.set("X-Dev-Requester-Id", String(requesterId));
  }
  return req;
}

// ─── Seed data ───────────────────────────────────────────────────────────

let requesterA: { id: number; fullName: string };
let requesterB: { id: number; fullName: string };
let ticketA: { id: number; ticketNumber: string };
let ticketB: { id: number; ticketNumber: string };
let activeAttachmentId: number;
let removedAttachmentId: number;

beforeAll(async () => {
  await seed();

  // ── Requesters ────────────────────────────────────────────────────────
  const requesters = await prisma.devRequester.findMany({
    where: { isActive: true },
    orderBy: { id: "asc" },
    select: { id: true, fullName: true },
  });
  expect(requesters.length).toBeGreaterThanOrEqual(2);
  requesterA = requesters[0];
  requesterB = requesters[1];

  // ── Categories & Related Systems ──────────────────────────────────────
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

  // ── Ticket for Requester A (with attachments) ─────────────────────────
  ticketA = await prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2026-DETAIL-A-${Date.now()}`,
      requesterId: requesterA.id,
      categoryId: category!.id,
      relatedSystemId: relatedSystem!.id,
      summary: "Laptop battery drains quickly",
      description:
        "My laptop battery is draining much faster than usual, lasting only 2 hours on a full charge.",
      requestedPriority: "MEDIUM",
    },
    select: { id: true, ticketNumber: true },
  });

  // Active attachment for ticket A
  const activeAtt = await prisma.attachment.create({
    data: {
      ticketId: ticketA.id,
      originalFileName: "battery_report.pdf",
      storedFileName: "active-attachment-test.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 204800,
      uploadedByRequesterId: requesterA.id,
    },
    select: { id: true },
  });
  activeAttachmentId = activeAtt.id;

  // Removed attachment for ticket A
  const removedAtt = await prisma.attachment.create({
    data: {
      ticketId: ticketA.id,
      originalFileName: "old_log.png",
      storedFileName: "removed-attachment-test.png",
      mimeType: "image/png",
      fileSizeBytes: 51200,
      uploadedByRequesterId: requesterA.id,
      isRemoved: true,
      removedAt: new Date("2026-08-22T10:00:00.000Z"),
      removedReason: "Uploaded wrong file",
      removedByRequesterId: requesterA.id,
    },
    select: { id: true },
  });
  removedAttachmentId = removedAtt.id;

  // ── Ticket for Requester B (no attachments) ───────────────────────────
  ticketB = await prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2026-DETAIL-B-${Date.now()}`,
      requesterId: requesterB.id,
      categoryId: category!.id,
      relatedSystemId: relatedSystem!.id,
      summary: "VPN connection drops frequently",
      description:
        "The VPN connection drops several times a day, interrupting my work and requiring reconnection.",
      requestedPriority: "HIGH",
    },
    select: { id: true, ticketNumber: true },
  });
});

afterAll(async () => {
  // Clean up test data (order matters due to FK constraints)
  await prisma.attachment.deleteMany({
    where: { ticketId: { in: [ticketA.id, ticketB.id] } },
  });
  await prisma.ticket.deleteMany({
    where: { id: { in: [ticketA.id, ticketB.id] } },
  });
});

// ─── Tests ───────────────────────────────────────────────────────────────

describe("GET /api/tickets/:ticketNumber", () => {
  // ─── API-16: Happy path ─────────────────────────────────────────────

  describe("API-16 — Happy path: own ticket with active + removed attachments", () => {
    it("returns 200 with full ticket fields", async () => {
      const res = await get(`/api/tickets/${ticketA.ticketNumber}`, requesterA.id);

      expect(res.status).toBe(200);
      expect(res.body.ticket).toBeDefined();

      // Ticket fields per api-spec §6 response shape
      const ticket = res.body.ticket;
      expect(ticket.id).toBe(ticketA.id);
      expect(ticket.ticketNumber).toBe(ticketA.ticketNumber);
      expect(ticket.ticketDate).toBeDefined(); // ISO string
      expect(ticket.requester).toEqual({
        id: requesterA.id,
        fullName: requesterA.fullName,
      });
      expect(ticket.category).toBeDefined();
      expect(ticket.category.id).toBeDefined();
      expect(ticket.category.name).toBeDefined();
      expect(ticket.relatedSystem).toBeDefined();
      expect(ticket.relatedSystem.id).toBeDefined();
      expect(ticket.relatedSystem.name).toBeDefined();
      expect(ticket.summary).toBe("Laptop battery drains quickly");
      expect(ticket.description).toContain("laptop battery");
      expect(ticket.requestedPriority).toBe("MEDIUM");
      expect(ticket.itPriority).toBeNull();
      expect(ticket.currentStatus).toBe("NEW");
      expect(ticket.ticketOwner).toBeNull();
      expect(ticket.resolutionSummary).toBeNull();
    });

    it("returns attachments split into active and removed arrays", async () => {
      const res = await get(`/api/tickets/${ticketA.ticketNumber}`, requesterA.id);

      expect(res.status).toBe(200);
      expect(res.body.attachments).toBeDefined();
      expect(res.body.attachments.active).toBeDefined();
      expect(res.body.attachments.removed).toBeDefined();

      // Active attachments
      expect(res.body.attachments.active.length).toBeGreaterThanOrEqual(1);
      const activeIds = res.body.attachments.active.map((a: any) => a.id);
      expect(activeIds).toContain(activeAttachmentId);

      const activeAtt = res.body.attachments.active.find(
        (a: any) => a.id === activeAttachmentId,
      );
      expect(activeAtt.originalFileName).toBe("battery_report.pdf");
      expect(activeAtt.fileSizeBytes).toBe(204800);
      expect(activeAtt.mimeType).toBe("application/pdf");
      expect(activeAtt.uploadedAt).toBeDefined();

      // Removed attachments
      expect(res.body.attachments.removed.length).toBeGreaterThanOrEqual(1);
      const removedIds = res.body.attachments.removed.map((a: any) => a.id);
      expect(removedIds).toContain(removedAttachmentId);

      const removedAtt = res.body.attachments.removed.find(
        (a: any) => a.id === removedAttachmentId,
      );
      expect(removedAtt.originalFileName).toBe("old_log.png");
      expect(removedAtt.fileSizeBytes).toBe(51200);
      expect(removedAtt.removedAt).toBeDefined();
      expect(removedAtt.removedReason).toBe("Uploaded wrong file");
    });

    it("does not include removed attachment fields in active array", async () => {
      const res = await get(`/api/tickets/${ticketA.ticketNumber}`, requesterA.id);

      const activeAtt = res.body.attachments.active.find(
        (a: any) => a.id === activeAttachmentId,
      );
      // Active attachment should NOT have removedAt/removedReason
      expect(activeAtt.removedAt).toBeUndefined();
      expect(activeAtt.removedReason).toBeUndefined();
    });
  });

  // ─── API-15: Cross-requester ────────────────────────────────────────

  describe("API-15 — Cross-requester: 404 when accessing another requester's ticket", () => {
    it("returns 404 with TICKET_NOT_FOUND for a different requester's ticket", async () => {
      const res = await get(`/api/tickets/${ticketA.ticketNumber}`, requesterB.id);

      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
      expect(res.body.error.message).toBe("Ticket not found.");
    });

    it("returns identical 404 for a non-existent ticketNumber", async () => {
      const res = await get("/api/tickets/TKT-2026-999999-NONEXISTENT", requesterA.id);

      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
      expect(res.body.error.message).toBe("Ticket not found.");
    });

    it("cross-requester 404 response matches non-existent 404 response (BR-13)", async () => {
      const resCross = await get(
        `/api/tickets/${ticketA.ticketNumber}`,
        requesterB.id,
      );
      const resMissing = await get(
        "/api/tickets/TKT-2026-999999-NONEXISTENT",
        requesterA.id,
      );

      // BR-13: identical response bodies — no information leak
      expect(resCross.body).toEqual(resMissing.body);
    });
  });

  // ─── Auth ───────────────────────────────────────────────────────────

  describe("Auth — 401 for missing or invalid header", () => {
    it("returns 401 without X-Dev-Requester-Id header", async () => {
      const res = await request(app).get(
        `/api/tickets/${ticketA.ticketNumber}`,
      );

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
    });

    it("returns 401 with non-numeric header", async () => {
      const res = await request(app)
        .get(`/api/tickets/${ticketA.ticketNumber}`)
        .set("X-Dev-Requester-Id", "not-a-number");

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
    });

    it("returns 401 with non-existent requester id", async () => {
      const res = await request(app)
        .get(`/api/tickets/${ticketA.ticketNumber}`)
        .set("X-Dev-Requester-Id", "999999");

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
    });
  });

  // ─── Response shape ─────────────────────────────────────────────────

  describe("Response shape validation", () => {
    it("ticket object has all required fields per api-spec §6", async () => {
      const res = await get(`/api/tickets/${ticketA.ticketNumber}`, requesterA.id);
      const ticket = res.body.ticket;

      // All fields from api-spec §6 response shape
      expect(ticket).toHaveProperty("id");
      expect(ticket).toHaveProperty("ticketNumber");
      expect(ticket).toHaveProperty("ticketDate");
      expect(ticket).toHaveProperty("requester");
      expect(ticket).toHaveProperty("category");
      expect(ticket).toHaveProperty("relatedSystem");
      expect(ticket).toHaveProperty("summary");
      expect(ticket).toHaveProperty("description");
      expect(ticket).toHaveProperty("requestedPriority");
      expect(ticket).toHaveProperty("itPriority");
      expect(ticket).toHaveProperty("currentStatus");
      expect(ticket).toHaveProperty("ticketOwner");
      expect(ticket).toHaveProperty("resolutionSummary");
    });

    it("attachments object has active and removed arrays", async () => {
      const res = await get(`/api/tickets/${ticketA.ticketNumber}`, requesterA.id);

      expect(res.body.attachments).toHaveProperty("active");
      expect(res.body.attachments).toHaveProperty("removed");
      expect(Array.isArray(res.body.attachments.active)).toBe(true);
      expect(Array.isArray(res.body.attachments.removed)).toBe(true);
    });

    it("active attachment has correct fields", async () => {
      const res = await get(`/api/tickets/${ticketA.ticketNumber}`, requesterA.id);
      const att = res.body.attachments.active[0];

      expect(att).toHaveProperty("id");
      expect(att).toHaveProperty("originalFileName");
      expect(att).toHaveProperty("fileSizeBytes");
      expect(att).toHaveProperty("mimeType");
      expect(att).toHaveProperty("uploadedAt");
    });

    it("removed attachment has correct fields including removal metadata", async () => {
      const res = await get(`/api/tickets/${ticketA.ticketNumber}`, requesterA.id);
      const att = res.body.attachments.removed[0];

      expect(att).toHaveProperty("id");
      expect(att).toHaveProperty("originalFileName");
      expect(att).toHaveProperty("fileSizeBytes");
      expect(att).toHaveProperty("removedAt");
      expect(att).toHaveProperty("removedReason");
    });

    it("ticket with no attachments returns empty arrays", async () => {
      const res = await get(`/api/tickets/${ticketB.ticketNumber}`, requesterB.id);

      expect(res.status).toBe(200);
      expect(res.body.attachments.active).toEqual([]);
      expect(res.body.attachments.removed).toEqual([]);
    });
  });
});
