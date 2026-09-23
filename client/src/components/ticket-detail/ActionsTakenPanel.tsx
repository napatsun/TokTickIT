/**
 * ActionsTakenPanel — ui-spec.md §4 (Actions Taken Panel, on Ticket Detail)
 * specification.md FR-01…FR-06, BR-03/04/05/06/11/15, FR-15
 *
 * One component for all three roles; callers pass the Ticket id and the
 * authenticated user (the panel is role-aware, not role-duplicated):
 *
 *   Requester      → read-only table; the Add/Edit/Void controls are absent
 *                    from the DOM entirely (§4.2 — hidden ≠ disabled), on top
 *                    of the server-side 403 (BR-15 defence in depth).
 *   IT Staff       → create; edit own rows within EDIT_WINDOW_MINUTES (BR-11).
 *   Administrator  → create; edit any row any time; void any non-voided row;
 *                    "Show voided" disclosure (re-fetches includeVoided=true,
 *                    §4.4 — never client-side filtering of a fetched list).
 *
 * Endpoints (api-spec.md §1, implemented server-side in
 * server/src/routes/actions-taken.ts):
 *   POST   /api/tickets/:ticketId/actions          create (201, Idempotency-Key)
 *   GET    /api/tickets/:ticketId/actions          list, oldest first (§1.2)
 *   PATCH  /api/tickets/:ticketId/actions/:actionId  edit / void (§1.3)
 *
 * Error handling notes (verified against the shipped API):
 *   - 422 bodies carry `error.fieldErrors` (field → message) — the Lab 2/3
 *     envelope key (api-spec.md §1 Implementation Note). Field messages are
 *     rendered inline next to their field with aria-describedby wiring, and
 *     focus moves to the first invalid field (§4.3).
 *   - 403 EDIT_WINDOW_EXPIRED / NOT_AUTHOR and 409 ENTRY_VOIDED surface as
 *     role-appropriate inline messages on the row/form, never a generic toast
 *     (§4.4). ENTRY_VOIDED additionally triggers a re-fetch because the row's
 *     client state is stale (the entry was voided elsewhere).
 *   - Network/5xx failures keep every entered value (§4.5 safe failure: the
 *     draft is never cleared) and show a dismissible error banner.
 *
 * Accessibility (ui-spec.md §8): labelled fields, aria-describedby error
 * wiring, aria-live announcement of the conditional Follow-up Note field, an
 * aria-expanded "Show more" toggle per row, a text-carrying follow-up badge
 * (never colour-only), and mobile stacked label:value rows (§7).
 */

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Button from "../shared/Button";
import ConfirmDialog from "../shared/ConfirmDialog";
import { apiClient } from "../../lib/apiClient";
import type { AuthUser } from "../../contexts/AuthContext";
import styles from "./ActionsTakenPanel.module.css";

// ─── Constants (mirrored from server/src/lib/actionTaken.ts) ────────────

/** BR-04/§4.3: description 5–2000 chars, result 3–2000, attachmentNotes ≤500. */
const DESCRIPTION_MIN = 5;
const DESCRIPTION_MAX = 2000;
const RESULT_MIN = 3;
const RESULT_MAX = 2000;
const ATTACHMENT_NOTES_MAX = 500;
const FOLLOW_UP_NOTE_MIN = 3;
const FOLLOW_UP_NOTE_MAX = 2000;
const VOID_REASON_MIN = 3;
const VOID_REASON_MAX = 500;

/** FR-15/AC-11: the server dedupes replays of this header for 5 seconds. */
const IDEMPOTENCY_WINDOW_MS = 5000;

// ─── Types ──────────────────────────────────────────────────────────────

/** api-spec.md §1.2 list item / §1.1 resource — exactly the DTO the server projects. */
export interface ActionTakenEntry {
  id: string;
  ticketId: number;
  actionDateTime: string;
  description: string;
  result: string;
  performedById: string;
  performedBy: { id: string; name: string };
  followUpRequired: boolean;
  followUpNote: string | null;
  attachmentNotes: string | null;
  isVoided: boolean;
  voidReason: string | null;
  createdAt: string;
  editedAt: string | null;
  editedById: string | null;
}

export interface ActionsTakenPanelProps {
  /** The internal integer Ticket id (staff route convention; §1 of api-spec). */
  ticketId: number;
  /** The authenticated session user — drives every role gate in this panel. */
  currentUser: AuthUser;
}

