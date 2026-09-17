import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { hashPassword, verifyPassword, UNHASHED_PLACEHOLDER } from "../../src/lib/password.js";

const prisma = getPrisma();

/**
 * Authentication API — api-spec.md §1 (tests.md §1)
 *
 *   API-01  valid login → 200, session cookie, safe user payload
 *   API-02  wrong password → 401 generic INVALID_CREDENTIALS
 *   API-03  unknown email → 401, byte-identical to API-02
 *   API-04  inactive account → 401, same shape (BR-09)
 *   API-05  missing fields → 422 field-level errors
 *   API-06  logout invalidates the session (BR-08)
 *   API-07  GET /auth/me → id/name/email/role/mustChangePassword, never passwordHash
 *   API-08  mustChangePassword=true → 403 PASSWORD_CHANGE_REQUIRED everywhere else (BR-02)
 *   API-09  weak / mismatched new password → 422, flag unchanged
 *   API-10  valid new password → 200, flag cleared, protected calls succeed
 *   UNIT-01 password hashing (BR-07)
 *
 * Dedicated fixture accounts (not the seed) keep this file independent of the
 * seed's documented credentials and of password changes made by other suites.
 */

// ─── Fixtures ───────────────────────────────────────────────────────────

const PASSWORD = "Password123!";
const run = crypto.randomUUID().slice(0, 8);

let activeUser: { id: string; email: string };
let mustChangeUser: { id: string; email: string };
let inactiveUser: { id: string; email: string };

beforeAll(async () => {
  activeUser = await prisma.user.create({
    data: {
      name: "Active Test Requester",
      email: `active-${run}@test.com`,
      passwordHash: await hashPassword(PASSWORD),
      role: "REQUESTER",
      isActive: true,
      mustChangePassword: false,
    },
    select: { id: true, email: true },
  });

  mustChangeUser = await prisma.user.create({
    data: {
      name: "Must Change Test Requester",
      email: `mustchange-${run}@test.com`,
      passwordHash: await hashPassword(PASSWORD),
      role: "REQUESTER",
      isActive: true,
      mustChangePassword: true,
    },
    select: { id: true, email: true },
  });

  inactiveUser = await prisma.user.create({
    data: {
      name: "Inactive Test Requester",
      email: `inactive-${run}@test.com`,
      passwordHash: await hashPassword(PASSWORD),
      role: "REQUESTER",
      isActive: false,
      mustChangePassword: false,
    },
    select: { id: true, email: true },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [activeUser.id, mustChangeUser.id, inactiveUser.id] } } });
  await prisma.$disconnect();
});

// ─── Helpers ────────────────────────────────────────────────────────────

/** A cookie-jar agent so the `sid` session cookie persists across requests. */
function agent() {
  return request.agent(app);
}

function readCookie(res: request.Response, name: string): string | undefined {
  const cookies = (res.headers["set-cookie"] as unknown as string[]) ?? [];
  for (const cookie of cookies) {
    const match = cookie.match(new RegExp(`^${name}=([^;]*)`));
    if (match) return decodeURIComponent(match[1]);
  }
  return undefined;
}

/** Log in and return { agent, csrfToken } for subsequent state-changing calls. */
async function loginAs(email: string, password: string = PASSWORD) {
  const a = agent();
  const res = await a.post("/api/auth/login").send({ email, password });
  return { a, res, csrfToken: readCookie(res, "csrf") };
}

// ─── API-01 ─────────────────────────────────────────────────────────────

describe("API-01 — valid login (AC-01)", () => {
  it("returns 200, sets the session cookie, and returns a safe user payload", async () => {
    const { a, res } = await loginAs(activeUser.email);

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: activeUser.id,
      name: "Active Test Requester",
      email: activeUser.email,
      role: "REQUESTER",
      isActive: true,
      mustChangePassword: false,
    });

    // No credential material ever leaves the API (BR-11).
    expect(res.body.user).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
    expect(JSON.stringify(res.body)).not.toContain("$2a$");

    // HTTP-only session cookie + readable CSRF cookie (api-spec §0).
    const setCookies = (res.headers["set-cookie"] as unknown as string[]) ?? [];
    const sidCookie = setCookies.find((c) => c.startsWith("sid="));
    expect(sidCookie).toBeDefined();
    expect(sidCookie).toContain("HttpOnly");
    expect(sidCookie).toContain("SameSite=Lax");
    expect(setCookies.some((c) => c.startsWith("csrf="))).toBe(true);

    // The session actually works.
    const me = await a.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(activeUser.id);
  });
});

