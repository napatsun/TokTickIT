/**
 * RemoveAttachmentConfirm — §9 Remove flow
 *
 * Inline confirm dialog requiring a removal reason (textarea, 3–200 chars)
 * before the destructive "Confirm Removal" button becomes enabled.
 * Cancel closes without changes.
 *
 * BR-34: removalReason required, trimmed, 3–200 chars
 * BR-36: explicit confirmation step before delete request
 */

import { useState, useCallback } from "react";
import Button from "../shared/Button";
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

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (isValid) {
        onConfirm(trimmedReason);
      }
    },
    [isValid, trimmedReason, onConfirm],
  );

  return (
    <div className={styles.overlay}>
      <form className={styles.dialog} onSubmit={handleSubmit}>
        <h3 className={styles.title}>Remove Attachment</h3>

        {error && (
          <div className={styles.errorBanner} role="alert">
            <p>{error}</p>
          </div>
        )}

        <div className={styles.fieldGroup}>
          <label htmlFor="removal-reason" className={styles.label}>
            Removal reason <span className={styles.required}>*</span>
          </label>
          <textarea
            id="removal-reason"
            className={styles.textarea}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Enter reason for removal (3–200 characters)"
            rows={3}
            maxLength={MAX_REASON_LENGTH}
          />
          <span className={styles.charCount}>
            {trimmedReason.length}/{MAX_REASON_LENGTH}
          </span>
          {reason.length > 0 && trimmedReason.length < MIN_REASON_LENGTH && (
            <p className={styles.errorText}>
              Removal reason must be at least {MIN_REASON_LENGTH} characters.
            </p>
          )}
        </div>

        <div className={styles.actions}>
          <Button variant="secondary" type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive-confirm"
            type="submit"
            disabled={!isValid}
          >
            Confirm Removal
          </Button>
        </div>
      </form>
    </div>
  );
}
