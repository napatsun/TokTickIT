import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";
import { TICKET_STATUSES } from "../../src/lib/statusTransitions.js";
import {
  createTestUser,
  loginAs,
  cleanupTestUsers,
  type SessionClient,
  type TestUser,
} from "../helpers/session.js";

const prisma = getPrisma();

/**
 * IT Staff Ticket Queue — tests.md §4, api-spec.md §3
 *
 *   API-14  default listing (paginated, createdAt desc, documented projection)
 *   API-15  search `q` by ticket number and by summary substring
 *   API-16  filters: status / priority / owner=unassigned|me|userId
 *   API-17  sort by itPriority and status, asc + desc
 *   API-18  pagination, including a page past the end
 *   API-19  invalid query params → 400 with a safe message
 *
 * Every ticket created here carries a per-run marker in its ticketNumber, so
 * `?q=<runId>` isolates this suite's fixtures from the seeded tickets that also
 * live in the shared queue.
 *
 * Route convention: `/api/staff/tickets` returns and accepts the internal
 * numeric Ticket id (`:id`), never a ticket number (api-spec.md §3).
 */

// ─── Fixtures ───────────────────────────────────────────────────────────

/** Unique substring shared by this run's ticket numbers only. */
const RUN_ID = `Q${Date.now()}`;

/** Summary-only token used for the "search by summary" case. */
const SUMMARY_TOKEN = `Zebra${Date.now()}`;

const IT_PRIORITY_ORDER = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
/** TicketStatus values in enum (declaration) order — the server's sort order. */
const STATUS_ORDER: string[] = [...TICKET_STATUSES];

let requester: TestUser;
let staffA: TestUser;
let staffB: TestUser;
let admin: TestUser;
let clientA: SessionClient; // IT Staff — owns fixtures 02 and 04
let clientB: SessionClient; // IT Staff — owns fixtures 03 and 05
let adminClient: SessionClient;
let extraStaff: TestUser; // IT Staff who owns nothing in this suite

interface QueueTicket {
  id: number;
  ticketNumber: string;
}

const QUEUE_TICKETS: QueueTicket[] = [];

