/**
 * ResolveMarkConfirm — ui-spec.md §4 "Problem Appears Resolved"
 *
 * Confirmation step before POSTing the resolve-mark. The copy is fixed by the
 * UI spec so the Requester understands this does not formally close the ticket
 * (BR-05/BR-20).
 *
 * Same inline-dialog pattern as RemoveAttachmentConfirm (Zen Green tokens).
 */

import Button from "../shared/Button";
import styles from "./ResolveMarkConfirm.module.css";

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
    <div className={styles.overlay}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="resolve-mark-title">
        <h3 className={styles.title} id="resolve-mark-title">
          Problem Appears Resolved
        </h3>

        {error && (
          <div className={styles.errorBanner} role="alert">
            <p>{error}</p>
          </div>
        )}

        <p className={styles.copy}>{RESOLVE_MARK_CONFIRM_COPY}</p>

        <div className={styles.actions}>
          <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={busy ? "busy" : "primary"}
            busyLabel="Sending…"
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
