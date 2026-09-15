/**
 * ConfirmDialog — a two-option confirmation built on Dialog (ui-spec.md §7).
 *
 * Used for the "Set New Initial Password" sub-action, whose copy is mandated by
 * the spec ("This resets {name}'s password. They will need to set a new one at
 * next login. Continue?"). The Continue/Cancel pair and the busy handling match
 * StatusChangeConfirm's, so the confirmation step feels the same everywhere.
 */

import Button from "./Button";
import Dialog from "./Dialog";
import styles from "./Dialog.module.css";

interface ConfirmDialogProps {
  title: string;
  /** The body copy explaining exactly what will happen. */
  copy: string;
  /** Label for the affirmative action, e.g. "Reset password". */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** True while the request is in flight. */
  busy?: boolean;
  /** Safe server-side error from the failed request. */
  error?: string | null;
  /** Text shown on the affirmative button while busy. */
  busyLabel?: string;
  testId?: string;
}

export default function ConfirmDialog({
  title,
  copy,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
  error,
  busyLabel = "Working…",
  testId,
}: ConfirmDialogProps) {
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      error={error}
      busy={busy}
      testId={testId}
      actions={
        <>
          <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={busy ? "busy" : "primary"}
            busyLabel={busyLabel}
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className={styles.copy}>{copy}</p>
    </Dialog>
  );
}