async function createQueueTicket(
  index: number,
  overrides: {
    status: (typeof TICKET_STATUSES)[number];
    itPriority: (typeof IT_PRIORITY_ORDER)[number];
    ownerId: string | null;
    summary?: string;
  },
): Promise<QueueTicket> {
  const category = await prisma.category.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  const relatedSystem = await prisma.relatedSystem.findFirst({
    where: { isActive: true },
    select: { id: true },
  });

  // Increasing with index, so `createdAt asc` = fixture 01 → 07 exactly.
  const createdAt = new Date(Date.now() - (100 - index) * 60_000);

  const created = await prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2026-${RUN_ID}-${String(index).padStart(2, "0")}`,
      requesterId: requester.id,
      ownerId: overrides.ownerId,
      categoryId: category!.id,
      relatedSystemId: relatedSystem!.id,
      summary: overrides.summary ?? `Queue fixture ticket ${index}`,
      description: `Queue fixture ticket ${index} for the IT Staff queue API suite.`,
      requestedPriority: "MEDIUM",
      itPriority: overrides.itPriority,
      status: overrides.status,
      createdAt,
    },
    select: { id: true, ticketNumber: true },
  });

  return created;
}

beforeAll(async () => {
  await seed();

  requester = await createTestUser({ name: "Queue Requester" });
  staffA = await createTestUser({ name: "Queue Staff A", role: "IT_STAFF" });
  staffB = await createTestUser({ name: "Queue Staff B", role: "IT_STAFF" });
  admin = await createTestUser({ name: "Queue Admin", role: "ADMINISTRATOR" });
  extraStaff = await createTestUser({ name: "Queue Staff Extra", role: "IT_STAFF" });

  clientA = await loginAs(app, staffA.email);
  clientB = await loginAs(app, staffB.email);
  adminClient = await loginAs(app, admin.email);

  QUEUE_TICKETS.push(
    await createQueueTicket(1, { status: "NEW", itPriority: "LOW", ownerId: null }),
    await createQueueTicket(2, {
      status: "OPEN",
      itPriority: "MEDIUM",
      ownerId: staffA.id,
      summary: `Unique queue search target ${SUMMARY_TOKEN}`,
    }),
    await createQueueTicket(3, {
      status: "IN_PROGRESS",
      itPriority: "URGENT",
      ownerId: staffB.id,
    }),
    await createQueueTicket(4, {
      status: "WAITING_FOR_REQUESTER",
      itPriority: "HIGH",
      ownerId: staffA.id,
    }),
    await createQueueTicket(5, { status: "RESOLVED", itPriority: "LOW", ownerId: staffB.id }),
    await createQueueTicket(6, { status: "CANCELLED", itPriority: "MEDIUM", ownerId: null }),
    await createQueueTicket(7, { status: "IN_PROGRESS", itPriority: "HIGH", ownerId: null }),
  );
});

afterAll(async () => {
  await cleanupTestUsers([
    requester.id,
    staffA.id,
    staffB.id,
    admin.id,
    extraStaff.id,
  ]);
  await prisma.$disconnect();
});

// ─── Helpers ────────────────────────────────────────────────────────────

function queue(client: SessionClient, query = "") {
  return client.agent.get(`/api/staff/tickets${query ? `?${query}` : ""}`);
}

/** Queue request scoped to this suite's fixtures. */
function isolated(client: SessionClient, extra = "") {
  return queue(client, `q=${RUN_ID}${extra ? `&${extra}` : ""}`);
}

function idsOf(body: { items: Array<{ id: number }> }): number[] {
  return body.items.map((t) => t.id);
}

// ─── API-14 ─────────────────────────────────────────────────────────────

describe("API-14 — Queue default listing (FR-16)", () => {
  it("returns the documented pagination envelope with default sort createdAt desc", async () => {
    const res = await isolated(clientA);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ["items", "page", "pageSize", "total", "totalPages"].sort(),
    );
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(10); // default (§3)
    expect(res.body.total).toBe(QUEUE_TICKETS.length);
    expect(res.body.totalPages).toBe(1);
    expect(res.body.items).toHaveLength(QUEUE_TICKETS.length);

    // Default direction is newest-first: fixture 07 (newest) before fixture 01.
    expect(res.body.items[0].ticketNumber).toBe(QUEUE_TICKETS[6].ticketNumber);

    const createdAt = res.body.items.map((t: { createdAt: string }) =>
      new Date(t.createdAt).getTime(),
    );
    for (let i = 1; i < createdAt.length; i++) {
      expect(createdAt[i - 1]).toBeGreaterThanOrEqual(createdAt[i]);
    }
  });

  it("returns the exact item projection from api-spec.md §3", async () => {
    const res = await isolated(clientA);
    const item = res.body.items.find((t: { ticketNumber: string }) =>
      t.ticketNumber.endsWith("-02"),
    );

    expect(item).toBeDefined();
    expect(Object.keys(item).sort()).toEqual(
      [
        "id",
        "ticketNumber",
        "createdAt",
        "summary",
        "category",
        "requestedPriority",
        "itPriority",
        "status",
        "owner",
      ].sort(),
    );
    expect(typeof item.id).toBe("number");
    expect(typeof item.category).toBe("string");
    expect(item.requestedPriority).toBe("MEDIUM");
    expect(item.itPriority).toBe("MEDIUM");
    // Fixture 02 is owned by staff A → owner is a { id, name } projection.
    expect(item.owner).toEqual({ id: staffA.id, name: staffA.name });
  });

  it("is reachable by an Administrator too (shared queue, api-spec.md §5)", async () => {
    const res = await isolated(adminClient);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(QUEUE_TICKETS.length);
  });
});

// ─── API-15 ─────────────────────────────────────────────────────────────

describe("API-15 — Queue search `q` (FR-16)", () => {
  it("matches by ticket number substring", async () => {
    const res = await queue(clientA, `q=${RUN_ID}-04`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].ticketNumber).toBe(`TKT-2026-${RUN_ID}-04`);
  });

  it("matches by summary substring", async () => {
    const res = await queue(clientA, `q=${SUMMARY_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].summary).toContain(SUMMARY_TOKEN);
  });

  it("ignores a `q` shorter than 2 characters instead of rejecting it (§3)", async () => {
    const ignored = await queue(clientA, `q=${RUN_ID.charAt(0)}&pageSize=1`);
    const all = await queue(clientA, "pageSize=1");

    expect(ignored.status).toBe(200);
    // Same total as an unfiltered listing → the 1-char `q` was ignored.
    expect(ignored.body.total).toBe(all.body.total);
  });

  it("returns an empty page (total 0) when nothing matches", async () => {
    const res = await queue(clientA, "q=zzz-no-such-ticket");

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.totalPages).toBe(1);
  });
});

