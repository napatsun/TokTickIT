import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";

const prisma = getPrisma();

/**
 * Data migration & seed — tests.md §7
 *
 *   MIG-03  seed script run twice is idempotent
 *   MIG-04  seeded account volume matches specification.md §7.3
 *   MIG-05  pre-existing Ticket/Attachment referential integrity post-migration
 */

async function tableCounts() {
  const [users, tickets, attachments, devRequesters, categories, relatedSystems] = await Promise.all([
    prisma.user.count(),
    prisma.ticket.count(),
    prisma.attachment.count(),
    prisma.devRequester.count(),
    prisma.category.count(),
    prisma.relatedSystem.count(),
  ]);
  return { users, tickets, attachments, devRequesters, categories, relatedSystems };
}

beforeAll(async () => {
  await seed();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── MIG-03 ─────────────────────────────────────────────────────────────

describe("MIG-03 — seed idempotency", () => {
  it("running seed twice does not duplicate users or tickets", async () => {
    const afterFirst = await tableCounts();

    await seed();

    const afterSecond = await tableCounts();

    expect(afterSecond).toEqual(afterFirst);
  });

  it("leaves no duplicate emails or ticket numbers behind", async () => {
    const duplicateEmails = await prisma.$queryRaw<{ email: string; count: number }[]>`
      SELECT email, count(*)::int AS count FROM "User" GROUP BY email HAVING count(*) > 1
    `;
    const duplicateTicketNumbers = await prisma.$queryRaw<{ ticketNumber: string; count: number }[]>`
      SELECT "ticketNumber", count(*)::int AS count FROM "Ticket" GROUP BY "ticketNumber" HAVING count(*) > 1
    `;

    expect(duplicateEmails).toEqual([]);
    expect(duplicateTicketNumbers).toEqual([]);
  });
});

// ─── MIG-04 ─────────────────────────────────────────────────────────────

describe("MIG-04 — seed volume (specification.md §7.3)", () => {
  it("provides at least 4 active + 1 inactive Requester", async () => {
    const active = await prisma.user.count({ where: { role: "REQUESTER", isActive: true } });
    const inactive = await prisma.user.count({ where: { role: "REQUESTER", isActive: false } });

    expect(active).toBeGreaterThanOrEqual(4);
    expect(inactive).toBeGreaterThanOrEqual(1);
  });

  it("provides at least 3 active + 1 inactive IT Staff", async () => {
    const active = await prisma.user.count({ where: { role: "IT_STAFF", isActive: true } });
    const inactive = await prisma.user.count({ where: { role: "IT_STAFF", isActive: false } });

    expect(active).toBeGreaterThanOrEqual(3);
    expect(inactive).toBeGreaterThanOrEqual(1);
  });

  it("provides at least one active Administrator", async () => {
    const admins = await prisma.user.count({ where: { role: "ADMINISTRATOR", isActive: true } });

    expect(admins).toBeGreaterThanOrEqual(1);
  });

  it("distributes tickets across statuses, IT priorities, and ownership", async () => {
    const statuses = await prisma.ticket.groupBy({ by: ["status"] });
    const priorities = await prisma.ticket.groupBy({ by: ["itPriority"] });
    const unassigned = await prisma.ticket.count({ where: { ownerId: null } });
    const assigned = await prisma.ticket.count({ where: { ownerId: { not: null } } });

    expect(statuses.length).toBeGreaterThanOrEqual(3);
    expect(priorities.length).toBeGreaterThanOrEqual(2);
    expect(unassigned).toBeGreaterThanOrEqual(1);
    expect(assigned).toBeGreaterThanOrEqual(1);
  });

  it("never seeds a plaintext password", async () => {
    const users = await prisma.user.findMany({ select: { passwordHash: true } });

    expect(users.length).toBeGreaterThan(0);
    for (const user of users) {
      expect(user.passwordHash.startsWith("$2")).toBe(true);
      expect(user.passwordHash).not.toContain("Password123!");
      expect(user.passwordHash).not.toContain("Admin123!");
    }
  });
});

// ─── MIG-05 ─────────────────────────────────────────────────────────────

describe("MIG-05 — referential integrity after migration", () => {
  it("has no Ticket whose requesterId does not resolve to a User", async () => {
    const orphans = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "Ticket" t
      LEFT JOIN "User" u ON u.id = t."requesterId"
      WHERE u.id IS NULL
    `;

    expect(orphans[0].count).toBe(0);
  });

  it("has no Ticket whose ownerId resolves to a missing User", async () => {
    const orphans = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "Ticket" t
      LEFT JOIN "User" u ON u.id = t."ownerId"
      WHERE t."ownerId" IS NOT NULL AND u.id IS NULL
    `;

    expect(orphans[0].count).toBe(0);
  });

  it("only assigns Tickets to active IT Staff or Administrators (BR-12)", async () => {
    const invalidOwners = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "Ticket" t
      JOIN "User" u ON u.id = t."ownerId"
      WHERE t."ownerId" IS NOT NULL
        AND NOT (u.role IN ('IT_STAFF', 'ADMINISTRATOR') AND u."isActive" = true)
    `;

    expect(invalidOwners[0].count).toBe(0);
  });

  it("has no Attachment whose uploader/remover does not resolve to a User", async () => {
    const uploaderOrphans = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "Attachment" a
      LEFT JOIN "User" u ON u.id = a."uploadedByRequesterId"
      WHERE u.id IS NULL
    `;
    const removerOrphans = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "Attachment" a
      LEFT JOIN "User" u ON u.id = a."removedByRequesterId"
      WHERE a."removedByRequesterId" IS NOT NULL AND u.id IS NULL
    `;

    expect(uploaderOrphans[0].count).toBe(0);
    expect(removerOrphans[0].count).toBe(0);
  });

  it("keeps every pre-existing Ticket queryable through its requester relation", async () => {
    const tickets = await prisma.ticket.findMany({
      select: { id: true, ticketNumber: true, requester: { select: { id: true, email: true } } },
    });

    expect(tickets.length).toBeGreaterThan(0);
    for (const ticket of tickets) {
      expect(ticket.requester).toBeTruthy();
      expect(ticket.requester.email).toBeTruthy();
    }
  });
});
