import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express, { Request, Response, NextFunction } from "express";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";
import {
  enforcePasswordChange,
  requireRole,
  type Role,
  type SessionUser,
} from "../../src/middleware/auth.js";
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
 * Authorization — tests.md §2 (Authorization / Role Navigation)
 *
 * Implemented so far:
 *   SEC-05  a body-supplied requesterId is ignored (session identity wins)
 *   SEC-07  cross-owner ticket access → 404, not 403
 *   SEC-08  no session cookie on any protected endpoint → 401
 *   + unit coverage for the reusable role guard and the mustChangePassword gate
 *
 * The remaining rows belong to later branches and are intentionally left as
 * skipped placeholders so tests.md traceability stays intact.
 */

let requesterA: TestUser;
let requesterB: TestUser;
let clientA: SessionClient;
let ticketA: { id: number; ticketNumber: string };

beforeAll(async () => {
  await seed();

  requesterA = await createTestUser({ name: "Authz Requester A" });
  requesterB = await createTestUser({ name: "Authz Requester B" });
  clientA = await loginAs(app, requesterA.email);

  const category = await prisma.category.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  const relatedSystem = await prisma.relatedSystem.findFirst({
    where: { isActive: true },
    select: { id: true },
  });

  ticketA = await prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2026-AUTHZ-A-${Date.now()}`,
      requesterId: requesterA.id,
      categoryId: category!.id,
      relatedSystemId: relatedSystem!.id,
      summary: "Authorization test ticket A",
      description: "This ticket is owned by Requester A for authorization boundary tests.",
      requestedPriority: "MEDIUM",
    },
    select: { id: true, ticketNumber: true },
  });
});

afterAll(async () => {
  await cleanupTestUsers([requesterA.id, requesterB.id]);
  await prisma.$disconnect();
});

// ─── SEC-08 ─────────────────────────────────────────────────────────────

describe("SEC-08 — unauthenticated access (FR-10)", () => {
  const protectedRoutes: Array<[string, string]> = [
    ["get", "/api/auth/me"],
    ["get", "/api/tickets"],
    ["get", "/api/tickets/TKT-2026-000001"],
    ["post", "/api/tickets"],
    ["get", "/api/categories"],
    ["get", "/api/related-systems"],
    ["get", "/api/attachments/1"],
    ["get", "/api/attachments/1/download"],
    ["delete", "/api/attachments/1"],
    ["get", "/api/tickets/TKT-2026-000001/comments"],
    ["post", "/api/tickets/TKT-2026-000001/comments"],
    ["post", "/api/tickets/TKT-2026-000001/resolve-mark"],
  ];

  for (const [method, path] of protectedRoutes) {
    it(`${method.toUpperCase()} ${path} → 401 without a session`, async () => {
      const res = await (request(app) as any)[method](path);

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
      expect(typeof res.body.error.code).toBe("string");
      expect(typeof res.body.error.message).toBe("string");
      // Never leak internals on an auth failure.
      expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:\d+/);
    });
  }

  it("POST /api/auth/logout → 401 without a session", async () => {
    const res = await request(app).post("/api/auth/logout");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });
});

// ─── requireRole (reusable role guard) ──────────────────────────────────

/** Minimal app that injects a fixed currentUser before the guarded route. */
function appWithUser(user: SessionUser | undefined) {
  const testApp = express();
  testApp.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = user;
    next();
  });
  testApp.get(
    "/staff-only",
    requireRole(["IT_STAFF", "ADMINISTRATOR"]),
    (_req: Request, res: Response) => res.status(200).json({ ok: true }),
  );
  return testApp;
}

function makeUser(role: Role): SessionUser {
  return {
    id: `test-${role}`,
    name: `Test ${role}`,
    email: `${role.toLowerCase()}@test.com`,
    role,
    isActive: true,
    mustChangePassword: false,
  };
}

describe("requireRole — reusable role guard (FR-09)", () => {
  it("returns 401 when the caller is not authenticated", async () => {
    const res = await request(appWithUser(undefined)).get("/staff-only");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 403 for an authenticated caller with the wrong role", async () => {
    const res = await request(appWithUser(makeUser("REQUESTER"))).get("/staff-only");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("allows every role in the allow-list", async () => {
    for (const role of ["IT_STAFF", "ADMINISTRATOR"] as const) {
      const res = await request(appWithUser(makeUser(role))).get("/staff-only");
      expect(res.status, `${role} should be allowed`).toBe(200);
      expect(res.body).toEqual({ ok: true });
    }
  });
});

// ─── mustChangePassword gate (unit) ─────────────────────────────────────

describe("enforcePasswordChange — gate middleware (BR-02)", () => {
  function appWithGate(user: SessionUser | undefined) {
    const testApp = express();
    testApp.use((req: Request, _res: Response, next: NextFunction) => {
      req.currentUser = user;
      next();
    });
    testApp.get("/protected", enforcePasswordChange, (_req: Request, res: Response) =>
      res.status(200).json({ ok: true }),
    );
    return testApp;
  }

  it("returns 403 PASSWORD_CHANGE_REQUIRED while the flag is set", async () => {
    const user: SessionUser = { ...makeUser("IT_STAFF"), mustChangePassword: true };
    const res = await request(appWithGate(user)).get("/protected");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("passes through once the flag is cleared", async () => {
    const res = await request(appWithGate(makeUser("IT_STAFF"))).get("/protected");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

// ─── Placeholders for later branches ────────────────────────────────────

describe.skip("SEC-01/02 — non-Administrator calling /api/admin/* (AC-15)", () => {
  // implemented in feature/lab3-staff-ticketing or feature/lab3-admin-users
  it("Requester calling any /api/admin/* endpoint → 403", () => {});
  it("IT Staff calling any /api/admin/* endpoint → 403", () => {});
});

describe.skip("SEC-03 — Requester calling internal-note endpoints (AC-04, BR-04)", () => {
  // implemented in feature/lab3-staff-ticketing or feature/lab3-admin-users
  it("GET/POST /api/staff/tickets/:id/notes → 403 with no note content", () => {});
});

describe.skip("SEC-04 — Requester calling the staff queue (FR-09)", () => {
  // implemented in feature/lab3-staff-ticketing or feature/lab3-admin-users
  it("GET /api/staff/tickets → 403", () => {});
});

describe("SEC-05 — client-supplied requesterId is ignored (AC-03, BR-03)", () => {
  it("creates the ticket for the session user, not the body's requesterId", async () => {
    const category = await prisma.category.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    const relatedSystem = await prisma.relatedSystem.findFirst({
      where: { isActive: true },
      select: { id: true },
    });

    const res = await csrf(clientA, clientA.agent.post("/api/tickets"))
      .field("categoryId", String(category!.id))
      .field("relatedSystemId", String(relatedSystem!.id))
      .field("summary", "Spoofed ownership attempt")
      .field("description", "This request tries to set requesterId to another user's id")
      .field("requestedPriority", "MEDIUM")
      .field("requesterId", requesterB.id);

    expect(res.status).toBe(201);
    expect(res.body.ticket.requester.id).toBe(requesterA.id);

    const stored = await prisma.ticket.findFirst({
      where: { ticketNumber: res.body.ticket.ticketNumber },
      select: { requesterId: true },
    });
    expect(stored?.requesterId).toBe(requesterA.id);
    expect(stored?.requesterId).not.toBe(requesterB.id);
  });

  it("never returns another Requester's data even when their id is supplied", async () => {
    const res = await clientA.agent.get(
      `/api/tickets?search=TKT-2026-AUTHZ-A&requesterId=${requesterB.id}`,
    );

    expect(res.status).toBe(200);
    const ids = res.body.tickets.map((t: { id: number }) => t.id);
    expect(ids).toContain(ticketA.id);
  });
});

describe.skip("SEC-06 — internal notes never reach a Requester (AC-17)", () => {
  // implemented in feature/lab3-staff-ticketing or feature/lab3-admin-users
  it("note content is absent from every Requester-facing response", () => {});
});

describe("SEC-07 — cross-owner ticket fetch (ownership)", () => {
  it("returns 404 (not 403) when Requester B fetches Requester A's ticket", async () => {
    const clientB = await loginAs(app, requesterB.email);

    const res = await clientB.agent.get(`/api/tickets/${ticketA.ticketNumber}`);

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
  });

  it("returns an identical 404 body for a non-existent ticket (no existence leak)", async () => {
    const clientB = await loginAs(app, requesterB.email);

    const crossOwner = await clientB.agent.get(`/api/tickets/${ticketA.ticketNumber}`);
    const missing = await clientB.agent.get("/api/tickets/TKT-2026-999999-NONEXISTENT");

    expect(crossOwner.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(crossOwner.body).toEqual(missing.body);
  });

  it("returns 404 for cross-owner comment listing and resolve-mark too", async () => {
    const clientB = await loginAs(app, requesterB.email);

    const comments = await clientB.agent.get(
      `/api/tickets/${ticketA.ticketNumber}/comments`,
    );
    const resolveMark = await csrf(
      clientB,
      clientB.agent.post(`/api/tickets/${ticketA.ticketNumber}/resolve-mark`),
    );

    expect(comments.status).toBe(404);
    expect(comments.body.error.code).toBe("TICKET_NOT_FOUND");
    expect(resolveMark.status).toBe(404);
    expect(resolveMark.body.error.code).toBe("TICKET_NOT_FOUND");
  });
});

describe.skip("SEC-09 — every /api/admin/* endpoint rejects non-Administrators (AC-15)", () => {
  // implemented in feature/lab3-staff-ticketing or feature/lab3-admin-users
  it("returns 403 for each admin route", () => {});
});

describe.skip("SEC-10 — 500 responses contain only a generic message", () => {
  // implemented in feature/lab3-staff-ticketing or feature/lab3-admin-users
  it("never returns a stack trace or internal detail", () => {});
});

describe.skip("API-36 — cross-owner vs non-existent ticket fetch shapes", () => {
  // implemented in feature/lab3-staff-ticketing or feature/lab3-admin-users
  it("both cases return an identical 404 shape", () => {});
});
