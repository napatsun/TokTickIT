/**
 * ResolveMarkConfirm — ui-spec.md §4 "Problem Appears Resolved"
 *
 * Confirmation step before POSTing the resolve-mark. The copy is fixed by the
 * UI spec so the Requester understands this does not formally close the ticket
 * (BR-05/BR-20).
 *
 * Rendered through the shared ConfirmDialog/Dialog primitive (ui-spec.md §7) so
 * this confirmation is pixel-identical to StatusChangeConfirm and the
 * Administrator confirmations, and inherits the same keyboard behaviour: focus
 * moves into the dialog on open, Tab is trapped, Escape cancels, and focus
 * returns to the trigger on close (§9).
 */

import ConfirmDialog from "../shared/ConfirmDialog";

export const RESOLVE_MARK_CONFIRM_COPY =
  "This tells IT Staff the issue seems fixed. IT Staff will still need to formally close the ticket. Continue?";

interface ResolveMarkConfirmProps {
  onConfirm: () => void;
  onCancel: () => void;
  /** True while the POST is in flight. */
  busy?: boolean;
  /** Server-side error from the failed request. */
  error?: string | null;
}

export default function ResolveMarkConfirm({
  onConfirm,
  onCancel,
  busy = false,
  error,
}: ResolveMarkConfirmProps) {
  return (
    <ConfirmDialog
      title="Problem Appears Resolved"
      copy={RESOLVE_MARK_CONFIRM_COPY}
      confirmLabel="Continue"
      busyLabel="Sending…"
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
