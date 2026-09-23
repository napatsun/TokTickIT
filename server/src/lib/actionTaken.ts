/**
 * Actions Taken — shared constants, pure validators, idempotency store, and
 * response projection (api-spec.md §1, specification.md §7.1).
 *
 * Everything that can be decided *without* touching the database lives here, so
 * the HTTP layer (routes/actions-taken.ts) stays a thin translation of
 * request → validator → Prisma, and so BR-05's conditional follow-up rule is
 * unit-testable as a plain function (UNIT-01).
 *
 * Business rules enforced:
 *   BR-01  `ticketId` is required and immutable — set from the path, never the body
 *   BR-03  `performedById` is never read from a client payload (nothing in this
 *          file accepts it; the create/update inputs have no such property)
 *   BR-04  `actionDateTime` is required, ISO-8601, and never in the future
 *   BR-05  `followUpNote` is required (>= 3 chars) iff `followUpRequired`,
 *          and must be empty/null otherwise
 *   BR-06  `attachmentNotes` is optional free text (<= 500 chars) and creates no
 *          file attachment of its own
 *   BR-11  the author may edit for `EDIT_WINDOW_MINUTES`; `voidReason` is
 *          required when an entry is being voided, and voiding is one-way
 *   FR-15 / AC-11  an `Idempotency-Key` replayed inside
 *          `IDEMPOTENCY_WINDOW_SECONDS` replays the original 201 response
 */

// ─── Constants ──────────────────────────────────────────────────────────
// Named, single-source constants (specification.md §11 decision 1: the demo can
// be re-tuned here without hunting for magic numbers).

/** BR-11: minutes after `createdAt` during which the author may still edit. */
export const EDIT_WINDOW_MINUTES = 15;

/** FR-15 / AC-11: replay window for a repeated `Idempotency-Key` header. */
export const IDEMPOTENCY_WINDOW_SECONDS = 5;

/** api-spec.md §1.1: `description` is 5–2000 characters. */
export const DESCRIPTION_MIN_LENGTH = 5;
export const DESCRIPTION_MAX_LENGTH = 2000;

/** api-spec.md §1.1: `result` is 3–2000 characters. */
export const RESULT_MIN_LENGTH = 3;
export const RESULT_MAX_LENGTH = 2000;

/** api-spec.md §1.1: `attachmentNotes` is optional, <= 500 characters. */
export const ATTACHMENT_NOTES_MAX_LENGTH = 500;

/** BR-05: a required follow-up note is at least 3 characters. */
export const FOLLOW_UP_NOTE_MIN_LENGTH = 3;
export const FOLLOW_UP_NOTE_MAX_LENGTH = 2000;

/** api-spec.md §1.3: `voidReason` is required (>= 3 chars) when voiding. */
export const VOID_REASON_MIN_LENGTH = 3;
export const VOID_REASON_MAX_LENGTH = 500;

export const EDIT_WINDOW_MS = EDIT_WINDOW_MINUTES * 60 * 1000;
export const IDEMPOTENCY_WINDOW_MS = IDEMPOTENCY_WINDOW_SECONDS * 1000;

/**
 * ISO-8601 date-time with a `T` separator; seconds/milliseconds and the zone
 * designator are optional so both `2026-09-20T10:15:00.000Z` (what
 * `Date#toISOString()` produces and what the UI sends) and a zoned
 * `2026-09-20T10:15Z` are accepted, while free-form date strings are not.
 */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

// ─── Result types ───────────────────────────────────────────────────────

/**
 * The two shapes both the HTTP layer and the unit tests consume: either the
 * normalised values, or a `fieldErrors` map that can be handed straight to the
 * Lab 2/3 error envelope (`{ error: { code, message, fieldErrors } }`).
 */
export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; fieldErrors: Record<string, string> };

function invalid(fieldErrors: Record<string, string>): Validated<never> {
  return { ok: false, fieldErrors };
}

