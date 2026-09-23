import { describe, it, expect } from "vitest";
import {
  ATTACHMENT_NOTES_MAX_LENGTH,
  DESCRIPTION_MIN_LENGTH,
  FOLLOW_UP_NOTE_MAX_LENGTH,
  IDEMPOTENCY_WINDOW_SECONDS,
  RESULT_MIN_LENGTH,
  VOID_REASON_MIN_LENGTH,
  createIdempotencyStore,
  parseActionDateTime,
  validateCreateActionTaken,
  validateEditActionTaken,
  validateFollowUpNote,
  type Validated,
} from "../../../src/lib/actionTaken.js";

/**
 * UNIT-01 and the pure-function contract behind it — tests.md §1, BR-04/BR-05/BR-11.
 *
 *   UNIT-01  the conditional follow-up-note validator, exercised as a truth table
 *            over (followUpRequired × followUpNote)
 *
 * The remaining blocks cover the other decisions `server/src/lib/actionTaken.ts`
 * makes without touching the database: the BR-04 timestamp rule (against an
 * injected clock, so no real waiting), the create/edit normalisation, and the
 * FR-15 idempotency window expiry.
 *
 * Everything here is a plain function call — no app, no database, no HTTP.
 */

function expectValid<T>(result: Validated<T>): T {
  if (!result.ok) {
    throw new Error(`expected a valid result, got ${JSON.stringify(result.fieldErrors)}`);
  }
  return result.value;
}

function expectInvalid<T>(result: Validated<T>): Record<string, string> {
  if (result.ok) {
    throw new Error(`expected a validation failure, got ${JSON.stringify(result.value)}`);
  }
  return result.fieldErrors;
}

// ─── UNIT-01 ────────────────────────────────────────────────────────────

describe("UNIT-01 — follow-up-note conditional validator (BR-05)", () => {
  it("case 1: required = true with a usable note → valid, note stored as trimmed text", () => {
    const value = expectValid(
      validateFollowUpNote(true, "  Monitor battery health for 2 weeks.  "),
    );

    expect(value).toEqual({
      followUpRequired: true,
      followUpNote: "Monitor battery health for 2 weeks.",
    });
  });

  it("case 2: required = true with no usable note → invalid, naming followUpNote", () => {
    for (const note of ["", "   \n\t  ", null, undefined]) {
      const fieldErrors = expectInvalid(validateFollowUpNote(true, note));

      expect(Object.keys(fieldErrors)).toEqual(["followUpNote"]);
      expect(fieldErrors.followUpNote).toMatch(/follow-up note is required/i);
    }
  });

  it("case 3: required = false with no note → valid, note normalised to null", () => {
    for (const note of ["", "   ", null, undefined]) {
      const value = expectValid(validateFollowUpNote(false, note));

      // BR-05: "otherwise followUpNote must be null/empty" — stored as absence.
      expect(value).toEqual({ followUpRequired: false, followUpNote: null });
    }
  });

  it("case 4: required = false with a non-empty note → invalid, naming followUpNote", () => {
    const fieldErrors = expectInvalid(validateFollowUpNote(false, "This should not be here."));

    expect(Object.keys(fieldErrors)).toEqual(["followUpNote"]);
    expect(fieldErrors.followUpNote).toMatch(/must be empty/i);
  });

  it("requires an actual boolean for followUpRequired", () => {
    for (const flag of [undefined, null, "true", "false", 1, 0]) {
      const fieldErrors = expectInvalid(validateFollowUpNote(flag, "some note"));

      expect(Object.keys(fieldErrors)).toEqual(["followUpRequired"]);
    }
  });

  it("respects the 3-character minimum exactly", () => {
    expect(expectValid(validateFollowUpNote(true, "abc")).followUpNote).toBe("abc");

    const tooShort = expectInvalid(validateFollowUpNote(true, "ab"));
    expect(tooShort.followUpNote).toMatch(/at least 3 characters/i);

    // Whitespace padding does not count towards the minimum.
    expect(expectInvalid(validateFollowUpNote(true, " ab "))).toHaveProperty("followUpNote");
  });

  it("accepts the maximum note length and rejects one character more", () => {
    const atLimit = "N".repeat(FOLLOW_UP_NOTE_MAX_LENGTH);
    expect(expectValid(validateFollowUpNote(true, atLimit)).followUpNote).toHaveLength(
      FOLLOW_UP_NOTE_MAX_LENGTH,
    );

    const overLimit = "N".repeat(FOLLOW_UP_NOTE_MAX_LENGTH + 1);
    expect(expectInvalid(validateFollowUpNote(true, overLimit))).toHaveProperty("followUpNote");
  });

  it("rejects a non-string note", () => {
    const fieldErrors = expectInvalid(validateFollowUpNote(true, 42));

    expect(Object.keys(fieldErrors)).toEqual(["followUpNote"]);
  });
});

