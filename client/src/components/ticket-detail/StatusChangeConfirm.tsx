/**
 * StatusChangeConfirm — ui-spec.md §6.3 (IT Staff Ticket Detail)
 *
 * A confirmation step is required for the "terminal / irreversible-feeling"
 * transitions: Resolved, Closed, and Cancelled. Other permitted transitions
 * apply immediately.
 *
 * Reuses ResolveMarkConfirm's dialog styles so the two confirmations are
 * visually identical (Zen Green tokens, no second visual language), while this
 * component stays separate because its copy and lifecycle are staff-specific.
 */

import Button from "../shared/Button";
import styles from "./ResolveMarkConfirm.module.css";

/** Human-readable labels for the status enum (also used by the detail page). */
export const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  WAITING_FOR_REQUESTER: "Waiting for Requester",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
  CANCELLED: "Cancelled",
};

/** Per-target confirmation copy, shown for Resolved / Closed / Cancelled. */
export const STATUS_CONFIRM_COPY: Record<string, string> = {
  RESOLVED:
    "Marking this ticket as Resolved tells the Requester the problem is fixed. IT Staff can still reopen it later. Continue?",
  CLOSED:
    "Closing this ticket finalises it. It can only be reopened after that. Continue?",
  CANCELLED:
    "Cancelling this ticket stops all work on it. A cancelled ticket cannot be moved to any other status. Continue?",
};

interface StatusChangeConfirmProps {
  /** Current status, shown for context. */
  from: string;
  /** Target status being confirmed. */
  to: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** True while the PATCH is in flight. */
  busy?: boolean;
  /** Safe server-side error from the failed request. */
  error?: string | null;
}

export default function StatusChangeConfirm({
  from,
  to,
  onConfirm,
  onCancel,
  busy = false,
  error,
}: StatusChangeConfirmProps) {
  const toLabel = STATUS_LABELS[to] ?? to;

  return (
    <div className={styles.overlay}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="status-change-title"
        data-testid="status-confirm-dialog"
      >
        <h3 className={styles.title} id="status-change-title">
          Change status to {toLabel}
        </h3>

        {error && (
          <div className={styles.errorBanner} role="alert">
            <p>{error}</p>
          </div>
        )}

        <p className={styles.copy}>
          {STATUS_CONFIRM_COPY[to] ??
            `Move this ticket from ${STATUS_LABELS[from] ?? from} to ${toLabel}?`}
        </p>

        <div className={styles.actions}>
          <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={busy ? "busy" : "primary"}
            busyLabel="Updating…"
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