/** Merge every failed check's field errors into one map (last write wins). */
function collectFieldErrors(
  fieldErrors: Record<string, string>,
  checks: ReadonlyArray<Validated<unknown>>,
): Record<string, string> {
  for (const check of checks) {
    if (!check.ok) Object.assign(fieldErrors, check.fieldErrors);
  }
  return fieldErrors;
}

// ─── Field validators ───────────────────────────────────────────────────

/**
 * BR-04: required, valid ISO-8601, and not in the future.
 *
 * @param now injectable clock so the future-timestamp rule is unit-testable
 *            without waiting for real time to pass.
 */
export function parseActionDateTime(
  value: unknown,
  now: Date = new Date(),
): Validated<Date> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return invalid({ actionDateTime: "Action date/time is required." });
  }

  const raw = value.trim();
  if (!ISO_8601_DATETIME.test(raw)) {
    return invalid({
      actionDateTime: "Action date/time must be a valid ISO-8601 date-time.",
    });
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return invalid({
      actionDateTime: "Action date/time must be a valid ISO-8601 date-time.",
    });
  }

  // BR-04: work cannot be logged before it happens — backdating is fine, a
  // future timestamp is not.
  if (parsed.getTime() > now.getTime()) {
    return invalid({ actionDateTime: "Action date/time cannot be in the future." });
  }

  return { ok: true, value: parsed };
}

function validateRequiredText(
  raw: unknown,
  field: string,
  label: string,
  min: number,
  max: number,
): Validated<string> {
  if (typeof raw !== "string") {
    return invalid({ [field]: `${label} is required.` });
  }

  // Trim first so "   " counts as empty and stored values carry no padding.
  const value = raw.trim();
  if (value.length < min || value.length > max) {
    return invalid({ [field]: `${label} must be between ${min} and ${max} characters.` });
  }

  return { ok: true, value };
}

function validateOptionalText(
  raw: unknown,
  field: string,
  label: string,
  max: number,
): Validated<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") {
    return invalid({ [field]: `${label} must be text.` });
  }

  const value = raw.trim();
  if (value.length > max) {
    return invalid({ [field]: `${label} cannot exceed ${max} characters.` });
  }

  // BR-06: an empty hint is stored as absence, not as "".
  return { ok: true, value: value.length === 0 ? null : value };
}

/**
 * BR-05 — the conditional follow-up pair. This is the pure truth table UNIT-01
 * exercises directly; both the create and the edit path funnel through it, so
 * the rule can never drift between them.
 *
 * | followUpRequired | followUpNote              | result                       |
 * |------------------|---------------------------|------------------------------|
 * | `true`           | >= 3 chars                | ok, note stored              |
 * | `true`           | empty / whitespace / null | invalid, field `followUpNote`|
 * | `false`          | empty / null / omitted    | ok, note stored as `null`    |
 * | `false`          | non-empty                 | invalid, field `followUpNote`|
 */
export function validateFollowUpNote(
  followUpRequired: unknown,
  followUpNote: unknown,
): Validated<{ followUpRequired: boolean; followUpNote: string | null }> {
  if (typeof followUpRequired !== "boolean") {
    return invalid({ followUpRequired: "Follow-up required must be true or false." });
  }

  let note: string | null;
  if (followUpNote === undefined || followUpNote === null) {
    note = "";
  } else if (typeof followUpNote === "string") {
    note = followUpNote.trim();
  } else {
    return invalid({ followUpNote: "Follow-up note must be text." });
  }

  if (followUpRequired) {
    if (note.length < FOLLOW_UP_NOTE_MIN_LENGTH) {
      return invalid({
        followUpNote: `Follow-up note is required when follow-up is needed (at least ${FOLLOW_UP_NOTE_MIN_LENGTH} characters).`,
      });
    }
    if (note.length > FOLLOW_UP_NOTE_MAX_LENGTH) {
      return invalid({
        followUpNote: `Follow-up note cannot exceed ${FOLLOW_UP_NOTE_MAX_LENGTH} characters.`,
      });
    }
    return { ok: true, value: { followUpRequired: true, followUpNote: note } };
  }

  if (note.length > 0) {
    return invalid({
      followUpNote: "Follow-up note must be empty when follow-up is not required.",
    });
  }

  return { ok: true, value: { followUpRequired: false, followUpNote: null } };
}

