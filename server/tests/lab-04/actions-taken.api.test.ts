import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";
import {
  EDIT_WINDOW_MINUTES,
  IDEMPOTENCY_WINDOW_SECONDS,
  DESCRIPTION_MIN_LENGTH,
  RESULT_MIN_LENGTH,
  ATTACHMENT_NOTES_MAX_LENGTH,
} from "../../src/lib/actionTaken.js";
import {
  createTestUser,
  loginAs,
  cleanupTestUsers,
  csrf,
  type SessionClient,
  type TestUser,
} from "../helpers/session.js";

const prisma = getPrisma();

/**
 * Actions Taken API — tests.md §1, api-spec.md §1
 *
 *   API-01  IT Staff creates a valid entry (201, correct Ticket + actor)
 *   API-02  a client-supplied `performedById` is ignored (BR-03)
 *   API-03  baseline happy path from the handout example
 *   API-04  followUpRequired=true with an empty note → 422 naming followUpNote
 *   API-05  followUpRequired=false with a non-empty note → 422 (BR-05)
 *   API-06  future `actionDateTime` → 422 (BR-04)
 *   API-07  Requester calls POST directly → 403 FORBIDDEN_ROLE (AC-06, BR-15)
 *   API-08  the Ticket-access denials that actually exist (see below)
 *   API-09  author edits their own entry inside the 15-minute window (BR-11)
 *   API-10  non-author IT Staff edits inside the window → 403 NOT_AUTHOR
 *   API-11  author edits after the window → 403 EDIT_WINDOW_EXPIRED
 *   API-12  Administrator edits/voids any entry at any time (BR-11)
 *   API-13  GET ordering: actionDateTime ASC, createdAt then id as tie-breaks
 *   API-14  same Idempotency-Key inside the window → one row, identical 201
 *   API-14b same Idempotency-Key after the window → a new, independent row
 *   API-28  voiding without a voidReason → 422 naming voidReason
 *   API-29  author edits `actionDateTime` to a valid past value → 200
 *   API-30  author edits `actionDateTime` to a future value → 422
 *   API-31  Requester asks for `includeVoided=true` → 403 FORBIDDEN_QUERY_PARAM
 *   API-38  Requester calls PATCH directly → 403 FORBIDDEN_ROLE (AC-06)
 *   API-39  PATCH with an unknown `ticketId` → 404 TICKET_NOT_FOUND
 *   API-39b PATCH with a valid Ticket but unknown `actionId` → 404 ACTION_NOT_FOUND
 *   API-40  Administrator edits a voided entry → 409 ENTRY_VOIDED
 *   API-41  Administrator un-voids a voided entry → 409 ENTRY_VOIDED
 *
 * API-08 note: Lab 3's staff router is a shared queue, and BR-02 relies on it
 * ("any active IT Staff/Administrator with access may author an Actions Taken
 * entry; `performedById` may differ from the Ticket's `ownerId`"). No existing
 * Ticket is therefore unreachable by a staff caller, so a staff-wide
 * FORBIDDEN_TICKET_ACCESS cannot be produced. The test asserts the two denials
 * that do exist — a Requester asking for a Ticket they do not own, and any
 * caller against a `ticketId` that does not exist — plus the positive control
 * that proves the shared queue is deliberate.
 */

let requesterA: TestUser;
let requesterB: TestUser;
let staffAuthor: TestUser;
let staffOther: TestUser;
let adminUser: TestUser;

let clientA: SessionClient;
let clientB: SessionClient;
let staffClient: SessionClient;
let otherStaffClient: SessionClient;
let adminClient: SessionClient;

/** Ticket owned (requesterId) by requesterA, coordinated (ownerId) by staffAuthor. */
let ticketA: { id: number; ticketNumber: string };
/** Ticket owned by requesterB — the cross-Requester fixture. */
let ticketB: { id: number; ticketNumber: string };

/** Active reference rows reused by every fixture Ticket created in this file. */
let fixtureCategoryId: number;
let fixtureRelatedSystemId: number;

const MISSING_TICKET_ID = 9_999_999;

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actionDateTime: iso(-60_000),
    description: "Replaced failing battery cell and re-seated connector.",
    result: "Laptop now holds charge for 6+ hours in testing.",
    followUpRequired: false,
    ...overrides,
  };
}

function postAction(
  client: SessionClient,
  ticketId: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const req = csrf(client, client.agent.post(`/api/tickets/${ticketId}/actions`)).send(
    body as object,
  );
  return Object.keys(headers).length > 0 ? req.set(headers) : req;
}

function getActions(client: SessionClient, ticketId: number, query = "") {
  return client.agent.get(`/api/tickets/${ticketId}/actions${query}`);
}

function patchAction(
  client: SessionClient,
  ticketId: number,
  actionId: string,
  body: unknown,
) {
  return csrf(
    client,
    client.agent.patch(`/api/tickets/${ticketId}/actions/${actionId}`),
  ).send(body as object);
}

