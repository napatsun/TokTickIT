import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";

const prisma = getPrisma();

/**
 * GET /api/dev-requesters — api-spec.md §1
 *
 * Returns only active Development Requesters (BR-02).
 * No auth header required — the one endpoint reachable before selection.
 * Response shape: { requesters: [{ id, fullName, email }] }
 *
 * Seed data (lab2/02): 4 active + 1 inactive (Robert Wilson, id:5).
 */
describe("GET /api/dev-requesters", () => {
  beforeAll(async () => {
    // Ensure seed data exists (idempotent)
    await seed();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns 200 with only active requesters", async () => {
    const res = await request(app).get("/api/dev-requesters");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("requesters");
    expect(Array.isArray(res.body.requesters)).toBe(true);

    // Seed has 4 active requesters
    expect(res.body.requesters.length).toBe(4);
  });

  it("returns requesters with id, fullName, and email fields", async () => {
    const res = await request(app).get("/api/dev-requesters");

    for (const requester of res.body.requesters) {
      expect(requester).toHaveProperty("id");
      expect(requester).toHaveProperty("fullName");
      expect(requester).toHaveProperty("email");
      expect(typeof requester.id).toBe("number");
      expect(typeof requester.fullName).toBe("string");
      expect(typeof requester.email).toBe("string");
    }
  });

  it("excludes inactive requesters (Robert Wilson)", async () => {
    const res = await request(app).get("/api/dev-requesters");

    const names = res.body.requesters.map((r: { fullName: string }) => r.fullName);
    expect(names).not.toContain("Robert Wilson");
  });

  it("returns requesters in ascending id order", async () => {
    const res = await request(app).get("/api/dev-requesters");

    const ids = res.body.requesters.map((r: { id: number }) => r.id);
    const sortedIds = [...ids].sort((a, b) => a - b);
    expect(ids).toEqual(sortedIds);
  });

  it("does not require an X-Dev-Requester-Id header", async () => {
    const res = await request(app).get("/api/dev-requesters");

    // Should succeed without any auth header
    expect(res.status).toBe(200);
  });

  it("returns inactive requester count confirming seed data integrity", async () => {
    // Verify seed data has exactly 1 inactive requester (Robert Wilson)
    const inactiveCount = await prisma.devRequester.count({
      where: { isActive: false },
    });
    expect(inactiveCount).toBe(1);

    const inactive = await prisma.devRequester.findFirst({
      where: { isActive: false },
      select: { fullName: true },
    });
    expect(inactive?.fullName).toBe("Robert Wilson");
  });
});
