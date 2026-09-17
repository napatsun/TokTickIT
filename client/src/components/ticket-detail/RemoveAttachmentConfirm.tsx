/**
 * RemoveAttachmentConfirm — §9 Remove flow
 *
 * Inline confirm dialog requiring a removal reason (textarea, 3–200 chars)
 * before the destructive "Confirm Removal" button becomes enabled.
 * Cancel closes without changes.
 *
 * BR-34: removalReason required, trimmed, 3–200 chars
 * BR-36: explicit confirmation step before delete request
 *
 * Rendered through the shared Dialog primitive (ui-spec.md §7) so this Lab 2
 * confirmation uses the same overlay tint, surface, width cap, scroll
 * behaviour, and keyboard contract (focus trap, Escape to cancel, focus
 * returned on close — §9) as every Lab 3 confirmation. Only the body differs,
 * because this one collects a reason.
 */

import { useState, useCallback } from "react";
import Button from "../shared/Button";
import Dialog from "../shared/Dialog";
import styles from "./RemoveAttachmentConfirm.module.css";

const MIN_REASON_LENGTH = 3;
const MAX_REASON_LENGTH = 200;

interface RemoveAttachmentConfirmProps {
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  /** Server-side error from failed DELETE request */
  error?: string | null;
}

export default function RemoveAttachmentConfirm({
  onConfirm,
  onCancel,
  error,
}: RemoveAttachmentConfirmProps) {
  const [reason, setReason] = useState("");
  const trimmedReason = reason.trim();
  const isValid =
    trimmedReason.length >= MIN_REASON_LENGTH &&
    trimmedReason.length <= MAX_REASON_LENGTH;

  const tooShort = reason.length > 0 && trimmedReason.length < MIN_REASON_LENGTH;

  const handleSubmit = useCallback(() => {
    if (isValid) onConfirm(trimmedReason);
  }, [isValid, trimmedReason, onConfirm]);

  return (
    <Dialog
      title="Remove Attachment"
      onClose={onCancel}
      error={error}
      testId="remove-attachment-dialog"
      actions={
        <>
          <Button variant="secondary" type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive-confirm"
            type="button"
            onClick={handleSubmit}
            disabled={!isValid}
          >
            Confirm Removal
          </Button>
        </>
      }
    >
      <div className={styles.fieldGroup}>
        <label htmlFor="removal-reason" className={styles.label}>
          Removal reason <span className={styles.required}>*</span>
        </label>
        {/* §9: the counter and the inline error are both associated with the
            textarea so a screen reader hears them in context. */}
        <textarea
          id="removal-reason"
          className={styles.textarea}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Enter reason for removal (3–200 characters)"
          rows={3}
          maxLength={MAX_REASON_LENGTH}
          aria-invalid={tooShort || undefined}
          aria-describedby={
            tooShort ? "removal-reason-error removal-reason-count" : "removal-reason-count"
          }
        />
        <span className={styles.charCount} id="removal-reason-count">
          {trimmedReason.length}/{MAX_REASON_LENGTH}
        </span>
        {tooShort && (
          <p className={styles.errorText} id="removal-reason-error" role="alert">
            Removal reason must be at least {MIN_REASON_LENGTH} characters.
          </p>
        )}
      </div>
    </Dialog>
  );
}
