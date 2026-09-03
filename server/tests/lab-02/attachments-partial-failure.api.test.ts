import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";

const prisma = getPrisma();

/**
 * POST /api/tickets/:ticketNumber/attachments — RECORD_CREATION_FAILED (BR-31)
 *
 * Tests that when DB insert fails for an attachment, the file is reported
 * in attachmentFailures with reason "RECORD_CREATION_FAILED" and the ticket
 * remains unaffected.
 *
 * Uses the same technique as create-ticket-attachments-db-failure.api.test.ts:
 * vi.spyOn with mockRejectedValueOnce — only works reliably with a single
 * file (single create call), so this test sends exactly 1 file.
 *
 * Isolated in its own file because vi.spyOn on Prisma's proxy-based
 * client doesn't cleanly restore — would break subsequent tests.
 */

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

describe("POST /api/tickets/:ticketNumber/attachments — RECORD_CREATION_FAILED", () => {
  let requesterId: number;
  let ticketId: number;
  let ticketNumber: string;

  beforeAll(async () => {
    await seed();

    const requester = await prisma.devRequester.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    const category = await prisma.category.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    const relatedSystem = await prisma.relatedSystem.findFirst({
      where: { isActive: true },
      select: { id: true },
    });

    expect(requester).toBeDefined();
    expect(category).toBeDefined();
    expect(relatedSystem).toBeDefined();

    requesterId = requester!.id;

    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber: `TKT-2026-PARTIAL-${Date.now()}`,
        requesterId: requester!.id,
        categoryId: category!.id,
        relatedSystemId: relatedSystem!.id,
        summary: "Partial failure test ticket",
        description: "This ticket tests partial attachment upload failure scenarios.",
        requestedPriority: "LOW",
      },
      select: { id: true, ticketNumber: true },
    });

    ticketId = ticket.id;
    ticketNumber = ticket.ticketNumber;
  });

  afterAll(async () => {
    await prisma.attachment.deleteMany({ where: { ticketId } });
    await prisma.ticket.delete({ where: { id: ticketId } });
  });

  it("returns RECORD_CREATION_FAILED when disk write succeeds but DB insert fails", async () => {
    // Same technique as create-ticket-attachments-db-failure.api.test.ts:
    // vi.spyOn with mockRejectedValueOnce — sends exactly 1 file.
    // saveAttachmentFile is NOT mocked — it writes to disk normally,
    // proving that the file write succeeds but the DB record fails.
    const spy = vi.spyOn(prisma.attachment, "create");
    spy.mockRejectedValueOnce(new Error("Simulated DB insert failure"));

    try {
      const res = await request(app)
        .post(`/api/tickets/${ticketNumber}/attachments`)
        .set("X-Dev-Requester-Id", String(requesterId))
        .attach("attachments", fakePng(), {
          filename: "dbfail.png",
          contentType: "image/png",
        });

      expect(res.status).toBe(201);

      // No attachments created (DB insert failed)
      expect(res.body.attachments).toHaveLength(0);

      // Failure reported with correct reason
      expect(res.body.attachmentFailures).toHaveLength(1);
      expect(res.body.attachmentFailures[0].originalFileName).toBe("dbfail.png");
      expect(res.body.attachmentFailures[0].reason).toBe("RECORD_CREATION_FAILED");

      // Ticket still exists and is unaffected
      const ticketStillExists = await prisma.ticket.findUnique({
        where: { id: ticketId },
      });
      expect(ticketStillExists).toBeDefined();
      expect(ticketStillExists!.ticketNumber).toBe(ticketNumber);
    } finally {
      spy.mockRestore();
    }
  });

  // NOTE: Happy path (attachmentFailures empty on success) is tested in
  // attachments.api.test.ts. Cannot add a second test here because
  // vi.spyOn on Prisma's proxy-based client doesn't cleanly restore —
  // the mock from the first test leaks into subsequent tests in the
  // same file.
});
