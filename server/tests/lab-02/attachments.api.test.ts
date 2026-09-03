import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";
import { UPLOADS_DIR } from "../../src/services/attachmentStorage.js";

const prisma = getPrisma();

/**
 * Attachment Endpoints — api-spec.md §7, §8, §9, §10
 *
 * Tests cover:
 *   API-17  AC-17  POST add attachment to owned ticket → 201
 *   API-18  AC-08  POST 6th active attachment → 400 ATTACHMENT_LIMIT_REACHED
 *   API-19  AC-18  GET download active attachment → 200 + correct content
 *   API-20  AC-19  GET download removed attachment → 404
 *   API-21  AC-19  DELETE soft-remove with valid reason → 200
 *   API-22  AC-20  DELETE without removalReason → 400
 *   API-23  BR-33  DELETE attachment on cross-requester ticket → 404
 *   Extra: POST on cross-requester ticket → 404
 *   Extra: GET attachment metadata happy path + cross-requester
 *   Extra: DELETE already-removed attachment → 404
 *   Extra: Auth 401 for all endpoints
 */

// ─── Test file helpers ──────────────────────────────────────────────────

/** Minimal valid PNG file */
function fakePng(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
    0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

/** Minimal valid PDF file */
function fakePdf(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF");
}

/** Create a fake file of specific size for download verification */
function fakeFileForDownload(content: string): Buffer {
  return Buffer.from(content);
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function get(path: string, requesterId: number) {
  return request(app)
    .get(path)
    .set("X-Dev-Requester-Id", String(requesterId));
}

function del(path: string, requesterId: number, body?: Record<string, string>) {
  const req = request(app)
    .delete(path)
    .set("X-Dev-Requester-Id", String(requesterId));
  if (body) req.send(body);
  return req;
}

// ─── Seed data ───────────────────────────────────────────────────────────

let requesterA: { id: number; fullName: string };
let requesterB: { id: number; fullName: string };
let ticketA: { id: number; ticketNumber: string };
let ticketB: { id: number; ticketNumber: string };
let activeAttachmentId: number;
let activeAttachmentStoredName: string;
let activeAttachmentMime: string;
let removedAttachmentId: number;
let existingTicketNumber: string;

// Files to write to disk for download tests
const DOWNLOAD_TEST_FILE = "download-test-content.txt";
const DOWNLOAD_TEST_STORED = "download-test-stored.txt";

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

  // ── Ticket for Requester A ────────────────────────────────────────────
  ticketA = await prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2026-ATTACH-A-${Date.now()}`,
      requesterId: requesterA.id,
      categoryId: category!.id,
      relatedSystemId: relatedSystem!.id,
      summary: "Attachment test ticket A",
      description: "This ticket is used for testing attachment endpoints thoroughly.",
      requestedPriority: "MEDIUM",
    },
    select: { id: true, ticketNumber: true },
  });

  // Active attachment for ticket A (with file on disk for download test)
  const fileContent = fakeFileForDownload("hello attachment content");
  const safeName = DOWNLOAD_TEST_STORED;

  // Write file to disk for download test
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOADS_DIR, safeName), fileContent);

  const activeAtt = await prisma.attachment.create({
    data: {
      ticketId: ticketA.id,
      originalFileName: DOWNLOAD_TEST_FILE,
      storedFileName: safeName,
      mimeType: "text/plain",
      fileSizeBytes: fileContent.length,
      uploadedByRequesterId: requesterA.id,
    },
    select: { id: true, storedFileName: true, mimeType: true },
  });
  activeAttachmentId = activeAtt.id;
  activeAttachmentStoredName = activeAtt.storedFileName;
  activeAttachmentMime = activeAtt.mimeType;

  // Removed attachment for ticket A
  const removedAtt = await prisma.attachment.create({
    data: {
      ticketId: ticketA.id,
      originalFileName: "old_screenshot.png",
      storedFileName: `removed-${Date.now()}.png`,
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
      ticketNumber: `TKT-2026-ATTACH-B-${Date.now()}`,
      requesterId: requesterB.id,
      categoryId: category!.id,
      relatedSystemId: relatedSystem!.id,
      summary: "Attachment test ticket B",
      description: "This ticket belongs to Requester B for cross-requester tests.",
      requestedPriority: "HIGH",
    },
    select: { id: true, ticketNumber: true },
  });

  existingTicketNumber = ticketA.ticketNumber;
});

afterAll(async () => {
  // Clean up test data
  await prisma.attachment.deleteMany({
    where: { ticketId: { in: [ticketA.id, ticketB.id] } },
  });
  await prisma.ticket.deleteMany({
    where: { id: { in: [ticketA.id, ticketB.id] } },
  });
  // Clean up test file from disk
  try {
    await fs.unlink(path.join(UPLOADS_DIR, DOWNLOAD_TEST_STORED));
  } catch {
    // ignore if already cleaned up
  }
});

// ─── Tests ───────────────────────────────────────────────────────────────

describe("Attachment Endpoints", () => {
  // ══════════════════════════════════════════════════════════════════════
  // API-17: POST /api/tickets/:ticketNumber/attachments — happy path
  // ══════════════════════════════════════════════════════════════════════

  describe("API-17 — POST add attachment to owned ticket", () => {
    it("returns 201 with attachment metadata on successful upload", async () => {
      const res = await request(app)
        .post(`/api/tickets/${existingTicketNumber}/attachments`)
        .set("X-Dev-Requester-Id", String(requesterA.id))
        .attach("attachments", fakePng(), {
          filename: "new_screenshot.png",
          contentType: "image/png",
        });

      expect(res.status).toBe(201);
      expect(res.body.attachments).toBeDefined();
      expect(res.body.attachments.length).toBeGreaterThanOrEqual(1);
      // BR-31: attachmentFailures always present in response (empty on success)
      expect(res.body.attachmentFailures).toBeDefined();
      expect(res.body.attachmentFailures).toHaveLength(0);

      const att = res.body.attachments.find(
        (a: any) => a.originalFileName === "new_screenshot.png",
      );
      expect(att).toBeDefined();
      expect(att).toHaveProperty("id");
      expect(att.originalFileName).toBe("new_screenshot.png");
      expect(att.mimeType).toBe("image/png");
      expect(att.fileSizeBytes).toBeGreaterThan(0);
      expect(att).toHaveProperty("uploadedAt");
    });

    it("attachment appears in subsequent GET of the ticket", async () => {
      // First add an attachment
      const addRes = await request(app)
        .post(`/api/tickets/${existingTicketNumber}/attachments`)
        .set("X-Dev-Requester-Id", String(requesterA.id))
        .attach("attachments", fakePdf(), {
          filename: "report.pdf",
          contentType: "application/pdf",
        });

      expect(addRes.status).toBe(201);
      const newAttId = addRes.body.attachments[0].id;

      // Then verify it shows in ticket detail
      const detailRes = await get(
        `/api/tickets/${existingTicketNumber}`,
        requesterA.id,
      );
      expect(detailRes.status).toBe(200);

      const activeIds = detailRes.body.attachments.active.map(
        (a: any) => a.id,
      );
      expect(activeIds).toContain(newAttId);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // API-17 extra: POST on cross-requester ticket → 404
  // ══════════════════════════════════════════════════════════════════════

  describe("API-17 extra — POST on cross-requester ticket", () => {
    it("returns 404 when adding attachment to another requester's ticket", async () => {
      const res = await request(app)
        .post(`/api/tickets/${ticketA.ticketNumber}/attachments`)
        .set("X-Dev-Requester-Id", String(requesterB.id))
        .attach("attachments", fakePng(), {
          filename: "sneaky.png",
          contentType: "image/png",
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // API-18: POST when active attachment count is already 5 → 400
  // ══════════════════════════════════════════════════════════════════════

  describe("API-18 — POST attachment limit reached (BR-30)", () => {
    it("returns 400 ATTACHMENT_LIMIT_REACHED when 5 active attachments exist", async () => {
      // Create a fresh ticket and add 5 active attachments
      const category = await prisma.category.findFirst({
        where: { isActive: true },
        select: { id: true },
      });
      const relatedSystem = await prisma.relatedSystem.findFirst({
        where: { isActive: true },
        select: { id: true },
      });

      const freshTicket = await prisma.ticket.create({
        data: {
          ticketNumber: `TKT-2026-LIMIT-${Date.now()}`,
          requesterId: requesterA.id,
          categoryId: category!.id,
          relatedSystemId: relatedSystem!.id,
          summary: "Ticket for limit test",
          description: "This ticket will have 5 active attachments for limit testing.",
          requestedPriority: "LOW",
        },
        select: { id: true, ticketNumber: true },
      });

      // Add 5 active attachments
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post(`/api/tickets/${freshTicket.ticketNumber}/attachments`)
          .set("X-Dev-Requester-Id", String(requesterA.id))
          .attach("attachments", fakePng(), {
            filename: `file${i}.png`,
            contentType: "image/png",
          });
        expect(res.status).toBe(201);
      }

      // 6th should fail
      const res = await request(app)
        .post(`/api/tickets/${freshTicket.ticketNumber}/attachments`)
        .set("X-Dev-Requester-Id", String(requesterA.id))
        .attach("attachments", fakePng(), {
          filename: "file6.png",
          contentType: "image/png",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("ATTACHMENT_LIMIT_REACHED");

      // Verify no 6th record was created
      const count = await prisma.attachment.count({
        where: { ticketId: freshTicket.id, isRemoved: false },
      });
      expect(count).toBe(5);

      // Cleanup
      await prisma.attachment.deleteMany({
        where: { ticketId: freshTicket.id },
      });
      await prisma.ticket.delete({ where: { id: freshTicket.id } });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // GET /api/attachments/:id — metadata
  // ══════════════════════════════════════════════════════════════════════

  describe("GET /api/attachments/:id — metadata", () => {
    it("returns 200 with full attachment metadata for owned attachment", async () => {
      const res = await get(
        `/api/attachments/${activeAttachmentId}`,
        requesterA.id,
      );

      expect(res.status).toBe(200);
      expect(res.body.attachment).toBeDefined();
      const att = res.body.attachment;
      expect(att.id).toBe(activeAttachmentId);
      expect(att.ticketId).toBe(ticketA.id);
      expect(att.originalFileName).toBe(DOWNLOAD_TEST_FILE);
      expect(att.mimeType).toBe("text/plain");
      expect(att.fileSizeBytes).toBeGreaterThan(0);
      expect(att).toHaveProperty("uploadedAt");
      expect(att.isRemoved).toBe(false);
      expect(att.removedAt).toBeNull();
      expect(att.removedReason).toBeNull();
    });

    it("returns 404 for cross-requester attachment", async () => {
      const res = await get(
        `/api/attachments/${activeAttachmentId}`,
        requesterB.id,
      );

      expect(res.status).toBe(404);
    });

    it("returns 404 for non-existent attachment", async () => {
      const res = await get("/api/attachments/999999", requesterA.id);
      expect(res.status).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // API-19: GET download active attachment → 200
  // ══════════════════════════════════════════════════════════════════════

  describe("API-19 — GET download active attachment", () => {
    it("returns 200 with correct content and Content-Disposition", async () => {
      const res = await get(
        `/api/attachments/${activeAttachmentId}/download`,
        requesterA.id,
      );

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/plain");
      expect(res.headers["content-disposition"]).toContain(
        `filename="${DOWNLOAD_TEST_FILE}"`,
      );
      // Verify actual file content
      expect(res.text).toBe("hello attachment content");
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // API-20: GET download removed attachment → 404
  // ══════════════════════════════════════════════════════════════════════

  describe("API-20 — GET download removed attachment (BR-35)", () => {
    it("returns 404 for a soft-removed attachment", async () => {
      const res = await get(
        `/api/attachments/${removedAttachmentId}/download`,
        requesterA.id,
      );

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("ATTACHMENT_NOT_FOUND");
    });

    it("returns 404 for cross-requester download", async () => {
      const res = await get(
        `/api/attachments/${activeAttachmentId}/download`,
        requesterB.id,
      );

      expect(res.status).toBe(404);
    });

    it("returns 404 for non-existent attachment", async () => {
      const res = await get("/api/attachments/999999/download", requesterA.id);
      expect(res.status).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // API-21: DELETE soft-remove with valid reason → 200
  // ══════════════════════════════════════════════════════════════════════

  describe("API-21 — DELETE soft-remove attachment", () => {
    it("returns 200 with isRemoved=true on valid removal", async () => {
      // Create a fresh attachment to remove
      const category = await prisma.category.findFirst({
        where: { isActive: true },
        select: { id: true },
      });
      const relatedSystem = await prisma.relatedSystem.findFirst({
        where: { isActive: true },
        select: { id: true },
      });

      const tempTicket = await prisma.ticket.create({
        data: {
          ticketNumber: `TKT-2026-REMOVE-${Date.now()}`,
          requesterId: requesterA.id,
          categoryId: category!.id,
          relatedSystemId: relatedSystem!.id,
          summary: "Ticket for remove test",
          description: "This ticket is used for testing attachment removal endpoint.",
          requestedPriority: "LOW",
        },
        select: { id: true, ticketNumber: true },
      });

      // Add an attachment
      const addRes = await request(app)
        .post(`/api/tickets/${tempTicket.ticketNumber}/attachments`)
        .set("X-Dev-Requester-Id", String(requesterA.id))
        .attach("attachments", fakePng(), {
          filename: "to_remove.png",
          contentType: "image/png",
        });
      expect(addRes.status).toBe(201);
      const attId = addRes.body.attachments[0].id;

      // Remove it
      const delRes = await del(
        `/api/attachments/${attId}`,
        requesterA.id,
        { removalReason: "Uploaded the wrong file by mistake" },
      );

      expect(delRes.status).toBe(200);
      expect(delRes.body.attachment).toBeDefined();
      expect(delRes.body.attachment.id).toBe(attId);
      expect(delRes.body.attachment.isRemoved).toBe(true);
      expect(delRes.body.attachment.removedAt).toBeDefined();
      expect(delRes.body.attachment.removedReason).toBe(
        "Uploaded the wrong file by mistake",
      );

      // Verify download now returns 404
      const dlRes = await get(
        `/api/attachments/${attId}/download`,
        requesterA.id,
      );
      expect(dlRes.status).toBe(404);

      // Cleanup
      await prisma.attachment.deleteMany({
        where: { ticketId: tempTicket.id },
      });
      await prisma.ticket.delete({ where: { id: tempTicket.id } });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // API-22: DELETE without removalReason → 400
  // ══════════════════════════════════════════════════════════════════════

  describe("API-22 — DELETE validation (AC-20, BR-34)", () => {
    it("returns 400 when removalReason is missing", async () => {
      const res = await del(
        `/api/attachments/${activeAttachmentId}`,
        requesterA.id,
        {},
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.fieldErrors.removalReason).toBeDefined();
    });

    it("returns 400 when removalReason is too short (<3 chars)", async () => {
      const res = await del(
        `/api/attachments/${activeAttachmentId}`,
        requesterA.id,
        { removalReason: "ab" },
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when removalReason is too long (>200 chars)", async () => {
      const res = await del(
        `/api/attachments/${activeAttachmentId}`,
        requesterA.id,
        { removalReason: "x".repeat(201) },
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("attachment remains active after failed removal attempt", async () => {
      // Verify the active attachment is still active
      const metaRes = await get(
        `/api/attachments/${activeAttachmentId}`,
        requesterA.id,
      );
      expect(metaRes.status).toBe(200);
      expect(metaRes.body.attachment.isRemoved).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // API-23: DELETE on cross-requester attachment → 404
  // ══════════════════════════════════════════════════════════════════════

  describe("API-23 — DELETE cross-requester (BR-33)", () => {
    it("returns 404 when removing another requester's attachment", async () => {
      const res = await del(
        `/api/attachments/${activeAttachmentId}`,
        requesterB.id,
        { removalReason: "Trying to remove someone else file" },
      );

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("ATTACHMENT_NOT_FOUND");
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Extra: DELETE already-removed attachment → 404 (idempotent rejected)
  // ══════════════════════════════════════════════════════════════════════

  describe("DELETE already-removed attachment — idempotent rejection", () => {
    it("returns 404 when trying to remove an already-removed attachment", async () => {
      const res = await del(
        `/api/attachments/${removedAttachmentId}`,
        requesterA.id,
        { removalReason: "Trying to remove again" },
      );

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("ATTACHMENT_NOT_FOUND");
      expect(res.body.error.message).toContain("already removed");
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Auth: 401 for all endpoints without header
  // ══════════════════════════════════════════════════════════════════════

  describe("Auth — 401 without X-Dev-Requester-Id header", () => {
    it("POST returns 401 without header", async () => {
      const res = await request(app)
        .post(`/api/tickets/${existingTicketNumber}/attachments`)
        .attach("attachments", fakePng(), {
          filename: "test.png",
          contentType: "image/png",
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
    });

    it("GET metadata returns 401 without header", async () => {
      const res = await request(app).get(
        `/api/attachments/${activeAttachmentId}`,
      );
      expect(res.status).toBe(401);
    });

    it("GET download returns 401 without header", async () => {
      const res = await request(app).get(
        `/api/attachments/${activeAttachmentId}/download`,
      );
      expect(res.status).toBe(401);
    });

    it("DELETE returns 401 without header", async () => {
      const res = await request(app)
        .delete(`/api/attachments/${activeAttachmentId}`)
        .send({ removalReason: "test reason" });
      expect(res.status).toBe(401);
    });
  });
});
