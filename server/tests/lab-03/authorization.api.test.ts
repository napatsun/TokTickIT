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
 * Authorization — tests.md §2 (Authorization / Role Navigation) and §8
 *
 * Implemented here:
 *   SEC-03  Requester → /api/staff/tickets/:id/notes is 403 with no note content
 *   SEC-04  Requester → /api/staff/tickets (Queue) is 403
 *   SEC-05  a body-supplied requesterId is ignored (session identity wins)
 *   SEC-06b IT-Staff-authored Internal Note never appears in ANY
 *           Requester-facing response (the full cross-role leak check — the
 *           schema-level guard SEC-06a lives in lab-02/ticket-detail.api.test.ts)
 *   SEC-07  cross-owner ticket access → 404, not 403
 *   SEC-08  no session cookie on any protected endpoint → 401
 *   SEC-10  a 500 response carries only the generic envelope (no stack trace)
 *   API-36  cross-owner vs non-existent ticket fetch shapes are identical
 *   + unit coverage for the reusable role guard and the mustChangePassword gate
 *
 *   SEC-01  Requester → every /api/admin/* route is 403 with no user data
 *   SEC-02  IT Staff → every /api/admin/* route is 403 with no user data
 *   SEC-09  the consolidated non-Administrator sweep over every admin route
 *           (see the note on that describe block: SEC-01/02 and SEC-09 assert
 *           the same thing, so the route table is shared rather than tripled)
 *
 * All three rows are live as of feature/lab3-05-admin-users — /api/admin/* is
 * mounted in app.ts, so a 403 now proves the guard ran, not that the route is
 * missing. The positive controls in SEC-01/SEC-09 pin that distinction.
 *
 * There are NO remaining `.skip()` placeholders in this file.
 */

let requesterA: TestUser;
let requesterB: TestUser;
let staff: TestUser;
let admin: TestUser;
let clientA: SessionClient;
let staffClient: SessionClient;
let adminClient: SessionClient;
let ticketA: { id: number; ticketNumber: string };

/**
 * SEC-06b marker: distinctive enough that a substring search over any response
 * body is a meaningful leak assertion, and never seeded anywhere.
 */
const INTERNAL_NOTE_MARKER = `SEC06B-INTERNAL-${Date.now()}`;
let internalNoteId: string;

beforeAll(async () => {
  await seed();

  requesterA = await createTestUser({ name: "Authz Requester A" });
  requesterB = await createTestUser({ name: "Authz Requester B" });
  staff = await createTestUser({ name: "Authz Staff", role: "IT_STAFF" });
  admin = await createTestUser({ name: "Authz Admin", role: "ADMINISTRATOR" });
  clientA = await loginAs(app, requesterA.email);
  staffClient = await loginAs(app, staff.email);
  adminClient = await loginAs(app, admin.email);

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

  // SEC-06b: create a REAL Internal Note as IT Staff, through the API, on the
  // ticket Requester A can see. Every Requester-facing assertion below is
  // measured against this row.
  const noteRes = await csrf(
    staffClient,
    staffClient.agent.post(`/api/staff/tickets/${ticketA.id}/notes`),
  ).send({
    content: `${INTERNAL_NOTE_MARKER} internal-only diagnostics for ticket A.`,
  });

  if (noteRes.status !== 201) {
    throw new Error(
      `SEC-06b fixture failed: expected 201 creating the internal note, got ${noteRes.status} ${JSON.stringify(noteRes.body)}`,
    );
  }
  internalNoteId = noteRes.body.id as string;
});

afterAll(async () => {
  await cleanupTestUsers([requesterA.id, requesterB.id, staff.id, admin.id]);
  await prisma.$disconnect();
});

/**
 * Recursively collect the dotted paths of every key whose name matches
 * `pattern`. Used to prove no internal-note relation/key is present anywhere
 * in a Requester-facing payload, at any depth.
 */
