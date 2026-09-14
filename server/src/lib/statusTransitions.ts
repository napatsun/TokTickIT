/**
 * Ticket status transition matrix — BR-19 / FR-21
 *
 * This is the server-side source of truth for "which status changes are
 * allowed". It mirrors ui-spec.md §6.1 cell-for-cell; every blank cell in that
 * table is an absent entry here and is rejected with 409 INVALID_TRANSITION.
 *
 * The same table is projected to the client through `allowedStatusTransitions`,
 * which the IT Staff Ticket Detail screen uses to render ONLY the permitted
 * next states. The UI therefore cannot offer a transition the server would
 * reject, and the server never trusts the UI in return (FR-09).
 *
 * Note: NEW is reachable only as a creation default — it never appears as a
 * transition target (§6.1 has no "New" column).
 */

export const TICKET_STATUSES = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_REQUESTER",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "CANCELLED",
] as const;

export type TicketStatusValue = (typeof TICKET_STATUSES)[number];

/**
 * From ↓ / To →  (ui-spec.md §6.1)
 *
 *   NEW                   → OPEN, IN_PROGRESS, CANCELLED
 *   OPEN                  → IN_PROGRESS, WAITING_FOR_REQUESTER, CANCELLED
 *   IN_PROGRESS           → WAITING_FOR_REQUESTER, RESOLVED, CANCELLED
 *   WAITING_FOR_REQUESTER → IN_PROGRESS, RESOLVED, CANCELLED
 *   RESOLVED              → CLOSED, REOPENED
 *   CLOSED                → REOPENED
 *   REOPENED              → IN_PROGRESS, WAITING_FOR_REQUESTER, CANCELLED
 *   CANCELLED             → (terminal: no outgoing transitions)
 */
export const STATUS_TRANSITIONS: Record<TicketStatusValue, readonly TicketStatusValue[]> = {
  NEW: ["OPEN", "IN_PROGRESS", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "REOPENED"],
  CLOSED: ["REOPENED"],
  REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "CANCELLED"],
  CANCELLED: [],
};

/** True when `to` is a permitted next state from `from`. */
export function isTransitionAllowed(from: string, to: string): boolean {
  const allowed = STATUS_TRANSITIONS[from as TicketStatusValue];
  return Array.isArray(allowed) && allowed.includes(to as TicketStatusValue);
}

/**
 * The permitted next states from `from`, in matrix order.
 * Returns an empty array for an unknown/terminal status so callers can always
 * render safely without a null check.
 */
export function allowedStatusTransitions(from: string): TicketStatusValue[] {
  return [...(STATUS_TRANSITIONS[from as TicketStatusValue] ?? [])];
}

/** True when the string is a member of the TicketStatus enum (400/422 guard). */
export function isTicketStatus(value: unknown): value is TicketStatusValue {
  return typeof value === "string" && (TICKET_STATUSES as readonly string[]).includes(value);
}

/**
 * Statuses that require an explicit confirmation dialog in the UI
 * (ui-spec.md §6.3: "terminal/irreversible-feeling" transitions).
 * Exposed server-side only as documentation of the shared contract; the client
 * owns the dialog copy.
 */
export const CONFIRMATION_REQUIRED_STATUSES: readonly TicketStatusValue[] = [
  "RESOLVED",
  "CLOSED",
  "CANCELLED",
];
