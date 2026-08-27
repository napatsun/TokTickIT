import { type ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

type ButtonVariant =
  | "primary"
  | "secondary"
  | "tertiary"
  | "destructive"
  | "destructive-confirm"
  | "busy";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant per §4. */
  variant: ButtonVariant;
  /**
   * Text shown during busy state (preceded by spinner).
   * Defaults to "Submitting…" if not provided.
   */
  busyLabel?: string;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: styles.primary,
  secondary: styles.secondary,
  tertiary: styles.tertiary,
  destructive: styles.destructive,
  "destructive-confirm": styles.destructiveConfirm,
  busy: styles.busy,
};

/**
 * Zen Green button component.
 *
 * §4 — Button hierarchy: primary / secondary / tertiary / destructive /
 *      destructive-confirm / busy.
 * §10 — Shared rules: 40px height, 2px focus ring (secondary-green),
 *       icons never replace required text, icon-only buttons carry
 *       aria-label + title.
 * §1  — Non-color redundancy: disabled uses cursor + aria-disabled,
 *       not color alone.
 */
export default function Button({
  variant,
  busyLabel = "Submitting…",
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || variant === "busy";
  const isBusy = variant === "busy";

  // When disabled or busy, override the variant class with disabled styling.
  // The variant class is still applied for structure, but .disabled overrides colors.
  const cssClass = [
    styles.button,
    isDisabled ? styles.disabled : VARIANT_CLASSES[variant],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      className={cssClass}
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      type={rest.type ?? "button"}
      {...rest}
    >
      {isBusy && (
        <span
          className={`spinner-border spinner-border-sm ${styles.spinner}`}
          role="status"
          aria-hidden="true"
        />
      )}
      {isBusy ? busyLabel : children}
    </button>
  );
}
