import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import express, { Request, Response, NextFunction } from "express";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import {
  enforcePasswordChange,
  requireRole,
  type Role,
  type SessionUser,
} from "../../src/middleware/auth.js";

const prisma = getPrisma();

/**
 * Authorization — tests.md §2 (Authorization / Role Navigation)
 *
 * Implemented in this branch (feature/lab3-02-auth-and-authorization):
 *   SEC-08  no session cookie on any protected endpoint → 401
 *   + unit coverage for the reusable role guard and the mustChangePassword gate
 *
 * The remaining rows belong to later branches and are intentionally left as
 * skipped placeholders so tests.md traceability stays intact.
 */

afterAll(async () => {
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

describe.skip("SEC-05 — client-supplied requesterId is ignored (AC-03, BR-03)", () => {
  // implemented in feature/lab3-staff-ticketing or feature/lab3-admin-users
  it("ticket is owned by the session user, not the body's requesterId", () => {});
});

describe.skip("SEC-06 — internal notes never reach a Requester (AC-17)", () => {
  // implemented in feature/lab3-staff-ticketing or feature/lab3-admin-users
  it("note content is absent from every Requester-facing response", () => {});
});

describe.skip("SEC-07 — cross-owner ticket fetch (ownership)", () => {
  // implemented in feature/lab3-staff-ticketing or feature/lab3-admin-users
  it("Requester A fetching Requester B's ticket → 404 (not 403)", () => {});
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
