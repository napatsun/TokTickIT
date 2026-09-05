/**
 * CreateTicketPage — ui-spec.md §7 (Create Ticket screen)
 *
 * Layout (desktop ≥992px): Single card, max-width ~840px, centered,
 * sections stacked top-to-bottom:
 *   1. Header row — "Create Ticket" title
 *   2. System-generated info — Ticket Date (read-only, "—" before submit)
 *   3. Classification — Category* + Related System* (2-col grid on desktop)
 *   4. Requested Priority* — segmented control (Low / Medium / High)
 *   5. Summary* — input, 120 max, live counter
 *   6. Description* — textarea, 2000 max, live counter
 *   7. Attachments — drag-and-drop + browse
 *   8. Actions — Cancel + Submit Ticket
 *
 * Post-submit states:
 *   - Success: pale-green panel with ticket number
 *   - Validation failure: per-field errors + form-level summary banner
 *   - API/server failure: red banner, values preserved
 *   - Partial success: attachmentFailures warning
 *
 * Uses useReducer for form state management (§7, BR-19 to BR-24).
 * Uses apiClient for all API calls (BR-03 / BR-05 enforcement).
 *
 * Phase 5a scope: static layout only. Reference data fetch, validation,
 * and submit handler will be added in subsequent phases.
 */

import { useReducer, useRef, useCallback, useEffect, act } from "react";
import { useNavigate } from "react-router-dom";
import Field from "../components/shared/Field.js";
import Button from "../components/shared/Button.js";
import Badge from "../components/shared/Badge.js";
import AttachmentPicker, {
  type PendingFile,
} from "../components/shared/AttachmentPicker.js";
import { apiClient } from "../lib/apiClient.js";
import styles from "./CreateTicketPage.module.css";

// ─── Types ──────────────────────────────────────────────────────────────

interface Category {
  id: number;
  name: string;
}

interface RelatedSystem {
  id: number;
  name: string;
}

type Priority = "" | "LOW" | "MEDIUM" | "HIGH";
type SubmissionStatus = "idle" | "submitting" | "success" | "error";

export interface FormState {
  // Reference data (will be fetched from API in Phase 5b)
  categories: Category[];
  relatedSystems: RelatedSystem[];
  refDataStatus: "loading" | "error" | "success";

  // Field values
  categoryId: number | "";
  relatedSystemId: number | "";
  summary: string;
  description: string;
  requestedPriority: Priority;

  // Validation errors (keyed by field name)
  errors: Record<string, string>;

  // Submission
  submissionStatus: SubmissionStatus;

  // Success response data
  createdTicket: {
    ticketNumber: string;
    ticketDate: string;
  } | null;
  attachmentFailures: Array<{ originalFileName: string; reason: string }>;

  // Attachments
  pendingFiles: PendingFile[];

  // API-level error banner
  apiErrorMessage: string;
}

type FormAction =
  | { type: "SET_REF_DATA"; categories: Category[]; relatedSystems: RelatedSystem[] }
  | { type: "SET_REF_DATA_ERROR" }
  | { type: "SET_FIELD"; field: string; value: string | number }
  | { type: "SET_ERRORS"; errors: Record<string, string> }
  | { type: "CLEAR_ERROR"; field: string }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_SUCCESS"; ticketNumber: string; ticketDate: string; attachmentFailures: FormState["attachmentFailures"] }
  | { type: "SUBMIT_ERROR"; message: string }
  | { type: "SET_PENDING_FILES"; files: PendingFile[] }
  | { type: "RESET_FORM" };

const INITIAL_STATE: FormState = {
  categories: [],
  relatedSystems: [],
  refDataStatus: "loading",

  categoryId: "",
  relatedSystemId: "",
  summary: "",
  description: "",
  requestedPriority: "",

  errors: {},

  submissionStatus: "idle",

  createdTicket: null,
  attachmentFailures: [],

  pendingFiles: [],

  apiErrorMessage: "",
};