// ─── BR-04 — actionDateTime ─────────────────────────────────────────────

describe("parseActionDateTime — required, ISO-8601, never in the future (BR-04)", () => {
  const now = new Date("2026-09-20T10:15:00.000Z");

  it("accepts a backdated timestamp in the documented format", () => {
    const value = expectValid(parseActionDateTime("2026-01-05T08:30:00.000Z", now));

    expect(value.toISOString()).toBe("2026-01-05T08:30:00.000Z");
  });

  it("accepts a timestamp at exactly the server clock", () => {
    const value = expectValid(parseActionDateTime("2026-09-20T10:15:00.000Z", now));

    expect(value.getTime()).toBe(now.getTime());
  });

  it("rejects one millisecond into the future", () => {
    const fieldErrors = expectInvalid(parseActionDateTime("2026-09-20T10:15:00.001Z", now));

    expect(Object.keys(fieldErrors)).toEqual(["actionDateTime"]);
    expect(fieldErrors.actionDateTime).toMatch(/future/i);
  });

  it("rejects a missing, empty, or non-ISO-8601 value", () => {
    for (const raw of [
      undefined,
      null,
      "",
      "   ",
      "not-a-date",
      "20/09/2026 10:15",
      "2026-09-20",
      "2026-09-20 10:15:00Z",
      "2026-13-45T99:99:99Z",
      1758358800000,
      new Date("2026-09-20T10:15:00.000Z"),
    ]) {
      const fieldErrors = expectInvalid(parseActionDateTime(raw, now));

      expect(Object.keys(fieldErrors), JSON.stringify(raw)).toEqual(["actionDateTime"]);
    }
  });

  it("accepts a zoned timestamp without seconds or milliseconds", () => {
    const value = expectValid(parseActionDateTime("2026-09-20T10:15Z", now));

    expect(value.toISOString()).toBe("2026-09-20T10:15:00.000Z");
  });
});

// ─── Create normalisation ───────────────────────────────────────────────

describe("validateCreateActionTaken — request normalisation (api-spec.md §1.1)", () => {
  const now = new Date("2026-09-20T10:15:00.000Z");

  const valid = {
    actionDateTime: "2026-09-20T10:15:00.000Z",
    description: "Replaced failing battery cell and re-seated connector.",
    result: "Laptop now holds charge for 6+ hours in testing.",
    followUpRequired: true,
    followUpNote: "Monitor battery health for 2 weeks.",
    attachmentNotes: "See battery-test-photo.jpg.",
  };

  it("normalises a complete payload", () => {
    const value = expectValid(validateCreateActionTaken(valid, now));

    expect(value).toEqual({
      actionDateTime: new Date("2026-09-20T10:15:00.000Z"),
      description: valid.description,
      result: valid.result,
      followUpRequired: true,
      followUpNote: valid.followUpNote,
      attachmentNotes: valid.attachmentNotes,
    });
  });

  it("trims text and turns a blank optional hint into null", () => {
    const value = expectValid(
      validateCreateActionTaken(
        {
          ...valid,
          description: `   ${valid.description}   `,
          result: `   ${valid.result}   `,
          attachmentNotes: "   ",
        },
        now,
      ),
    );

    expect(value.description).toBe(valid.description);
    expect(value.result).toBe(valid.result);
    expect(value.attachmentNotes).toBeNull();
  });

  it("collects every missing/invalid field into one fieldErrors map", () => {
    const fieldErrors = expectInvalid(validateCreateActionTaken({}, now));

    expect(Object.keys(fieldErrors).sort()).toEqual(
      ["actionDateTime", "description", "followUpRequired", "result"].sort(),
    );
  });

  it("enforces the description and result length boundaries", () => {
    const shortDescription = expectInvalid(
      validateCreateActionTaken(
        { ...valid, description: "A".repeat(DESCRIPTION_MIN_LENGTH - 1) },
        now,
      ),
    );
    expect(shortDescription).toHaveProperty("description");

    const shortResult = expectInvalid(
      validateCreateActionTaken({ ...valid, result: "B".repeat(RESULT_MIN_LENGTH - 1) }, now),
    );
    expect(shortResult).toHaveProperty("result");

    const longNotes = expectInvalid(
      validateCreateActionTaken(
        { ...valid, attachmentNotes: "C".repeat(ATTACHMENT_NOTES_MAX_LENGTH + 1) },
        now,
      ),
    );
    expect(longNotes).toHaveProperty("attachmentNotes");
  });

  it("ignores every server-set field a client might try to inject (BR-03)", () => {
    const value = expectValid(
      validateCreateActionTaken(
        {
          ...valid,
          id: "client-chosen-id",
          ticketId: 4242,
          performedById: "someone-else",
          performedBy: { id: "someone-else", name: "Impostor" },
          createdAt: "2000-01-01T00:00:00.000Z",
          isVoided: true,
          voidReason: "spoofed",
          editedAt: "2000-01-01T00:00:00.000Z",
          editedById: "someone-else",
        },
        now,
      ),
    );

    // The normalized value simply has no such properties to carry forward.
    expect(Object.keys(value).sort()).toEqual(
      [
        "actionDateTime",
        "attachmentNotes",
        "description",
        "followUpNote",
        "followUpRequired",
        "result",
      ].sort(),
    );
  });

  it("treats a non-object body as an empty submission rather than throwing", () => {
    for (const raw of [undefined, null, "text", 7, []]) {
      expectInvalid(validateCreateActionTaken(raw, now));
    }
  });
});

