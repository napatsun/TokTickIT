import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";
import { isValidTicketNumber } from "../../src/services/ticket-number.js";

const prisma = getPrisma();

/**
 * POST /api/tickets — api-spec.md §4
 *
 * Creates a Ticket for the current Requester.
 * Phase 4: multipart/form-data (no attachments in these tests,
 * but all requests use multipart to match production behavior).
 *
 * Response 201: { ticket, attachments: [], attachmentFailures: [] }
 *
 * Business rules tested:
 *   BR-06  Ticket number format: TKT-{YYYY}-{6-digit}
 *   BR-07  currentStatus = NEW
 *   BR-08  itPriority = null, ticketOwnerId = null
 *   BR-09  createdAt set by backend
 *   BR-19  Summary: trimmed, 5-120 chars
 *   BR-20  Description: trimmed, 20-2000 chars
 *   BR-21  Category/RelatedSystem must be active
 *   BR-22  RequestedPriority: LOW/MEDIUM/HIGH only
 *   BR-26  Safe error messages
 */
describe("POST /api/tickets", () => {
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

  // ─── Multipart helpers ──────────────────────────────────────────────

  const DEFAULTS = {
    categoryId: 0, // replaced in beforeAll
    relatedSystemId: 0,
    summary: "Laptop battery drains quickly",
    description:
      "My laptop battery is draining much faster than usual. It used to last 8 hours but now barely makes it through 3.",
    requestedPriority: "MEDIUM",
  };

  /**
   * Build a supertest request with multipart form fields.
   * Overrides replace specific fields; omitting a field means it won't
   * be included in the multipart body (simulates missing field).
   */
  function postTicket(
    overrides: Record<string, string> = {},
    requesterId?: number,
  ) {
    const fields: Record<string, string> = {
      categoryId: String(activeCategoryId),
      relatedSystemId: String(activeRelatedSystemId),
      summary: DEFAULTS.summary,
      description: DEFAULTS.description,
      requestedPriority: DEFAULTS.requestedPriority,
      ...overrides,
    };

    let chain = request(app)
      .post("/api/tickets")
      .set("X-Dev-Requester-Id", String(requesterId ?? activeRequesterId));

    // .field() each key — omitting a key means it won't be in the body
    for (const [key, value] of Object.entries(fields)) {
      chain = chain.field(key, value);
    }

    return chain;
  }

  /**
   * Build a multipart request with specific fields only (no defaults).
   * Used for "missing field" tests where we intentionally omit fields.
   */
  function postTicketPartial(
    fields: Record<string, string>,
    requesterId?: number,
  ) {
    let chain = request(app)
      .post("/api/tickets")
      .set("X-Dev-Requester-Id", String(requesterId ?? activeRequesterId));

    for (const [key, value] of Object.entries(fields)) {
      chain = chain.field(key, value);
    }

    return chain;
  }

  // ─── Happy path ──────────────────────────────────────────────────────

  describe("happy path", () => {
    it("returns 201 with ticket, empty attachments, and empty attachmentFailures", async () => {
      const res = await postTicket();

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("ticket");
      expect(res.body).toHaveProperty("attachments");
      expect(res.body).toHaveProperty("attachmentFailures");
      expect(Array.isArray(res.body.attachments)).toBe(true);
      expect(res.body.attachments.length).toBe(0);
      expect(Array.isArray(res.body.attachmentFailures)).toBe(true);
      expect(res.body.attachmentFailures.length).toBe(0);
    });

    it("generates a valid ticket number (BR-06)", async () => {
      const res = await postTicket();

      expect(res.status).toBe(201);
      expect(isValidTicketNumber(res.body.ticket.ticketNumber)).toBe(true);

      const year = new Date().getFullYear();
      expect(res.body.ticket.ticketNumber).toMatch(
        new RegExp(`^TKT-${year}-\\d{6}$`),
      );
    });

    it("sets currentStatus to NEW (BR-07)", async () => {
      const res = await postTicket();

      expect(res.status).toBe(201);
      expect(res.body.ticket.currentStatus).toBe("NEW");
    });

    it("sets itPriority and ticketOwnerId to null (BR-08)", async () => {
      const res = await postTicket();

      expect(res.status).toBe(201);
      expect(res.body.ticket.itPriority).toBeNull();
      expect(res.body.ticket.ticketOwner).toBeNull();
    });

    it("sets ticketDate from backend (BR-09)", async () => {
      const res = await postTicket();

      expect(res.status).toBe(201);
      expect(res.body.ticket.ticketDate).toBeDefined();
      expect(
        new Date(res.body.ticket.ticketDate).toISOString(),
      ).toBe(res.body.ticket.ticketDate);
    });

    it("includes requester, category, and relatedSystem objects", async () => {
      const res = await postTicket();

      expect(res.status).toBe(201);
      expect(res.body.ticket.requester).toHaveProperty("id");
      expect(res.body.ticket.requester).toHaveProperty("fullName");
      expect(res.body.ticket.category).toHaveProperty("id");
      expect(res.body.ticket.category).toHaveProperty("name");
      expect(res.body.ticket.relatedSystem).toHaveProperty("id");
      expect(res.body.ticket.relatedSystem).toHaveProperty("name");
    });

    it("accepts all three priority values", async () => {
      for (const priority of ["LOW", "MEDIUM", "HIGH"]) {
        const res = await postTicket({ requestedPriority: priority });

        expect(res.status).toBe(201);
        expect(res.body.ticket.requestedPriority).toBe(priority);
      }
    });

    it("trims summary and description (BR-19/BR-20)", async () => {
      const res = await postTicket({
        summary: "  Laptop battery drains quickly  ",
        description:
          "  My laptop battery is draining much faster than usual. It used to last 8 hours but now barely makes it through 3.  ",
      });

      expect(res.status).toBe(201);
      expect(res.body.ticket.summary).toBe("Laptop battery drains quickly");
      expect(res.body.ticket.description).toMatch(/^My laptop battery/);
    });

    it("returns unique ticket numbers on successive requests", async () => {
      const res1 = await postTicket({
        summary: "First ticket for uniqueness test",
      });

      const res2 = await postTicket({
        summary: "Second ticket for uniqueness test",
      });

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.ticket.ticketNumber).not.toBe(
        res2.body.ticket.ticketNumber,
      );
    });
  });

  // ─── Validation: summary (BR-19) ─────────────────────────────────────

  describe("summary validation (BR-19)", () => {
    it("rejects empty summary with 400", async () => {
      const res = await postTicket({ summary: "" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.fieldErrors).toHaveProperty("summary");
    });

    it("rejects summary shorter than 5 chars", async () => {
      const res = await postTicket({ summary: "Hi" });

      expect(res.status).toBe(400);
      expect(res.body.error.fieldErrors.summary).toContain("5");
    });

    it("rejects summary longer than 120 chars", async () => {
      const res = await postTicket({ summary: "A".repeat(121) });

      expect(res.status).toBe(400);
      expect(res.body.error.fieldErrors.summary).toContain("120");
    });

    it("accepts summary at exactly 5 chars", async () => {
      const res = await postTicket({ summary: "Hello" });

      expect(res.status).toBe(201);
    });

    it("accepts summary at exactly 120 chars", async () => {
      const res = await postTicket({ summary: "A".repeat(120) });

      expect(res.status).toBe(201);
    });

    it("rejects missing summary field", async () => {
      // Multipart pattern: don't include .field("summary", ...)
      // → req.body.summary is undefined → validation error
      const res = await postTicketPartial({
        categoryId: String(activeCategoryId),
        relatedSystemId: String(activeRelatedSystemId),
        description: DEFAULTS.description,
        requestedPriority: DEFAULTS.requestedPriority,
      });

      expect(res.status).toBe(400);
      expect(res.body.error.fieldErrors).toHaveProperty("summary");
    });
  });

  // ─── Validation: description (BR-20) ─────────────────────────────────

  describe("description validation (BR-20)", () => {
    it("rejects empty description with 400", async () => {
      const res = await postTicket({ description: "" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.fieldErrors).toHaveProperty("description");
    });

    it("rejects description shorter than 20 chars", async () => {
      const res = await postTicket({ description: "Too short" });

      expect(res.status).toBe(400);
      expect(res.body.error.fieldErrors.description).toContain("20");
    });

    it("rejects description longer than 2000 chars", async () => {
      const res = await postTicket({ description: "A".repeat(2001) });

      expect(res.status).toBe(400);
      expect(res.body.error.fieldErrors.description).toContain("2000");
    });

    it("accepts description at exactly 20 chars", async () => {
      const res = await postTicket({ description: "A".repeat(20) });

      expect(res.status).toBe(201);
    });

    it("accepts description at exactly 2000 chars", async () => {
      const res = await postTicket({ description: "A".repeat(2000) });

      expect(res.status).toBe(201);
    });
  });

  // ─── Validation: requestedPriority (BR-22) ───────────────────────────

  describe("requestedPriority validation (BR-22)", () => {
    it("rejects invalid priority value", async () => {
      const res = await postTicket({ requestedPriority: "URGENT" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.fieldErrors).toHaveProperty("requestedPriority");
    });

    it("accepts lowercase priority (normalized to uppercase)", async () => {
      const res = await postTicket({ requestedPriority: "medium" });

      expect(res.status).toBe(201);
    });

    it("rejects missing priority field", async () => {
      // Multipart pattern: don't include .field("requestedPriority", ...)
      const res = await postTicketPartial({
        categoryId: String(activeCategoryId),
        relatedSystemId: String(activeRelatedSystemId),
        summary: DEFAULTS.summary,
        description: DEFAULTS.description,
      });

      expect(res.status).toBe(400);
      expect(res.body.error.fieldErrors).toHaveProperty("requestedPriority");
    });

    it("rejects empty string priority", async () => {
      const res = await postTicket({ requestedPriority: "" });

      expect(res.status).toBe(400);
      expect(res.body.error.fieldErrors).toHaveProperty("requestedPriority");
    });
  });

  // ─── Reference validation (BR-21) ────────────────────────────────────

  describe("reference validation (BR-21)", () => {
    it("rejects non-existent categoryId", async () => {
      const res = await postTicket({ categoryId: "99999" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_REFERENCE");
      expect(res.body.error.fieldErrors).toHaveProperty("categoryId");
    });

    it("rejects non-existent relatedSystemId", async () => {
      const res = await postTicket({ relatedSystemId: "99999" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_REFERENCE");
      expect(res.body.error.fieldErrors).toHaveProperty("relatedSystemId");
    });

    it("rejects inactive categoryId", async () => {
      const inactiveCategory = await prisma.category.create({
        data: { name: `Inactive Cat ${crypto.randomUUID()}`, isActive: false },
      });

      const res = await postTicket({
        categoryId: String(inactiveCategory.id),
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_REFERENCE");
      expect(res.body.error.fieldErrors.categoryId).toContain(
        "no longer available",
      );

      await prisma.category.delete({ where: { id: inactiveCategory.id } });
    });

    it("rejects inactive relatedSystemId", async () => {
      const inactiveRS = await prisma.relatedSystem.create({
        data: { name: `Inactive RS ${crypto.randomUUID()}`, isActive: false },
      });

      const res = await postTicket({
        relatedSystemId: String(inactiveRS.id),
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_REFERENCE");
      expect(res.body.error.fieldErrors.relatedSystemId).toContain(
        "no longer available",
      );

      await prisma.relatedSystem.delete({ where: { id: inactiveRS.id } });
    });
  });

  // ─── Multiple field errors ───────────────────────────────────────────

  describe("multiple field errors", () => {
    it("returns all field errors at once when multiple fields are invalid", async () => {
      const res = await postTicketPartial({
        summary: "Hi",
        description: "Short",
        requestedPriority: "INVALID",
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(Object.keys(res.body.error.fieldErrors).length).toBeGreaterThanOrEqual(3);
    });
  });

  // ─── Auth (BR-05) ────────────────────────────────────────────────────

  describe("auth", () => {
    it("returns 401 without X-Dev-Requester-Id header", async () => {
      const res = await postTicket({}, 0); // requesterId 0 → no header set

      // Actually need to not set the header at all
      const res2 = await request(app)
        .post("/api/tickets")
        .field("categoryId", String(activeCategoryId))
        .field("relatedSystemId", String(activeRelatedSystemId))
        .field("summary", DEFAULTS.summary)
        .field("description", DEFAULTS.description)
        .field("requestedPriority", DEFAULTS.requestedPriority);

      expect(res2.status).toBe(401);
      expect(res2.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
    });

    it("returns 401 with inactive requester", async () => {
      const inactive = await prisma.devRequester.findFirst({
        where: { isActive: false },
        select: { id: true },
      });
      if (!inactive) return;

      const res = await postTicket({}, inactive.id);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
    });

    it("returns 401 with non-existent requester id", async () => {
      const res = await postTicket({}, 99999);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
    });
  });

  // ─── Error response shape ────────────────────────────────────────────

  describe("error response shape", () => {
    it("follows Common Error Shape for validation errors", async () => {
      const res = await postTicket({ summary: "" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toHaveProperty("code");
      expect(res.body.error).toHaveProperty("message");
      expect(res.body.error).toHaveProperty("fieldErrors");
      expect(typeof res.body.error.code).toBe("string");
      expect(typeof res.body.error.message).toBe("string");
      expect(typeof res.body.error.fieldErrors).toBe("object");
    });
  });
});
