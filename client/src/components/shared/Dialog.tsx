/**
 * Dialog — the application's modal primitive (ui-spec.md §7).
 *
 * This is the same overlay/dialog pattern already used by ResolveMarkConfirm
 * and StatusChangeConfirm (same Zen Green tokens, same structure, same overlay
 * tint) — it exists so the Administrator Create/Edit User modals reuse that
 * pattern instead of inventing a second one. Those two components were left
 * untouched on purpose: they are small, already reviewed, and rewriting them to
 * route through this primitive would be churn with no behavioural gain.
 *
 * Behaviour (§7 states):
 *   - Escape closes the dialog, unless a request is in flight (`busy`).
 *   - Clicking the overlay closes it, under the same rule.
 *   - `role="dialog" aria-modal="true"` + `aria-labelledby` on the title.
 *   - A safe server error renders as an in-dialog banner (§6), never as an
 *     alert() and never with internal detail.
 */

import { useEffect, useId, type ReactNode } from "react";
import styles from "./Dialog.module.css";

interface DialogProps {
  /** Heading shown at the top of the dialog. */
  title: string;
  /** Called on Escape / overlay click / the caller's own Cancel action. */
  onClose: () => void;
  /** Form body. */
  children: ReactNode;
  /** Footer actions (typically Cancel + the primary action). */
  actions: ReactNode;
  /** Safe server-side error message, or null. */
  error?: string | null;
  /** True while a request is in flight: blocks dismissal to avoid a half-state. */
  busy?: boolean;
  /** Wider layout for two-column forms. */
  wide?: boolean;
  /** Hook for tests / responsive screenshots. */
  testId?: string;
}

export default function Dialog({
  title,
  onClose,
  children,
  actions,
  error,
  busy = false,
  wide = false,
  testId,
}: DialogProps) {
  const titleId = `${useId()}-dialog-title`;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  return (
    <div
      className={styles.overlay}
      // Only a click that starts AND ends on the overlay itself dismisses —
      // a drag that began inside the form must not close it.
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={wide ? `${styles.dialog} ${styles.dialogWide}` : styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
      >
        <h3 className={styles.title} id={titleId}>
          {title}
        </h3>

        {error && (
          <div className={styles.errorBanner} role="alert" data-testid={testId ? `${testId}-error` : undefined}>
            <p>{error}</p>
          </div>
        )}

        <div className={styles.body}>{children}</div>

        <div className={styles.actions}>{actions}</div>
      </div>
    </div>
  );
}
