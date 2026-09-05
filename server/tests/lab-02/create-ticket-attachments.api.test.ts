import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";
import { UPLOADS_DIR } from "../../src/services/attachmentStorage.js";

const prisma = getPrisma();

/**
 * POST /api/tickets — Attachment Upload Tests (BR-28 to BR-32)
 *
 * Tests the attachment upload flow when creating a ticket:
 * - Happy path with 1 file, 5 files
 * - Rejection: >5 files, >5MB, unsupported type, MIME/extension mismatch
 * - Partial failure (BR-31): ticket survives attachment failure
 * - Disk write verification
 */

// ─── Test file helpers ──────────────────────────────────────────────────

/** Minimal valid JPEG file (smallest possible) */
function fakeJpeg(name = "test.jpg"): Buffer {
  // JPEG SOI marker + APP0 + minimal content
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

/** Minimal valid PNG file */
function fakePng(name = "test.png"): Buffer {
  // PNG signature + IHDR chunk
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
    0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND chunk
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

/** Create a buffer of specified size (filled with dummy bytes) */
function fakeLargeFile(sizeBytes: number): Buffer {
  return Buffer.alloc(sizeBytes, 0x41);
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("POST /api/tickets — attachments", () => {
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ─── Happy path ──────────────────────────────────────────────────────

  describe("happy path", () => {
    it("creates ticket with 1 JPG attachment", async () => {
      const res = await request(app)
        .post("/api/tickets")
        .set("X-Dev-Requester-Id", String(activeRequesterId))
        .field("categoryId", String(activeCategoryId))
        .field("relatedSystemId", String(activeRelatedSystemId))
        .field("summary", "Ticket with attachment test")
        .field("description", "This ticket tests attachment upload functionality")
        .field("requestedPriority", "MEDIUM")
        .attach("attachments", fakeJpeg(), { filename: "screenshot.jpg", contentType: "image/jpeg" });

      expect(res.status).toBe(201);
      expect(res.body.ticket).toBeDefined();
      expect(res.body.attachments).toHaveLength(1);
      expect(res.body.attachmentFailures).toHaveLength(0);

      const att = res.body.attachments[0];
      expect(att).toHaveProperty("id");
      expect(att.originalFileName).toBe("screenshot.jpg");
      expect(att.mimeType).toBe("image/jpeg");
      expect(att.fileSizeBytes).toBeGreaterThan(0);
      expect(att).toHaveProperty("uploadedAt");
    });

    it("creates ticket with 5 attachments (BR-30 max)", async () => {
      const res = await request(app)
        .post("/api/tickets")
        .set("X-Dev-Requester-Id", String(activeRequesterId))
        .field("categoryId", String(activeCategoryId))
        .field("relatedSystemId", String(activeRelatedSystemId))
        .field("summary", "Ticket with 5 attachments")
        .field("description", "This ticket tests the maximum attachment limit of 5 files")
        .field("requestedPriority", "LOW")
        .attach("attachments", fakeJpeg(), { filename: "file1.jpg", contentType: "image/jpeg" })
        .attach("attachments", fakePng(), { filename: "file2.png", contentType: "image/png" })
        .attach("attachments", fakeJpeg(), { filename: "file3.jpg", contentType: "image/jpeg" })
        .attach("attachments", fakePng(), { filename: "file4.png", contentType: "image/png" })
        .attach("attachments", fakeJpeg(), { filename: "file5.jpg", contentType: "image/jpeg" });

      expect(res.status).toBe(201);
      expect(res.body.attachments).toHaveLength(5);
      expect(res.body.attachmentFailures).toHaveLength(0);
    });

    it("creates ticket with no attachments (optional per FR-04)", async () => {
      const res = await request(app)
        .post("/api/tickets")
        .set("X-Dev-Requester-Id", String(activeRequesterId))
        .field("categoryId", String(activeCategoryId))
        .field("relatedSystemId", String(activeRelatedSystemId))
        .field("summary", "Ticket without attachments test")
        .field("description", "This ticket has no attachments at all")
        .field("requestedPriority", "HIGH");

      expect(res.status).toBe(201);
      expect(res.body.attachments).toHaveLength(0);
      expect(res.body.attachmentFailures).toHaveLength(0);
    });
  });

  // ─── Rejection: >5 files (BR-30) ────────────────────────────────────

  describe("attachment limit (BR-30)", () => {
    it("rejects 6 files with 400", async () => {
      const res = await request(app)
        .post("/api/tickets")
        .set("X-Dev-Requester-Id", String(activeRequesterId))
        .field("categoryId", String(activeCategoryId))
        .field("relatedSystemId", String(activeRelatedSystemId))
        .field("summary", "Ticket with too many files")
        .field("description", "This ticket tries to exceed the 5 file attachment limit")
        .field("requestedPriority", "MEDIUM")
        .attach("attachments", fakeJpeg(), { filename: "f1.jpg", contentType: "image/jpeg" })
        .attach("attachments", fakeJpeg(), { filename: "f2.jpg", contentType: "image/jpeg" })
        .attach("attachments", fakeJpeg(), { filename: "f3.jpg", contentType: "image/jpeg" })
        .attach("attachments", fakeJpeg(), { filename: "f4.jpg", contentType: "image/jpeg" })
        .attach("attachments", fakeJpeg(), { filename: "f5.jpg", contentType: "image/jpeg" })
        .attach("attachments", fakeJpeg(), { filename: "f6.jpg", contentType: "image/jpeg" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.fieldErrors).toHaveProperty("attachments");
    });
  });

  // ─── Rejection: >5MB (BR-29) ────────────────────────────────────────

  describe("file size limit (BR-29)", () => {
    it("rejects file exceeding 5MB with 413", async () => {
      const largeBuffer = fakeLargeFile(6 * 1024 * 1024); // 6MB

      const res = await request(app)
        .post("/api/tickets")
        .set("X-Dev-Requester-Id", String(activeRequesterId))
        .field("categoryId", String(activeCategoryId))
        .field("relatedSystemId", String(activeRelatedSystemId))
        .field("summary", "Ticket with oversized file")
        .field("description", "This ticket tests the 5MB file size limit enforcement")
        .field("requestedPriority", "MEDIUM")
        .attach("attachments", largeBuffer, { filename: "large.jpg", contentType: "image/jpeg" });

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe("ATTACHMENT_TOO_LARGE");
      expect(res.body.error.fieldErrors).toHaveProperty("attachments");
    });
  });

  // ─── Rejection: unsupported type (BR-28) ─────────────────────────────

  describe("file type validation (BR-28)", () => {
    it("rejects .docx file with 415", async () => {
      const res = await request(app)
        .post("/api/tickets")
        .set("X-Dev-Requester-Id", String(activeRequesterId))
        .field("categoryId", String(activeCategoryId))
        .field("relatedSystemId", String(activeRelatedSystemId))
        .field("summary", "Ticket with docx file")
        .field("description", "This ticket tests rejection of unsupported file types like docx")
        .field("requestedPriority", "MEDIUM")
        .attach("attachments", Buffer.from("fake docx content"), {
          filename: "report.docx",
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });

      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe("UNSUPPORTED_ATTACHMENT_TYPE");
      expect(res.body.error.fieldErrors.attachments).toContain("report.docx");
    });

    it("rejects .gif file with 415", async () => {
      const res = await request(app)
        .post("/api/tickets")
        .set("X-Dev-Requester-Id", String(activeRequesterId))
        .field("categoryId", String(activeCategoryId))
        .field("relatedSystemId", String(activeRelatedSystemId))
        .field("summary", "Ticket with gif file")
        .field("description", "This ticket tests rejection of the GIF format")
        .field("requestedPriority", "MEDIUM")
        .attach("attachments", Buffer.from("fake gif content"), {
          filename: "animation.gif",
          contentType: "image/gif",
        });

      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe("UNSUPPORTED_ATTACHMENT_TYPE");
    });

    it("rejects MIME/extension mismatch (BR-28)", async () => {
      // BR-28: "extension and MIME type are both checked; a mismatched
      // extension/MIME pair is rejected"
      // Send a file with .png extension but image/jpeg MIME type
      const res = await request(app)
        .post("/api/tickets")
        .set("X-Dev-Requester-Id", String(activeRequesterId))
        .field("categoryId", String(activeCategoryId))
        .field("relatedSystemId", String(activeRelatedSystemId))
        .field("summary", "Ticket with mismatched MIME test")
        .field("description", "This ticket tests MIME/extension mismatch handling")
        .field("requestedPriority", "MEDIUM")
        .attach("attachments", fakeJpeg(), {
          filename: "image.png", // extension says PNG
          contentType: "image/jpeg", // but MIME says JPEG
        });

      // BR-28: rejected because extension (.png) does not match MIME (image/jpeg)
      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe("UNSUPPORTED_ATTACHMENT_TYPE");
    });
  });

  // ─── Partial failure (BR-31) ─────────────────────────────────────────

  describe("partial failure (BR-31)", () => {
    it("ticket survives when 1 of 3 attachments fails to upload", async () => {
      // Mock saveAttachmentFile to fail on the second call
      const attachmentStorage = await import("../../src/services/attachmentStorage.js");
      const originalSave = attachmentStorage.saveAttachmentFile;
      let callCount = 0;

      vi.spyOn(attachmentStorage, "saveAttachmentFile").mockImplementation(
        async (buffer: Buffer, safeFileName: string) => {
          callCount++;
          if (callCount === 2) {
            throw new Error("Simulated disk write failure");
          }
          return originalSave(buffer, safeFileName);
        },
      );

      try {
        const res = await request(app)
          .post("/api/tickets")
          .set("X-Dev-Requester-Id", String(activeRequesterId))
          .field("categoryId", String(activeCategoryId))
          .field("relatedSystemId", String(activeRelatedSystemId))
          .field("summary", "Ticket with partial failure test")
          .field("description", "This ticket tests partial attachment failure handling per BR-31")
          .field("requestedPriority", "MEDIUM")
          .attach("attachments", fakeJpeg(), { filename: "ok1.jpg", contentType: "image/jpeg" })
          .attach("attachments", fakeJpeg(), { filename: "fail.jpg", contentType: "image/jpeg" })
          .attach("attachments", fakeJpeg(), { filename: "ok2.jpg", contentType: "image/jpeg" });

        // BR-31: Ticket is still created (201), not rolled back
        expect(res.status).toBe(201);
        expect(res.body.ticket).toBeDefined();

        // 2 attachments succeeded, 1 failed
        expect(res.body.attachments).toHaveLength(2);
        expect(res.body.attachmentFailures).toHaveLength(1);
        expect(res.body.attachmentFailures[0].originalFileName).toBe("fail.jpg");
        expect(res.body.attachmentFailures[0].reason).toBe("UPLOAD_INTERRUPTED");
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  // ─── Disk write verification ─────────────────────────────────────────

  describe("disk write verification", () => {
    it("writes the actual file to server/uploads/", async () => {
      const res = await request(app)
        .post("/api/tickets")
        .set("X-Dev-Requester-Id", String(activeRequesterId))
        .field("categoryId", String(activeCategoryId))
        .field("relatedSystemId", String(activeRelatedSystemId))
        .field("summary", "Disk write verification test")
        .field("description", "This ticket verifies that attachment files are written to disk")
        .field("requestedPriority", "LOW")
        .attach("attachments", fakeJpeg(), { filename: "disktest.jpg", contentType: "image/jpeg" });

      expect(res.status).toBe(201);
      expect(res.body.attachments).toHaveLength(1);

      // Verify the file exists on disk
      const att = res.body.attachments[0];
      const filePath = path.join(UPLOADS_DIR, `${att.id}_disktest.jpg`);

      // The stored filename is UUID-based, so we need to find it
      // Query the attachment record to get the storedFileName
      const attachmentRecord = await prisma.attachment.findUnique({
        where: { id: att.id },
        select: { storedFileName: true },
      });
      expect(attachmentRecord).toBeDefined();

      const actualPath = path.join(UPLOADS_DIR, attachmentRecord!.storedFileName);
      const fileExists = await fs
        .access(actualPath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      // Verify file size matches
      const stat = await fs.stat(actualPath);
      expect(stat.size).toBe(att.fileSizeBytes);
    });
  });

});
