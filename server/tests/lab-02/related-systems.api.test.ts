import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
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
 * GET /api/related-systems — api-spec.md §3
 *
 * Returns active Related Systems wrapped in { relatedSystems: [...] }.
 * Lab 3 (BR-03): identity comes from the authenticated session cookie.
 * Only isActive=true rows are returned (BR-21).
 *
 * Seed data: 6 related systems (Email, Campus Wi-Fi, VPN, Corporate Laptop,
 * Printer, Grade Submission App).
 */
describe("GET /api/related-systems", () => {
  let requester: TestUser;
  let client: SessionClient;

  beforeAll(async () => {
    await seed();
    requester = await createTestUser({ role: "REQUESTER" });
    client = await loginAs(app, requester.email);
  });

  afterAll(async () => {
    await cleanupTestUsers([requester.id]);
    await prisma.$disconnect();
  });

  it("returns 200 with wrapped format { relatedSystems: [...] }", async () => {
    const res = await client.agent.get("/api/related-systems");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("relatedSystems");
    expect(Array.isArray(res.body.relatedSystems)).toBe(true);
  });

  it("returns all 6 seeded active related systems", async () => {
    const res = await client.agent.get("/api/related-systems");

    expect(res.body.relatedSystems.length).toBe(6);

    const names = res.body.relatedSystems.map((rs: { name: string }) => rs.name);
    expect(names).toContain("Email");
    expect(names).toContain("Campus Wi-Fi");
    expect(names).toContain("VPN");
    expect(names).toContain("Corporate Laptop");
    expect(names).toContain("Printer");
    expect(names).toContain("Grade Submission App");
  });

  it("returns related systems with id and name fields", async () => {
    const res = await client.agent.get("/api/related-systems");

    for (const rs of res.body.relatedSystems) {
      expect(rs).toHaveProperty("id");
      expect(rs).toHaveProperty("name");
      expect(typeof rs.id).toBe("number");
      expect(typeof rs.name).toBe("string");
    }
  });

  it("returns related systems in ascending id order", async () => {
    const res = await client.agent.get("/api/related-systems");

    const ids = res.body.relatedSystems.map((rs: { id: number }) => rs.id);
    const sortedIds = [...ids].sort((a: number, b: number) => a - b);
    expect(ids).toEqual(sortedIds);
  });

  it("returns 401 without a session", async () => {
    const res = await request(app).get("/api/related-systems");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 401 once the session's user is deactivated", async () => {
    const temp = await createTestUser({ role: "REQUESTER" });
    const tempClient = await loginAs(app, temp.email);

    expect((await tempClient.agent.get("/api/related-systems")).status).toBe(200);

    await prisma.user.update({ where: { id: temp.id }, data: { isActive: false } });

    const res = await tempClient.agent.get("/api/related-systems");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");

    await cleanupTestUsers([temp.id]);
  });

  it("excludes inactive related systems from response", async () => {
    // Create an inactive related system directly via Prisma
    const inactiveSystem = await prisma.relatedSystem.create({
      data: { name: "__TEST_INACTIVE_SYSTEM__", isActive: false },
    });

    try {
      const res = await client.agent.get("/api/related-systems");

      expect(res.status).toBe(200);

      const ids = res.body.relatedSystems.map((rs: { id: number }) => rs.id);
      expect(ids).not.toContain(inactiveSystem.id);

      const names = res.body.relatedSystems.map((rs: { name: string }) => rs.name);
      expect(names).not.toContain("__TEST_INACTIVE_SYSTEM__");
    } finally {
      // Cleanup: remove the test record
      await prisma.relatedSystem.delete({ where: { id: inactiveSystem.id } });
    }
  });
});