// ─── Create ─────────────────────────────────────────────────────────────

/** Exactly the client-supplied columns of a new ActionTaken (BR-03: no actor). */
export interface ActionTakenCreateInput {
  actionDateTime: Date;
  description: string;
  result: string;
  followUpRequired: boolean;
  followUpNote: string | null;
  attachmentNotes: string | null;
}

/**
 * Validate and normalise a `POST /api/tickets/:ticketId/actions` body.
 *
 * Deliberately blind to `id`, `ticketId`, `performedById`, `createdAt`,
 * `isVoided`, `editedAt`, and `editedById`: api-spec.md §1.1 lists them as
 * server-set, so a client that sends them is simply ignored (API-02), never
 * trusted and never rejected for it.
 */
export function validateCreateActionTaken(
  raw: unknown,
  now: Date = new Date(),
): Validated<ActionTakenCreateInput> {
  const body = (raw ?? {}) as Record<string, unknown>;

  // One check per documented field, then a single combined 422 so a client sees
  // every problem at once instead of one per round trip.
  const actionDateTime = parseActionDateTime(body.actionDateTime, now);
  const description = validateRequiredText(
    body.description,
    "description",
    "Description",
    DESCRIPTION_MIN_LENGTH,
    DESCRIPTION_MAX_LENGTH,
  );
  const result = validateRequiredText(
    body.result,
    "result",
    "Result",
    RESULT_MIN_LENGTH,
    RESULT_MAX_LENGTH,
  );
  const followUp = validateFollowUpNote(body.followUpRequired, body.followUpNote);
  const attachmentNotes = validateOptionalText(
    body.attachmentNotes,
    "attachmentNotes",
    "Attachment notes",
    ATTACHMENT_NOTES_MAX_LENGTH,
  );

  const fieldErrors = collectFieldErrors({}, [
    actionDateTime,
    description,
    result,
    followUp,
    attachmentNotes,
  ]);
  if (Object.keys(fieldErrors).length > 0) return invalid(fieldErrors);

  // Unreachable once the map is empty (a failed check always names a field),
  // but it keeps the compiler honest without non-null assertions.
  if (!actionDateTime.ok || !description.ok || !result.ok || !followUp.ok || !attachmentNotes.ok) {
    return invalid(fieldErrors);
  }

  return {
    ok: true,
    value: {
      actionDateTime: actionDateTime.value,
      description: description.value,
      result: result.value,
      followUpRequired: followUp.value.followUpRequired,
      followUpNote: followUp.value.followUpNote,
      attachmentNotes: attachmentNotes.value,
    },
  };
}

// ─── Edit ───────────────────────────────────────────────────────────────

/** The stored values an edit must validate against (the "effective" state). */
export interface ActionTakenEditableState {
  actionDateTime: Date;
  description: string;
  result: string;
  followUpRequired: boolean;
  followUpNote: string | null;
  attachmentNotes: string | null;
}

/** Only the columns an edit may touch, plus the Administrator-only void. */
export interface ActionTakenEditChanges {
  actionDateTime?: Date;
  description?: string;
  result?: string;
  followUpRequired?: boolean;
  followUpNote?: string | null;
  attachmentNotes?: string | null;
  isVoided?: true;
  voidReason?: string;
}

