import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express, { Request, Response, NextFunction } from "express";
import { app } from "../../src/app.js";
import { requesterContext } from "../../src/middleware/requester-context.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";
import {
  createTestUser,
  loginAs,
  cleanupTestUsers,
  type SessionClient,
  type TestUser,
} from "../helpers/session.js";

const prisma = getPrisma();

/**
 * Requester Context Middleware — BR-03 / BR-41 single access point
 *
 * Lab 3 removes the `X-Dev-Requester-Id` bridge: `requesterContext` no longer
 * resolves any request header. It only re-projects the session identity that
 * `requireAuth` already resolved (`req.currentUser`) into the Lab 2
 * `currentRequester` shape used by the ticket handlers.
 *
 * Covered here:
 *   - 401 when no authenticated user is on the request
 *   - `req.currentRequester` is populated with id / fullName / email
 *   - the real app rejects a dev header without a session (header removed)
 */

// ─── Minimal app: optional injected session user + middleware ────────────

function createTestApp() {
  const testApp = express();
  testApp.use((req: Request, _res: Response, next: NextFunction) => {
    const header = req.header("X-Test-User");
    if (header) {
      const [id, name, email] = header.split("|");
      req.currentUser = {
        id,
        name,
        email,
        role: "REQUESTER",
        isActive: true,
        mustChangePassword: false,
      };
    }
    next();
  });
  testApp.get("/protected", requesterContext, (req: Request, res: Response) => {
    res.status(200).json({ currentRequester: req.currentRequester });
  });
  return testApp;
}

const testApp = createTestApp();

// ─── Tests ──────────────────────────────────────────────────────────────

describe("requesterContext middleware (session-based)", () => {
  let requester: TestUser;
  let client: SessionClient;

  beforeAll(async () => {
    await seed();
    requester = await createTestUser({ name: "Context Requester", role: "REQUESTER" });
    client = await loginAs(app, requester.email);
  });

  afterAll(async () => {
    await cleanupTestUsers([requester.id]);
    await prisma.$disconnect();
  });

  describe("rejects unauthenticated requests", () => {
    it("returns 401 when there is no authenticated user", async () => {
      const res = await request(testApp).get("/protected");

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication required.",
        },
      });
    });

    it("follows the Common Error Shape from api-spec.md", async () => {
      const res = await request(testApp).get("/protected");

      expect(res.status).toBe(401);
      expect(res.body.error).toHaveProperty("code");
      expect(res.body.error).toHaveProperty("message");
      expect(typeof res.body.error.code).toBe("string");
      expect(typeof res.body.error.message).toBe("string");
      expect(res.body.error.fieldErrors).toBeUndefined();
    });

    it("no longer accepts the retired X-Dev-Requester-Id header on the real app", async () => {
      const res = await request(app)
        .get("/api/tickets")
        .set("X-Dev-Requester-Id", String(requester.id));

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });
  });

  describe("accepts an authenticated session", () => {
    it("attaches currentRequester derived from the session user", async () => {
      const res = await client.agent.get("/api/categories");

      // The real handlers only run when currentRequester resolved; a 200 proves
      // the middleware attached it without throwing.
      expect(res.status).toBe(200);
    });

    it("maps the session user onto the Lab 2 currentRequester shape", async () => {
      const res = await request(testApp)
        .get("/protected")
        .set("X-Test-User", `${requester.id}|${requester.name}|${requester.email}`);

      expect(res.status).toBe(200);
      expect(res.body.currentRequester).toEqual({
        id: requester.id,
        fullName: requester.name,
        email: requester.email,
      });
    });
  });
});
