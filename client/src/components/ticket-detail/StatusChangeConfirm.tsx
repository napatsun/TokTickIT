/**
 * StatusChangeConfirm — ui-spec.md §6.3 (IT Staff Ticket Detail)
 *
 * A confirmation step is required for the "terminal / irreversible-feeling"
 * transitions: Resolved, Closed, and Cancelled. Other permitted transitions
 * apply immediately.
 *
 * Rendered through the shared ConfirmDialog/Dialog primitive (ui-spec.md §7) so
 * every confirmation in the app shares one overlay, one surface treatment, and
 * one set of modal keyboard behaviours (focus in on open, Tab trapped, Escape
 * to cancel, focus returned on close — §9).
 */

import ConfirmDialog from "../shared/ConfirmDialog";

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
  const toLabel = STATUS_LABELS[to];

  return (
    <ConfirmDialog
      title={`Change status to ${toLabel}`}
      copy={
        STATUS_CONFIRM_COPY[to] ??
        `Move this ticket from ${STATUS_LABELS[from] ?? from} to ${toLabel}?`
      }
      confirmLabel="Continue"
      busyLabel="Updating…"
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
      testId="status-confirm-dialog"
    />
  );
}
