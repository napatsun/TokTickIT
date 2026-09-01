import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";

const prisma = getPrisma();

/**
 * POST /api/tickets — RECORD_CREATION_FAILED scenario (BR-31)
 *
 * Tests the case where saveAttachmentFile succeeds (file written to disk)
 * but prisma.attachment.create() fails (DB error). The ticket is still
 * created (201), the attachment is reported as failed with reason
 * "RECORD_CREATION_FAILED" — distinct from "UPLOAD_INTERRUPTED".
 *
 * This test is isolated in its own file because vi.spyOn on Prisma's
 * proxy-based client doesn't cleanly restore, which would break
 * subsequent tests in the same file.
 */

/** Minimal valid JPEG file */
function fakeJpeg(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

describe("POST /api/tickets — RECORD_CREATION_FAILED reason", () => {
  let activeRequesterId: number;
  let activeCategoryId: number;
  let activeRelatedSystemId: number;

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

    activeRequesterId = requester!.id;
    activeCategoryId = category!.id;
    activeRelatedSystemId = relatedSystem!.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns RECORD_CREATION_FAILED when disk write succeeds but DB insert fails", async () => {
    // Mock only prisma.attachment.create to fail on the first call.
    // saveAttachmentFile is NOT mocked — it writes to disk normally,
    // proving that the file write succeeds but the DB record fails.
    const spy = vi.spyOn(prisma.attachment, "create");
    spy.mockRejectedValueOnce(new Error("Simulated DB insert failure"));

    try {
      const res = await request(app)
        .post("/api/tickets")
        .set("X-Dev-Requester-Id", String(activeRequesterId))
        .field("categoryId", String(activeCategoryId))
        .field("relatedSystemId", String(activeRelatedSystemId))
        .field("summary", "DB insert failure test")
        .field("description", "This ticket tests RECORD_CREATION_FAILED reason when DB insert fails")
        .field("requestedPriority", "MEDIUM")
        .attach("attachments", fakeJpeg(), { filename: "dbfail.jpg", contentType: "image/jpeg" });

      expect(res.status).toBe(201);
      expect(res.body.ticket).toBeDefined();
      expect(res.body.attachments).toHaveLength(0);
      expect(res.body.attachmentFailures).toHaveLength(1);
      expect(res.body.attachmentFailures[0].originalFileName).toBe("dbfail.jpg");
      expect(res.body.attachmentFailures[0].reason).toBe("RECORD_CREATION_FAILED");
    } finally {
      spy.mockRestore();
    }
  });
});
