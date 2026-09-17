/**
 * Dialog — the application's single modal primitive (ui-spec.md §7, §9).
 *
 * Every confirmation in the app is built on this component (ConfirmDialog) or
 * renders through it directly (StatusChangeConfirm, ResolveMarkConfirm,
 * RemoveAttachmentConfirm, the Administrator Create/Edit User modals), so there
 * is exactly one overlay tint, one surface treatment, and one set of modal
 * keyboard behaviours in the product.
 *
 * Behaviour (§7 states, §9 accessibility):
 *   - Escape closes the dialog, unless a request is in flight (`busy`).
 *   - Clicking the overlay closes it, under the same rule.
 *   - `role="dialog" aria-modal="true"` + `aria-labelledby` on the title.
 *   - Focus moves into the dialog on open (first focusable control) and returns
 *     to whatever was focused before it opened, on close.
 *   - Tab / Shift+Tab stay inside the dialog while it is open (focus trap).
 *   - When dialogs are stacked (the reset-password confirmation opens on top of
 *     the Edit User modal) only the top-most dialog traps focus and answers
 *     Escape, so the two never fight over the keyboard.
 *   - A safe server error renders as an in-dialog banner (§6), never as an
 *     alert() and never with internal detail.
 */

import { useEffect, useId, useRef, type ReactNode } from "react";
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

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Open-dialog stack, in mount order. Only the last entry is "on top" and
 * therefore allowed to handle Escape / Tab — the same rule a native modal
 * layer would apply.
 */
const openDialogs: symbol[] = [];

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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const stackIdRef = useRef<symbol>(Symbol("dialog"));

  // ─── Focus management (§9) ────────────────────────────────────────────
  useEffect(() => {
    const stackId = stackIdRef.current;
    const node = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    openDialogs.push(stackId);

    // Move focus into the dialog so keyboard users are never left behind on the
    // page underneath. Prefer the first focusable control; fall back to the
    // dialog container itself (which then also receives the focus ring).
    const firstFocusable = node?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? node)?.focus();

    return () => {
      const index = openDialogs.lastIndexOf(stackId);
      if (index !== -1) openDialogs.splice(index, 1);

      // Return focus to the trigger so tabbing continues from where the user
      // left off (e.g. back into the Edit User modal that opened this one).
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, []);

  // ─── Escape + focus trap (§9) ─────────────────────────────────────────
  useEffect(() => {
    function isTopMostDialog() {
      return openDialogs[openDialogs.length - 1] === stackIdRef.current;
    }

    function focusableElements(): HTMLElement[] {
      if (!dialogRef.current) return [];
      return Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    }

    function handleKeyDown(event: KeyboardEvent) {
      // A stacked dialog on top owns the keyboard while it is open.
      if (!isTopMostDialog()) return;

      if (event.key === "Escape") {
        if (!busy) onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = focusableElements();
      if (focusable.length === 0) {
        // Nothing focusable: keep focus on the dialog container.
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
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
        ref={dialogRef}
        className={wide ? `${styles.dialog} ${styles.dialogWide}` : styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        tabIndex={-1}
      >
        {/* h2, not h3: every screen that opens a dialog already has a single
            <h1>, so the dialog title is the next level down. An h3 here made
            axe's heading-order rule (and screen-reader outline) report a
            skipped level (§9). The Administrator Edit modal's own sub-section
            is an h3 for the same reason. */}
        <h2 className={styles.title} id={titleId}>
          {title}
        </h2>

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