/** Create an entry through the API as `staffAuthor` and return its id. */
async function createAsAuthor(body: Record<string, unknown> = {}): Promise<string> {
  const res = await postAction(staffClient, ticketA.id, validBody(body));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

/** Age an entry so the BR-11 author window has elapsed. */
async function backdateBeyondEditWindow(actionId: string): Promise<void> {
  await prisma.actionTaken.update({
    where: { id: actionId },
    data: { createdAt: new Date(Date.now() - (EDIT_WINDOW_MINUTES + 5) * 60 * 1000) },
  });
}

beforeAll(async () => {
  await seed();

  requesterA = await createTestUser({ name: "Actions Requester A" });
  requesterB = await createTestUser({ name: "Actions Requester B" });
  staffAuthor = await createTestUser({ name: "Actions Staff Author", role: "IT_STAFF" });
  staffOther = await createTestUser({ name: "Actions Staff Other", role: "IT_STAFF" });
  adminUser = await createTestUser({ name: "Actions Admin", role: "ADMINISTRATOR" });

  clientA = await loginAs(app, requesterA.email);
  clientB = await loginAs(app, requesterB.email);
  staffClient = await loginAs(app, staffAuthor.email);
  otherStaffClient = await loginAs(app, staffOther.email);
  adminClient = await loginAs(app, adminUser.email);

  const category = await prisma.category.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  const relatedSystem = await prisma.relatedSystem.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  expect(category).toBeDefined();
  expect(relatedSystem).toBeDefined();
  fixtureCategoryId = category!.id;
  fixtureRelatedSystemId = relatedSystem!.id;

  ticketA = await prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2026-ACTIONS-A-${Date.now()}`,
      requesterId: requesterA.id,
      ownerId: staffAuthor.id,
      categoryId: fixtureCategoryId,
      relatedSystemId: fixtureRelatedSystemId,
      summary: "Actions Taken test ticket A",
      description: "This ticket is used for testing the Actions Taken endpoints thoroughly.",
      requestedPriority: "MEDIUM",
      status: "IN_PROGRESS",
    },
    select: { id: true, ticketNumber: true },
  });

  ticketB = await prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2026-ACTIONS-B-${Date.now()}`,
      requesterId: requesterB.id,
      categoryId: fixtureCategoryId,
      relatedSystemId: fixtureRelatedSystemId,
      summary: "Actions Taken test ticket B",
      description: "Unassigned ticket owned by another Requester, for cross-owner tests.",
      requestedPriority: "LOW",
    },
    select: { id: true, ticketNumber: true },
  });
});

afterAll(async () => {
  await cleanupTestUsers([
    requesterA.id,
    requesterB.id,
    staffAuthor.id,
    staffOther.id,
    adminUser.id,
  ]);
  await prisma.$disconnect();
});

// ─── API-01 / API-03 — create ───────────────────────────────────────────

describe("API-01 — IT Staff creates a valid Actions Taken entry (FR-01, AC-01)", () => {
  it("returns 201, saves it under the Ticket, and stamps the session user as actor", async () => {
    const before = await prisma.actionTaken.count({ where: { ticketId: ticketA.id } });

    const res = await postAction(staffClient, ticketA.id, validBody());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ticketId: ticketA.id,
      performedById: staffAuthor.id,
      performedBy: { id: staffAuthor.id, name: staffAuthor.name },
      followUpRequired: false,
      followUpNote: null,
      attachmentNotes: null,
      isVoided: false,
      voidReason: null,
      editedAt: null,
      editedById: null,
    });
    expect(typeof res.body.id).toBe("string");
    expect(new Date(res.body.actionDateTime).toISOString()).toBe(res.body.actionDateTime);
    expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt);

    expect(await prisma.actionTaken.count({ where: { ticketId: ticketA.id } })).toBe(before + 1);

    const stored = await prisma.actionTaken.findUnique({ where: { id: res.body.id } });
    expect(stored).not.toBeNull();
    expect(stored?.ticketId).toBe(ticketA.id);
    expect(stored?.performedById).toBe(staffAuthor.id);
    expect(stored?.isVoided).toBe(false);
  });

  it("is immediately visible in the Ticket's Actions Taken list (AC-01)", async () => {
    const created = await postAction(
      staffClient,
      ticketA.id,
      validBody({ description: "Listed immediately after creation." }),
    );
    expect(created.status).toBe(201);

    const list = await getActions(staffClient, ticketA.id);
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toContain(created.body.id);
  });

  it("lets any IT Staff author on a Ticket coordinated by someone else (BR-02)", async () => {
    // staffOther is NOT ticketA's ownerId — the shared queue still allows this.
    const res = await postAction(
      otherStaffClient,
      ticketA.id,
      validBody({ description: "Authored by a non-owner IT Staff member." }),
    );

    expect(res.status).toBe(201);
    expect(res.body.performedById).toBe(staffOther.id);
    // BR-02: the entry's actor may differ from the Ticket's owner.
    expect(res.body.performedById).not.toBe(staffAuthor.id);
  });
});

