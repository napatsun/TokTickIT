import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";

const prisma = getPrisma();

/**
 * GET /api/categories — api-spec.md §2
 *
 * Returns active Categories wrapped in { categories: [...] }.
 * Requires X-Dev-Requester-Id header (requesterContext middleware).
 * Only isActive=true rows are returned (BR-21).
 *
 * Seed data: 4 active categories (Account and Access, Hardware, Software, Network).
 */
describe("GET /api/categories", () => {
  let activeRequesterId: number;

  beforeAll(async () => {
    await seed();

    // Find an active requester for auth header
    const requester = await prisma.devRequester.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    expect(requester).toBeDefined();
    activeRequesterId = requester!.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns 200 with wrapped format { categories: [...] }", async () => {
    const res = await request(app)
      .get("/api/categories")
      .set("X-Dev-Requester-Id", String(activeRequesterId));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("categories");
    expect(Array.isArray(res.body.categories)).toBe(true);
  });

  it("returns only active categories", async () => {
    const res = await request(app)
      .get("/api/categories")
      .set("X-Dev-Requester-Id", String(activeRequesterId));

    // Seed has 4 active categories
    expect(res.body.categories.length).toBe(4);

    const names = res.body.categories.map((c: { name: string }) => c.name);
    expect(names).toContain("Account and Access");
    expect(names).toContain("Hardware");
    expect(names).toContain("Software");
    expect(names).toContain("Network");
  });

  it("returns categories with id and name fields", async () => {
    const res = await request(app)
      .get("/api/categories")
      .set("X-Dev-Requester-Id", String(activeRequesterId));

    for (const category of res.body.categories) {
      expect(category).toHaveProperty("id");
      expect(category).toHaveProperty("name");
      expect(typeof category.id).toBe("number");
      expect(typeof category.name).toBe("string");
    }
  });

  it("returns categories in ascending id order", async () => {
    const res = await request(app)
      .get("/api/categories")
      .set("X-Dev-Requester-Id", String(activeRequesterId));

    const ids = res.body.categories.map((c: { id: number }) => c.id);
    const sortedIds = [...ids].sort((a: number, b: number) => a - b);
    expect(ids).toEqual(sortedIds);
  });

  it("returns 401 without X-Dev-Requester-Id header", async () => {
    const res = await request(app).get("/api/categories");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
  });

  it("returns 401 with inactive requester", async () => {
    const inactive = await prisma.devRequester.findFirst({
      where: { isActive: false },
      select: { id: true },
    });
    if (!inactive) return; // No inactive requesters in DB, skip

    const res = await request(app)
      .get("/api/categories")
      .set("X-Dev-Requester-Id", String(inactive.id));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
  });
});
