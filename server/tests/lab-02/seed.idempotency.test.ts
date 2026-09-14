import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seed } from "../../prisma/seed.js";
import { getPrisma } from "../../src/prisma.js";

const prisma = getPrisma();

/**
 * SEED-01 — Seed idempotency
 * specification.md Section 5.3 (seed idempotency requirement):
 * Running the seed script twice in a row must not create duplicate rows.
 *
 * Lab 3: the retired `DevRequester` table is gone (BR-03); Public Comments are
 * seeded with deterministic ids so they count the same on every run.
 */
describe("Seed idempotency", () => {
  beforeAll(async () => {
    // Clear reference tables so the first seed() creates from scratch
    await prisma.$executeRawUnsafe('DELETE FROM "PublicComment"');
    await prisma.$executeRawUnsafe('DELETE FROM "Attachment"');
    await prisma.$executeRawUnsafe('DELETE FROM "Ticket"');
    await prisma.$executeRawUnsafe('DELETE FROM "RelatedSystem"');
    await prisma.$executeRawUnsafe('DELETE FROM "Category"');
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
      users: await prisma.user.count(),
      tickets: await prisma.ticket.count(),
      publicComments: await prisma.publicComment.count(),
    };

    // --- Second seed run ---
    await seed();

    const afterSecond = {
      categories: await prisma.category.count(),
      relatedSystems: await prisma.relatedSystem.count(),
      users: await prisma.user.count(),
      tickets: await prisma.ticket.count(),
      publicComments: await prisma.publicComment.count(),
    };

    // Every table must have the same count after both runs
    expect(afterSecond).toEqual(afterFirst);
  });
});