describe("API-03 — baseline happy path (handout example, AC-01)", () => {
  it("accepts a full payload including follow-up and attachment notes", async () => {
    const res = await postAction(
      staffClient,
      ticketA.id,
      validBody({
        actionDateTime: "2026-09-20T10:15:00.000Z",
        description: "Replaced failing battery cell and re-seated connector.",
        result: "Laptop now holds charge for 6+ hours in testing.",
        followUpRequired: true,
        followUpNote: "Monitor battery health for 2 weeks; revisit if drain returns.",
        attachmentNotes: "See battery-test-photo.jpg in ticket attachments.",
      }),
    );

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      actionDateTime: "2026-09-20T10:15:00.000Z",
      followUpRequired: true,
      followUpNote: "Monitor battery health for 2 weeks; revisit if drain returns.",
      attachmentNotes: "See battery-test-photo.jpg in ticket attachments.",
      performedById: staffAuthor.id,
    });
    expect(res.body.performedBy.name).toBe(staffAuthor.name);
  });

  it("honours the documented field boundaries", async () => {
    const minOk = await postAction(
      staffClient,
      ticketA.id,
      validBody({
        description: "A".repeat(DESCRIPTION_MIN_LENGTH),
        result: "B".repeat(RESULT_MIN_LENGTH),
        attachmentNotes: "C".repeat(ATTACHMENT_NOTES_MAX_LENGTH),
      }),
    );
    expect(minOk.status).toBe(201);

    const oneShort = await postAction(
      staffClient,
      ticketA.id,
      validBody({ description: "A".repeat(DESCRIPTION_MIN_LENGTH - 1) }),
    );
    expect(oneShort.status).toBe(422);
    expect(oneShort.body.error.fieldErrors).toHaveProperty("description");

    const notesTooLong = await postAction(
      staffClient,
      ticketA.id,
      validBody({ attachmentNotes: "C".repeat(ATTACHMENT_NOTES_MAX_LENGTH + 1) }),
    );
    expect(notesTooLong.status).toBe(422);
    expect(notesTooLong.body.error.fieldErrors).toHaveProperty("attachmentNotes");
  });

  it("trims description/result and treats a blank attachmentNotes as absent", async () => {
    const res = await postAction(
      staffClient,
      ticketA.id,
      validBody({
        description: "   trimmed description   ",
        result: "   trimmed result   ",
        attachmentNotes: "   ",
      }),
    );

    expect(res.status).toBe(201);
    expect(res.body.description).toBe("trimmed description");
    expect(res.body.result).toBe("trimmed result");
    expect(res.body.attachmentNotes).toBeNull();
  });

  it("returns 404 TICKET_NOT_FOUND for a Ticket that does not exist", async () => {
    const res = await postAction(staffClient, MISSING_TICKET_ID, validBody());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
  });

  it("returns 401 without a session and 403 PASSWORD_CHANGE_REQUIRED behind the gate", async () => {
    const anonymous = await request(app)
      .post(`/api/tickets/${ticketA.id}/actions`)
      .send(validBody());
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe("UNAUTHENTICATED");

    const gated = await createTestUser({ role: "IT_STAFF", mustChangePassword: true });
    const gatedClient = await loginAs(app, gated.email);
    const res = await postAction(gatedClient, ticketA.id, validBody());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    await cleanupTestUsers([gated.id]);
  });
});

describe("API-02 — the server, never the client, decides who performed the action (BR-03)", () => {
  it("ignores an injected performedById and every other server-set field", async () => {
    const res = await postAction(staffClient, ticketA.id, {
      ...validBody({ description: "Spoof attempt on the performed-by field." }),
      id: "attacker-supplied-id",
      ticketId: ticketB.id,
      performedById: requesterB.id,
      createdAt: "2000-01-01T00:00:00.000Z",
      isVoided: true,
      voidReason: "spoofed",
      editedAt: "2000-01-01T00:00:00.000Z",
      editedById: requesterB.id,
    });

    expect(res.status).toBe(201);
    expect(res.body.performedById).toBe(staffAuthor.id);
    expect(res.body.performedBy).toEqual({ id: staffAuthor.id, name: staffAuthor.name });
    // BR-01: the Ticket comes from the path.
    expect(res.body.ticketId).toBe(ticketA.id);
    expect(res.body.id).not.toBe("attacker-supplied-id");
    expect(res.body.isVoided).toBe(false);
    expect(res.body.voidReason).toBeNull();
    expect(res.body.editedAt).toBeNull();
    expect(res.body.editedById).toBeNull();
    expect(new Date(res.body.createdAt).getTime()).toBeGreaterThan(
      new Date("2000-01-01T00:00:00.000Z").getTime(),
    );

    const stored = await prisma.actionTaken.findUnique({ where: { id: res.body.id } });
    expect(stored?.isVoided).toBe(false);
    expect(stored?.performedById).toBe(staffAuthor.id);
  });
});

// ─── API-04 … API-06 — create validation ────────────────────────────────