// ─── Edit normalisation ─────────────────────────────────────────────────

describe("validateEditActionTaken — BR-05 against the effective pair, void rules (§1.3)", () => {
  const now = new Date("2026-09-20T10:15:00.000Z");

  const current = {
    actionDateTime: new Date("2026-09-19T09:00:00.000Z"),
    description: "Original description.",
    result: "Original result.",
    followUpRequired: true,
    followUpNote: "Original follow-up plan.",
    attachmentNotes: null,
  };

  it("applies only the submitted fields", () => {
    const value = expectValid(
      validateEditActionTaken({ description: "Corrected description." }, current, now),
    );

    expect(value).toEqual({ description: "Corrected description." });
  });

  it("keeps an existing note valid when only followUpRequired=true is sent", () => {
    const value = expectValid(validateEditActionTaken({ followUpRequired: true }, current, now));

    expect(value).toEqual({
      followUpRequired: true,
      followUpNote: "Original follow-up plan.",
    });
  });

  it("clears the stale note when follow-up is switched off", () => {
    const value = expectValid(validateEditActionTaken({ followUpRequired: false }, current, now));

    expect(value).toEqual({ followUpRequired: false, followUpNote: null });
  });

  it("rejects switching follow-up on when the effective note is empty", () => {
    const withoutNote = { ...current, followUpRequired: false, followUpNote: null };

    const fieldErrors = expectInvalid(
      validateEditActionTaken({ followUpRequired: true }, withoutNote, now),
    );

    expect(fieldErrors).toHaveProperty("followUpNote");
  });

  it("rejects a non-empty note on an entry whose follow-up is off", () => {
    const withoutNote = { ...current, followUpRequired: false, followUpNote: null };

    const fieldErrors = expectInvalid(
      validateEditActionTaken({ followUpNote: "not allowed here" }, withoutNote, now),
    );

    expect(fieldErrors).toHaveProperty("followUpNote");
  });

  it("re-validates an edited actionDateTime against BR-04", () => {
    const past = expectValid(
      validateEditActionTaken(
        { actionDateTime: "2026-09-18T07:00:00.000Z" },
        current,
        now,
      ),
    );
    expect(past.actionDateTime?.toISOString()).toBe("2026-09-18T07:00:00.000Z");

    const future = expectInvalid(
      validateEditActionTaken(
        { actionDateTime: "2026-09-21T07:00:00.000Z" },
        current,
        now,
      ),
    );
    expect(future).toHaveProperty("actionDateTime");
  });

  it("requires a usable voidReason only when isVoided is being set to true", () => {
    const voided = expectValid(
      validateEditActionTaken(
        { isVoided: true, voidReason: "Duplicate entry created by double submission." },
        current,
        now,
      ),
    );
    expect(voided).toEqual({
      isVoided: true,
      voidReason: "Duplicate entry created by double submission.",
    });

    for (const voidReason of [undefined, "", "   ", "ab".slice(0, VOID_REASON_MIN_LENGTH - 1)]) {
      const fieldErrors = expectInvalid(
        validateEditActionTaken({ isVoided: true, voidReason }, current, now),
      );

      expect(Object.keys(fieldErrors), JSON.stringify(voidReason)).toEqual(["voidReason"]);
    }

    // A reason without `isVoided` is ignored, so nothing is storable.
    expect(expectInvalid(validateEditActionTaken({ voidReason: "orphan" }, current, now))).toEqual({
      _request: expect.any(String),
    });

    // Non-boolean flag.
    const notBoolean = expectInvalid(
      validateEditActionTaken({ isVoided: "yes", voidReason: "a reason" }, current, now),
    );
    expect(notBoolean).toHaveProperty("isVoided");
  });

  it("never produces a performedById (or other server-set) change", () => {
    const value = expectValid(
      validateEditActionTaken(
        {
          description: "Actor must not change.",
          performedById: "someone-else",
          editedById: "someone-else",
          createdAt: "2000-01-01T00:00:00.000Z",
          ticketId: 99,
        },
        current,
        now,
      ),
    );

    expect(value).toEqual({ description: "Actor must not change." });
    expect(value).not.toHaveProperty("performedById");
  });

  it("rejects a request that names no editable field", () => {
    for (const body of [{}, null, undefined, { followUpNote: undefined }]) {
      const fieldErrors = expectInvalid(validateEditActionTaken(body, current, now));

      expect(fieldErrors).toHaveProperty("_request");
    }
  });
});

