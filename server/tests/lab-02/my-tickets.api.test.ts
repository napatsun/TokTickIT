import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";

const prisma = getPrisma();

/**
 * GET /api/tickets — api-spec.md §5
 *
 * Paginated, searchable, filterable, sortable list of the current
 * Requester's own Tickets (FR-07, FR-08).
 *
 * Tests cover:
 *   API-09  AC-10  Requester isolation — only own tickets returned
 *   API-10  AC-11  Search by ticket number/summary substring
 *   API-11  AC-12  Filter by categoryId
 *   API-12  AC-15  Pagination — 42 items, page 1 shows 10, page 2 next 10
 *   API-13  BR-17  Clamping — page=0, pageSize=999 → page=1, pageSize=10
 *   API-14  BR-15  Invalid enum — requestedPriority=URGENT → 400
 *   API-36  BR-15  filterOptions.categories — distinct only for requester
 *   API-37  BR-15  filterOptions.requestedPriorities — distinct only
 *   API-38  BR-15  filterOptions.currentStatuses — distinct only
 *   API-39  BR-15  filterOptions independent of active filter params
 *   API-40  BR-15  filterOptions empty when requester has zero tickets
 *   API-41  BR-12  filterOptions does not include other requester's values
 */

// ─── Helpers ─────────────────────────────────────────────────────────────

let requesterA: { id: number; fullName: string };
let requesterB: { id: number; fullName: string };
let categoryHardware: { id: number; name: string };
let categorySoftware: { id: number; name: string };
let categoryNetwork: { id: number; name: string };
let relatedSystem: { id: number };

/** IDs of tickets created for requesterA (used for isolation checks) */
const ticketIdsA: number[] = [];

/** ticketNumber of the "laptop" search target for requesterA */
let laptopTicketNumber: string;

function get(path: string, requesterId: number) {
  return request(app)
    .get(path)
    .set("X-Dev-Requester-Id", String(requesterId));
}

// ─── Seed data ───────────────────────────────────────────────────────────