describe("API-04 — followUpRequired=true requires a usable followUpNote (BR-05, AC-07)", () => {
  it("rejects an empty, whitespace-only, missing, or too-short note with 422 naming followUpNote", async () => {
    for (const followUpNote of [undefined, "", "   \n\t ", "ab"]) {
      const res = await postAction(
        staffClient,
        ticketA.id,
        validBody({ followUpRequired: true, followUpNote }),
      );

      expect(res.status, JSON.stringify(followUpNote)).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.fieldErrors).toHaveProperty("followUpNote");
    }
  });

  it("accepts a note of exactly the 3-character minimum", async () => {
    const res = await postAction(
      staffClient,
      ticketA.id,
      validBody({ followUpRequired: true, followUpNote: "abc" }),
    );

    expect(res.status).toBe(201);
    expect(res.body.followUpNote).toBe("abc");
  });

  it("rejects a non-boolean followUpRequired", async () => {
    const missing = await postAction(staffClient, ticketA.id, {
      actionDateTime: iso(-1000),
      description: "Missing the follow-up flag entirely.",
      result: "Validation should catch this.",
    });
    expect(missing.status).toBe(422);
    expect(missing.body.error.fieldErrors).toHaveProperty("followUpRequired");

    const stringy = await postAction(
      staffClient,
      ticketA.id,
      validBody({ followUpRequired: "true" }),
    );
    expect(stringy.status).toBe(422);
    expect(stringy.body.error.fieldErrors).toHaveProperty("followUpRequired");
  });
});

describe("API-05 — followUpNote must be empty when follow-up is not required (BR-05)", () => {
  it("rejects a non-empty note when followUpRequired=false", async () => {
    const res = await postAction(
      staffClient,
      ticketA.id,
      validBody({ followUpRequired: false, followUpNote: "This note should not be here." }),
    );

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.fieldErrors).toHaveProperty("followUpNote");
  });

  it("stores null when the note is omitted or blank", async () => {
    const omitted = await postAction(staffClient, ticketA.id, validBody());
    expect(omitted.status).toBe(201);
    expect(omitted.body.followUpNote).toBeNull();
  });
});

describe("API-06 — actionDateTime must not be in the future (BR-04)", () => {
  it("rejects a future timestamp with 422", async () => {
    const res = await postAction(
      staffClient,
      ticketA.id,
      validBody({ actionDateTime: iso(10 * 60 * 1000) }),
    );

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.fieldErrors).toHaveProperty("actionDateTime");
  });

  it("requires the field and rejects non-ISO-8601 values", async () => {
    for (const actionDateTime of [undefined, "", "not-a-date", "20/09/2026 10:15", 12345]) {
      const res = await postAction(staffClient, ticketA.id, validBody({ actionDateTime }));

      expect(res.status, JSON.stringify(actionDateTime)).toBe(422);
      expect(res.body.error.fieldErrors).toHaveProperty("actionDateTime");
    }
  });

  it("accepts a backdated timestamp (BR-04 allows backdating)", async () => {
    const res = await postAction(
      staffClient,
      ticketA.id,
      validBody({ actionDateTime: "2026-01-05T08:30:00.000Z" }),
    );

    expect(res.status).toBe(201);
    expect(res.body.actionDateTime).toBe("2026-01-05T08:30:00.000Z");
  });
});

// ─── API-07 / API-08 — authorization ───────────────────────────────────

describe("API-07 — a Requester can never create an entry, even via a direct API call (AC-06, BR-15)", () => {
  it("returns 403 FORBIDDEN_ROLE for a Requester on their own Ticket", async () => {
    const res = await postAction(clientA, ticketA.id, validBody());

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_ROLE");
    expect(await prisma.actionTaken.count({ where: { performedById: requesterA.id } })).toBe(0);
  });

  it("returns 403 FORBIDDEN_ROLE for a Requester on someone else's Ticket too", async () => {
    const res = await postAction(clientA, ticketB.id, validBody());

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_ROLE");
  });
});

describe("API-08 — Ticket-access denials (BR-15)", () => {
  it("gives a Requester reading another Requester's Ticket 403 FORBIDDEN_TICKET_ACCESS", async () => {
    const res = await getActions(clientA, ticketB.id);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_TICKET_ACCESS");
  });

  it("answers a non-existent ticketId with 404 TICKET_NOT_FOUND for every role and verb", async () => {
    const staffPost = await postAction(staffClient, MISSING_TICKET_ID, validBody());
    const staffGet = await getActions(staffClient, MISSING_TICKET_ID);
    const staffPatch = await patchAction(staffClient, MISSING_TICKET_ID, "any-id", {
      description: "no such ticket",
    });
    const requesterGet = await getActions(clientA, MISSING_TICKET_ID);

    for (const res of [staffPost, staffGet, staffPatch, requesterGet]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
    }
  });

  it("keeps the staff queue shared: any IT Staff may read any Ticket's entries", async () => {
    // Positive control for the note above — the only reason a staff-wide
    // FORBIDDEN_TICKET_ACCESS cannot be produced is that it is never warranted.
    const res = await getActions(otherStaffClient, ticketB.id);

    expect(res.status).toBe(200);
    expect(res.body.ticketId).toBe(ticketB.id);
  });
});

// ─── API-09 … API-12 — edit window, author, Administrator ──────────────