function matchingKeyPaths(value: unknown, pattern: RegExp, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => matchingKeyPaths(entry, pattern, `${path}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
      ...(pattern.test(key) ? [`${path}.${key}`] : []),
      ...matchingKeyPaths(child, pattern, `${path}.${key}`),
    ]);
  }
  return [];
}

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
    ["get", "/api/admin/users"],
    ["post", "/api/admin/users"],
    ["patch", "/api/admin/users/placeholder-user-id"],
    ["post", "/api/admin/users/placeholder-user-id/reset-password"],
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

// ─── SEC-01 / SEC-02 / SEC-09: /api/admin/* is Administrator-only (AC-15) ─

type AdminRoute = { method: "get" | "post" | "patch"; path: string; body?: unknown };

/**
 * The complete route inventory of api-spec.md §4.
 *
 * SEC-01, SEC-02 and SEC-09 all sweep this one list, so adding an admin
 * endpoint here is the only edit needed for every non-Administrator assertion
 * below to cover it. The placeholder user id is deliberately bogus: a 403 must
 * be produced by the role guard BEFORE any handler or lookup runs, so the id is
 * never reached. If that ever stops being true these tests fail loudly.
 */
const ADMIN_ROUTES: AdminRoute[] = [
  { method: "get", path: "/api/admin/users" },
  {
    method: "post",
    path: "/api/admin/users",
    body: { name: "Intruder", email: "intruder@test.local", role: "REQUESTER", initialPassword: "Password123!" },
  },
  { method: "patch", path: "/api/admin/users/placeholder-user-id", body: { name: "Intruder" } },
  {
    method: "post",
    path: "/api/admin/users/placeholder-user-id/reset-password",
    body: { newInitialPassword: "Password123!" },
  },
];

function routeLabel(route: AdminRoute): string {
  return `${route.method.toUpperCase()} ${route.path}`;
}

/** Call one admin route as `client`, echoing CSRF on state-changing methods. */
function callAdminRoute(client: SessionClient, route: AdminRoute): request.Test {
  switch (route.method) {
    case "get":
      return client.agent.get(route.path);
    case "post":
      return csrf(client, client.agent.post(route.path)).send((route.body ?? {}) as object);
    case "patch":
      return csrf(client, client.agent.patch(route.path)).send((route.body ?? {}) as object);
  }
}

/** Assert a response carries only the generic envelope — no stack, no ORM, no user data. */
function expectForbiddenEnvelope(res: request.Response, label: string): void {
  expect(res.status, label).toBe(403);
  expect(res.body.error.code, label).toBe("FORBIDDEN");
  expect(Object.keys(res.body), label).toEqual(["error"]);
  expect(Object.keys(res.body.error).sort(), label).toEqual(["code", "message"]);

  const serialised = JSON.stringify(res.body);
  expect(serialised, label).not.toMatch(/at .*\.ts:\d+/); // stack frame
  expect(serialised, label).not.toMatch(/prisma|PrismaClient|P20\d\d/i);
  expect(serialised, label).not.toMatch(/server\/src|node_modules/);
  // No user-shaped payload may appear in a refusal.
  for (const probe of [admin.email, requesterA.email, staff.email, admin.id]) {
    expect(serialised, label).not.toContain(probe);
  }
  expect(res.body.items, label).toBeUndefined();
}

/**
 * SEC-01 — Requester blocked from every /api/admin/* endpoint (AC-15).
 */
describe("SEC-01 — Requester calling /api/admin/* (AC-15)", () => {
  for (const route of ADMIN_ROUTES) {
    it(`${routeLabel(route)} → 403 FORBIDDEN with no user data`, async () => {
      const res = await callAdminRoute(clientA, route);
      expectForbiddenEnvelope(res, `Requester ${routeLabel(route)}`);
    });
  }

  it("positive control — the same routes DO exist and answer an Administrator", async () => {
    // Without this, SEC-01 could pass simply because /api/admin/* was never
    // mounted (which is exactly why the previous branch left this row Pending).
    const list = await callAdminRoute(adminClient, ADMIN_ROUTES[0]);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.items)).toBe(true);
  });

  it("cannot be talked past the guard by a role field in the request body", async () => {
    // The sweep above already sends bodies; this pins the specific attempt of
    // smuggling `role: "ADMINISTRATOR"` into the update payload.
    const res = await csrf(clientA, clientA.agent.patch(`/api/admin/users/${requesterA.id}`)).send({
      role: "ADMINISTRATOR",
      isActive: true,
    });

    expectForbiddenEnvelope(res, "Requester smuggling an admin role");

    const row = await prisma.user.findUnique({
      where: { id: requesterA.id },
      select: { role: true },
    });
    expect(row?.role).toBe("REQUESTER");
  });
});

/**
 * SEC-02 — IT Staff blocked from every /api/admin/* endpoint (AC-15).
 *
 * IT Staff legitimately reach the shared-staff queue (SEC-04) and the Reassign
 * picker (`GET /api/staff/owners`), but the Administrator user-management group
 * is a strictly higher privilege tier and must reject them nonetheless.
 */
describe("SEC-02 — IT Staff calling /api/admin/* (AC-15)", () => {
  for (const route of ADMIN_ROUTES) {
    it(`${routeLabel(route)} → 403 FORBIDDEN with no user data`, async () => {
      const res = await callAdminRoute(staffClient, route);
      expectForbiddenEnvelope(res, `IT Staff ${routeLabel(route)}`);
    });
  }

  it("IT Staff can still use the staff-scoped ownership picker", async () => {
    // Documents the deliberate split: /api/staff/* is IT-Staff-accessible,
    // /api/admin/* is not. See the /api/staff/owners reconciliation note in
    // server/src/routes/staff-tickets.ts and the branch-05 report.
    const res = await staffClient.agent.get("/api/staff/owners");
    expect(res.status).toBe(200);
  });
});

/**
 * SEC-09 — non-Administrator sweep over every /api/admin/* endpoint (AC-15).
 *
 * tests.md lists SEC-01/02 and SEC-09 as separate rows, but their assertion
 * sets are the same shape. Rather than write the sweep three times, SEC-09 is
 * the consolidated version: it walks EVERY admin route × EVERY non-Administrator
 * role in one place, and SEC-01/SEC-02 above keep the role-specific framing
 * (data-leak probes, the staff-scope contrast) that the separate rows imply.
 * A failure here fails all three rows, which is the intended coupling.
 */
describe("SEC-09 — every /api/admin/* endpoint rejects non-Administrators (AC-15)", () => {
  // Lazy getters, not the clients themselves: a describe callback runs during
  // collection, before beforeAll has logged anybody in, so capturing the
  // clients eagerly here would capture `undefined`.
  const nonAdminRoles: Array<[string, () => SessionClient]> = [
    ["Requester", () => clientA],
    ["IT Staff", () => staffClient],
  ];

  for (const [roleName, getClient] of nonAdminRoles) {
    for (const route of ADMIN_ROUTES) {
      it(`${roleName} → ${routeLabel(route)} → 403`, async () => {
        const res = await callAdminRoute(getClient(), route);
        expect(res.status, `${roleName} ${routeLabel(route)}`).toBe(403);
        expect(res.body.error.code).toBe("FORBIDDEN");
      });
    }
  }

  it("the Administrator role is the only one that gets through", async () => {
    const allowed = await callAdminRoute(adminClient, { method: "get", path: "/api/admin/users" });
    expect(allowed.status).toBe(200);
  });
});

// ─── SEC-03 ─────────────────────────────────────────────────────────────

describe("SEC-03 — Requester calling internal-note endpoints (AC-04, BR-04)", () => {
  it("returns 403 FORBIDDEN for both GET and POST, with no note content in the body", async () => {
    const get = await clientA.agent.get(`/api/staff/tickets/${ticketA.id}/notes`);
    const post = await csrf(
      clientA,
      clientA.agent.post(`/api/staff/tickets/${ticketA.id}/notes`),
    ).send({ content: "a Requester must never be able to write this" });

    for (const [label, res] of [
      ["GET", get],
      ["POST", post],
    ] as const) {
      expect(res.status, label).toBe(403);
      expect(res.body.error.code, label).toBe("FORBIDDEN");
      // No note payload of any kind: not the marker, not an items array, not a
      // relation key — and nothing about the internal model.
      expect(JSON.stringify(res.body), label).not.toContain(INTERNAL_NOTE_MARKER);
      expect(res.body.items, label).toBeUndefined();
      expect(JSON.stringify(res.body), label).not.toMatch(/internalNote/i);
      expect(JSON.stringify(res.body), label).not.toMatch(/at .*\.ts:\d+/);
    }
  });

  it("rejects the Requester before any handler runs, on every note-ish path", async () => {
    const paths = [
      `/api/staff/tickets/${ticketA.id}/notes`,
      `/api/staff/tickets/${ticketA.id}/notes/12345`,
      `/api/staff/tickets/9999999/notes`,
    ];

    for (const path of paths) {
      const res = await clientA.agent.get(path);
      expect(res.status, path).toBe(403);
      expect(res.body.error.code, path).toBe("FORBIDDEN");
    }
  });
});

// ─── SEC-04 ─────────────────────────────────────────────────────────────

describe("SEC-04 — Requester calling the staff queue (FR-09)", () => {
  it("returns 403 for GET /api/staff/tickets", async () => {
    const res = await clientA.agent.get("/api/staff/tickets");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(res.body.items).toBeUndefined();
  });

  it("returns 403 for every other staff endpoint too (no partial exposure)", async () => {
    const staffPaths: Array<[string, string]> = [
      ["get", "/api/staff/tickets"],
      ["get", `/api/staff/tickets/${ticketA.id}`],
      ["get", "/api/staff/owners"],
      ["post", `/api/staff/tickets/${ticketA.id}/claim`],
      ["post", `/api/staff/tickets/${ticketA.id}/comments`],
    ];

    for (const [method, path] of staffPaths) {
      const req = (clientA.agent as any)[method](path);
      const res = await (method === "get" ? req : csrf(clientA, req));

      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(403);
      expect(res.body.error.code, `${method.toUpperCase()} ${path}`).toBe("FORBIDDEN");
    }
  });
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

// ─── SEC-06b (required deliverable — answers the PR review comment) ──────
//
// SEC-06a (schema-level guard) lives in
// server/tests/lab-02/ticket-detail.api.test.ts L359-394 and asserts no
// internal-notes key can appear in the Requester detail payload. SEC-06b is the
// full cross-role check the reviewer asked for: create a REAL note as IT Staff,
// then walk every endpoint a Requester can reach and prove the note is absent.

describe("SEC-06b — an IT-Staff-authored Internal Note never reaches a Requester (AC-17, BR-04)", () => {
  it("positive control — the note exists in the DB and IS returned to staff/admin", async () => {
    const stored = await prisma.internalNote.findUnique({ where: { id: internalNoteId } });
    expect(stored).not.toBeNull();
    expect(stored?.content).toContain(INTERNAL_NOTE_MARKER);
    expect(stored?.ticketId).toBe(ticketA.id);

    for (const client of [staffClient, adminClient]) {
      const res = await client.agent.get(`/api/staff/tickets/${ticketA.id}/notes`);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).toContain(INTERNAL_NOTE_MARKER);
    }
  });

  it("is absent from the Requester ticket detail, as a key AND as content", async () => {
    const res = await clientA.agent.get(`/api/tickets/${ticketA.ticketNumber}`);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(INTERNAL_NOTE_MARKER);
    // Recursive, any depth: no `internalNotes` / `internalNote` / `internal...`
    // key may exist anywhere in the payload.
    expect(matchingKeyPaths(res.body, /internal/i)).toEqual([]);
    expect(res.body.ticket.id).toBe(ticketA.id);
  });

  it("is absent from the Requester Public Comments list", async () => {
    const res = await clientA.agent.get(`/api/tickets/${ticketA.ticketNumber}/comments`);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(INTERNAL_NOTE_MARKER);
    expect(matchingKeyPaths(res.body, /internal/i)).toEqual([]);
    expect(res.body.items.every((c: { authorRole: string }) => c.authorRole !== "IT_STAFF")).toBe(
      true,
    );
  });

  it("is absent from the Requester ticket list", async () => {
    const res = await clientA.agent.get("/api/tickets");

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(INTERNAL_NOTE_MARKER);
    expect(matchingKeyPaths(res.body, /internal/i)).toEqual([]);

    const mine = res.body.tickets.find(
      (t: { ticketNumber: string }) => t.ticketNumber === ticketA.ticketNumber,
    );
    expect(mine).toBeDefined();
    expect(matchingKeyPaths(mine, /internal/i)).toEqual([]);
  });

  it("is absent from every other Requester-reachable endpoint", async () => {
    const paths = [
      "/api/auth/me",
      "/api/categories",
      "/api/related-systems",
      "/api/tickets",
      `/api/tickets/${ticketA.ticketNumber}`,
      `/api/tickets/${ticketA.ticketNumber}/comments`,
    ];

    for (const path of paths) {
      const res = await clientA.agent.get(path);
      expect(res.status, path).toBe(200);
      expect(JSON.stringify(res.body), path).not.toContain(INTERNAL_NOTE_MARKER);
      expect(matchingKeyPaths(res.body, /internal/i), path).toEqual([]);
    }
  });

  it("is absent from Requester-facing error bodies as well", async () => {
    const crossOwner = await loginAs(app, requesterB.email);
    const res = await crossOwner.agent.get(`/api/tickets/${ticketA.ticketNumber}`);

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(INTERNAL_NOTE_MARKER);
  });
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

// ─── SEC-10 ─────────────────────────────────────────────────────────────

/**
 * A value that cannot be bound as a PostgreSQL int4, so Prisma throws inside
 * the handler's try/catch. That is a genuine unexpected-server-error path — no
 * mocking of internals, which keeps this test honest about what the real app
 * returns when a query explodes.
 */
const OUT_OF_RANGE_TICKET_ID = 3_000_000_000;

describe("SEC-10 — 500 responses contain only a generic message (§6 safe errors)", () => {
  const failingCalls: Array<[string, string, unknown]> = [
    ["get", `/api/staff/tickets/${OUT_OF_RANGE_TICKET_ID}`, undefined],
    ["post", `/api/staff/tickets/${OUT_OF_RANGE_TICKET_ID}/claim`, undefined],
    ["post", `/api/staff/tickets/${OUT_OF_RANGE_TICKET_ID}/notes`, { content: "boom" }],
    ["patch", `/api/staff/tickets/${OUT_OF_RANGE_TICKET_ID}/status`, { status: "OPEN" }],
  ];

  for (const [method, path, body] of failingCalls) {
    it(`${method.toUpperCase()} ${path} → generic 500 with no internal detail`, async () => {
      const req = (staffClient.agent as any)[method](path);
      if (body !== undefined) req.send(body as object);
      const res = method === "get" ? await req : await csrf(staffClient, req);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: {
          code: "SERVER_ERROR",
          message: "Something went wrong. Please try again.",
        },
      });

      const serialised = JSON.stringify(res.body);
      expect(serialised).not.toMatch(/at .*\.ts:\d+/); // stack frame
      expect(serialised).not.toMatch(/\bError\b/);
      expect(serialised).not.toMatch(/prisma|PrismaClient|P2033|P2002/i);
      expect(serialised).not.toMatch(/server\/src|node_modules/);
      // Exactly one top-level key: the standard envelope. Nothing else leaks.
      expect(Object.keys(res.body)).toEqual(["error"]);
    });
  }
});

// ─── API-36 ─────────────────────────────────────────────────────────────

describe("API-36 — cross-owner vs non-existent ticket fetch shapes (§6 safe errors)", () => {
  it("Requester: the cross-owner 404 is byte-identical to the non-existent 404", async () => {
    const clientB = await loginAs(app, requesterB.email);

    const crossOwner = await clientB.agent.get(`/api/tickets/${ticketA.ticketNumber}`);
    const missing = await clientB.agent.get("/api/tickets/TKT-2026-999999-NONEXISTENT");

    expect(crossOwner.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(crossOwner.body).toEqual(missing.body);
  });

  it("Staff: a non-existent ticket id returns the same generic 404 as a malformed id", async () => {
    const missing = await staffClient.agent.get("/api/staff/tickets/9999999");
    const malformed = await staffClient.agent.get("/api/staff/tickets/not-a-number");

    expect(missing.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(missing.body).toEqual(malformed.body);
    expect(missing.body).toEqual({
      error: { code: "TICKET_NOT_FOUND", message: "Ticket not found." },
    });
    expect(JSON.stringify(missing.body)).not.toMatch(/at .*\.ts:\d+/);
  });

  it("Staff: a ticket owned by another Requester is readable, not hidden behind a 404", async () => {
    // The shared queue has no ownership restriction, so this must be a real 200
    // — proving the 404 above is about existence only, not about hiding tickets
    // from staff (which would make the queue unusable).
    const res = await staffClient.agent.get(`/api/staff/tickets/${ticketA.id}`);

    expect(res.status).toBe(200);
    expect(res.body.ticket.requester.id).toBe(requesterA.id);
  });
});
