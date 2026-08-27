import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import styles from "./Field.module.css";

type FieldState = "default" | "focused" | "invalid" | "readonly" | "disabled";
type FieldType = "input" | "textarea";

// ---- Props ----

interface FieldBaseProps {
  /** Visual state per §3. */
  state?: FieldState;
  /** Label text — always rendered above the control (§10). */
  label: string;
  /** Show red asterisk after label (§3). Does NOT substitute for validation message. */
  required?: boolean;
  /** Render <textarea> instead of <input>. */
  type?: FieldType;
  /** Validation error message — shown directly below the field (§3). */
  errorMessage?: string;
  /** Max character count. When set, a live counter "n/max" is displayed. */
  maxLength?: number;
  /** Current value (controlled component). */
  value?: string;
  /** Textarea rows (default 4). */
  rows?: number;
}

// Split input vs textarea attributes for proper typing.
type InputOnlyProps = InputHTMLAttributes<HTMLInputElement>;
type TextareaOnlyProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export type FieldProps = FieldBaseProps &
  Omit<InputOnlyProps & TextareaOnlyProps, keyof FieldBaseProps>;

// ---- Component ----

/**
 * Unified Field component — §3 (Field States) + §10 (Shared Rules).
 *
 * Single component, five visual states via `state` prop:
 *   default  → white bg, editable border, 6px radius
 *   focused  → secondary-green border, 2px focus ring
 *   invalid  → error border + message below field
 *   readonly → warm ivory bg, muted text, not tabbable
 *   disabled → disabled bg/text, cursor not-allowed
 *
 * §10 rules enforced:
 *   - Label always above control, 600 weight, 13–14px
 *   - Consistent 40px height for inputs
 *   - Required asterisk is red (*), never replaces validation message
 *   - Validation message always below the field, never form-level only
 */
export default function Field({
  state = "default",
  label,
  required = false,
  type = "input",
  errorMessage,
  maxLength,
  value,
  rows = 4,
  name,
  id: idProp,
  placeholder,
  onChange,
  ...rest
}: FieldProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const errorId = `${id}-error`;
  const counterId = `${id}-counter`;

  const isReadonly = state === "readonly";
  const isDisabled = state === "disabled";
  // §3: errorMessage presence automatically implies invalid state,
  // so callers never need to remember to set state="invalid" alongside errorMessage.
  const isInvalid = state === "invalid" || Boolean(errorMessage);

  // §3: read-only is not tabbable
  const tabIndex = isReadonly ? -1 : undefined;

  // §3: aria-disabled for disabled state
  const ariaDisabled = isDisabled ? true : undefined;

  // §3: aria-invalid for invalid state
  const ariaInvalid = isInvalid ? true : undefined;

  // §3: describedby links to error message when invalid
  const ariaDescribedBy = isInvalid && errorMessage ? errorId : undefined;

  // Character counter
  const currentLength = typeof value === "string" ? value.length : 0;
  const showCounter = maxLength != null;

  // Build CSS class list
  // When errorMessage implies invalid, override the visual state class
  const visualState = isInvalid ? "invalid" : state;

  const fieldClasses = [
    styles.field,
    styles[visualState],
    type === "textarea" ? styles.textarea : styles.input,
  ]
    .filter(Boolean)
    .join(" ");

  const inputClasses = [
    styles.control,
    styles[`${visualState}Control`],
    type === "textarea" ? styles.textareaControl : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Shared input props
  const sharedProps = {
    id,
    name: name ?? id,
    value,
    placeholder,
    onChange,
    disabled: isDisabled,
    readOnly: isReadonly || undefined,
    tabIndex,
    "aria-disabled": ariaDisabled,
    "aria-invalid": ariaInvalid,
    "aria-describedby": ariaDescribedBy,
    "aria-required": required || undefined,
    maxLength: maxLength ?? undefined,
  };

  return (
    <div className={fieldClasses}>
      {/* §10: label always above control, weight 600, 13–14px */}
      <label htmlFor={id} className={styles.label}>
        {label}
        {required && (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        )}
      </label>

      {/* §3: validation message placed directly beneath field */}
      {isInvalid && errorMessage && (
        <div id={errorId} className={styles.errorMessage} role="alert">
          {errorMessage}
        </div>
      )}

      {type === "textarea" ? (
        <textarea
          className={inputClasses}
          rows={rows}
          style={{ resize: "vertical" }} /* §7: vertically resizable only */
          {...sharedProps}
          {...rest}
        />
      ) : (
        <input
          className={inputClasses}
          type="text"
          {...sharedProps}
          {...rest}
        />
      )}

      {/* §7: live character counter "n/max" */}
      {showCounter && (
        <span id={counterId} className={styles.counter}>
          {currentLength}/{maxLength}
        </span>
      )}
    </div>
  );
}