// ─── Reducer ────────────────────────────────────────────────────────────

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "SET_REF_DATA":
      return {
        ...state,
        categories: action.categories,
        relatedSystems: action.relatedSystems,
        refDataStatus: "success",
      };

    case "SET_REF_DATA_ERROR":
      return { ...state, refDataStatus: "error" };

    case "SET_FIELD":
      return {
        ...state,
        [action.field]: action.value,
        // Clear field error when user edits (BR-24: preserve other errors)
        errors: (() => {
          const next = { ...state.errors };
          delete next[action.field];
          return next;
        })(),
      };

    case "SET_ERRORS":
      return { ...state, errors: action.errors, submissionStatus: "idle" };

    case "CLEAR_ERROR": {
      const next = { ...state.errors };
      delete next[action.field];
      return { ...state, errors: next };
    }

    case "SUBMIT_START":
      return {
        ...state,
        submissionStatus: "submitting",
        apiErrorMessage: "",
        errors: {},
      };

    case "SUBMIT_SUCCESS":
      return {
        ...state,
        submissionStatus: "success",
        createdTicket: {
          ticketNumber: action.ticketNumber,
          ticketDate: action.ticketDate,
        },
        attachmentFailures: action.attachmentFailures,
      };

    case "SUBMIT_ERROR":
      return {
        ...state,
        submissionStatus: "error",
        apiErrorMessage: action.message,
      };

    case "SET_PENDING_FILES":
      return { ...state, pendingFiles: action.files };

    case "RESET_FORM":
      return {
        ...INITIAL_STATE,
        // Preserve loaded reference data
        categories: state.categories,
        relatedSystems: state.relatedSystems,
        refDataStatus: state.refDataStatus,
      };

    default:
      return state;
  }
}

// ─── Client-side validation (BR-19 to BR-24) ───────────────────────

const VALID_PRIORITIES = new Set(["LOW", "MEDIUM", "HIGH"]);

/**
 * Validate all form fields per BR-19 to BR-22.
 * Returns a Record of field name → error message.
 * Empty object means all fields valid.
 *
 * BR-24: field values are NOT cleared on validation failure —
 * the caller preserves state as-is.
 */
export function validateForm(state: FormState): Record<string, string> {
  const errors: Record<string, string> = {};

  // BR-21: categoryId required
  if (state.categoryId === "") {
    errors.categoryId = "Category is required.";
  }

  // BR-21: relatedSystemId required
  if (state.relatedSystemId === "") {
    errors.relatedSystemId = "Related system is required.";
  }

  // BR-19: summary required, trimmed, 5–120 chars
  const summary = state.summary.trim();
  if (summary.length === 0) {
    errors.summary = "Summary is required.";
  } else if (summary.length < 5 || summary.length > 120) {
    errors.summary = "Summary must be between 5 and 120 characters.";
  }

  // BR-20: description required, trimmed, 20–2000 chars
  const description = state.description.trim();
  if (description.length === 0) {
    errors.description = "Description is required.";
  } else if (description.length < 20 || description.length > 2000) {
    errors.description = "Description must be between 20 and 2000 characters.";
  }

  // BR-21 + BR-22: requestedPriority required, must be LOW/MEDIUM/HIGH
  if (!VALID_PRIORITIES.has(state.requestedPriority)) {
    errors.requestedPriority = "Please select a priority.";
  }

  return errors;
}

/**
 * Validate a single field. Used for blur-triggered live validation.
 * Returns error message or undefined if valid.
 */
function validateField(
  field: string,
  state: FormState,
): string | undefined {
  switch (field) {
    case "categoryId":
      if (state.categoryId === "") return "Category is required.";
      return undefined;
    case "relatedSystemId":
      if (state.relatedSystemId === "") return "Related system is required.";
      return undefined;
    case "summary": {
      const v = state.summary.trim();
      if (v.length === 0) return "Summary is required.";
      if (v.length < 5 || v.length > 120)
        return "Summary must be between 5 and 120 characters.";
      return undefined;
    }
    case "description": {
      const v = state.description.trim();
      if (v.length === 0) return "Description is required.";
      if (v.length < 20 || v.length > 2000)
        return "Description must be between 20 and 2000 characters.";
      return undefined;
    }
    case "requestedPriority":
      if (!VALID_PRIORITIES.has(state.requestedPriority))
        return "Please select a priority.";
      return undefined;
    default:
      return undefined;
  }
}

// ─── Async submit (Phase 5d) ──────────────────────────────────────
// Defined outside the component to avoid stale closure issues.
// Receives state and dispatch explicitly so it can be tested directly.

