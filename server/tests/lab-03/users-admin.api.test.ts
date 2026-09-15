import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";
import { verifyPassword } from "../../src/lib/password.js";
import {
  createTestUser,
  cleanupTestUsers,
  loginAs,
  csrf,
  TEST_PASSWORD,
  type SessionClient,
  type TestUser,
} from "../helpers/session.js";

const prisma = getPrisma();

/**
 * Administrator User Management API — api-spec.md §4
 * (FR-24 … FR-31, BR-10, BR-21, BR-23 … BR-26, BR-29 … BR-31)
 *
 * Covers tests.md §9 rows API-28 … API-35.
 *
 * Two things about this suite are worth reading before editing it:
 *
 * 1. The "last active Administrator" guard is GLOBAL by definition — it counts
 *    rows across the whole User table, so it cannot be exercised without
 *    temporarily changing who else is active. `withActiveAdmins()` snapshots
 *    the real administrator rows first and always restores them, so the suite
 *    leaves no trace of that manipulation behind. Vitest runs this project with
 *    `singleFork: true`, so no other file is affected while it is swapped.
 *
 * 2. Every "no change persisted" assertion re-reads the row from the database
 *    rather than trusting the response, because the guard fires inside a
 *    SERIALIZABLE transaction and the whole point is that it rolls back.
 */

// ─── Fixtures ───────────────────────────────────────────────────────────

const TOKEN = `adminapi-${Date.now()}`;
/**
 * A SEPARATE marker for fixtures that are deliberately outside the searchable
 * `TOKEN` set, so `q=${TOKEN}` assertions can be exact rather than "contains".
 */
const OUTSIDE = `outside-${Date.now()}`;

let adminA: TestUser; // the acting Administrator
let adminB: TestUser; // a spare active Administrator (keeps self-deactivation reachable)
let requester: TestUser;

let adminAClient: SessionClient;
let adminBClient: SessionClient;

/** Real (pre-existing) administrator rows, so the guard tests can restore them. */
let adminSnapshot: Array<{ id: string; isActive: boolean }>;

/** Standalone users created by the list/create/edit tests. */
const created: string[] = [];

let searchAlpha: TestUser;
let searchBeta: TestUser;
let searchGamma: TestUser;

beforeAll(async () => {
  await seed();

  // Snapshot BEFORE any fixture admin exists, so restoration only ever touches
  // rows this suite did not create.
  adminSnapshot = await prisma.user.findMany({
    where: { role: "ADMINISTRATOR" },
    select: { id: true, isActive: true },
  });

  adminA = await createTestUser({
    name: `Admin A ${TOKEN}`,
    email: `admin-a-${TOKEN}@test.local`,
    role: "ADMINISTRATOR",
  });
  adminB = await createTestUser({
    name: `Admin B ${TOKEN}`,
    email: `admin-b-${TOKEN}@test.local`,
    role: "ADMINISTRATOR",
  });
  requester = await createTestUser({
    name: `Plain Requester ${OUTSIDE}`,
    email: `requester-${OUTSIDE}@test.local`,
  });

  adminAClient = await loginAs(app, adminA.email);
  adminBClient = await loginAs(app, adminB.email);

  searchAlpha = await createTestUser({
    name: `Alpha ${TOKEN}`,
    email: `alpha-${TOKEN}@test.local`,
    role: "REQUESTER",
  });
  searchBeta = await createTestUser({
    name: `Beta ${TOKEN}`,
    email: `beta-${TOKEN}@test.local`,
    role: "IT_STAFF",
  });
  searchGamma = await createTestUser({
    name: `Gamma ${TOKEN}`,
    email: `gamma-${TOKEN}@test.local`,
    role: "ADMINISTRATOR",
    isActive: false,
  });
});

afterAll(async () => {
  // Restore the real administrator flags first — if a guard test threw midway
  // this is what keeps the shared database honest for the suites that follow.
  await restoreAdminActiveFlags();
  await cleanupTestUsers([adminA.id, adminB.id, requester.id, searchAlpha.id, searchBeta.id, searchGamma.id, ...created]);
  await prisma.$disconnect();
});

// ─── Helpers ────────────────────────────────────────────────────────────