beforeAll(async () => {
  await seed();

  // ── Requesters ────────────────────────────────────────────────────────
  const requesters = await prisma.devRequester.findMany({
    where: { isActive: true },
    orderBy: { id: "asc" },
    select: { id: true, fullName: true },
  });
  expect(requesters.length).toBeGreaterThanOrEqual(2);
  requesterA = requesters[0];
  requesterB = requesters[1];

  // ── Categories ────────────────────────────────────────────────────────
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { id: "asc" },
    select: { id: true, name: true },
  });
  // Need at least Hardware + Software + Network for filterOptions tests
  const hw = categories.find((c) => c.name === "Hardware");
  const sw = categories.find((c) => c.name === "Software");
  const nw = categories.find((c) => c.name === "Network");
  expect(hw).toBeDefined();
  expect(sw).toBeDefined();
  expect(nw).toBeDefined();
  categoryHardware = hw!;
  categorySoftware = sw!;
  categoryNetwork = nw!;

  // ── Related System ────────────────────────────────────────────────────
  const rs = await prisma.relatedSystem.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  expect(rs).toBeDefined();
  relatedSystem = rs!;

  // ── Clean up any leftover tickets from prior test runs ────────────────
  // (Only delete tickets for our two requesters to avoid affecting parallel tests)
  await prisma.attachment.deleteMany({
    where: { ticket: { requesterId: { in: [requesterA.id, requesterB.id] } } },
  });
  await prisma.ticket.deleteMany({
    where: { requesterId: { in: [requesterA.id, requesterB.id] } },
  });

  // ── Create tickets for requesterA ─────────────────────────────────────
  // We need enough tickets for pagination test (42 total for requesterA)
  // and varied categories/priorities for filterOptions tests.
  //
  // IMPORTANT: Use random ticket numbers to avoid collisions with
  // seed.idempotency.test.ts which deletes all data and re-seeds with
  // generateTicketNumber(). Fixed numbers (100000–100041) would collide
  // and cause unique constraint violations in parallel runs.

  const prioritiesForA = ["LOW", "MEDIUM", "HIGH"] as const;
  const categoriesForA = [categoryHardware, categorySoftware, categoryNetwork];

  // Generate a unique 6-digit random base to avoid any collision with
  // seed data (which uses incrementing sequences starting at 000001)
  const randomBase = 900000 + Math.floor(Math.random() * 90000);

  for (let i = 0; i < 42; i++) {
    const cat = categoriesForA[i % categoriesForA.length];
    const prio = prioritiesForA[i % prioritiesForA.length];
    const summary =
      i === 0
        ? "Laptop battery drains quickly"
        : `Ticket ${String(i + 1).padStart(2, "0")} for requester A`;
    const ticketNumber = `TKT-2026-${String(randomBase + i).padStart(6, "0")}`;
    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber,
        requesterId: requesterA.id,
        categoryId: cat.id,
        relatedSystemId: relatedSystem.id,
        summary,
        description: `Description for ticket ${i + 1} that is long enough to meet the minimum twenty character requirement.`,
        requestedPriority: prio,
      },
    });
    ticketIdsA.push(ticket.id);
    if (i === 0) laptopTicketNumber = ticketNumber;
  }

  // ── Create 3 tickets for requesterB ───────────────────────────────────
  // Only Hardware category, only MEDIUM priority — tests that filterOptions
  // for B doesn't include A's Software/Network or LOW/HIGH.
  // Use a different random base to avoid collision with requesterA tickets.
  const randomBaseB = 800000 + Math.floor(Math.random() * 90000);
  for (let i = 0; i < 3; i++) {
    await prisma.ticket.create({
      data: {
        ticketNumber: `TKT-2026-${String(randomBaseB + i).padStart(6, "0")}`,
        requesterId: requesterB.id,
        categoryId: categoryHardware.id,
        relatedSystemId: relatedSystem.id,
        summary: `Requester B ticket ${i + 1}`,
        description: `Description for requester B ticket ${i + 1} meeting minimum length requirement.`,
        requestedPriority: "MEDIUM",
      },
    });
  }
});

afterAll(async () => {
  // Clean up test tickets
  await prisma.attachment.deleteMany({
    where: { ticket: { requesterId: { in: [requesterA.id, requesterB.id] } } },
  });
  await prisma.ticket.deleteMany({
    where: { requesterId: { in: [requesterA.id, requesterB.id] } },
  });
  await prisma.$disconnect();
});

// ─── Tests ───────────────────────────────────────────────────────────────