export async function submitTicket(
  currentState: FormState,
  dispatchFn: React.Dispatch<FormAction>,
) {
  try {
    // ─── Build FormData ──────────────────────────────────────
    const formData = new FormData();
    formData.append("categoryId", String(currentState.categoryId));
    formData.append("relatedSystemId", String(currentState.relatedSystemId));
    formData.append("summary", currentState.summary.trim());
    formData.append("description", currentState.description.trim());
    formData.append("requestedPriority", currentState.requestedPriority);

    // BR-30: only include files without client-side validation errors
    for (const pf of currentState.pendingFiles) {
      if (!pf.error) {
        formData.append("attachments", pf.file);
      }
    }

    // ─── Call API ────────────────────────────────────────────
    const res = await apiClient("/api/tickets", {
      method: "POST",
      body: formData,
      // NOTE: Do NOT set Content-Type header — the browser must set
      // it automatically with the correct multipart boundary.
    });

    const body = await res.json();

    // ─── Handle response ─────────────────────────────────────

    if (res.status === 201) {
      // Success — BR-31: attachmentFailures may be non-empty
      dispatchFn({
        type: "SUBMIT_SUCCESS",
        ticketNumber: body.ticket.ticketNumber,
        ticketDate: body.ticket.ticketDate,
        attachmentFailures: body.attachmentFailures ?? [],
      });
      return;
    }

    // 401: apiClient handles auto-redirect (BR-03), just return
    if (res.status === 401) {
      return;
    }

    // 400: validation error or invalid reference
    if (res.status === 400 && body.error?.fieldErrors) {
      dispatchFn({ type: "SET_ERRORS", errors: body.error.fieldErrors });

      // Focus first error field (AC-24)
      const fieldOrder = ["categoryId", "relatedSystemId", "requestedPriority", "summary", "description"];
      const firstErrorField = fieldOrder.find((f) => body.error.fieldErrors[f]);
      if (firstErrorField) {
        setTimeout(() => {
          document.getElementById(firstErrorField)?.focus();
        }, 0);
      }
      return;
    }

    // 400 without fieldErrors (shouldn't happen per api-spec, but handle safely)
    if (res.status === 400) {
      dispatchFn({
        type: "SUBMIT_ERROR",
        message: body.error?.message ?? "Please fix the highlighted fields.",
      });
      return;
    }

    // 413/415: attachment errors
    if (res.status === 413 || res.status === 415) {
      const attachmentMsg =
        body.error?.fieldErrors?.attachments ?? body.error?.message ?? "Attachment error.";
      dispatchFn({ type: "SUBMIT_ERROR", message: attachmentMsg });
      return;
    }

    // 500 or any other status: safe generic message (AC-09)
    dispatchFn({
      type: "SUBMIT_ERROR",
      message: "We couldn\u2019t submit your ticket. Please try again.",
    });
  } catch {
    // Network error or JSON parse failure (AC-09)
    dispatchFn({
      type: "SUBMIT_ERROR",
      message: "We couldn\u2019t submit your ticket. Please try again.",
    });
  }
}

// ─── Component ──────────────────────────────────────────────────────────