/**
 * Validate and normalise a `PATCH /api/tickets/:ticketId/actions/:actionId` body
 * (api-spec.md §1.3).
 *
 * `performedById` is absent from `ActionTakenEditChanges` on purpose: it is
 * never editable by anyone, at any time, so a body that carries it cannot even
 * express a change.
 *
 * The un-void and frozen-entry decisions are *state* decisions (409
 * `ENTRY_VOIDED`), made by the HTTP layer against the loaded row, because the
 * request body itself can be perfectly well-formed.
 */
export function validateEditActionTaken(
  raw: unknown,
  current: ActionTakenEditableState,
  now: Date = new Date(),
): Validated<ActionTakenEditChanges> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};
  const changes: ActionTakenEditChanges = {};

  // ─── Void (Administrator only; the role check is the HTTP layer's job) ──
  if (body.isVoided !== undefined) {
    if (typeof body.isVoided !== "boolean") {
      fieldErrors.isVoided = "isVoided must be true or false.";
    } else if (body.isVoided === true) {
      // `voidReason` is required iff `isVoided` is being set to true in the same
      // request (API-28); otherwise it is ignored entirely.
      const reason = validateRequiredText(
        body.voidReason,
        "voidReason",
        "Void reason",
        VOID_REASON_MIN_LENGTH,
        VOID_REASON_MAX_LENGTH,
      );
      if (reason.ok) {
        changes.isVoided = true;
        changes.voidReason = reason.value;
      } else {
        Object.assign(fieldErrors, reason.fieldErrors);
      }
    }
    // `isVoided: false` is not an edit target: un-voiding an already-voided entry
    // is the 409 ENTRY_VOIDED state check, and on a live entry it is a no-op.
  }

  // ─── Editable fields ────────────────────────────────────────────────────
  if (body.actionDateTime !== undefined) {
    const when = parseActionDateTime(body.actionDateTime, now);
    if (when.ok) changes.actionDateTime = when.value;
    else Object.assign(fieldErrors, when.fieldErrors);
  }

  if (body.description !== undefined) {
    const description = validateRequiredText(
      body.description,
      "description",
      "Description",
      DESCRIPTION_MIN_LENGTH,
      DESCRIPTION_MAX_LENGTH,
    );
    if (description.ok) changes.description = description.value;
    else Object.assign(fieldErrors, description.fieldErrors);
  }

  if (body.result !== undefined) {
    const result = validateRequiredText(
      body.result,
      "result",
      "Result",
      RESULT_MIN_LENGTH,
      RESULT_MAX_LENGTH,
    );
    if (result.ok) changes.result = result.value;
    else Object.assign(fieldErrors, result.fieldErrors);
  }

  // BR-05 on edit too — validated against the *effective* pair, not just the
  // submitted fragment, so `{ followUpRequired: true }` on an entry that already
  // has a note is legal while `{ followUpRequired: true }` on one without is not.
  if (body.followUpRequired !== undefined || body.followUpNote !== undefined) {
    const effectiveRequired =
      body.followUpRequired !== undefined ? body.followUpRequired : current.followUpRequired;
    const effectiveNote =
      body.followUpNote !== undefined
        ? body.followUpNote
        : // Switching follow-up off clears any note the entry was carrying.
          body.followUpRequired === false
          ? ""
          : current.followUpNote;

    const followUp = validateFollowUpNote(effectiveRequired, effectiveNote);
    if (followUp.ok) {
      changes.followUpRequired = followUp.value.followUpRequired;
      changes.followUpNote = followUp.value.followUpNote;
    } else {
      Object.assign(fieldErrors, followUp.fieldErrors);
    }
  }

  if (body.attachmentNotes !== undefined) {
    const attachmentNotes = validateOptionalText(
      body.attachmentNotes,
      "attachmentNotes",
      "Attachment notes",
      ATTACHMENT_NOTES_MAX_LENGTH,
    );
    if (attachmentNotes.ok) changes.attachmentNotes = attachmentNotes.value;
    else Object.assign(fieldErrors, attachmentNotes.fieldErrors);
  }

  if (Object.keys(fieldErrors).length > 0) return invalid(fieldErrors);

  // An edit that names no editable field is a malformed request rather than a
  // silent audit-stamp-only write. (A body carrying only `voidReason`, with
  // `isVoided` not set to true, lands here on purpose — the reason is ignored
  // per §1.3.)
  if (Object.keys(changes).length === 0) {
    return invalid({ _request: "Provide at least one field to update." });
  }

  return { ok: true, value: changes };
}