// ─── API-02 / API-03 / API-04 ───────────────────────────────────────────

describe("API-02/03/04 — generic credential failures (BR-06, BR-09)", () => {
  it("API-02: wrong password → 401 INVALID_CREDENTIALS with no field detail", async () => {
    const res = await agent().post("/api/auth/login").send({ email: activeUser.email, password: "WrongPassword1" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." },
    });
    expect(res.body.error.fields).toBeUndefined();
  });

  it("API-03: non-existent email → 401, identical body to wrong password", async () => {
    const wrongPassword = await agent()
      .post("/api/auth/login")
      .send({ email: activeUser.email, password: "WrongPassword1" });
    const unknownEmail = await agent()
      .post("/api/auth/login")
      .send({ email: `nobody-${run}@test.com`, password: PASSWORD });

    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it("API-04: inactive account with the CORRECT password → 401, same shape (no account-existence leak)", async () => {
    const wrongPassword = await agent()
      .post("/api/auth/login")
      .send({ email: activeUser.email, password: "WrongPassword1" });
    const inactive = await agent().post("/api/auth/login").send({ email: inactiveUser.email, password: PASSWORD });

    expect(inactive.status).toBe(401);
    expect(inactive.body).toEqual(wrongPassword.body);
    // No session was established.
    expect(((inactive.headers["set-cookie"] as unknown as string[]) ?? []).some((c) => c.startsWith("sid="))).toBe(false);
  });
});

// ─── API-05 ─────────────────────────────────────────────────────────────

describe("API-05 — malformed login input (BR-01)", () => {
  it("returns 422 field-level errors when email and password are missing", async () => {
    const res = await agent().post("/api/auth/login").send({});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.fields).toHaveProperty("email");
    expect(res.body.error.fields).toHaveProperty("password");
  });

  it("returns 422 for a malformed email", async () => {
    const res = await agent().post("/api/auth/login").send({ email: "not-an-email", password: PASSWORD });

    expect(res.status).toBe(422);
    expect(res.body.error.fields).toHaveProperty("email");
  });
});

// ─── API-06 ─────────────────────────────────────────────────────────────

describe("API-06 — logout invalidates the session (FR-05, BR-08)", () => {
  it("returns 200 and the old cookie is rejected with 401 afterwards", async () => {
    const { a, csrfToken } = await loginAs(activeUser.email);

    const meBefore = await a.get("/api/auth/me");
    expect(meBefore.status).toBe(200);

    const logout = await a.post("/api/auth/logout").set("X-CSRF-Token", csrfToken!);
    expect(logout.status).toBe(200);
    expect(logout.body).toEqual({ success: true });

    const meAfter = await a.get("/api/auth/me");
    expect(meAfter.status).toBe(401);
    expect(meAfter.body.error.code).toBe("UNAUTHENTICATED");
  });
});

// ─── API-07 ─────────────────────────────────────────────────────────────

describe("API-07 — GET /api/auth/me (FR-04, BR-11)", () => {
  it("returns the current user and never the password hash", async () => {
    const { a } = await loginAs(activeUser.email);

    const res = await a.get("/api/auth/me");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: activeUser.id,
      name: "Active Test Requester",
      email: activeUser.email,
      role: "REQUESTER",
      isActive: true,
      mustChangePassword: false,
    });
    expect(res.body.passwordHash).toBeUndefined();
  });

  it("returns 401 without a session", async () => {
    const res = await agent().get("/api/auth/me");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });
});

// ─── API-08 ─────────────────────────────────────────────────────────────

describe("API-08 — mustChangePassword gate (AC-02, BR-02, FR-06)", () => {
  it("blocks every other protected endpoint with 403 PASSWORD_CHANGE_REQUIRED", async () => {
    const { a } = await loginAs(mustChangeUser.email);

    for (const path of ["/api/tickets", "/api/categories", "/api/related-systems"]) {
      const res = await a.get(path);
      expect(res.status, `${path} should be blocked`).toBe(403);
      expect(res.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    }
  });

  it("still allows /auth/me, /auth/logout, and /auth/change-password", async () => {
    const { a, csrfToken } = await loginAs(mustChangeUser.email);

    const me = await a.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.mustChangePassword).toBe(true);

    // Exempt endpoints must not answer with PASSWORD_CHANGE_REQUIRED.
    const change = await a
      .post("/api/auth/change-password")
      .set("X-CSRF-Token", csrfToken!)
      .send({ newPassword: "short", confirmPassword: "short" });
    expect(change.status).toBe(422);
    expect(change.body.error.code).toBe("VALIDATION_ERROR");

    const logout = await a.post("/api/auth/logout").set("X-CSRF-Token", csrfToken!);
    expect(logout.status).toBe(200);
  });

  it("applies the guard to session-authenticated POSTs as well", async () => {
    const { a, csrfToken } = await loginAs(mustChangeUser.email);

    const res = await a.post("/api/tickets").set("X-CSRF-Token", csrfToken!).field("summary", "x");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });
});