/** Assert a response body leaks no credential material and no stack trace (BR-11, BR-26, §6). */
function expectSafeBody(res: request.Response): void {
  const text = JSON.stringify(res.body ?? {});
  expect(text).not.toContain("passwordHash");
  expect(text).not.toContain("$2a$");
  expect(text).not.toContain("PrismaClient");
  // V8 stack frames look like `    at fn (/path/file.ts:12:34)`.
  expect(text).not.toMatch(/at .*\(.*:\d+:\d+\)/);
}

/** The exact public projection of a user (admin-users.ts AdminUserDto). */
function expectUserShape(item: Record<string, unknown>): void {
  expect(Object.keys(item).sort()).toEqual(["email", "id", "isActive", "name", "role"]);
}

async function userRow(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, isActive: true, mustChangePassword: true, passwordHash: true },
  });
}

/**
 * Leave exactly `ids` as the active Administrators for the duration of `fn`,
 * then put every pre-existing administrator back the way it was. Always
 * restores, even when the body throws.
 */
async function withActiveAdmins<T>(ids: string[], fn: () => Promise<T>): Promise<T> {
  // Make the listed fixtures active Administrators first, THEN deactivate every
  // other active Administrator, so the guard sees exactly `ids`.
  await prisma.user.updateMany({
    where: { id: { in: ids } },
    data: { role: "ADMINISTRATOR", isActive: true },
  });
  await prisma.user.updateMany({
    where: { role: "ADMINISTRATOR", isActive: true, id: { notIn: ids } },
    data: { isActive: false },
  });
  try {
    return await fn();
  } finally {
    await restoreAdminActiveFlags();
  }
}

async function restoreAdminActiveFlags(): Promise<void> {
  for (const row of adminSnapshot ?? []) {
    await prisma.user.update({ where: { id: row.id }, data: { isActive: row.isActive } });
  }
}

/** Create a user through the API and remember it for cleanup. */
async function createViaApi(body: Record<string, unknown>): Promise<request.Response> {
  const res = await csrf(adminAClient, adminAClient.agent.post("/api/admin/users")).send(body);
  if (res.status === 201 && res.body?.id) created.push(res.body.id as string);
  return res;
}

// ─── API-28: list / search / filter ─────────────────────────────────────

describe("API-28 — GET /api/admin/users: list, search by name/email, filter by role", () => {
  it("returns { items: [...] } where every item is the exact public user projection", async () => {
    const res = await adminAClient.agent.get("/api/admin/users");

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["items"]);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const item of res.body.items) expectUserShape(item);
    expectSafeBody(res);
  });

  it("never exposes passwordHash or mustChangePassword in the list", async () => {
    const res = await adminAClient.agent.get("/api/admin/users");

    const text = JSON.stringify(res.body);
    expect(text).not.toContain("passwordHash");
    expect(text).not.toContain("mustChangePassword");
  });

  it("does not paginate — the full filtered list comes back in one response", async () => {
    const all = await adminAClient.agent.get("/api/admin/users");
    const totalUsers = await prisma.user.count();

    expect(all.body.items).toHaveLength(totalUsers);
    expect(all.body.pagination).toBeUndefined();
    expect(all.body.page).toBeUndefined();
  });

  it("searches by name (case-insensitive, partial)", async () => {
    const lower = await adminAClient.agent.get(`/api/admin/users?q=${TOKEN}`);
    const upper = await adminAClient.agent.get(`/api/admin/users?q=${TOKEN.toUpperCase()}`);
    const partial = await adminAClient.agent.get(`/api/admin/users?q=Alph`);

    for (const res of [lower, upper]) {
      expect(res.status).toBe(200);
      const names = res.body.items.map((u: { name: string }) => u.name);
      expect(names).toContain(`Alpha ${TOKEN}`);
      expect(names).toContain(`Beta ${TOKEN}`);
      expect(names).toContain(`Gamma ${TOKEN}`);
    }

    expect(partial.body.items.map((u: { name: string }) => u.name)).toContain(`Alpha ${TOKEN}`);
  });

  it("searches by email as well as name", async () => {
    const res = await adminAClient.agent.get(`/api/admin/users?q=alpha-${TOKEN}@test.local`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].email).toBe(`alpha-${TOKEN}@test.local`);
  });

  it("every returned row actually matches the search term in name or email", async () => {
    const res = await adminAClient.agent.get(`/api/admin/users?q=${TOKEN}`);

    for (const item of res.body.items) {
      expect(`${item.name} ${item.email}`.toLowerCase()).toContain(TOKEN.toLowerCase());
    }
  });

  it("filters by the role enum", async () => {
    const staff = await adminAClient.agent.get(`/api/admin/users?q=${TOKEN}&role=IT_STAFF`);
    const admins = await adminAClient.agent.get(`/api/admin/users?q=${TOKEN}&role=ADMINISTRATOR`);

    expect(staff.status).toBe(200);
    expect(staff.body.items.map((u: { email: string }) => u.email)).toEqual([`beta-${TOKEN}@test.local`]);

    expect(admins.status).toBe(200);
    expect(admins.body.items.map((u: { email: string }) => u.email).sort()).toEqual(
      [`admin-a-${TOKEN}@test.local`, `admin-b-${TOKEN}@test.local`, `gamma-${TOKEN}@test.local`].sort(),
    );
  });

  it("combined search + filter returns only rows satisfying both", async () => {
    const res = await adminAClient.agent.get(`/api/admin/users?q=${TOKEN}&role=REQUESTER`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((u: { email: string }) => u.email)).toEqual([`alpha-${TOKEN}@test.local`]);
  });

  it("includes deactivated users — an inactive account is still listable", async () => {
    const res = await adminAClient.agent.get(`/api/admin/users?q=gamma-${TOKEN}`);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].isActive).toBe(false);
  });

  it("rejects an invalid role filter with 400 and never falls back to the unfiltered list", async () => {
    const res = await adminAClient.agent.get("/api/admin/users?role=SUPERUSER");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.fieldErrors.role).toBeDefined();
    // Critically: no `items`, so a bad filter can never be mistaken for "all users".
    expect(res.body.items).toBeUndefined();
    expectSafeBody(res);
  });

  it("treats an empty q / role as absent rather than as an error", async () => {
    const res = await adminAClient.agent.get("/api/admin/users?q=&role=");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(await prisma.user.count());
  });
});