// ─── Idempotency store (FR-15, AC-11) ───────────────────────────────────

export interface IdempotentResponse {
  status: number;
  body: unknown;
}

interface StoredEntry extends IdempotentResponse {
  expiresAt: number;
}

/**
 * A tiny time-boxed replay cache for `Idempotency-Key`.
 *
 * Lab 4 ships no shared cache/queue infrastructure (and BR-13's "no cached
 * counters" rule concerns dashboard aggregates, not this), so the store is
 * in-process: a repeated key inside the window replays the stored response and
 * writes nothing, and every entry expires on its own after
 * `IDEMPOTENCY_WINDOW_SECONDS`. The factory shape exists so the expiry rule is
 * unit-testable with an injected clock instead of a real 5-second sleep.
 */
export function createIdempotencyStore(windowMs: number = IDEMPOTENCY_WINDOW_MS) {
  const entries = new Map<string, StoredEntry>();

  return {
    /** The stored response for `key`, or `null` when absent or expired. */
    lookup(key: string, now: number = Date.now()): IdempotentResponse | null {
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= now) {
        entries.delete(key);
        return null;
      }
      return { status: entry.status, body: entry.body };
    },

    /** Remember a successful response for `key`, sweeping anything expired. */
    save(key: string, status: number, body: unknown, now: number = Date.now()): void {
      for (const [storedKey, entry] of entries) {
        if (entry.expiresAt <= now) entries.delete(storedKey);
      }
      entries.set(key, { status, body, expiresAt: now + windowMs });
    },

    clear(): void {
      entries.clear();
    },

    get size(): number {
      return entries.size;
    },
  };
}

export type IdempotencyStore = ReturnType<typeof createIdempotencyStore>;

/**
 * Process-wide store used by `POST /api/tickets/:ticketId/actions`.
 *
 * Only successful (201) creations are remembered: a rejected submission has no
 * resource to replay, so a corrected retry with the same key must still be able
 * to create the entry.
 */
export const actionTakenIdempotencyStore = createIdempotencyStore();

// ─── Response projection ────────────────────────────────────────────────

/** An `ActionTaken` row joined with its author, as Prisma returns it. */
export interface ActionTakenRow {
  id: string;
  ticketId: number;
  actionDateTime: Date;
  description: string;
  result: string;
  performedById: string;
  followUpRequired: boolean;
  followUpNote: string | null;
  attachmentNotes: string | null;
  isVoided: boolean;
  voidReason: string | null;
  createdAt: Date;
  editedAt: Date | null;
  editedById: string | null;
  performedBy: { id: string; name: string };
}

/**
 * The single Actions Taken resource shape used by all three endpoints
 * (api-spec.md §1.1 "full resource", §1.2 list items): ids and timestamps as
 * they are stored, `performedBy` as `{ id, name }`, and every nullable text
 * column explicitly `null` rather than omitted so a client never has to guess.
 */
export function toActionTakenDto(row: ActionTakenRow) {
  return {
    id: row.id,
    ticketId: row.ticketId,
    actionDateTime: row.actionDateTime.toISOString(),
    description: row.description,
    result: row.result,
    performedById: row.performedById,
    performedBy: { id: row.performedBy.id, name: row.performedBy.name },
    followUpRequired: row.followUpRequired,
    followUpNote: row.followUpNote ?? null,
    attachmentNotes: row.attachmentNotes ?? null,
    isVoided: row.isVoided,
    voidReason: row.voidReason ?? null,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    editedById: row.editedById ?? null,
  };
}