export default function CreateTicketPage() {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(formReducer, INITIAL_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  // ─── Fetch reference data on mount (Phase 5b) ──────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadRefData() {
      try {
        const [catRes, rsRes] = await Promise.all([
          apiClient("/api/categories"),
          apiClient("/api/related-systems"),
        ]);

        if (!catRes.ok || !rsRes.ok) throw new Error("Failed to load ref data");

        const catData = await catRes.json();
        const rsData = await rsRes.json();

        if (!cancelled) {
          dispatch({
            type: "SET_REF_DATA",
            categories: catData.categories ?? [],
            relatedSystems: rsData.relatedSystems ?? [],
          });
        }
      } catch {
        if (!cancelled) {
          dispatch({ type: "SET_REF_DATA_ERROR" });
        }
      }
    }

    loadRefData();
    return () => { cancelled = true; };
  }, []);

  // ─── Field change handler ────────────────────────────────────────
  // Fields whose values should be stored as number (not string) in state.
  // HTML select elements always return string values from e.target.value,
  // but FormState declares these as number | "" — so we parse here.
  const NUMERIC_FIELDS = new Set(["categoryId", "relatedSystemId"]);

  const handleFieldChange = useCallback(
    (field: string) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const raw = e.target.value;
        const value = NUMERIC_FIELDS.has(field)
          ? (raw === "" ? "" : Number(raw))
          : raw;
        dispatch({ type: "SET_FIELD", field, value });
      },
    [],
  );

  // ─── Priority segmented control ─────────────────────────────────

  const priorities: { value: Priority; label: string }[] = [
    { value: "LOW", label: "Low" },
    { value: "MEDIUM", label: "Medium" },
    { value: "HIGH", label: "High" },
  ];

  // ─── Form submit handler (Phase 5c) ─────────────────────────────

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // BR-19 to BR-22: client-side validation before any API call
    const errors = validateForm(state);

    if (Object.keys(errors).length > 0) {
      // BR-24: preserve all field values, just show errors
      dispatch({ type: "SET_ERRORS", errors });

      // AC-24: focus the first invalid field for keyboard accessibility
      const fieldOrder = ["categoryId", "relatedSystemId", "requestedPriority", "summary", "description"];
      const firstErrorField = fieldOrder.find((f) => errors[f]);
      if (firstErrorField) {
        // Use act + setTimeout to ensure React has rendered the error
        // messages before focusing. This is more reliable than
        // requestAnimationFrame in test environments (jsdom).
        setTimeout(() => {
          const el = document.getElementById(firstErrorField);
          el?.focus();
        }, 0);
      }
      return;
    }

    // All valid — proceed to submit (Phase 5d)
    dispatch({ type: "SUBMIT_START" });
    submitTicket(state, dispatch);
  }

  // ─── Blur handler for live validation ───────────────────────────

  const handleBlur = useCallback(
    (field: string) => () => {
      const error = validateField(field, state);
      if (error) {
        dispatch({ type: "SET_ERRORS", errors: { ...state.errors, [field]: error } });
      } else if (state.errors[field]) {
        // Clear the error for this field if it's now valid
        dispatch({ type: "CLEAR_ERROR", field });
      }
    },
    [state.errors, state.categoryId, state.relatedSystemId, state.summary, state.description, state.requestedPriority],
  );

  // ─── Cancel handler ─────────────────────────────────────────────

  function handleCancel() {
    navigate("/tickets", { replace: true });
  }

  // ─── Render: Loading state (ref data) ───────────────────────────

  if (state.refDataStatus === "loading") {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.loadingArea}>
            <div className={styles.spinner} role="status" aria-label="Loading" />
            <span className={styles.loadingText}>Loading form data…</span>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: Ref data error state ───────────────────────────────

  if (state.refDataStatus === "error") {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Create Ticket</h1>
          <div className={styles.refErrorBanner} role="alert">
            Could not load categories or related systems.
            <Button
              variant="tertiary"
              onClick={() => window.location.reload()}
              style={{ marginLeft: 8, color: "var(--color-error)" }}
            >
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: Success state ──────────────────────────────────────

  if (state.submissionStatus === "success" && state.createdTicket) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          {/* §7.1: Header row */}
          <div className={styles.headerRow}>
            <h1 className={styles.title}>Create Ticket</h1>
          </div>

          {/* Success panel */}
          <div className={styles.successPanel}>
            <span className={styles.successIcon} aria-hidden="true">
              ✅
            </span>
            <span className={styles.successTicketNumber}>
              {state.createdTicket.ticketNumber}
            </span>
            <p className={styles.successMessage}>
              Your ticket has been created successfully. An IT staff member will
              review it shortly.
            </p>

            {/* BR-31: Partial attachment failures */}
            {state.attachmentFailures.length > 0 && (
              <div className={styles.attachmentFailures} role="status">
                {state.attachmentFailures.map((af) => (
                  <span key={af.originalFileName} className={styles.attachmentFailureItem}>
                    {af.originalFileName}: {af.reason}
                  </span>
                ))}
                <span>
                  These attachments were not uploaded. You can add them later from
                  Ticket Detail.
                </span>
              </div>
            )}

            <div className={styles.successActions}>
              <Button
                variant="secondary"
                onClick={() =>
                  navigate(`/tickets/${state.createdTicket!.ticketNumber}`)
                }
              >
                View Ticket
              </Button>
              <Button
                variant="primary"
                onClick={() => dispatch({ type: "RESET_FORM" })}
              >
                Create Another Ticket
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: Form ───────────────────────────────────────────────

  // Determine field states from errors
  const getFieldState = (field: string): "default" | "invalid" =>
    state.errors[field] ? "invalid" : "default";

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <form ref={formRef} noValidate onSubmit={handleSubmit}>
          {/* ─── §7.1: Header row ─── */}
          <div className={styles.headerRow}>
            <h1 className={styles.title}>Create Ticket</h1>
          </div>

          {/* ─── §7.2: System-generated info (read-only) ─── */}
          <div>
            <span className={styles.sectionLabel}>System Information</span>
            <Field
              state="readonly"
              label="Ticket Date"
              value={state.createdTicket?.ticketDate ?? "\u2014"}
            />
          </div>

          {/* ─── Validation summary banner (§7: post-submit) ─── */}
          {Object.keys(state.errors).length > 0 && state.submissionStatus === "idle" && (
            <div className={styles.validationSummary} role="alert">
              Please fix {Object.keys(state.errors).length} field(s) below.
            </div>
          )}

          {/* ─── API error banner (§7: post-submit) ─── */}
          {state.apiErrorMessage && (
            <div className={styles.apiErrorBanner} role="alert">
              {state.apiErrorMessage}
            </div>
          )}

          {/* ─── §7.3: Classification (2-col grid on desktop) ─── */}
          <div className={styles.classificationGrid}>
            <Field
              type="select"
              label="Category"
              required
              id="categoryId"
              state={getFieldState("categoryId")}
              errorMessage={state.errors.categoryId}
              value={state.categoryId}
              onChange={handleFieldChange("categoryId")}
              onBlur={handleBlur("categoryId")}
            >
              <option value="">— Select a category —</option>
              {state.categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </Field>

            <Field
              type="select"
              label="Related System"
              required
              id="relatedSystemId"
              state={getFieldState("relatedSystemId")}
              errorMessage={state.errors.relatedSystemId}
              value={state.relatedSystemId}
              onChange={handleFieldChange("relatedSystemId")}
              onBlur={handleBlur("relatedSystemId")}
            >
              <option value="">— Select a related system —</option>
              {state.relatedSystems.map((rs) => (
                <option key={rs.id} value={rs.id}>
                  {rs.name}
                </option>
              ))}
            </Field>
          </div>

          {/* ─── §7.4: Requested Priority (segmented control) ─── */}
          <div className={styles.priorityGroup}>
            <label className="field-label" style={{ fontSize: 13, fontWeight: 600 }}>
              Requested Priority
              <span style={{ color: "var(--color-error)", marginLeft: 2 }} aria-hidden="true">*</span>
            </label>
            <div className={styles.prioritySegmented} role="radiogroup" aria-label="Requested Priority">
              {priorities.map((p) => (
                <Button
                  key={p.value}
                  variant={state.requestedPriority === p.value ? "primary" : "secondary"}
                  type="button"
                  className={`${styles.priorityOption} ${
                    state.requestedPriority === p.value ? styles.priorityOptionActive : ""
                  }`}
                  onClick={() => dispatch({ type: "SET_FIELD", field: "requestedPriority", value: p.value })}
                  onBlur={handleBlur("requestedPriority")}
                  role="radio"
                  aria-checked={state.requestedPriority === p.value}
                >
                  {p.label}
                  <Badge variant="priority" value={p.value} />
                </Button>
              ))}
            </div>
            {state.errors.requestedPriority && (
              <div className="field-error" style={{ fontSize: 13, color: "var(--color-error)" }} role="alert">
                ⚠ {state.errors.requestedPriority}
              </div>
            )}
          </div>

          {/* ─── §7.5: Summary ─── */}
          <Field
            type="input"
            label="Summary"
            required
            id="summary"
            maxLength={120}
            state={getFieldState("summary")}
            errorMessage={state.errors.summary}
            value={state.summary}
            onChange={handleFieldChange("summary")}
            onBlur={handleBlur("summary")}
            placeholder="Brief description of your issue"
          />

          {/* ─── §7.6: Description ─── */}
          <Field
            type="textarea"
            label="Description"
            required
            id="description"
            maxLength={2000}
            rows={6}
            state={getFieldState("description")}
            errorMessage={state.errors.description}
            value={state.description}
            onChange={handleFieldChange("description")}
            onBlur={handleBlur("description")}
            placeholder="Please describe your issue in detail (minimum 20 characters)"
          />

          {/* ─── §7.7: Attachments ─── */}
          <div>
            <span className={styles.sectionLabel}>Attachments (optional)</span>
            <AttachmentPicker
              files={state.pendingFiles}
              onFilesChange={(files) =>
                dispatch({ type: "SET_PENDING_FILES", files })
              }
              maxFiles={5}
            />
          </div>

          {/* ─── §7.8: Actions ─── */}
          <div className={styles.actions}>
            <Button variant="secondary" onClick={handleCancel} type="button">
              Cancel
            </Button>
            <Button
              variant={state.submissionStatus === "submitting" ? "busy" : "primary"}
              type="submit"
              disabled={state.submissionStatus === "submitting"}
            >
              Submit Ticket
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