interface DraftState {
  actionDateTime: string;
  description: string;
  result: string;
  followUpRequired: boolean;
  followUpNote: string;
  attachmentNotes: string;
}

type FieldName = keyof Pick<
  DraftState,
  "actionDateTime" | "description" | "result" | "followUpRequired" | "followUpNote" | "attachmentNotes"
>;

const FIELD_ORDER: FieldName[] = [
  "actionDateTime",
  "description",
  "result",
  "followUpRequired",
  "followUpNote",
  "attachmentNotes",
];

// ─── Helpers ────────────────────────────────────────────────────────────

function formatDateTime(isoString: string): string {
  return new Date(isoString).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** §4.2 "Edited {relativeTime} by {editor}" — coarse, test-stable units. */
export function formatRelativeTime(isoString: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(isoString).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** `<input type="datetime-local">` value for an ISO string, in local time. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** Local input value → ISO-8601 instant (the shape the API validates, BR-04). */
function fromLocalInputValue(value: string): string | null {
  if (value === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Client-side BR-04 check mirroring parseActionDateTime on the server. */
function isFutureTimestamp(iso: string): boolean {
  return new Date(iso).getTime() > Date.now();
}

async function readFieldErrors(response: Response): Promise<Record<string, string>> {
  // 422 VALIDATION_ERROR carries `error.fieldErrors` (field → message).
  try {
    const body = (await response.json()) as { error?: { fieldErrors?: Record<string, string> } };
    return body?.error?.fieldErrors ?? {};
  } catch {
    return {};
  }
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string } };
    return body?.error?.code ?? "";
  } catch {
    return "";
  }
}

function emptyDraft(): DraftState {
  return {
    actionDateTime: toLocalInputValue(new Date()),
    description: "",
    result: "",
    followUpRequired: false,
    followUpNote: "",
    attachmentNotes: "",
  };
}

function draftFromEntry(entry: ActionTakenEntry): DraftState {
  return {
    // The datetime-local input only stores minutes; seconds come from the entry.
    actionDateTime: toLocalInputValue(new Date(entry.actionDateTime)),
    description: entry.description,
    result: entry.result,
    followUpRequired: entry.followUpRequired,
    followUpNote: entry.followUpNote ?? "",
    attachmentNotes: entry.attachmentNotes ?? "",
  };
}

function hasEdits(base: DraftState, current: DraftState): boolean {
  return base.actionDateTime !== current.actionDateTime ||
    base.description !== current.description ||
    base.result !== current.result ||
    base.followUpRequired !== current.followUpRequired ||
    base.followUpNote !== current.followUpNote ||
    base.attachmentNotes !== current.attachmentNotes;
}

// ─── Component ──────────────────────────────────────────────────────────

export default function ActionsTakenPanel({ ticketId, currentUser }: ActionsTakenPanelProps) {
  const isRequester = currentUser.role === "REQUESTER";
  const isAdministrator = currentUser.role === "ADMINISTRATOR";
  // FR-01/FR-06: only IT Staff/Administrator author or edit; Requesters view.
  const canWrite = !isRequester;

  const [entries, setEntries] = useState<ActionTakenEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showVoided, setShowVoided] = useState(false);

  const [formMode, setFormMode] = useState<"closed" | "create" | "edit">("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [baseline, setBaseline] = useState<DraftState>(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Void (Administrator only, §4.4)
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Ids for aria wiring (§8).
  const headingId = useId();
  const hintId = useId();
  const noteLiveId = useId();
  const voidReasonId = useId();
  const voidErrorId = useId();

  const listPath = `/api/tickets/${ticketId}/actions${showVoided ? "?includeVoided=true" : ""}`;

  // ─── Load (§4.4: the Show-voided toggle re-fetches; it never filters locally) ──
  const fetchEntries = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await apiClient(listPath);
      if (!response.ok) {
        setLoadError("Couldn't load Actions Taken.");
        return;
      }
      const data = (await response.json()) as { items?: ActionTakenEntry[] };
      // api-spec.md §1.2: oldest first; the server guarantees the order, the
      // panel renders it verbatim (FR-03 — no client-side re-sort that could
      // mask a contract change).
      setEntries(Array.isArray(data.items) ? data.items : []);
    } catch {
      setLoadError("Couldn't load Actions Taken.");
    } finally {
      setIsLoading(false);
    }
  }, [listPath]);

  useEffect(() => {
    void fetchEntries();
  }, [fetchEntries]);

  const entryPath = useCallback(
    (actionId: string) => `/api/tickets/${ticketId}/actions/${actionId}`,
    [ticketId],
  );

  // ─── Create / edit form ─────────────────────────────────────────────────

  function openCreate() {
    setFormMode("create");
    setEditingId(null);
    setDraft(emptyDraft());
    setBaseline(emptyDraft());
    setFieldErrors({});
    setFormError(null);
    setConfirmCancel(false);
  }

  function openEdit(entry: ActionTakenEntry) {
    const next = draftFromEntry(entry);
    setFormMode("edit");
    setEditingId(entry.id);
    setDraft(next);
    setBaseline(next);
    setFieldErrors({});
    setFormError(null);
    setConfirmCancel(false);
  }

  function requestCloseForm() {
    setFormMode("closed");
    setEditingId(null);
    setDraft(emptyDraft());
    setBaseline(emptyDraft());
    setFieldErrors({});
    setFormError(null);
  }

  /**
   * §4.3: cancel with any touched field prompts before discarding, so a slip
   * never destroys entered data (handout §8.5). An untouched form closes
   * without a pointless confirmation.
   */
  function requestCancel() {
    if (hasEdits(baseline, draft)) {
      setConfirmCancel(true);
      return;
    }
    requestCloseForm();
  }

  function focusFirstInvalid(errors: Partial<Record<FieldName, string>>) {
    // The ids (`action-<field>`) are on the controls themselves.
    const firstField = FIELD_ORDER.find((field) => errors[field]);
    if (!firstField) return;
    const node = document.getElementById(`action-${firstField}`);
    if (node instanceof HTMLElement) node.focus();
  }

  const setDraftField = useCallback((field: keyof DraftState, value: string | boolean) => {
    setDraft((current) => ({ ...current, [field]: value }));
    // Clear the field's error as soon as the user edits it again.
    setFieldErrors((current) => {
      if (current[field as FieldName] === undefined) return current;
      const next = { ...current };
      delete next[field as FieldName];
      return next;
    });
  }, []);

  const submitForm = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (submitting) return;
      setFormError(null);

      // Client-side BR-04: a future Action Date/Time is rejected before the
      // request is sent (the server re-validates it — defence in depth).
      const isoDateTime = fromLocalInputValue(draft.actionDateTime);
      if (isoDateTime === null) {
        const errors = { actionDateTime: "Action date/time is required." };
        setFieldErrors(errors);
        focusFirstInvalid(errors);
        return;
      }
      if (isFutureTimestamp(isoDateTime)) {
        const errors = { actionDateTime: "Action date/time cannot be in the future." };
        setFieldErrors(errors);
        focusFirstInvalid(errors);
        return;
      }

      setSubmitting(true);
      setFieldErrors({});

      // FR-15/AC-11: one key per submission attempt, scoped per attempt — a
      // genuine retry (or a corrected resubmission) must create a new entry,
      // while a transport-level duplicate click replays the same 201 body.
      const idempotencyKey =
        formMode === "create" ? `ui-${Date.now()}-${Math.random().toString(36).slice(2)}` : null;

      try {
        const response =
          formMode === "create"
            ? await apiClient(`/api/tickets/${ticketId}/actions`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
                },
                body: JSON.stringify({
                  actionDateTime: isoDateTime,
                  description: draft.description,
                  result: draft.result,
                  followUpRequired: draft.followUpRequired,
                  // BR-05: an empty note is sent as "" so the server can store
                  // null; a non-empty note travels verbatim.
                  followUpNote: draft.followUpRequired ? draft.followUpNote : "",
                  attachmentNotes: draft.attachmentNotes,
                }),
              })
            : await apiClient(entryPath(editingId ?? ""), {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  actionDateTime: isoDateTime,
                  description: draft.description,
                  result: draft.result,
                  followUpRequired: draft.followUpRequired,
                  followUpNote: draft.followUpRequired ? draft.followUpNote : "",
                  attachmentNotes: draft.attachmentNotes,
                }),
              });

        if (!response.ok) {
          if (response.status === 422) {
            const serverFieldErrors = await readFieldErrors(response);
            const errors: Partial<Record<FieldName, string>> = {};
            for (const [field, message] of Object.entries(serverFieldErrors)) {
              if ((FIELD_ORDER as string[]).includes(field)) {
                errors[field as FieldName] = message;
              }
            }
            setFieldErrors(errors);
            focusFirstInvalid(errors);
            return;
          }

          // §4.4: role-appropriate inline messages for the documented 403/409
          // codes — never a generic "something went wrong".
          const code = await readErrorCode(response);
          const entry = entries.find((item) => item.id === editingId);
          if (code === "EDIT_WINDOW_EXPIRED") {
            setFormError("The 15-minute edit window for this entry has expired. Ask an Administrator to make further changes.");
            return;
          }
          if (code === "NOT_AUTHOR") {
            setFormError("Only the author of this entry or an Administrator can edit it.");
            return;
          }
          if (code === "ENTRY_VOIDED") {
            setFormError("This entry has been voided and can no longer be changed.");
            await fetchEntries(); // refresh stale row state
            return;
          }
          if (code === "ACTION_NOT_FOUND") {
            setFormError("This entry no longer exists. The list has been refreshed.");
            await fetchEntries();
            return;
          }
          if (code === "FORBIDDEN_ROLE") {
            setFormError(
              entry && entry.performedById === currentUser.id
                ? "Your role can no longer edit this entry."
                : "Only the author of this entry (within the edit window) or an Administrator can edit it.",
            );
            return;
          }

          // §4.5 safe failure: keep the draft, show a dismissible banner.
          setFormError("Couldn't save — check your connection and try again.");
          return;
        }

        const saved = (await response.json()) as ActionTakenEntry;

        // Re-fetch keeps §1.2's server order authoritative (a backdated
        // actionDateTime may not belong at the bottom).
        await fetchEntries();

        if (formMode === "create") {
          // §4.3: the new row appears with a brief highlight animation.
          setHighlightedId(saved.id);
        }
        setFormMode("closed");
        setEditingId(null);
        setDraft(emptyDraft());
        setBaseline(emptyDraft());
        setConfirmCancel(false);
      } catch {
        // §4.5: never clear the draft on a network failure.
        setFormError("Couldn't save — check your connection and try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [draft, entries, editingId, entryPath, fetchEntries, formMode, submitting, ticketId, currentUser.id],
  );

  const dismissFormError = useCallback(() => setFormError(null), []);

  // ─── Void (Administrator only, §4.4/BR-11) ──────────────────────────────

  const startVoid = useCallback((entry: ActionTakenEntry) => {
    setVoidingId(entry.id);
    setVoidReason("");
    setVoidError(null);
  }, []);

  const cancelVoid = useCallback(() => {
    setVoidingId(null);
    setVoidReason("");
    setVoidError(null);
  }, []);

  const confirmVoid = useCallback(async () => {
    if (voidingId === null) return;
    const trimmed = voidReason.trim();
    if (trimmed.length < VOID_REASON_MIN) {
      setVoidError(`A void reason is required (at least ${VOID_REASON_MIN} characters).`);
      return;
    }

    setVoiding(true);
    setVoidError(null);
    try {
      const response = await apiClient(entryPath(voidingId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isVoided: true, voidReason: trimmed }),
      });
      if (!response.ok) {
        const code = await readErrorCode(response);
        if (code === "ENTRY_VOIDED") {
          setVoidError("This entry has already been voided. The list has been refreshed.");
          await fetchEntries();
        } else {
          setVoidError("Couldn't void this entry — check your connection and try again.");
        }
        return;
      }
      // BR-11: voided rows vanish from the default view; under "Show voided"
      // they reappear with their reason and timestamp.
      await fetchEntries();
      setVoidingId(null);
      setVoidReason("");
    } catch {
      setVoidError("Couldn't void this entry — check your connection and try again.");
    } finally {
      setVoiding(false);
    }
  }, [entryPath, fetchEntries, voidReason, voidingId]);

  // ─── Derived ────────────────────────────────────────────────────────────

  const liveFollowUpNoteMessage = useMemo(() => {
    if (!draft.followUpRequired) return null;
    const length = draft.followUpNote.trim().length;
    if (length === 0 || length >= FOLLOW_UP_NOTE_MIN) return null;
    return `Follow-up note must be at least ${FOLLOW_UP_NOTE_MIN} characters.`;
  }, [draft.followUpRequired, draft.followUpNote]);

  const visibleEntries = useMemo(
    () => (showVoided ? entries : entries.filter((entry) => !entry.isVoided)),
    [entries, showVoided],
  );
  const nonVoidedCount = useMemo(
    () => entries.filter((entry) => !entry.isVoided).length,
    [entries],
  );

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <section className={styles.section} aria-labelledby={headingId} data-testid="actions-taken-panel">
      <div className={styles.headerRow}>
        <h2 className={styles.heading} id={headingId}>
          Actions Taken{" "}
          {/* No aria-label override: the h2's accessible name must match its visible
              text "Actions Taken (N)" (ui-spec §4.2, WCAG 2.5.3 Label in Name). */}
          <span className={styles.countBadge}>({nonVoidedCount})</span>
        </h2>
        {canWrite && formMode === "closed" && (
          <Button variant="primary" onClick={openCreate} data-testid="add-action-button">
            + Add Actions Taken
          </Button>
        )}
      </div>
      <p className={styles.hint} id={hintId}>
        {isRequester
          ? "The work IT Staff performed on this ticket."
          : "A chronological log of the work performed on this ticket."}
      </p>

      {/* ─── Create / edit form (inline above the table, §4.3) ─────────── */}
      {formMode !== "closed" && (
        <form
          className={styles.form}
          onSubmit={(event) => void submitForm(event)}
          noValidate
          data-testid="actions-taken-form"
          aria-label={formMode === "create" ? "Add Actions Taken" : "Edit Actions Taken"}
        >
          {formMode === "create" ? (
            <h3 className={styles.formTitle}>Add Actions Taken</h3>
          ) : (
            <h3 className={styles.formTitle}>Edit Actions Taken</h3>
          )}

          {formError && (
            <div className={styles.errorBanner} role="alert" data-testid="action-form-error">
              <p>{formError}</p>
              <Button variant="tertiary" onClick={dismissFormError} data-testid="action-form-error-dismiss">
                Dismiss
              </Button>
            </div>
          )}

          <div className={styles.formGrid}>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="action-actionDateTime">
                Action Date/Time
                <span className={styles.requiredMark} aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="action-actionDateTime"
                className={styles.input}
                type="datetime-local"
                value={draft.actionDateTime}
                onChange={(event) => setDraftField("actionDateTime", event.target.value)}
                aria-invalid={fieldErrors.actionDateTime ? true : undefined}
                aria-describedby={
                  fieldErrors.actionDateTime ? "action-actionDateTime-error" : undefined
                }
                aria-busy={submitting}
              />
              {fieldErrors.actionDateTime && (
                <p className={styles.fieldError} id="action-actionDateTime-error" role="alert">
                  {fieldErrors.actionDateTime}
                </p>
              )}
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="action-description">
                Action Description
                <span className={styles.requiredMark} aria-hidden="true">
                  *
                </span>
              </label>
              <textarea
                id="action-description"
                className={styles.textarea}
                rows={3}
                maxLength={DESCRIPTION_MAX}
                value={draft.description}
                onChange={(event) => setDraftField("description", event.target.value)}
                aria-invalid={fieldErrors.description ? true : undefined}
                aria-describedby={fieldErrors.description ? "action-description-error" : undefined}
                placeholder="What was done? (5–2000 characters)"
                aria-busy={submitting}
                required
              />
              {fieldErrors.description && (
                <p className={styles.fieldError} id="action-description-error" role="alert">
                  {fieldErrors.description}
                </p>
              )}
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="action-result">
                Result
                <span className={styles.requiredMark} aria-hidden="true">
                  *
                </span>
              </label>
              <textarea
                id="action-result"
                className={styles.textarea}
                rows={3}
                maxLength={RESULT_MAX}
                value={draft.result}
                onChange={(event) => setDraftField("result", event.target.value)}
                aria-invalid={fieldErrors.result ? true : undefined}
                aria-describedby={fieldErrors.result ? "action-result-error" : undefined}
                placeholder="What was the outcome? (3–2000 characters)"
                aria-busy={submitting}
                required
              />
              {fieldErrors.result && (
                <p className={styles.fieldError} id="action-result-error" role="alert">
                  {fieldErrors.result}
                </p>
              )}
            </div>

            <div className={`${styles.fieldGroup} ${styles.toggleGroup}`}>
              <input
                id="action-followUpRequired"
                className={styles.checkbox}
                type="checkbox"
                checked={draft.followUpRequired}
                onChange={(event) => setDraftField("followUpRequired", event.target.checked)}
                aria-describedby={draft.followUpRequired ? noteLiveId : undefined}
                aria-busy={submitting}
              />
              <label className={styles.label} htmlFor="action-followUpRequired">
                Follow-Up Required?
              </label>
            </div>

            {/* BR-05 conditional field: announced when it appears (§8). */}
            {draft.followUpRequired && (
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="action-followUpNote">
                  Follow-up Note
                  <span className={styles.requiredMark} aria-hidden="true">
                    *
                  </span>
                </label>
                <textarea
                  id="action-followUpNote"
                  className={styles.textarea}
                  rows={2}
                  maxLength={FOLLOW_UP_NOTE_MAX}
                  value={draft.followUpNote}
                  onChange={(event) => setDraftField("followUpNote", event.target.value)}
                  aria-invalid={fieldErrors.followUpNote ? true : undefined}
                  aria-describedby={
                    [noteLiveId, fieldErrors.followUpNote ? "action-followUpNote-error" : null]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                  placeholder={`Required when follow-up is needed (at least ${FOLLOW_UP_NOTE_MIN} characters)`}
                  aria-busy={submitting}
                  required
                />
                {/* The live region carries both the appearance announcement and
                    the live inline validation state so AT users hear the field
                    become required without moving focus (§8, BR-05). */}
                <p className={styles.hint} id={noteLiveId} aria-live="polite" role="status">
                  {fieldErrors.followUpNote ??
                    liveFollowUpNoteMessage ??
                    "Follow-up note is required while Follow-Up Required is on."}
                </p>
              </div>
            )}

            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="action-attachmentNotes">
                Attachment Notes
              </label>
              <input
                id="action-attachmentNotes"
                className={styles.input}
                type="text"
                maxLength={ATTACHMENT_NOTES_MAX}
                value={draft.attachmentNotes}
                onChange={(event) => setDraftField("attachmentNotes", event.target.value)}
                aria-invalid={fieldErrors.attachmentNotes ? true : undefined}
                aria-describedby={fieldErrors.attachmentNotes ? "action-attachmentNotes-error" : undefined}
                placeholder="Optional — where can the file be found?"
                aria-busy={submitting}
              />
              {fieldErrors.attachmentNotes && (
                <p className={styles.fieldError} id="action-attachmentNotes-error" role="alert">
                  {fieldErrors.attachmentNotes}
                </p>
              )}
            </div>

            {/* BR-03: Performed By is never an editable field — static text only. */}
            <div className={styles.fieldGroup}>
              <span className={styles.label}>Performed By</span>
              <p className={styles.performedBy} data-testid="performed-by-text">
                {formMode === "edit"
                  ? `Recorded as: ${entries.find((item) => item.id === editingId)?.performedBy.name ?? currentUser.name}`
                  : `Will be recorded as: ${currentUser.name}`}
              </p>
            </div>
          </div>

          <div className={styles.formActions}>
            <Button
              variant="secondary"
              onClick={requestCancel}
              disabled={submitting}
              data-testid="action-cancel-button"
            >
              Cancel
            </Button>
            <Button
              variant={submitting ? "busy" : "primary"}
              busyLabel="Saving…"
              type="submit"
              disabled={submitting}
              data-testid="action-save-button"
            >
              {formMode === "create" ? "Save Actions Taken" : "Save Changes"}
            </Button>
          </div>
        </form>
      )}

      {/* ─── Cancel confirmation: protect entered data (§4.3, handout §8.5) ── */}
      {confirmCancel && (
        <ConfirmDialog
          title="Discard this draft?"
          copy="You have entered data that hasn't been saved yet. Discarding the form will lose it."
          confirmLabel="Discard"
          onConfirm={requestCloseForm}
          onCancel={() => setConfirmCancel(false)}
          testId="action-cancel-confirm"
        />
      )}

      {/* ─── Void confirmation (Administrator, inline, §4.4) ──────────────── */}
      {voidingId !== null && (
        <div className={styles.voidBox} data-testid="void-confirm">
          <h3 className={styles.formTitle}>Void this entry?</h3>
          <p className={styles.hint}>
            Voiding hides the entry from the default view and freezes it permanently (BR-11). This
            cannot be undone.
          </p>
          {voidError && (
            <div className={styles.errorBanner} role="alert" data-testid="void-error">
              <p>{voidError}</p>
            </div>
          )}
          <label className={styles.label} htmlFor={voidReasonId}>
            Void Reason
            <span className={styles.requiredMark} aria-hidden="true">
              *
            </span>
          </label>
          <input
            id={voidReasonId}
            className={styles.input}
            type="text"
            maxLength={VOID_REASON_MAX}
            value={voidReason}
            onChange={(event) => {
              setVoidReason(event.target.value);
              setVoidError(null);
            }}
            aria-describedby={voidError ? voidErrorId : undefined}
            aria-invalid={voidError ? true : undefined}
            placeholder="Why is this entry being voided?"
            disabled={voiding}
          />
          <div className={styles.formActions}>
            <Button variant="secondary" onClick={cancelVoid} disabled={voiding} data-testid="void-cancel-button">
              Cancel
            </Button>
            <Button
              variant={voiding ? "busy" : "destructive"}
              busyLabel="Voiding…"
              onClick={() => void confirmVoid()}
              disabled={voiding}
              data-testid="void-confirm-button"
            >
              Void Entry
            </Button>
          </div>
        </div>
      )}

      {/* ─── Show voided disclosure (IT Staff/Administrator only, §4.4) ──── */}
      {canWrite && (
        <div className={styles.voidedToggleRow}>
          <input
            id="show-voided-toggle"
            className={styles.checkbox}
            type="checkbox"
            checked={showVoided}
            onChange={(event) => setShowVoided(event.target.checked)}
            data-testid="show-voided-toggle"
          />
          <label className={styles.label} htmlFor="show-voided-toggle">
            Show voided
          </label>
        </div>
      )}

      {/* ─── States ─────────────────────────────────────────────────────── */}
      {isLoading && (
        <div className={styles.skeletonBlock} aria-hidden="true" data-testid="actions-taken-skeleton">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className={styles.skeletonRow}>
              <div className={`${styles.skeletonLine} ${styles.skeletonNarrow}`} />
              <div className={`${styles.skeletonLine} ${styles.skeletonWide}`} />
              <div className={`${styles.skeletonLine} ${styles.skeletonNarrow}`} />
              <div className={`${styles.skeletonLine} ${styles.skeletonNarrow}`} />
              <div className={`${styles.skeletonLine} ${styles.skeletonBadge}`} />
            </div>
          ))}
        </div>
      )}

      {!isLoading && loadError && (
        <div className={styles.errorBanner} role="alert" data-testid="actions-taken-load-error">
          <p>{loadError}</p>
          <Button variant="tertiary" onClick={() => void fetchEntries()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !loadError && visibleEntries.length === 0 && (
        <div className={styles.emptyState} data-testid="actions-taken-empty">
          <p className={styles.mutedText}>No Actions Taken recorded yet.</p>
          {canWrite && formMode === "closed" && (
            <Button variant="primary" onClick={openCreate} data-testid="add-action-empty-cta">
              + Add Actions Taken
            </Button>
          )}
        </div>
      )}

      {!isLoading && !loadError && visibleEntries.length > 0 && (
        <div className={styles.tableWrap} data-testid="actions-taken-table">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Date/Time</th>
                <th scope="col">Description</th>
                <th scope="col">Result</th>
                <th scope="col">Performed By</th>
                <th scope="col">Follow-up</th>
                <th scope="col">
                  <span className={styles.visuallyHidden}>Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((entry) => {
                const isExpanded = expandedId === entry.id;
                const voided = entry.isVoided;
                // Compute edit/void affordances (§4.4):
                //   Requester           → none (absent from the DOM)
                //   Voided row          → none for anyone (permanently frozen)
                //   Administrator       → Edit + Void on every non-voided row
                //   Author (IT Staff)   → Edit within the 15-minute window
                const authorCanEdit =
                  !voided &&
                  canWrite &&
                  (isAdministrator ||
                    (entry.performedById === currentUser.id &&
                      Date.now() - new Date(entry.createdAt).getTime() <= 15 * 60 * 1000));
                const canVoid = !voided && isAdministrator;

                return (
                  <TableRow
                    key={entry.id}
                    entry={entry}
                    expanded={isExpanded}
                    highlighted={highlightedId === entry.id}
                    onToggle={() => setExpandedId(isExpanded ? null : entry.id)}
                    canEdit={authorCanEdit}
                    canVoid={canVoid}
                    onEdit={() => openEdit(entry)}
                    onVoid={() => startVoid(entry)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Row ────────────────────────────────────────────────────────────────

interface TableRowProps {
  entry: ActionTakenEntry;
  expanded: boolean;
  highlighted: boolean;
  onToggle: () => void;
  canEdit: boolean;
  canVoid: boolean;
  onEdit: () => void;
  onVoid: () => void;
}

function TableRow({
  entry,
  expanded,
  highlighted,
  onToggle,
  canEdit,
  canVoid,
  onEdit,
  onVoid,
}: TableRowProps) {
  const rowId = `action-row-${entry.id}`;
  const detailsId = `action-details-${entry.id}`;
  const descId = `action-desc-${entry.id}`;
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Keep the relative "Edited …" caption honest without a ticker per second.
  useEffect(() => {
    if (entry.editedAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [entry.editedAt]);

  const isLong = entry.description.length > 120;

  return (
    <>
      <tr
        className={`${styles.row} ${highlighted ? styles.rowHighlighted : ""} ${
          entry.isVoided ? styles.rowVoided : ""
        }`}
        data-testid="actions-taken-row"
      >
        <td data-label="Date/Time" className={styles.cellDateTime}>
          {formatDateTime(entry.actionDateTime)}
        </td>
        <td data-label="Description" className={styles.cellDescription} id={descId}>
          <span
            className={`${styles.descriptionText} ${!showFullDescription ? styles.clamp : ""}`}
          >
            {entry.description}
          </span>
          {isLong && (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setShowFullDescription((current) => !current)}
              aria-expanded={showFullDescription}
              aria-controls={descId}
              data-testid={`show-more-${entry.id}`}
            >
              {showFullDescription ? "Show less" : "Show more"}
            </button>
          )}
        </td>
        <td data-label="Result" className={styles.cellResult}>
          {entry.result}
        </td>
        <td data-label="Performed By">{entry.performedBy.name}</td>
        <td data-label="Follow-up">
          {/* §8: the badge always carries its text; colour is never the sole cue. */}
          <span className={entry.followUpRequired ? styles.badgeFollowUp : styles.badgeNoFollowUp}>
            {entry.followUpRequired ? "Follow-up needed" : "No follow-up"}
          </span>
        </td>
        <td data-label="Details" className={styles.cellActions}>
          {(canEdit || canVoid) && (
            <>
              {canEdit && (
                <Button variant="secondary" onClick={onEdit} data-testid={`edit-action-${entry.id}`}>
                  Edit
                </Button>
              )}
              {canVoid && (
                <Button variant="tertiary" onClick={onVoid} data-testid={`void-action-${entry.id}`}>
                  Void
                </Button>
              )}
            </>
          )}
          <Button
            variant="tertiary"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={detailsId}
            data-testid={`expand-action-${entry.id}`}
          >
            {expanded ? "Hide details" : "Details"}
          </Button>
        </td>
      </tr>
      {expanded && (
        <tr className={styles.detailsRow}>
          <td colSpan={6} id={detailsId}>
            <div className={styles.detailsBody} id={rowId}>
              {entry.attachmentNotes ? (
                <p>
                  <span className={styles.detailsLabel}>Attachment Notes:</span>{" "}
                  {entry.attachmentNotes}
                </p>
              ) : (
                <p>
                  <span className={styles.detailsLabel}>Attachment Notes:</span>{" "}
                  <span className={styles.mutedText}>None</span>
                </p>
              )}
              {entry.followUpRequired && entry.followUpNote && (
                <p>
                  <span className={styles.detailsLabel}>Follow-up Note:</span> {entry.followUpNote}
                </p>
              )}
              {entry.editedAt && (
                <p className={styles.editedCaption} data-testid={`edited-caption-${entry.id}`}>
                  Edited {formatRelativeTime(entry.editedAt, now)}
                  {entry.editedById
                    ? ` by ${entry.editedById === entry.performedById ? entry.performedBy.name : "an Administrator"}`
                    : ""}
                  .
                </p>
              )}
              {entry.isVoided && (
                <p className={styles.voidCaption} data-testid={`void-caption-${entry.id}`}>
                  Voided — reason: {entry.voidReason ?? "not recorded"}
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
