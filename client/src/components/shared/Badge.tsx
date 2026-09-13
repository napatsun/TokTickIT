import styles from "./Badge.module.css";

// Extensible: add new status values here as later labs introduce them.
// Each entry maps a status string to its CSS module class and display label.
// Lab 3 added the full TicketStatus set (ui-spec.md §4/§6).
const STATUS_STYLES: Record<string, string> = {
  NEW: styles.statusNew,
  OPEN: styles.statusOpen,
  IN_PROGRESS: styles.statusInProgress,
  WAITING_FOR_REQUESTER: styles.statusWaiting,
  RESOLVED: styles.statusResolved,
  CLOSED: styles.statusClosed,
  REOPENED: styles.statusReopened,
  CANCELLED: styles.statusCancelled,
};

const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  WAITING_FOR_REQUESTER: "Waiting for Requester",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
  CANCELLED: "Cancelled",
};

// IT Priority adds URGENT (BR-14) on top of the Requester scale.
const PRIORITY_STYLES: Record<string, string> = {
  LOW: styles.priorityLow,
  MEDIUM: styles.priorityMedium,
  HIGH: styles.priorityHigh,
  URGENT: styles.priorityUrgent,
};

const PRIORITY_LABELS: Record<string, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

interface BadgeProps {
  /** Which badge family to render. */
  variant: "priority" | "status";
  /** The value to display. Unknown values fall back to a readable label. */
  value: string;
}

/** "WAITING_FOR_REQUESTER" → "Waiting For Requester" for unmapped values. */
function humanize(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Renders a colored badge with a text label.
 *
 * §1 accessibility rule: every badge carries visible text alongside
 * color — color alone is never used to convey meaning.
 *
 * §8 badge colors:
 *   Priority — Low (gray-green pale), Medium (amber), High/Urgent (red-tinted)
 *   Status   — New/Open (pale-green), In Progress/Waiting (amber),
 *              Resolved/Closed (success green), Reopened (amber),
 *              Cancelled (neutral gray)
 */
export default function Badge({ variant, value }: BadgeProps) {
  const isPriority = variant === "priority";
  const cssClass = (isPriority ? PRIORITY_STYLES[value] : STATUS_STYLES[value]) ?? "";
  const label =
    (isPriority ? PRIORITY_LABELS[value] : STATUS_LABELS[value]) ?? humanize(value);

  return (
    <span className={`${styles.badge} ${cssClass}`} role="status">
      {label}
    </span>
  );
}