describe("API-09 — the author edits their own entry inside the window (BR-11)", () => {
  it("returns 200 with the fields updated and the editedAt/editedById audit pair set", async () => {
    const actionId = await createAsAuthor({ description: "Typo in teh description." });

    const res = await patchAction(staffClient, ticketA.id, actionId, {
      description: "Typo in the description.",
      result: "Result corrected inside the edit window.",
    });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(actionId);
    expect(res.body.description).toBe("Typo in the description.");
    expect(res.body.result).toBe("Result corrected inside the edit window.");
    expect(res.body.editedById).toBe(staffAuthor.id);
    expect(typeof res.body.editedAt).toBe("string");
    expect(new Date(res.body.editedAt).toISOString()).toBe(res.body.editedAt);
    // BR-11: audit, not history — the original actor is untouched.
    expect(res.body.performedById).toBe(staffAuthor.id);

    const stored = await prisma.actionTaken.findUnique({ where: { id: actionId } });
    expect(stored?.description).toBe("Typo in the description.");
    expect(stored?.editedById).toBe(staffAuthor.id);
    expect(stored?.editedAt).not.toBeNull();
  });

  it("never lets an edit change performedById", async () => {
    const actionId = await createAsAuthor({ description: "Actor is not editable." });

    const res = await patchAction(staffClient, ticketA.id, actionId, {
      description: "Actor is still not editable.",
      performedById: requesterB.id,
      ticketId: ticketB.id,
      createdAt: "2000-01-01T00:00:00.000Z",
    });

    expect(res.status).toBe(200);
    expect(res.body.performedById).toBe(staffAuthor.id);
    expect(res.body.ticketId).toBe(ticketA.id);
  });

  it("rejects an edit that names no editable field", async () => {
    const actionId = await createAsAuthor({ description: "Nothing to change here." });

    const res = await patchAction(staffClient, ticketA.id, actionId, {});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("API-10 — non-author IT Staff may not edit (BR-11)", () => {
  it("returns 403 NOT_AUTHOR for a staff member who did not create the entry", async () => {
    const actionId = await createAsAuthor({ description: "Authored by staffAuthor only." });

    const res = await patchAction(otherStaffClient, ticketA.id, actionId, {
      description: "Someone else trying to rewrite history.",
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_AUTHOR");

    const stored = await prisma.actionTaken.findUnique({ where: { id: actionId } });
    expect(stored?.description).toBe("Authored by staffAuthor only.");
    expect(stored?.editedAt).toBeNull();
  });
});

describe("API-11 — the author window expires after EDIT_WINDOW_MINUTES (BR-11)", () => {
  it("returns 403 EDIT_WINDOW_EXPIRED for the author after 15 minutes", async () => {
    const actionId = await createAsAuthor({ description: "Old entry the author can no longer fix." });
    await backdateBeyondEditWindow(actionId);

    const res = await patchAction(staffClient, ticketA.id, actionId, {
      description: "Too late to correct this.",
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("EDIT_WINDOW_EXPIRED");

    const stored = await prisma.actionTaken.findUnique({ where: { id: actionId } });
    expect(stored?.description).toBe("Old entry the author can no longer fix.");
    expect(stored?.editedAt).toBeNull();
  });
});

describe("API-12 — an Administrator edits and voids any entry at any time (BR-11)", () => {
  it("edits another user's expired entry and records the Administrator as editor", async () => {
    const actionId = await createAsAuthor({ description: "Admin will correct this later." });
    await backdateBeyondEditWindow(actionId);

    const res = await patchAction(adminClient, ticketA.id, actionId, {
      description: "Administrator correction after the window closed.",
    });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe("Administrator correction after the window closed.");
    expect(res.body.editedById).toBe(adminUser.id);
    // BR-11: editing never reassigns authorship.
    expect(res.body.performedById).toBe(staffAuthor.id);
  });

  it("voids an entry with a reason and stamps the audit pair", async () => {
    const actionId = await createAsAuthor({ description: "Duplicate entry to be voided." });

    const res = await patchAction(adminClient, ticketA.id, actionId, {
      isVoided: true,
      voidReason: "Duplicate entry created by double submission.",
    });

    expect(res.status).toBe(200);
    expect(res.body.isVoided).toBe(true);
    expect(res.body.voidReason).toBe("Duplicate entry created by double submission.");
    expect(res.body.editedById).toBe(adminUser.id);
    expect(res.body.editedAt).not.toBeNull();

    const stored = await prisma.actionTaken.findUnique({ where: { id: actionId } });
    expect(stored?.isVoided).toBe(true);
    expect(stored?.voidReason).toBe("Duplicate entry created by double submission.");
    expect(stored?.performedById).toBe(staffAuthor.id);
  });

  it("does not let IT Staff void, even their own entry (BR-11, Administrator-only)", async () => {
    const actionId = await createAsAuthor({ description: "Only an Admin may void this." });

    const res = await patchAction(staffClient, ticketA.id, actionId, {
      isVoided: true,
      voidReason: "Trying to self-serve a void.",
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_ROLE");

    const stored = await prisma.actionTaken.findUnique({ where: { id: actionId } });
    expect(stored?.isVoided).toBe(false);
  });
});

// ─── API-13 — ordering (§1.2, FR-03) ───────────────────────────────────

describe("API-13 — GET returns entries oldest-first (FR-03)", () => {
  it("sorts by actionDateTime and falls back to createdAt then id for ties", async () => {
    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber: `TKT-2026-ACTIONS-ORDER-${Date.now()}`,
        requesterId: requesterA.id,
        categoryId: fixtureCategoryId,
        relatedSystemId: fixtureRelatedSystemId,
        summary: "Actions ordering test ticket",
        description: "A dedicated ticket so ordering assertions are not disturbed by other tests.",
        requestedPriority: "HIGH",
      },
      select: { id: true },
    });

    // Deliberately created out of order, with one exact tie (same
    // actionDateTime in two different requests → different createdAt).
    const tie = "2026-03-02T09:00:00.000Z";
    const created: string[] = [];
    for (const actionDateTime of [
      "2026-03-03T09:00:00.000Z",
      tie,
      "2026-03-01T09:00:00.000Z",
      tie,
    ]) {
      const res = await postAction(
        staffClient,
        ticket.id,
        validBody({ actionDateTime, description: `Ordering entry at ${actionDateTime}` }),
      );
      expect(res.status).toBe(201);
      created.push(res.body.id);
    }

    const res = await getActions(staffClient, ticket.id);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(4);

    const times = res.body.items.map((i: { actionDateTime: string }) =>
      new Date(i.actionDateTime).getTime(),
    );
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeLessThanOrEqual(times[i]);
    }

    // The tie is broken deterministically by (createdAt, id) — assert against the
    // stored rows rather than against an assumption about millisecond timing.
    const rows = await prisma.actionTaken.findMany({
      where: { ticketId: ticket.id, isVoided: false },
      select: { id: true, actionDateTime: true, createdAt: true },
    });
    const expected = [...rows]
      .sort(
        (a, b) =>
          a.actionDateTime.getTime() - b.actionDateTime.getTime() ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .map((r) => r.id);

    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual(expected);
    expect(res.body.items.map((i: { id: string }) => i.id)).not.toEqual(created);

    // Repeating the identical query returns the identical order (FR-03's
    // determinism requirement).
    const again = await getActions(staffClient, ticket.id);
    expect(again.body.items.map((i: { id: string }) => i.id)).toEqual(expected);
  });

  it("hides voided entries by default and exposes them for staff with includeVoided=true", async () => {
    const visible = await createAsAuthor({ description: "Live entry stays in the default list." });
    const voided = await createAsAuthor({ description: "Voided entry leaves the default list." });

    const voidRes = await patchAction(adminClient, ticketA.id, voided, {
      isVoided: true,
      voidReason: "Voided for the includeVoided test.",
    });
    expect(voidRes.status).toBe(200);

    const defaultList = await getActions(staffClient, ticketA.id);
    const ids = defaultList.body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(visible);
    expect(ids).not.toContain(voided);

    const withVoided = await getActions(staffClient, ticketA.id, "?includeVoided=true");
    const allIds = withVoided.body.items.map((i: { id: string }) => i.id);
    expect(allIds).toContain(voided);
    const voidedItem = withVoided.body.items.find((i: { id: string }) => i.id === voided);
    expect(voidedItem.voidReason).toBe("Voided for the includeVoided test.");
    expect(withVoided.body.count).toBe(withVoided.body.items.length);
  });

  it("returns an empty list (not an error) for a Ticket with zero entries (§7.5 item 2)", async () => {
    const res = await getActions(staffClient, ticketB.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ticketId: ticketB.id, count: 0, items: [] });
  });

  it("lets the owning Requester read their own Ticket's entries, read-only (FR-06)", async () => {
    const live = await createAsAuthor({ description: "Requester-visible entry." });
    const hidden = await createAsAuthor({ description: "Voided entry a Requester must not see." });
    await patchAction(adminClient, ticketA.id, hidden, {
      isVoided: true,
      voidReason: "Hidden from the Requester entirely.",
    });

    const res = await getActions(clientA, ticketA.id);

    expect(res.status).toBe(200);
    expect(res.body.ticketId).toBe(ticketA.id);
    const ids = res.body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(live);
    expect(ids).not.toContain(hidden);
    expect(res.body.items.every((i: { isVoided: boolean }) => i.isVoided === false)).toBe(true);
  });
});

// ─── API-14 / API-14b — idempotency (FR-15, AC-11) ─────────────────────

describe("API-14 — a replayed Idempotency-Key inside the window creates one row (AC-11)", () => {
  it("returns the identical 201 body twice and persists a single entry", async () => {
    const key = `api14-${Date.now()}-${Math.random()}`;
    const body = validBody({ description: "Double-click protection check." });
    const before = await prisma.actionTaken.count({ where: { ticketId: ticketA.id } });

    const first = await postAction(staffClient, ticketA.id, body, {
      "Idempotency-Key": key,
    });
    const second = await postAction(staffClient, ticketA.id, body, {
      "Idempotency-Key": key,
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await prisma.actionTaken.count({ where: { ticketId: ticketA.id } })).toBe(before + 1);
  });

  it("scopes the key per caller and per Ticket", async () => {
    const key = `api14-scope-${Date.now()}-${Math.random()}`;
    const body = validBody({ description: "Same key string, different callers." });

    const asStaff = await postAction(staffClient, ticketA.id, body, { "Idempotency-Key": key });
    const asOther = await postAction(otherStaffClient, ticketA.id, body, {
      "Idempotency-Key": key,
    });

    expect(asStaff.status).toBe(201);
    expect(asOther.status).toBe(201);
    expect(asOther.body.id).not.toBe(asStaff.body.id);
  });

  it("does not create anything when no key is supplied", async () => {
    const before = await prisma.actionTaken.count({ where: { ticketId: ticketA.id } });
    const body = validBody({ description: "No key, so two real submissions." });

    const first = await postAction(staffClient, ticketA.id, body);
    const second = await postAction(staffClient, ticketA.id, body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect(await prisma.actionTaken.count({ where: { ticketId: ticketA.id } })).toBe(before + 2);
  });
});

describe("API-14b — the same key after the window is a new, independent create (FR-15)", () => {
  it("persists a second row once IDEMPOTENCY_WINDOW_SECONDS has elapsed", async () => {
    const key = `api14b-${Date.now()}-${Math.random()}`;
    const body = validBody({ description: "Genuine second submission after the window." });
    const before = await prisma.actionTaken.count({ where: { ticketId: ticketA.id } });

    const first = await postAction(staffClient, ticketA.id, body, { "Idempotency-Key": key });
    expect(first.status).toBe(201);

    // The window is seconds long by design (§1.1); wait it out for real rather
    // than assuming the expiry behaviour.
    await sleep(IDEMPOTENCY_WINDOW_SECONDS * 1000 + 500);

    const second = await postAction(staffClient, ticketA.id, body, { "Idempotency-Key": key });

    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect(await prisma.actionTaken.count({ where: { ticketId: ticketA.id } })).toBe(before + 2);
  }, 20_000);
});

describe("API-28 — voiding requires a voidReason (§1.3, BR-11)", () => {
  it("returns 422 naming voidReason for a missing, empty, or too-short reason", async () => {
    for (const voidReason of [undefined, "", "   ", "ab"]) {
      const actionId = await createAsAuthor({ description: "Void attempt with a bad reason." });

      const res = await patchAction(adminClient, ticketA.id, actionId, {
        isVoided: true,
        voidReason,
      });

      expect(res.status, JSON.stringify(voidReason)).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.fieldErrors).toHaveProperty("voidReason");

      const stored = await prisma.actionTaken.findUnique({ where: { id: actionId } });
      expect(stored?.isVoided).toBe(false);
    }
  });

  it("ignores voidReason when isVoided is not being set to true", async () => {
    const actionId = await createAsAuthor({ description: "voidReason alone must not 422." });

    // §1.3: the reason is ignored in that case — so this is an edit with nothing
    // to change, which the API reports as a validation error on the request,
    // never as a stored void reason.
    const res = await patchAction(staffClient, ticketA.id, actionId, {
      voidReason: "orphan reason",
    });

    expect(res.status).toBe(422);
    const stored = await prisma.actionTaken.findUnique({ where: { id: actionId } });
    expect(stored?.isVoided).toBe(false);
    expect(stored?.voidReason).toBeNull();
  });
});

// ─── API-29 … API-31 — edit/read edge cases ────────────────────────────

describe("API-29 / API-30 — actionDateTime is editable but re-validated (BR-04)", () => {
  it("API-29: the author may move actionDateTime to a valid past value", async () => {
    const actionId = await createAsAuthor({ actionDateTime: iso(-60_000) });
    const target = iso(-3 * 60 * 60 * 1000);

    const res = await patchAction(staffClient, ticketA.id, actionId, {
      actionDateTime: target,
    });

    expect(res.status).toBe(200);
    expect(res.body.actionDateTime).toBe(target);
    expect(res.body.editedById).toBe(staffAuthor.id);
  });

  it("API-30: the author may not move actionDateTime into the future", async () => {
    const actionId = await createAsAuthor({ actionDateTime: iso(-60_000) });
    const original = (await prisma.actionTaken.findUnique({ where: { id: actionId } }))!
      .actionDateTime;

    const res = await patchAction(staffClient, ticketA.id, actionId, {
      actionDateTime: iso(30 * 60 * 1000),
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.fieldErrors).toHaveProperty("actionDateTime");

    const stored = await prisma.actionTaken.findUnique({ where: { id: actionId } });
    expect(stored?.actionDateTime.getTime()).toBe(original.getTime());
  });

  it("applies BR-05 to the effective pair on edit", async () => {
    const withNote = await createAsAuthor({
      followUpRequired: true,
      followUpNote: "Original follow-up plan.",
    });

    // Switching follow-up off clears the stale note instead of leaving it behind.
    const cleared = await patchAction(staffClient, ticketA.id, withNote, {
      followUpRequired: false,
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.followUpRequired).toBe(false);
    expect(cleared.body.followUpNote).toBeNull();

    // Turning it back on without a note is rejected …
    const reopened = await patchAction(staffClient, ticketA.id, withNote, {
      followUpRequired: true,
    });
    expect(reopened.status).toBe(422);
    expect(reopened.body.error.fieldErrors).toHaveProperty("followUpNote");

    // … and the entry is unchanged by the rejected attempt.
    const stored = await prisma.actionTaken.findUnique({ where: { id: withNote } });
    expect(stored?.followUpRequired).toBe(false);
    expect(stored?.followUpNote).toBeNull();
  });
});

describe("API-31 — includeVoided is an explicit rejection for a Requester (§1.2)", () => {
  it("returns 403 FORBIDDEN_QUERY_PARAM on the Requester's own Ticket", async () => {
    const res = await getActions(clientA, ticketA.id, "?includeVoided=true");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_QUERY_PARAM");
  });

  it("accepts includeVoided=false for the same Requester", async () => {
    const res = await getActions(clientA, ticketA.id, "?includeVoided=false");

    expect(res.status).toBe(200);
    expect(res.body.ticketId).toBe(ticketA.id);
  });
});

// ─── API-38 … API-41 — PATCH authorization and the void freeze ─────────

describe("API-38 — a Requester can never PATCH an Actions Taken entry (AC-06)", () => {
  it("returns 403 FORBIDDEN_ROLE on their own Ticket and on someone else's", async () => {
    const actionId = await createAsAuthor({ description: "Requester must not touch this." });

    const own = await patchAction(clientA, ticketA.id, actionId, {
      description: "Requester rewriting the IT log.",
    });
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe("FORBIDDEN_ROLE");

    const foreign = await patchAction(clientA, ticketB.id, actionId, {
      description: "Requester rewriting an unrelated log.",
    });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe("FORBIDDEN_ROLE");

    const stored = await prisma.actionTaken.findUnique({ where: { id: actionId } });
    expect(stored?.description).toBe("Requester must not touch this.");
    expect(stored?.editedAt).toBeNull();
  });
});

describe("API-39 / API-39b — PATCH lookup order: Ticket first, then Action (§1.3)", () => {
  it("API-39: an unknown ticketId is 404 TICKET_NOT_FOUND", async () => {
    const res = await patchAction(staffClient, MISSING_TICKET_ID, "does-not-matter", {
      description: "Ticket lookup must fail first.",
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
  });

  it("API-39b: a valid Ticket with an unknown actionId is 404 ACTION_NOT_FOUND", async () => {
    const res = await patchAction(staffClient, ticketA.id, "no-such-action-id", {
      description: "Action lookup runs second.",
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ACTION_NOT_FOUND");
  });

  it("API-39b: both bad resolves to TICKET_NOT_FOUND, never ACTION_NOT_FOUND", async () => {
    const res = await patchAction(staffClient, MISSING_TICKET_ID, "no-such-action-id", {
      description: "Ticket wins the race.",
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
  });

  it("does not leak another Ticket's entry through the actionId", async () => {
    const actionId = await createAsAuthor({ description: "Belongs to ticketA." });

    const res = await patchAction(staffClient, ticketB.id, actionId, {
      description: "Cross-ticket rewrite attempt.",
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ACTION_NOT_FOUND");
  });
});

describe("API-40 / API-41 — voiding is permanently one-way (§1.3, BR-11)", () => {
  it("API-40: an Administrator cannot edit a voided entry's other fields", async () => {
    const actionId = await createAsAuthor({ description: "Frozen after voiding." });
    const voidRes = await patchAction(adminClient, ticketA.id, actionId, {
      isVoided: true,
      voidReason: "Frozen on purpose for the API-40 check.",
    });
    expect(voidRes.status).toBe(200);

    const res = await patchAction(adminClient, ticketA.id, actionId, {
      description: "Trying to edit a voided entry.",
      result: "Trying to edit the result too.",
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ENTRY_VOIDED");

    const stored = await prisma.actionTaken.findUnique({ where: { id: actionId } });
    expect(stored?.description).toBe("Frozen after voiding.");
    expect(stored?.isVoided).toBe(true);
  });

  it("API-41: an Administrator cannot un-void a voided entry", async () => {
    const actionId = await createAsAuthor({ description: "Never coming back." });
    const voidRes = await patchAction(adminClient, ticketA.id, actionId, {
      isVoided: true,
      voidReason: "Frozen for the API-41 check.",
    });
    expect(voidRes.status).toBe(200);

    const res = await patchAction(adminClient, ticketA.id, actionId, {
      isVoided: false,
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ENTRY_VOIDED");

    const stored = await prisma.actionTaken.findUnique({ where: { id: actionId } });
    expect(stored?.isVoided).toBe(true);
    expect(stored?.voidReason).toBe("Frozen for the API-41 check.");
  });

  it("never deletes a voided entry — the audit trail is append-only (BR-11)", async () => {
    const actionId = await createAsAuthor({ description: "Voided but still on the record." });
    await patchAction(adminClient, ticketA.id, actionId, {
      isVoided: true,
      voidReason: "Soft-deleted, never hard-deleted.",
    });

    const stillThere = await prisma.actionTaken.findUnique({ where: { id: actionId } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.isVoided).toBe(true);
  });
});