// ─── API-29: create ─────────────────────────────────────────────────────

describe("API-29 — POST /api/admin/users: create with one role and an initial password", () => {
  it("returns 201 with the created user and forces mustChangePassword = true", async () => {
    const email = `created-${TOKEN}@test.local`;
    const res = await createViaApi({
      name: `Created ${TOKEN}`,
      email,
      role: "IT_STAFF",
      isActive: true,
      initialPassword: "InitialPass1!",
    });

    expect(res.status).toBe(201);
    expectUserShape(res.body);
    expect(res.body.name).toBe(`Created ${TOKEN}`);
    expect(res.body.email).toBe(email);
    expect(res.body.role).toBe("IT_STAFF");
    expect(res.body.isActive).toBe(true);
    expectSafeBody(res);

    // BR-25: the flag is a server decision, not a client one.
    const row = await userRow(res.body.id as string);
    expect(row?.mustChangePassword).toBe(true);
    // Persisted as a bcrypt hash: the plaintext is absent, the password verifies.
    expect(row!.passwordHash).not.toContain("InitialPass1!");
    expect(await verifyPassword("InitialPass1!", row!.passwordHash)).toBe(true);
  });

  it("forces mustChangePassword = true even when the caller explicitly asks for false", async () => {
    const email = `forced-${TOKEN}@test.local`;
    const res = await csrf(adminAClient, adminAClient.agent.post("/api/admin/users")).send({
      name: `Forced ${TOKEN}`,
      email,
      role: "REQUESTER",
      isActive: true,
      initialPassword: "InitialPass1!",
      mustChangePassword: false, // BR-25: must be ignored
    });

    expect(res.status).toBe(201);
    created.push(res.body.id as string);

    const row = await prisma.user.findUnique({
      where: { id: res.body.id as string },
      select: { mustChangePassword: true },
    });
    expect(row?.mustChangePassword).toBe(true);
  });

  it("normalises the stored email to lowercase and trimmed form", async () => {
    const res = await createViaApi({
      name: `Case ${TOKEN}`,
      email: `  CASE-${TOKEN}@TEST.LOCAL  `,
      role: "REQUESTER",
      initialPassword: "InitialPass1!",
    });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe(`case-${TOKEN}@test.local`);
  });

  it("defaults isActive to true when omitted, and honours an explicit false", async () => {
    const active = await createViaApi({
      name: `DefaultActive ${TOKEN}`,
      email: `default-active-${TOKEN}@test.local`,
      role: "REQUESTER",
      initialPassword: "InitialPass1!",
    });
    const inactive = await createViaApi({
      name: `Inactive ${TOKEN}`,
      email: `inactive-${TOKEN}@test.local`,
      role: "REQUESTER",
      isActive: false,
      initialPassword: "InitialPass1!",
    });

    expect(active.status).toBe(201);
    expect(active.body.isActive).toBe(true);
    expect(inactive.status).toBe(201);
    expect(inactive.body.isActive).toBe(false);
  });

  it("the created Administrator can actually log in with the initial password", async () => {
    const email = `login-check-${TOKEN}@test.local`;
    const res = await createViaApi({
      name: `Login Check ${TOKEN}`,
      email,
      role: "ADMINISTRATOR",
      initialPassword: "InitialPass1!",
    });

    expect(res.status).toBe(201);

    const login = await request(app).post("/api/auth/login").send({ email, password: "InitialPass1!" });
    expect(login.status).toBe(200);
    // FR-06 / BR-02: the forced-change flag reaches the client on login.
    expect(login.body.user.mustChangePassword).toBe(true);
  });

  it("rejects a missing name, an invalid role and a weak password with field-level 422s", async () => {
    const res = await csrf(adminAClient, adminAClient.agent.post("/api/admin/users")).send({
      name: "   ",
      email: "not-an-email",
      role: "SUPERUSER",
      initialPassword: "short",
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    for (const field of ["name", "email", "role", "initialPassword"]) {
      expect(res.body.error.fields[field], field).toBeDefined();
    }
    expectSafeBody(res);
  });

  it("rejects an initial password that fails the shared policy (no letter / too short)", async () => {
    for (const initialPassword of ["onelongpassword", "12345678", "Ab1"]) {
      const res = await csrf(adminAClient, adminAClient.agent.post("/api/admin/users")).send({
        name: `Weak ${TOKEN}`,
        email: `weak-${initialPassword.length}-${TOKEN}@test.local`,
        role: "REQUESTER",
        initialPassword,
      });

      expect(res.status, initialPassword).toBe(422);
      expect(res.body.error.fields.initialPassword, initialPassword).toBeDefined();
    }
  });
});

// ─── API-30: duplicate email ────────────────────────────────────────────

describe("API-30 — duplicate email on create and edit (AC-12, BR-29, BR-26)", () => {
  it("rejects a create whose email is already used, and creates nothing", async () => {
    const email = `dup-${TOKEN}@test.local`;
    const first = await createViaApi({
      name: `Dup First ${TOKEN}`,
      email,
      role: "REQUESTER",
      initialPassword: "InitialPass1!",
    });
    expect(first.status).toBe(201);

    const before = await prisma.user.count();
    const second = await csrf(adminAClient, adminAClient.agent.post("/api/admin/users")).send({
      name: `Dup Second ${TOKEN}`,
      email,
      role: "REQUESTER",
      initialPassword: "InitialPass1!",
    });

    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe("EMAIL_ALREADY_IN_USE");
    expect(second.body.error.fields.email).toBe("This email is already in use.");
    expect(await prisma.user.count()).toBe(before);
    expectSafeBody(second);
  });

  it("treats a case-variant of an existing email as the same email", async () => {
    const res = await csrf(adminAClient, adminAClient.agent.post("/api/admin/users")).send({
      name: `Dup Case ${TOKEN}`,
      email: `DUP-${TOKEN}@TEST.LOCAL`,
      role: "REQUESTER",
      initialPassword: "InitialPass1!",
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("EMAIL_ALREADY_IN_USE");
  });

  it("gives the identical generic answer whether the conflicting account is active or inactive (BR-26)", async () => {
    const activeEmail = `dup-active-${TOKEN}@test.local`;
    const inactiveEmail = `dup-inactive-${TOKEN}@test.local`;

    await createViaApi({ name: `Dup Active ${TOKEN}`, email: activeEmail, role: "REQUESTER", initialPassword: "InitialPass1!" });
    await createViaApi({
      name: `Dup Inactive ${TOKEN}`,
      email: inactiveEmail,
      role: "REQUESTER",
      isActive: false,
      initialPassword: "InitialPass1!",
    });

    const againstActive = await csrf(adminAClient, adminAClient.agent.post("/api/admin/users")).send({
      name: `Probe Active ${TOKEN}`,
      email: activeEmail,
      role: "REQUESTER",
      initialPassword: "InitialPass1!",
    });
    const againstInactive = await csrf(adminAClient, adminAClient.agent.post("/api/admin/users")).send({
      name: `Probe Inactive ${TOKEN}`,
      email: inactiveEmail,
      role: "REQUESTER",
      initialPassword: "InitialPass1!",
    });

    expect(againstActive.status).toBe(422);
    expect(againstInactive.status).toBe(422);
    // Byte-identical: the status code, the code, the message and the field text.
    expect(againstInactive.body).toEqual(againstActive.body);
  });

  it("rejects editing a user onto another user's email, leaving the target untouched", async () => {
    const taken = `taken-${TOKEN}@test.local`;
    const takenUser = await createViaApi({
      name: `Taken ${TOKEN}`,
      email: taken,
      role: "REQUESTER",
      initialPassword: "InitialPass1!",
    });
    const mover = await createViaApi({
      name: `Mover ${TOKEN}`,
      email: `mover-${TOKEN}@test.local`,
      role: "REQUESTER",
      initialPassword: "InitialPass1!",
    });
    expect(takenUser.status).toBe(201);
    expect(mover.status).toBe(201);

    const res = await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${mover.body.id}`)).send({
      email: taken,
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("EMAIL_ALREADY_IN_USE");
    expect(res.body.error.fields.email).toBeDefined();

    const row = await userRow(mover.body.id as string);
    expect(row?.email).toBe(`mover-${TOKEN}@test.local`);
    expectSafeBody(res);
  });

  it("allows a user to be edited onto a case-variant of their OWN email", async () => {
    const res = await createViaApi({
      name: `Self Case ${TOKEN}`,
      email: `selfcase-${TOKEN}@test.local`,
      role: "REQUESTER",
      initialPassword: "InitialPass1!",
    });

    const patch = await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${res.body.id}`)).send({
      email: `SelfCase-${TOKEN}@TEST.LOCAL`,
    });

    expect(patch.status).toBe(200);
    expect(patch.body.email).toBe(`selfcase-${TOKEN}@test.local`);
  });
});

// ─── API-31: edit ───────────────────────────────────────────────────────

describe("API-31 — PATCH /api/admin/users/:id: edit name/email/role/activation", () => {
  it("updates all four fields and returns the updated user", async () => {
    const createdUser = await createViaApi({
      name: `Edit Me ${TOKEN}`,
      email: `edit-me-${TOKEN}@test.local`,
      role: "REQUESTER",
      initialPassword: "InitialPass1!",
    });

    const newEmail = `edited-${TOKEN}@test.local`;
    const res = await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${createdUser.body.id}`)).send({
      name: `Edited Name ${TOKEN}`,
      email: newEmail,
      role: "IT_STAFF",
      isActive: false,
    });

    expect(res.status).toBe(200);
    expectUserShape(res.body);
    expect(res.body.name).toBe(`Edited Name ${TOKEN}`);
    expect(res.body.email).toBe(newEmail);
    expect(res.body.role).toBe("IT_STAFF");
    expect(res.body.isActive).toBe(false);
    expectSafeBody(res);

    const row = await userRow(res.body.id as string);
    expect(row).toMatchObject({ name: `Edited Name ${TOKEN}`, email: newEmail, role: "IT_STAFF", isActive: false });
  });

  it("applies a partial update without touching the other fields", async () => {
    const target = await createViaApi({
      name: `Partial ${TOKEN}`,
      email: `partial-${TOKEN}@test.local`,
      role: "REQUESTER",
      initialPassword: "InitialPass1!",
    });

    const res = await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${target.body.id}`)).send({
      name: `Partial Renamed ${TOKEN}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe(`Partial Renamed ${TOKEN}`);
    expect(res.body.email).toBe(`partial-${TOKEN}@test.local`);
    expect(res.body.role).toBe("REQUESTER");
    expect(res.body.isActive).toBe(true);
  });

  it("can change a password-flagged user's role without clearing the forced-change flag", async () => {
    const target = await createViaApi({
      name: `Role Change ${TOKEN}`,
      email: `role-change-${TOKEN}@test.local`,
      role: "REQUESTER",
      initialPassword: "InitialPass1!",
    });

    const res = await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${target.body.id}`)).send({
      role: "IT_STAFF",
    });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("IT_STAFF");

    const row = await userRow(target.body.id as string);
    expect(row?.mustChangePassword).toBe(true);
  });

  it("returns 404 for an unknown user id", async () => {
    const res = await csrf(adminAClient, adminAClient.agent.patch("/api/admin/users/does-not-exist")).send({
      name: "Nobody",
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("USER_NOT_FOUND");
    expectSafeBody(res);
  });

  it("rejects an empty patch body rather than silently doing nothing", async () => {
    const res = await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${requester.id}`)).send({});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a non-boolean isActive and a whitespace-only name", async () => {
    const bad = await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${requester.id}`)).send({
      isActive: "yes",
      name: "   ",
    });

    expect(bad.status).toBe(422);
    expect(bad.body.error.fields.isActive).toBeDefined();
    expect(bad.body.error.fields.name).toBeDefined();

    const row = await userRow(requester.id);
    expect(row).toMatchObject({ name: `Plain Requester ${OUTSIDE}`, isActive: true });
  });

  it("can reactivate a previously deactivated user", async () => {
    const target = await createViaApi({
      name: `Reactivate ${TOKEN}`,
      email: `reactivate-${TOKEN}@test.local`,
      role: "REQUESTER",
      isActive: false,
      initialPassword: "InitialPass1!",
    });

    const res = await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${target.body.id}`)).send({
      isActive: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(true);
  });
});

// ─── API-32: self-deactivation ──────────────────────────────────────────

describe("API-32 — Administrator deactivating their own account (AC-13, BR-23, BR-30)", () => {
  it("returns 409 SELF_DEACTIVATION and persists nothing", async () => {
    const res = await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${adminA.id}`)).send({
      isActive: false,
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SELF_DEACTIVATION");
    expect(res.body.error.message).toBe("You cannot deactivate your own account.");
    expectSafeBody(res);

    const row = await userRow(adminA.id);
    expect(row?.isActive).toBe(true);
  });

  it("still allows the same Administrator to edit their own name/email", async () => {
    const res = await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${adminA.id}`)).send({
      name: `Admin A Renamed ${TOKEN}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe(`Admin A Renamed ${TOKEN}`);

    // Put it back so later assertions in this file read the original name.
    await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${adminA.id}`)).send({
      name: `Admin A ${TOKEN}`,
    });
  });

  it("also blocks the self-deactivation when it arrives alongside other field edits", async () => {
    const res = await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${adminA.id}`)).send({
      name: `Should Not Apply ${TOKEN}`,
      isActive: false,
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SELF_DEACTIVATION");

    // The whole request rolls back — the rename must not have been applied.
    const row = await userRow(adminA.id);
    expect(row).toMatchObject({ name: `Admin A ${TOKEN}`, isActive: true });
  });
});

