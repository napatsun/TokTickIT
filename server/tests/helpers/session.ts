/**
 * Session test helper — BR-03
 *
 * Every Requester/Staff/Admin server test authenticates the way a real client
 * does: by posting to /api/auth/login with a cookie jar and then echoing the
 * CSRF token on state-changing requests. The Lab 2 `X-Dev-Requester-Id` header
 * no longer exists, so tests must not (and cannot) impersonate a user with a
 * request header.
 *
 * Fixture users are created with a known password and
 * `mustChangePassword = false` so the BR-02 gate does not block the endpoint
 * under test. The seeded/legacy accounts keep their documented
 * `mustChangePassword = true` state untouched.
 */

import request from "supertest";
import type { Express } from "express";
import { getPrisma } from "../../src/prisma.js";
import { hashPassword } from "../../src/lib/password.js";

// ─── Types ──────────────────────────────────────────────────────────────

export type TestRole = "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR";

export interface TestUser {
  id: string;
  name: string;
  email: string;
  role: TestRole;
}

export interface SessionClient {
  agent: ReturnType<typeof request.agent>;
  csrfToken: string;
}

/** Login password for every user created through this helper. */
export const TEST_PASSWORD = "SessionTest1!";

const prisma = getPrisma();
let sequence = 0;

// ─── Fixture users ──────────────────────────────────────────────────────

export async function createTestUser(
  overrides: Partial<{
    name: string;
    email: string;
    role: TestRole;
    isActive: boolean;
    mustChangePassword: boolean;
  }> = {},
): Promise<TestUser> {
  const n = ++sequence;
  const email = overrides.email ?? `session-${Date.now()}-${n}@test.local`;

  const user = await prisma.user.create({
    data: {
      name: overrides.name ?? `Session User ${n}`,
      email,
      passwordHash: await hashPassword(TEST_PASSWORD),
      role: overrides.role ?? "REQUESTER",
      isActive: overrides.isActive ?? true,
      mustChangePassword: overrides.mustChangePassword ?? false,
    },
    select: { id: true, name: true, email: true, role: true },
  });

  return user as TestUser;
}

/**
 * Delete fixture users and everything that references them (FKs are
 * `onDelete: Restrict`, so children must go first).
 */
export async function cleanupTestUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;

  // A fixture user can be the requester of a ticket, the owner of one (staff
  // fixtures claim/assign), or both — collect both directions so no fixture
  // ticket is left behind holding a FK to a user we are about to delete.
  const tickets = await prisma.ticket.findMany({
    where: { OR: [{ requesterId: { in: userIds } }, { ownerId: { in: userIds } }] },
    select: { id: true },
  });
  const ticketIds = tickets.map((t) => t.id);

  if (ticketIds.length > 0) {
    await prisma.publicComment.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.internalNote.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.attachment.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
  }

  // Content authored by the user on someone else's ticket (staff fixtures on a
  // seeded ticket, for example). Internal Notes are IT-Staff-authored, so they
  // must be cleared by author as well as by ticket.
  await prisma.publicComment.deleteMany({ where: { authorId: { in: userIds } } });
  await prisma.internalNote.deleteMany({ where: { authorId: { in: userIds } } });
  await prisma.attachment.deleteMany({ where: { uploadedByRequesterId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

// ─── Login ──────────────────────────────────────────────────────────────

function readCookie(res: request.Response, name: string): string | undefined {
  const cookies = (res.headers["set-cookie"] as unknown as string[]) ?? [];
  for (const cookie of cookies) {
    const match = cookie.match(new RegExp(`^${name}=([^;]*)`));
    if (match) return decodeURIComponent(match[1]);
  }
  return undefined;
}

/** Log in through the real auth API and capture the CSRF token. */
export async function loginAs(
  app: Express,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<SessionClient> {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password });

  if (res.status !== 200) {
    throw new Error(
      `loginAs(${email}) expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }

  const csrfToken = readCookie(res, "csrf");
  if (!csrfToken) {
    throw new Error(`loginAs(${email}) did not receive a csrf cookie`);
  }

  return { agent, csrfToken };
}

/** Create an active fixture user and return both the row and a logged-in client. */
export async function createLoggedInUser(
  app: Express,
  overrides: Parameters<typeof createTestUser>[0] = {},
): Promise<{ user: TestUser; client: SessionClient }> {
  const user = await createTestUser(overrides);
  const client = await loginAs(app, user.email);
  return { user, client };
}

/** Attach the CSRF header required on state-changing session requests (§0). */
export function csrf(client: SessionClient, req: request.Test): request.Test {
  return req.set("X-CSRF-Token", client.csrfToken);
}
