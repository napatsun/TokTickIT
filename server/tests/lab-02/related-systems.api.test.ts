import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";

const prisma = getPrisma();

/**
 * GET /api/related-systems — api-spec.md §3
 *
 * Returns active Related Systems wrapped in { relatedSystems: [...] }.
 * Requires X-Dev-Requester-Id header (requesterContext middleware).
 * Only isActive=true rows are returned (BR-21).
 *
 * Seed data: 6 related systems (Email, Campus Wi-Fi, VPN, Corporate Laptop,
 * Printer, Grade Submission App).
 */
describe("GET /api/related-systems", () => {
  let activeRequesterId: number;

  beforeAll(async () => {
    await seed();

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

  it("returns 200 with wrapped format { relatedSystems: [...] }", async () => {
    const res = await request(app)
      .get("/api/related-systems")
      .set("X-Dev-Requester-Id", String(activeRequesterId));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("relatedSystems");
    expect(Array.isArray(res.body.relatedSystems)).toBe(true);
  });

  it("returns all 6 seeded active related systems", async () => {
    const res = await request(app)
      .get("/api/related-systems")
      .set("X-Dev-Requester-Id", String(activeRequesterId));

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
    const res = await request(app)
      .get("/api/related-systems")
      .set("X-Dev-Requester-Id", String(activeRequesterId));

    for (const rs of res.body.relatedSystems) {
      expect(rs).toHaveProperty("id");
      expect(rs).toHaveProperty("name");
      expect(typeof rs.id).toBe("number");
      expect(typeof rs.name).toBe("string");
    }
  });

  it("returns related systems in ascending id order", async () => {
    const res = await request(app)
      .get("/api/related-systems")
      .set("X-Dev-Requester-Id", String(activeRequesterId));

    const ids = res.body.relatedSystems.map((rs: { id: number }) => rs.id);
    const sortedIds = [...ids].sort((a: number, b: number) => a - b);
    expect(ids).toEqual(sortedIds);
  });

  it("returns 401 without X-Dev-Requester-Id header", async () => {
    const res = await request(app).get("/api/related-systems");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
  });

  it("returns 401 with inactive requester", async () => {
    const inactive = await prisma.devRequester.findFirst({
      where: { isActive: false },
      select: { id: true },
    });
    if (!inactive) return;

    const res = await request(app)
      .get("/api/related-systems")
      .set("X-Dev-Requester-Id", String(inactive.id));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
  });

  it("returns 401 with non-existent requester id", async () => {
    const res = await request(app)
      .get("/api/related-systems")
      .set("X-Dev-Requester-Id", "99999");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
  });
});