// ─── API-33: last active Administrator ──────────────────────────────────

describe("API-33 — last active Administrator guard (AC-13, BR-24, BR-31)", () => {
  it("blocks deactivating the last active Administrator", async () => {
    await withActiveAdmins([adminA.id], async () => {
      const res = await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${adminA.id}`)).send({
        isActive: false,
      });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("LAST_ACTIVE_ADMIN");
      expect(res.body.error.message).toBe("At least one active Administrator is required.");
      expectSafeBody(res);

      const row = await userRow(adminA.id);
      expect(row?.isActive).toBe(true);
    });
  });

  it("blocks changing the last active Administrator's role away from ADMINISTRATOR", async () => {
    await withActiveAdmins([adminA.id], async () => {
      const res = await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${adminA.id}`)).send({
        role: "IT_STAFF",
      });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("LAST_ACTIVE_ADMIN");

      const row = await userRow(adminA.id);
      expect(row?.role).toBe("ADMINISTRATOR");
    });
  });

  it("reports LAST_ACTIVE_ADMIN rather than SELF_DEACTIVATION for a sole Administrator acting on themselves", async () => {
    await withActiveAdmins([adminA.id], async () => {
      const res = await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${adminA.id}`)).send({
        isActive: false,
      });

      // Precedence: the account-level guard would also match here, but the
      // system-level invariant is the more useful and more specific answer.
      expect(res.body.error.code).toBe("LAST_ACTIVE_ADMIN");
    });
  });

  it("allows the change once a second active Administrator exists", async () => {
    await withActiveAdmins([adminA.id, adminB.id], async () => {
      const res = await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${adminB.id}`)).send({
        role: "IT_STAFF",
      });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe("IT_STAFF");
    });

    // adminB is restored to ADMINISTRATOR by the following update.
    await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${adminB.id}`)).send({ role: "ADMINISTRATOR" });
  });

  it("counts only ACTIVE Administrators — an inactive admin does not satisfy the invariant", async () => {
    await withActiveAdmins([adminA.id], async () => {
      // adminB is an Administrator but currently inactive, so deactivating the
      // only *active* one is still refused.
      await prisma.user.update({ where: { id: adminB.id }, data: { role: "ADMINISTRATOR", isActive: false } });

      const res = await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${adminA.id}`)).send({
        isActive: false,
      });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("LAST_ACTIVE_ADMIN");
    });
  });

  it("is race-condition-safe: two concurrent demotions of the final two admins cannot leave zero", async () => {
    await withActiveAdmins([adminA.id, adminB.id], async () => {
      try {
        // This is a genuine write-skew: each transaction READS "one other active
        // Administrator exists" and then WRITES a DIFFERENT row. Under READ
        // COMMITTED both would pass and the system would end up with no
        // Administrator at all. Neither request touches its own account, so no
        // other guard can mask the race — only SERIALIZABLE isolation (with the
        // P2034 retry in admin-users.ts) can make exactly one of them fail.
        const [first, second] = await Promise.all([
          csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${adminB.id}`)).send({ role: "IT_STAFF" }),
          csrf(adminBClient, adminBClient.agent.patch(`/api/admin/users/${adminA.id}`)).send({ role: "IT_STAFF" }),
        ]);

        const statuses = [first.status, second.status].sort();
        expect(statuses).toEqual([200, 409]);

        const rejected = first.status === 409 ? first : second;
        expect(rejected.body.error.code).toBe("LAST_ACTIVE_ADMIN");
        expectSafeBody(rejected);

        // The invariant holds in the database, which is the assertion that matters.
        const stillActive = await prisma.user.count({ where: { role: "ADMINISTRATOR", isActive: true } });
        expect(stillActive).toBe(1);
      } finally {
        // Whichever request won demoted one of the two; both must be active
        // Administrators again for the remaining suites in this file.
        await prisma.user.updateMany({
          where: { id: { in: [adminA.id, adminB.id] } },
          data: { role: "ADMINISTRATOR", isActive: true },
        });
      }
    });
  });
});

// ─── API-34: reset password ─────────────────────────────────────────────

describe("API-34 — POST /api/admin/users/:id/reset-password (AC-14, FR-28, BR-25)", () => {
  it("returns { success: true }, rehashes the password and forces a change at next login", async () => {
    const target = await createViaApi({
      name: `Reset Target ${TOKEN}`,
      email: `reset-target-${TOKEN}@test.local`,
      role: "REQUESTER",
      initialPassword: "InitialPass1!",
    });
    const before = await userRow(target.body.id as string);

    const res = await csrf(
      adminAClient,
      adminAClient.agent.post(`/api/admin/users/${target.body.id}/reset-password`),
    ).send({ newInitialPassword: "ResetPass9!" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expectSafeBody(res);

    const after = await userRow(target.body.id as string);
    expect(after?.mustChangePassword).toBe(true);
    expect(after?.passwordHash).not.toBe(before?.passwordHash);
    // The old password no longer works, the new one does.
    expect(await verifyPassword("InitialPass1!", after!.passwordHash)).toBe(false);
    expect(await verifyPassword("ResetPass9!", after!.passwordHash)).toBe(true);
  });

  it("leaves the account usable but gated: login succeeds, protected routes do not", async () => {
    const target = await createViaApi({
      name: `Reset Gate ${TOKEN}`,
      email: `reset-gate-${TOKEN}@test.local`,
      role: "REQUESTER",
      initialPassword: "InitialPass1!",
    });

    await csrf(
      adminAClient,
      adminAClient.agent.post(`/api/admin/users/${target.body.id}/reset-password`),
    ).send({ newInitialPassword: "ResetPass9!" });

    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({
      email: `reset-gate-${TOKEN}@test.local`,
      password: "ResetPass9!",
    });

    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);

    // BR-02: every authenticated route is gated until the password is changed.
    const gated = await agent.get("/api/tickets");
    expect(gated.status).toBe(403);
    expect(gated.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("rejects a new password that fails the shared policy", async () => {
    for (const newInitialPassword of ["short", "nonumberlong", "12345678"]) {
      const res = await csrf(
        adminAClient,
        adminAClient.agent.post(`/api/admin/users/${requester.id}/reset-password`),
      ).send({ newInitialPassword });

      expect(res.status, newInitialPassword).toBe(422);
      expect(res.body.error.fields.newInitialPassword, newInitialPassword).toBeDefined();
    }

    // requester's hash is untouched by all three rejected attempts.
    const row = await userRow(requester.id);
    expect(await verifyPassword(TEST_PASSWORD, row!.passwordHash)).toBe(true);
  });

  it("returns 404 for an unknown user id", async () => {
    const res = await csrf(
      adminAClient,
      adminAClient.agent.post("/api/admin/users/nope-not-a-user/reset-password"),
    ).send({ newInitialPassword: "ResetPass9!" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("USER_NOT_FOUND");
    expectSafeBody(res);
  });

  it("resets another Administrator's password without changing their role or activation state", async () => {
    const res = await csrf(
      adminAClient,
      adminAClient.agent.post(`/api/admin/users/${adminB.id}/reset-password`),
    ).send({ newInitialPassword: "ResetPass9!" });

    expect(res.status).toBe(200);

    const row = await userRow(adminB.id);
    expect(row).toMatchObject({ role: "ADMINISTRATOR", isActive: true, mustChangePassword: true });
  });
});

// ─── API-35: invalid role ───────────────────────────────────────────────

describe("API-35 — invalid role value", () => {
  it("rejects an invalid role on create with a field-level 422", async () => {
    const before = await prisma.user.count();
    const res = await csrf(adminAClient, adminAClient.agent.post("/api/admin/users")).send({
      name: `Bad Role ${TOKEN}`,
      email: `bad-role-${TOKEN}@test.local`,
      role: "MANAGER",
      initialPassword: "InitialPass1!",
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.fields.role).toBeDefined();
    expect(await prisma.user.count()).toBe(before);
  });

  it("rejects an invalid role on edit, leaving the existing role in place", async () => {
    const res = await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${requester.id}`)).send({
      role: "ADMIN",
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.fields.role).toBeDefined();

    const row = await userRow(requester.id);
    expect(row?.role).toBe("REQUESTER");
  });

  it("rejects a non-string role (null / number) the same way", async () => {
    for (const role of [null, 7, { name: "ADMINISTRATOR" }]) {
      const res = await csrf(adminAClient, adminAClient.agent.patch(`/api/admin/users/${requester.id}`)).send({ role });

      expect(res.status, JSON.stringify(role)).toBe(422);
      expect(res.body.error.fields.role, JSON.stringify(role)).toBeDefined();
    }
  });
});

// ─── Cross-cutting: the admin API never leaks credential material ────────

describe("admin API — safe errors and no credential material anywhere", () => {
  it("never returns passwordHash from any admin endpoint", async () => {
    const responses = [
      await adminAClient.agent.get("/api/admin/users"),
      await adminAClient.agent.get(`/api/admin/users?q=${TOKEN}`),
    ];

    for (const res of responses) {
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain("passwordHash");
      expect(text).not.toContain("$2a$");
      expect(text).not.toContain("$2b$");
    }
  });

  it("returns a generic 404 body for an unknown user without internal detail", async () => {
    const res = await csrf(adminAClient, adminAClient.agent.patch("/api/admin/users/00000000-0000-0000-0000-000000000000")).send({
      name: "Ghost",
    });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe("User not found.");
    expectSafeBody(res);
  });
});
