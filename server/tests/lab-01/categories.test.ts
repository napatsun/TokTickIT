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
 * GET /api/categories — api-spec.md §2
 *
 * Returns active Categories wrapped in { categories: [...] }.
 * Lab 3 (BR-03): identity comes from the authenticated session cookie.
 * Only isActive=true rows are returned (BR-21).
 *
 * Seed data: 4 active categories (Account and Access, Hardware, Software, Network).
 */
describe("GET /api/categories", () => {
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

  it("returns 200 with wrapped format { categories: [...] }", async () => {
    const res = await client.agent.get("/api/categories");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("categories");
    expect(Array.isArray(res.body.categories)).toBe(true);
  });

  it("returns only active categories", async () => {
    const res = await client.agent.get("/api/categories");

    // Seed has 4 active categories
    expect(res.body.categories.length).toBe(4);

    const names = res.body.categories.map((c: { name: string }) => c.name);
    expect(names).toContain("Account and Access");
    expect(names).toContain("Hardware");
    expect(names).toContain("Software");
    expect(names).toContain("Network");
  });

  it("returns categories with id and name fields", async () => {
    const res = await client.agent.get("/api/categories");

    for (const category of res.body.categories) {
      expect(category).toHaveProperty("id");
      expect(category).toHaveProperty("name");
      expect(typeof category.id).toBe("number");
      expect(typeof category.name).toBe("string");
    }
  });

  it("returns categories in ascending id order", async () => {
    const res = await client.agent.get("/api/categories");

    const ids = res.body.categories.map((c: { id: number }) => c.id);
    const sortedIds = [...ids].sort((a: number, b: number) => a - b);
    expect(ids).toEqual(sortedIds);
  });

  it("returns 401 without a session", async () => {
    const res = await request(app).get("/api/categories");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 401 once the session's user is deactivated", async () => {
    const temp = await createTestUser({ role: "REQUESTER" });
    const tempClient = await loginAs(app, temp.email);

    expect((await tempClient.agent.get("/api/categories")).status).toBe(200);

    await prisma.user.update({ where: { id: temp.id }, data: { isActive: false } });

    const res = await tempClient.agent.get("/api/categories");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");

    await cleanupTestUsers([temp.id]);
  });

  it("excludes inactive categories from response", async () => {
    // Create an inactive category directly via Prisma
    const inactiveCategory = await prisma.category.create({
      data: { name: "__TEST_INACTIVE_CATEGORY__", isActive: false },
    });

    try {
      const res = await client.agent.get("/api/categories");

      expect(res.status).toBe(200);

      const ids = res.body.categories.map((c: { id: number }) => c.id);
      expect(ids).not.toContain(inactiveCategory.id);

      const names = res.body.categories.map((c: { name: string }) => c.name);
      expect(names).not.toContain("__TEST_INACTIVE_CATEGORY__");
    } finally {
      // Cleanup: remove the test record
      await prisma.category.delete({ where: { id: inactiveCategory.id } });
    }
  });
});