describe("GET /api/tickets", () => {
  // ─── API-09: Requester isolation (AC-10) ─────────────────────────────

  describe("API-09: requestor isolation (AC-10)", () => {
    it("returns only requesterA's tickets, never requesterB's", async () => {
      // Use pageSize=50 to get all 42 tickets in one page
      const res = await get("/api/tickets?pageSize=50", requesterA.id);

      expect(res.status).toBe(200);
      expect(res.body.tickets.length).toBe(42);

      const ids = res.body.tickets.map((t: any) => t.id);
      for (const id of ids) {
        expect(ticketIdsA).toContain(id);
      }
    });

    it("returns only requesterB's tickets, never requesterA's", async () => {
      const res = await get("/api/tickets", requesterB.id);

      expect(res.status).toBe(200);
      expect(res.body.tickets.length).toBe(3);

      // All returned tickets should belong to requesterB
      for (const ticket of res.body.tickets) {
        // We can't check requesterId directly from the response shape,
        // but we can verify none of requesterA's ticket IDs appear
        expect(ticketIdsA).not.toContain(ticket.id);
      }
    });
  });

  // ─── API-10: Search (AC-11) ──────────────────────────────────────────

  describe("API-10: search (AC-11)", () => {
    it("search matches ticket number substring (case-insensitive)", async () => {
      // Extract the last 4 digits of the laptop ticket number to use as
      // a partial substring. This proves BR-14 partial/substring matching
      // (not exact full-number match) because "XXXX" is a suffix shared
      // with the laptop ticket only — other tickets have different suffixes.
      const suffix = laptopTicketNumber.slice(-4);
      const res = await get(
        `/api/tickets?search=${suffix}`,
        requesterA.id,
      );

      expect(res.status).toBe(200);
      expect(res.body.tickets.length).toBe(1);
      expect(res.body.tickets[0].ticketNumber).toBe(laptopTicketNumber);
    });

    it("search matches summary substring (case-insensitive)", async () => {
      const res = await get("/api/tickets?search=laptop+battery", requesterA.id);

      expect(res.status).toBe(200);
      expect(res.body.tickets.length).toBeGreaterThanOrEqual(1);
      // The first ticket (index 0) has summary "Laptop battery drains quickly"
      expect(res.body.tickets[0].summary.toLowerCase()).toContain(
        "laptop battery",
      );
    });

    it("search returns empty when no match", async () => {
      const res = await get(
        "/api/tickets?search=ZZZZZNONEXISTENT",
        requesterA.id,
      );

      expect(res.status).toBe(200);
      expect(res.body.tickets.length).toBe(0);
      expect(res.body.pagination.totalItems).toBe(0);
    });
  });

  // ─── API-11: Filter by categoryId (AC-12) ────────────────────────────

  describe("API-11: filter by categoryId (AC-12)", () => {
    it("returns only Hardware tickets for requesterA", async () => {
      // Use pageSize=50 to get all 14 Hardware tickets in one page
      const res = await get(
        `/api/tickets?categoryId=${categoryHardware.id}&pageSize=50`,
        requesterA.id,
      );

      expect(res.status).toBe(200);
      // Tickets 0,3,6,...,39 → 14 Hardware tickets for requesterA
      expect(res.body.tickets.length).toBe(14);
      for (const ticket of res.body.tickets) {
        expect(ticket.category).toBe("Hardware");
      }
    });

    it("returns only Software tickets", async () => {
      const res = await get(
        `/api/tickets?categoryId=${categorySoftware.id}`,
        requesterA.id,
      );

      expect(res.status).toBe(200);
      for (const ticket of res.body.tickets) {
        expect(ticket.category).toBe("Software");
      }
    });
  });

  // ─── API-12: Pagination (AC-15) ──────────────────────────────────────

  describe("API-12: pagination (AC-15)", () => {
    it("page 1 shows 10 tickets with correct pagination metadata", async () => {
      const res = await get("/api/tickets?page=1&pageSize=10", requesterA.id);

      expect(res.status).toBe(200);
      expect(res.body.tickets.length).toBe(10);
      expect(res.body.pagination).toEqual({
        page: 1,
        pageSize: 10,
        totalItems: 42,
        totalPages: 5,
      });
    });

    it("page 2 returns the next distinct 10 tickets", async () => {
      const res1 = await get("/api/tickets?page=1&pageSize=10", requesterA.id);
      const res2 = await get("/api/tickets?page=2&pageSize=10", requesterA.id);

      expect(res2.status).toBe(200);
      expect(res2.body.tickets.length).toBe(10);

      const ids1 = res1.body.tickets.map((t: any) => t.id);
      const ids2 = res2.body.tickets.map((t: any) => t.id);

      // No overlap between pages
      for (const id of ids2) {
        expect(ids1).not.toContain(id);
      }
    });

    it("page 5 shows the last 2 tickets", async () => {
      const res = await get("/api/tickets?page=5&pageSize=10", requesterA.id);

      expect(res.status).toBe(200);
      expect(res.body.tickets.length).toBe(2);
      expect(res.body.pagination.page).toBe(5);
    });
  });

  // ─── API-13: Clamping (BR-17) ────────────────────────────────────────

  describe("API-13: parameter clamping (BR-17)", () => {
    it("clamps page=0 to page=1 (not a 400)", async () => {
      const res = await get("/api/tickets?page=0&pageSize=10", requesterA.id);

      expect(res.status).toBe(200);
      expect(res.body.pagination.page).toBe(1);
    });

    it("clamps negative page to 1", async () => {
      const res = await get("/api/tickets?page=-5&pageSize=10", requesterA.id);

      expect(res.status).toBe(200);
      expect(res.body.pagination.page).toBe(1);
    });

    it("clamps pageSize=999 to pageSize=10 (fallback)", async () => {
      const res = await get("/api/tickets?page=1&pageSize=999", requesterA.id);

      expect(res.status).toBe(200);
      expect(res.body.pagination.pageSize).toBe(10);
      expect(res.body.tickets.length).toBe(10);
    });

    it("clamps pageSize=0 to pageSize=10", async () => {
      const res = await get("/api/tickets?page=1&pageSize=0", requesterA.id);

      expect(res.status).toBe(200);
      expect(res.body.pagination.pageSize).toBe(10);
    });

    it("accepts valid pageSize=20", async () => {
      const res = await get("/api/tickets?page=1&pageSize=20", requesterA.id);

      expect(res.status).toBe(200);
      expect(res.body.pagination.pageSize).toBe(20);
      expect(res.body.tickets.length).toBe(20);
    });

    it("accepts valid pageSize=50", async () => {
      const res = await get("/api/tickets?page=1&pageSize=50", requesterA.id);

      expect(res.status).toBe(200);
      expect(res.body.pagination.pageSize).toBe(50);
      expect(res.body.tickets.length).toBe(42);
    });
  });

  // ─── API-14: Invalid enum (BR-15) ────────────────────────────────────

  describe("API-14: invalid enum values", () => {
    it("returns 400 for invalid requestedPriority", async () => {
      const res = await get(
        "/api/tickets?requestedPriority=URGENT",
        requesterA.id,
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.fieldErrors).toHaveProperty("requestedPriority");
    });

    it("returns 400 for invalid sortBy", async () => {
      const res = await get(
        "/api/tickets?sortBy=invalidField",
        requesterA.id,
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.fieldErrors).toHaveProperty("sortBy");
    });

    it("returns 400 for invalid sortDir", async () => {
      const res = await get("/api/tickets?sortDir=random", requesterA.id);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.fieldErrors).toHaveProperty("sortDir");
    });

    it("returns 400 for invalid currentStatus", async () => {
      const res = await get(
        "/api/tickets?currentStatus=CLOSED",
        requesterA.id,
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.fieldErrors).toHaveProperty("currentStatus");
    });
  });

  // ─── API-36: filterOptions.categories (BR-15) ────────────────────────

  describe("API-36: filterOptions.categories (BR-15)", () => {
    it("contains only distinct categories from requesterA's tickets", async () => {
      const res = await get("/api/tickets", requesterA.id);

      expect(res.status).toBe(200);
      const cats = res.body.filterOptions.categories;

      // RequesterA has tickets in Hardware, Software, Network
      expect(cats.length).toBe(3);
      const catNames = cats.map((c: any) => c.name).sort();
      expect(catNames).toEqual(["Hardware", "Network", "Software"]);

      // Each entry has id and name
      for (const cat of cats) {
        expect(cat).toHaveProperty("id");
        expect(cat).toHaveProperty("name");
      }
    });

    it("does not include categories that have no tickets for this requester", async () => {
      // "Account and Access" exists as an active category but requesterA has
      // no tickets in it — it should not appear in filterOptions.
      const res = await get("/api/tickets", requesterA.id);

      expect(res.status).toBe(200);
      const catNames = res.body.filterOptions.categories.map(
        (c: any) => c.name,
      );
      expect(catNames).not.toContain("Account and Access");
    });
  });

  // ─── API-37: filterOptions.requestedPriorities (BR-15) ────────────────

  describe("API-37: filterOptions.requestedPriorities (BR-15)", () => {
    it("contains only distinct priorities present in requesterA's tickets", async () => {
      const res = await get("/api/tickets", requesterA.id);

      expect(res.status).toBe(200);
      const priorities = res.body.filterOptions.requestedPriorities;

      // RequesterA has LOW, MEDIUM, HIGH (distributed across 42 tickets)
      expect(priorities.sort()).toEqual(["HIGH", "LOW", "MEDIUM"]);
    });
  });

  // ─── API-38: filterOptions.currentStatuses (BR-15) ───────────────────

  describe("API-38: filterOptions.currentStatuses (BR-15)", () => {
    it("contains only distinct statuses present in requesterA's tickets", async () => {
      const res = await get("/api/tickets", requesterA.id);

      expect(res.status).toBe(200);
      const statuses = res.body.filterOptions.currentStatuses;

      // Lab 2: only NEW exists
      expect(statuses).toEqual(["NEW"]);
    });
  });

  // ─── API-39: filterOptions independent of active filters (BR-15) ──────

  describe("API-39: filterOptions independent of filters (BR-15)", () => {
    it("returns same filterOptions whether or not a categoryId filter is applied", async () => {
      const resNoFilter = await get("/api/tickets", requesterA.id);
      const resWithFilter = await get(
        `/api/tickets?categoryId=${categoryHardware.id}`,
        requesterA.id,
      );

      expect(resNoFilter.status).toBe(200);
      expect(resWithFilter.status).toBe(200);

      // filterOptions should be identical regardless of active filter
      expect(resWithFilter.body.filterOptions).toEqual(
        resNoFilter.body.filterOptions,
      );
    });

    it("returns same filterOptions when search is active", async () => {
      const resNoFilter = await get("/api/tickets", requesterA.id);
      const resWithSearch = await get(
        "/api/tickets?search=laptop",
        requesterA.id,
      );

      expect(resWithSearch.status).toBe(200);
      expect(resWithSearch.body.filterOptions).toEqual(
        resNoFilter.body.filterOptions,
      );
    });
  });

  // ─── API-40: filterOptions empty when zero tickets (BR-15, BR-39) ─────

  describe("API-40: filterOptions empty when zero tickets (BR-15)", () => {
    // Use a requester that has no tickets. After our cleanup in beforeAll,
    // requesterB has 3 tickets, but we need a clean one.
    // We'll create a temporary requester with no tickets.
    let emptyRequester: { id: number };

    beforeAll(async () => {
      const r = await prisma.devRequester.create({
        data: {
          fullName: "Empty Requester",
          email: `empty-${crypto.randomUUID()}@test.com`,
          isActive: true,
        },
      });
      emptyRequester = r;
    });

    afterAll(async () => {
      await prisma.devRequester.delete({ where: { id: emptyRequester.id } });
    });

    it("returns empty filterOptions arrays when requester has zero tickets", async () => {
      const res = await get("/api/tickets", emptyRequester.id);

      expect(res.status).toBe(200);
      expect(res.body.tickets.length).toBe(0);
      expect(res.body.pagination.totalItems).toBe(0);
      expect(res.body.filterOptions.categories).toEqual([]);
      expect(res.body.filterOptions.requestedPriorities).toEqual([]);
      expect(res.body.filterOptions.currentStatuses).toEqual([]);
    });
  });

  // ─── API-41: filterOptions cross-requester isolation (BR-12) ──────────

  describe("API-41: filterOptions cross-requester isolation (BR-12)", () => {
    it("requesterB's filterOptions does not include values only from requesterA", async () => {
      const res = await get("/api/tickets", requesterB.id);

      expect(res.status).toBe(200);

      // RequesterB has only Hardware tickets with MEDIUM priority
      const catNames = res.body.filterOptions.categories.map(
        (c: any) => c.name,
      );
      expect(catNames).toEqual(["Hardware"]);
      expect(catNames).not.toContain("Software");
      expect(catNames).not.toContain("Network");

      const priorities = res.body.filterOptions.requestedPriorities;
      expect(priorities).toEqual(["MEDIUM"]);
      expect(priorities).not.toContain("LOW");
      expect(priorities).not.toContain("HIGH");
    });
  });

  // ─── Response shape validation ────────────────────────────────────────

  describe("response shape", () => {
    it("returns tickets, pagination, and filterOptions at top level", async () => {
      const res = await get("/api/tickets", requesterA.id);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("tickets");
      expect(res.body).toHaveProperty("pagination");
      expect(res.body).toHaveProperty("filterOptions");
      expect(Array.isArray(res.body.tickets)).toBe(true);
    });

    it("each ticket has all required fields", async () => {
      const res = await get("/api/tickets?page=1&pageSize=1", requesterA.id);

      expect(res.status).toBe(200);
      const ticket = res.body.tickets[0];

      expect(ticket).toHaveProperty("id");
      expect(ticket).toHaveProperty("ticketNumber");
      expect(ticket).toHaveProperty("createdAt");
      expect(ticket).toHaveProperty("summary");
      expect(ticket).toHaveProperty("category");
      expect(ticket).toHaveProperty("requestedPriority");
      expect(ticket).toHaveProperty("itPriority");
      expect(ticket).toHaveProperty("currentStatus");
      expect(ticket).toHaveProperty("ticketOwner");
      expect(ticket).toHaveProperty("updatedAt");
    });

    it("itPriority and ticketOwner are null in Lab 2", async () => {
      const res = await get("/api/tickets?page=1&pageSize=1", requesterA.id);

      expect(res.status).toBe(200);
      const ticket = res.body.tickets[0];
      expect(ticket.itPriority).toBeNull();
      expect(ticket.ticketOwner).toBeNull();
    });

    it("pagination has all required fields", async () => {
      const res = await get("/api/tickets", requesterA.id);

      expect(res.status).toBe(200);
      const p = res.body.pagination;
      expect(p).toHaveProperty("page");
      expect(p).toHaveProperty("pageSize");
      expect(p).toHaveProperty("totalItems");
      expect(p).toHaveProperty("totalPages");
      expect(typeof p.page).toBe("number");
      expect(typeof p.pageSize).toBe("number");
      expect(typeof p.totalItems).toBe("number");
      expect(typeof p.totalPages).toBe("number");
    });
  });

  // ─── Default sort (BR-16) ────────────────────────────────────────────

  describe("default sort (BR-16)", () => {
    it("defaults to createdAt desc (newest first)", async () => {
      const res = await get("/api/tickets?page=1&pageSize=10", requesterA.id);

      expect(res.status).toBe(200);
      const dates = res.body.tickets.map((t: any) => new Date(t.createdAt).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
      }
    });
  });

  // ─── Sort by updatedAt ────────────────────────────────────────────────

  describe("sortBy and sortDir", () => {
    it("sorts by updatedAt asc", async () => {
      const res = await get(
        "/api/tickets?sortBy=updatedAt&sortDir=asc&page=1&pageSize=10",
        requesterA.id,
      );

      expect(res.status).toBe(200);
      const dates = res.body.tickets.map((t: any) => new Date(t.updatedAt).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]);
      }
    });

    it("sorts by createdAt asc", async () => {
      const res = await get(
        "/api/tickets?sortBy=createdAt&sortDir=asc&page=1&pageSize=10",
        requesterA.id,
      );

      expect(res.status).toBe(200);
      const dates = res.body.tickets.map((t: any) => new Date(t.createdAt).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]);
      }
    });
  });

  // ─── Auth ─────────────────────────────────────────────────────────────

  describe("auth", () => {
    it("returns 401 without X-Dev-Requester-Id header", async () => {
      const res = await request(app).get("/api/tickets");

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
    });

    it("returns 401 with non-existent requester id", async () => {
      const res = await get("/api/tickets", 99999);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_REQUESTER_CONTEXT");
    });
  });
});