// ─── FR-15 — idempotency window ─────────────────────────────────────────

describe("createIdempotencyStore — the FR-15 replay window (api-spec.md §1.1)", () => {
  it("replays a stored response inside the window", () => {
    const store = createIdempotencyStore();
    const body = { id: "act_1", description: "stored" };
    const start = 1_000_000;

    store.save("key-1", 201, body, start);

    expect(store.lookup("key-1", start)).toEqual({ status: 201, body });
    expect(store.lookup("key-1", start + IDEMPOTENCY_WINDOW_SECONDS * 1000 - 1)).not.toBeNull();
  });

  it("expires exactly at the end of the window", () => {
    const store = createIdempotencyStore();
    const start = 1_000_000;
    store.save("key-2", 201, { id: "act_2" }, start);

    const expiry = start + IDEMPOTENCY_WINDOW_SECONDS * 1000;
    expect(store.lookup("key-2", expiry)).toBeNull();
    expect(store.size).toBe(0);
  });

  it("keeps distinct keys independent and sweeps expired ones on save", () => {
    const store = createIdempotencyStore();
    const now = 5_000_000;

    store.save("a", 201, { id: "a" }, now);
    store.save("b", 201, { id: "b" }, now);
    expect(store.size).toBe(2);

    // Saving past the window sweeps the two expired keys before inserting.
    store.save("c", 201, { id: "c" }, now + IDEMPOTENCY_WINDOW_SECONDS * 1000 + 1);
    expect(store.size).toBe(1);
    expect(store.lookup("a", now + IDEMPOTENCY_WINDOW_SECONDS * 1000 + 1)).toBeNull();
    expect(store.lookup("b", now + IDEMPOTENCY_WINDOW_SECONDS * 1000 + 1)).toBeNull();
    expect(store.lookup("c", now + IDEMPOTENCY_WINDOW_SECONDS * 1000 + 1)).toEqual({
      status: 201,
      body: { id: "c" },
    });
  });

  it("returns null for a key that was never stored, and can be cleared", () => {
    const store = createIdempotencyStore();

    expect(store.lookup("never-seen")).toBeNull();

    store.save("k", 201, { id: "k" });
    store.clear();
    expect(store.lookup("k")).toBeNull();
  });

  it("honours an explicit window override", () => {
    const store = createIdempotencyStore(1_000);
    store.save("short", 201, { id: "short" }, 0);

    expect(store.lookup("short", 999)).not.toBeNull();
    expect(store.lookup("short", 1_000)).toBeNull();
  });
});
