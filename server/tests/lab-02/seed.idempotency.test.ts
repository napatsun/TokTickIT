import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seed } from "../../prisma/seed.js";
import { getPrisma } from "../../src/prisma.js";

const prisma = getPrisma();

/**
 * SEED-01 — Seed idempotency
 * specification.md Section 5.3 (seed idempotency requirement):
 * Running the seed script twice in a row must not create duplicate rows.
 */
describe("Seed idempotency", () => {
  beforeAll(async () => {
    // Clear reference tables so the first seed() creates from scratch
    await prisma.$executeRawUnsafe("DELETE FROM \"Attachment\"");
    await prisma.$executeRawUnsafe("DELETE FROM \"Ticket\"");
    await prisma.$executeRawUnsafe("DELETE FROM \"DevRequester\"");
    await prisma.$executeRawUnsafe("DELETE FROM \"RelatedSystem\"");
    await prisma.$executeRawUnsafe("DELETE FROM \"Category\"");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("running seed twice produces the same row counts in every table", async () => {
    // --- First seed run ---
    await seed();

    const afterFirst = {
      categories: await prisma.category.count(),
      relatedSystems: await prisma.relatedSystem.count(),
      devRequesters: await prisma.devRequester.count(),
    };

    // --- Second seed run ---
    await seed();

    const afterSecond = {
      categories: await prisma.category.count(),
      relatedSystems: await prisma.relatedSystem.count(),
      devRequesters: await prisma.devRequester.count(),
    };

    // Every table must have the same count after both runs
    expect(afterSecond.categories).toBe(afterFirst.categories);
    expect(afterSecond.relatedSystems).toBe(afterFirst.relatedSystems);
    expect(afterSecond.devRequesters).toBe(afterFirst.devRequesters);
  });
});
