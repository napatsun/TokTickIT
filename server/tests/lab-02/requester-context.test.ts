import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express, { Request, Response } from "express";
import { requesterContext } from "../../src/middleware/requester-context.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";

const prisma = getPrisma();

/**
 * Requester Context Middleware — BR-41 single access point
 *
 * Verifies that the middleware:
 * - Rejects requests with missing/invalid X-Dev-Requester-Id header
 * - Rejects inactive requesters
 * - Accepts valid active requesters and attaches req.currentRequester
 *
 * We create a minimal Express app with the middleware + a test route
 * that echoes back `req.currentRequester` to verify attachment.
 *
 * NOTE: IDs are looked up dynamically from the DB because the seed
 * idempotency test deletes all records and re-seeds, advancing
 * autoincrement sequences.
 */

// ─── Test app setup ─────────────────────────────────────────────────────

function createTestApp() {
  const testApp = express();

  // Test endpoint protected by the middleware
  testApp.get("/protected", requesterContext, (req: Request, res: Response) => {
    res.status(200).json({ currentRequester: req.currentRequester });
  });

  return testApp;
}

const testApp = createTestApp();

// ─── Dynamic ID lookup ──────────────────────────────────────────────────

let activeRequester1: { id: number; fullName: string; email: string };
let activeRequester2: { id: number; fullName: string; email: string };
let activeRequester3: { id: number; fullName: string; email: string };
let inactiveRequester: { id: number; fullName: string; email: string };

// ─── Tests ──────────────────────────────────────────────────────────────

describe("requesterContext middleware", () => {
  beforeAll(async () => {
    await seed();

    // Look up actual IDs from DB (may vary due to seed.idempotency test)
    const requesters = await prisma.devRequester.findMany({
      orderBy: { id: "asc" },
      select: { id: true, fullName: true, email: true, isActive: true },
    });

    const active = requesters.filter((r) => r.isActive);
    const inactive = requesters.find((r) => !r.isActive);

    expect(active.length).toBeGreaterThanOrEqual(3);
    expect(inactive).toBeDefined();

    activeRequester1 = active[0];
    activeRequester2 = active[1];
    activeRequester3 = active[2];
    inactiveRequester = inactive!;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ─── Reject cases ───────────────────────────────────────────────────

  describe("rejects invalid requests", () => {
    it("returns 401 when X-Dev-Requester-Id header is missing", async () => {
      const res = await request(testApp).get("/protected");

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: {
          code: "INVALID_REQUESTER_CONTEXT",
          message: "No active Development Requester selected.",
        },
      });
    });

    it("returns 401 when header is an empty string", async () => {
      const res = await request(testApp)
        .get("/protected")
        .set("X-Dev-Requester-Id", "");

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
    });

    it("returns 401 when header is non-numeric text", async () => {
      const res = await request(testApp)
        .get("/protected")
        .set("X-Dev-Requester-Id", "hello");

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
    });

    it("returns 401 when header is a decimal number", async () => {
      const res = await request(testApp)
        .get("/protected")
        .set("X-Dev-Requester-Id", "1.5");

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
    });

    it("returns 401 when header is zero", async () => {
      const res = await request(testApp)
        .get("/protected")
        .set("X-Dev-Requester-Id", "0");

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
    });

    it("returns 401 when header is negative", async () => {
      const res = await request(testApp)
        .get("/protected")
        .set("X-Dev-Requester-Id", "-1");

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
    });

    it("returns 401 when requester does not exist", async () => {
      const res = await request(testApp)
        .get("/protected")
        .set("X-Dev-Requester-Id", "99999");

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
    });

    it("returns 401 when requester is inactive", async () => {
      const res = await request(testApp)
        .get("/protected")
        .set("X-Dev-Requester-Id", String(inactiveRequester.id));

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
    });
  });

  // ─── Accept cases ──────────────────────────────────────────────────

  describe("accepts valid requests", () => {
    it("returns 200 and attaches currentRequester for a valid active requester", async () => {
      const res = await request(testApp)
        .get("/protected")
        .set("X-Dev-Requester-Id", String(activeRequester1.id));

      expect(res.status).toBe(200);
      expect(res.body.currentRequester).toBeDefined();
      expect(res.body.currentRequester.id).toBe(activeRequester1.id);
      expect(res.body.currentRequester.fullName).toBe(activeRequester1.fullName);
      expect(res.body.currentRequester.email).toBe(activeRequester1.email);
    });

    it("attaches correct requester data for a different active requester", async () => {
      const res = await request(testApp)
        .get("/protected")
        .set("X-Dev-Requester-Id", String(activeRequester2.id));

      expect(res.status).toBe(200);
      expect(res.body.currentRequester.id).toBe(activeRequester2.id);
      expect(res.body.currentRequester.fullName).toBe(activeRequester2.fullName);
      expect(res.body.currentRequester.email).toBe(activeRequester2.email);
    });

    it("works with string numeric header (common client behavior)", async () => {
      const res = await request(testApp)
        .get("/protected")
        .set("X-Dev-Requester-Id", String(activeRequester3.id));

      expect(res.status).toBe(200);
      expect(res.body.currentRequester.id).toBe(activeRequester3.id);
      expect(res.body.currentRequester.fullName).toBe(activeRequester3.fullName);
    });
  });

  // ─── Error response shape ──────────────────────────────────────────

  describe("error response shape", () => {
    it("follows Common Error Shape from api-spec.md", async () => {
      const res = await request(testApp).get("/protected");

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toHaveProperty("code");
      expect(res.body.error).toHaveProperty("message");
      expect(typeof res.body.error.code).toBe("string");
      expect(typeof res.body.error.message).toBe("string");
      // No fieldErrors on 401 (fieldErrors only for 400 validation)
      expect(res.body.error.fieldErrors).toBeUndefined();
    });
  });
});