// ─── API-16 ─────────────────────────────────────────────────────────────

describe("API-16 — Queue filters (FR-16)", () => {
  it("filters by status", async () => {
    const res = await isolated(clientA, "status=IN_PROGRESS");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2); // fixtures 03 and 07
    for (const item of res.body.items) {
      expect(item.status).toBe("IN_PROGRESS");
    }
    expect(idsOf(res.body).sort()).toEqual(
      [QUEUE_TICKETS[2].id, QUEUE_TICKETS[6].id].sort((a, b) => a - b),
    );
  });

  it("filters by itPriority", async () => {
    const res = await isolated(clientA, "priority=URGENT");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].itPriority).toBe("URGENT");
    expect(res.body.items[0].id).toBe(QUEUE_TICKETS[2].id);
  });

  it("filters owner=unassigned", async () => {
    const res = await isolated(clientA, "owner=unassigned");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3); // fixtures 01, 06, 07
    for (const item of res.body.items) {
      expect(item.owner).toBeNull();
    }
  });

  it("filters owner=me to the caller's own tickets", async () => {
    const res = await isolated(clientA, "owner=me");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2); // fixtures 02 and 04 are owned by staff A
    for (const item of res.body.items) {
      expect(item.owner.id).toBe(staffA.id);
    }
  });

  it("filters owner=<userId> to that user's tickets", async () => {
    const res = await isolated(clientA, `owner=${staffB.id}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2); // fixtures 03 and 05
    for (const item of res.body.items) {
      expect(item.owner.id).toBe(staffB.id);
    }
  });

  it("returns an empty result for owner=me when the caller owns nothing here", async () => {
    const extraClient = await loginAs(app, extraStaff.email);
    const res = await isolated(extraClient, "owner=me");

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});

// ─── API-17 ─────────────────────────────────────────────────────────────

describe("API-17 — Queue sorting (FR-16)", () => {
  it("sorts by itPriority asc/desc using the LOW<MEDIUM<HIGH<URGENT scale", async () => {
    const asc = await isolated(clientA, "sortBy=itPriority&sortDir=asc");
    const desc = await isolated(clientA, "sortBy=itPriority&sortDir=desc");

    expect(asc.status).toBe(200);
    expect(desc.status).toBe(200);

    const ascIndexes = asc.body.items.map((t: { itPriority: string }) =>
      IT_PRIORITY_ORDER.indexOf(t.itPriority as (typeof IT_PRIORITY_ORDER)[number]),
    );
    expect(ascIndexes[0]).toBe(0); // LOW first
    expect(ascIndexes.at(-1)).toBe(3); // URGENT last
    for (let i = 1; i < ascIndexes.length; i++) {
      expect(ascIndexes[i - 1]).toBeLessThanOrEqual(ascIndexes[i]);
    }

    const descIndexes = desc.body.items.map((t: { itPriority: string }) =>
      IT_PRIORITY_ORDER.indexOf(t.itPriority as (typeof IT_PRIORITY_ORDER)[number]),
    );
    expect(descIndexes[0]).toBe(3); // URGENT first
    expect(descIndexes.at(-1)).toBe(0); // LOW last
    for (let i = 1; i < descIndexes.length; i++) {
      expect(descIndexes[i - 1]).toBeGreaterThanOrEqual(descIndexes[i]);
    }
  });

  it("sorts by status asc/desc using the TicketStatus enum order", async () => {
    const asc = await isolated(clientA, "sortBy=status&sortDir=asc");
    const desc = await isolated(clientA, "sortBy=status&sortDir=desc");

    expect(asc.status).toBe(200);
    expect(desc.status).toBe(200);

    const ascIndexes = asc.body.items.map((t: { status: string }) =>
      STATUS_ORDER.indexOf(t.status),
    );
    expect(ascIndexes[0]).toBe(STATUS_ORDER.indexOf("NEW"));
    for (let i = 1; i < ascIndexes.length; i++) {
      expect(ascIndexes[i - 1]).toBeLessThanOrEqual(ascIndexes[i]);
    }

    const descIndexes = desc.body.items.map((t: { status: string }) =>
      STATUS_ORDER.indexOf(t.status),
    );
    expect(descIndexes[0]).toBe(STATUS_ORDER.indexOf("CANCELLED"));
    for (let i = 1; i < descIndexes.length; i++) {
      expect(descIndexes[i - 1]).toBeGreaterThanOrEqual(descIndexes[i]);
    }
  });

  it("defaults sortDir to desc when only sortBy is supplied", async () => {
    const explicit = await isolated(clientA, "sortBy=itPriority&sortDir=desc");
    const implicit = await isolated(clientA, "sortBy=itPriority");

    expect(idsOf(implicit.body)).toEqual(idsOf(explicit.body));
  });
});

// ─── API-18 ─────────────────────────────────────────────────────────────

describe("API-18 — Queue pagination (FR-16)", () => {
  it("returns the correct slice for each page (pageSize=2)", async () => {
    const page1 = await isolated(clientA, "sortBy=createdAt&sortDir=asc&page=1&pageSize=2");
    const page2 = await isolated(clientA, "sortBy=createdAt&sortDir=asc&page=2&pageSize=2");

    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.page).toBe(1);
    expect(page1.body.pageSize).toBe(2);
    expect(page1.body.total).toBe(QUEUE_TICKETS.length);
    expect(page1.body.totalPages).toBe(4);

    // oldest-first: fixture 01 then 02 on page 1.
    expect(idsOf(page1.body)).toEqual([QUEUE_TICKETS[0].id, QUEUE_TICKETS[1].id]);

    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.page).toBe(2);
    expect(idsOf(page2.body)).toEqual([QUEUE_TICKETS[2].id, QUEUE_TICKETS[3].id]);
  });

  it("returns an empty items array for a page past the end, with correct total/totalPages", async () => {
    const res = await isolated(clientA, "page=99&pageSize=2");

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.page).toBe(99);
    expect(res.body.total).toBe(QUEUE_TICKETS.length);
    expect(res.body.totalPages).toBe(4);
  });

  it("accepts pageSize up to the 50 maximum", async () => {
    const res = await isolated(clientA, "pageSize=50");

    expect(res.status).toBe(200);
    expect(res.body.pageSize).toBe(50);
  });
});

// ─── API-19 ─────────────────────────────────────────────────────────────

describe("API-19 — invalid query parameters (api-spec.md §3)", () => {
  const invalidQueries: Array<[string, string]> = [
    ["invalid status enum", "status=NOT_A_STATUS"],
    ["invalid priority enum", "priority=SUPER_URGENT"],
    ["invalid sortBy enum", "sortBy=summary"],
    ["invalid sortDir enum", "sortDir=sideways"],
    ["pageSize above the maximum", "pageSize=51"],
    ["pageSize of zero", "pageSize=0"],
    ["non-numeric pageSize", "pageSize=ten"],
    ["page of zero", "page=0"],
    ["non-numeric page", "page=first"],
  ];

  for (const [label, query] of invalidQueries) {
    it(`returns 400 for ${label}`, async () => {
      const res = await queue(clientA, query);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(typeof res.body.error.message).toBe("string");
      // Safe error: no stack trace, ORM detail, or internal path leaks.
      expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:\d+/);
      expect(JSON.stringify(res.body)).not.toMatch(/prisma/i);
    });
  }

  it("returns 401 without a session", async () => {
    const res = await request(app).get("/api/staff/tickets");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });
});