// ─── API-09 / API-10 ────────────────────────────────────────────────────

describe("API-09/API-10 — change password (FR-07, AC-14)", () => {
  it("API-09: weak and mismatched passwords → 422 and the flag stays set", async () => {
    const { a, csrfToken } = await loginAs(mustChangeUser.email);

    const weak = await a
      .post("/api/auth/change-password")
      .set("X-CSRF-Token", csrfToken!)
      .send({ newPassword: "abc", confirmPassword: "abc" });
    expect(weak.status).toBe(422);
    expect(weak.body.error.fields).toHaveProperty("newPassword");

    const mismatch = await a
      .post("/api/auth/change-password")
      .set("X-CSRF-Token", csrfToken!)
      .send({ newPassword: "NewPassword1", confirmPassword: "NewPassword2" });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.fields).toHaveProperty("confirmPassword");

    const me = await a.get("/api/auth/me");
    expect(me.body.mustChangePassword).toBe(true);
  });

  it("API-10: valid password → 200, flag cleared, protected calls succeed, and the new password works", async () => {
    const { a, csrfToken } = await loginAs(mustChangeUser.email);
    const newPassword = "BrandNewPass9";

    const change = await a
      .post("/api/auth/change-password")
      .set("X-CSRF-Token", csrfToken!)
      .send({ newPassword, confirmPassword: newPassword });
    expect(change.status).toBe(200);
    expect(change.body).toEqual({ success: true });

    const me = await a.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.mustChangePassword).toBe(false);

    // The gate is gone for the same session…
    const tickets = await a.get("/api/tickets");
    expect(tickets.status).toBe(200);

    // …the old password no longer authenticates…
    const oldLogin = await agent().post("/api/auth/login").send({ email: mustChangeUser.email, password: PASSWORD });
    expect(oldLogin.status).toBe(401);

    // …and the new one does.
    const newLogin = await agent().post("/api/auth/login").send({ email: mustChangeUser.email, password: newPassword });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.mustChangePassword).toBe(false);
  });
});

// ─── CSRF (api-spec.md §0) ──────────────────────────────────────────────

describe("CSRF protection (api-spec.md §0)", () => {
  it("rejects a state-changing session request without the X-CSRF-Token header", async () => {
    const { a } = await loginAs(activeUser.email);

    const res = await a.post("/api/auth/logout");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CSRF_INVALID");
  });

  it("rejects a mismatched X-CSRF-Token header", async () => {
    const { a } = await loginAs(activeUser.email);

    const res = await a.post("/api/auth/logout").set("X-CSRF-Token", "not-the-token");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CSRF_INVALID");
  });
});

// ─── UNIT-01 ────────────────────────────────────────────────────────────

describe("UNIT-01 — password hashing (BR-07)", () => {
  it("produces a salted hash that never equals the plaintext", async () => {
    const hash = await hashPassword(PASSWORD);

    expect(hash).not.toBe(PASSWORD);
    expect(hash.startsWith("$2")).toBe(true);
    expect(hash).not.toContain(PASSWORD);
  });

  it("salts each hash differently while verifying the same plaintext", async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);

    expect(first).not.toBe(second); // unique salt per hash
    expect(await verifyPassword(PASSWORD, first)).toBe(true);
    expect(await verifyPassword(PASSWORD, second)).toBe(true);
  });

  it("verify() matches the correct password only", async () => {
    const hash = await hashPassword(PASSWORD);

    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword("WrongPassword1", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("never verifies against an empty or un-migrated placeholder hash", async () => {
    expect(await verifyPassword(PASSWORD, "")).toBe(false);
    expect(await verifyPassword(PASSWORD, UNHASHED_PLACEHOLDER)).toBe(false);
    expect(await verifyPassword(PASSWORD, "not-a-bcrypt-hash")).toBe(false);
  });
});
