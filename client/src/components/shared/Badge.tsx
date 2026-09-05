import styles from "./Badge.module.css";

type Priority = "LOW" | "MEDIUM" | "HIGH";
type Status = "NEW";

// Extensible: add new status values here as Lab 3/4 introduces them.
// Each entry maps a status string to its CSS module class.
const STATUS_STYLES: Record<string, string> = {
  NEW: styles.statusNew,
};

const PRIORITY_STYLES: Record<Priority, string> = {
  LOW: styles.priorityLow,
  MEDIUM: styles.priorityMedium,
  HIGH: styles.priorityHigh,
};

interface BadgeProps {
  /** Which badge family to render. */
  variant: "priority" | "status";
  /** The value to display. Must be a known value for the variant. */
  value: string;
}

/**
 * Renders a colored badge with a text label.
 *
 * §1 accessibility rule: every badge carries visible text alongside
 * color — color alone is never used to convey meaning.
 *
 * §8 badge colors:
 *   Priority — Low (gray-green pale), Medium (amber), High (red-tinted)
 *   Status   — New (pale-green bg, secondary-green text)
 */
export default function Badge({ variant, value }: BadgeProps) {
  let cssClass: string;
  let label: string;

  if (variant === "priority") {
    cssClass = PRIORITY_STYLES[value as Priority] ?? "";
    // Display label: "Low", "Medium", "High" — always visible (§1)
    label = value.charAt(0) + value.slice(1).toLowerCase();
  } else {
    // variant === "status"
    cssClass = STATUS_STYLES[value] ?? "";
    label = value.charAt(0) + value.slice(1).toLowerCase();
  }

  return (
    <span className={`${styles.badge} ${cssClass}`} role="status">
      {label}
    </span>
  );
}
