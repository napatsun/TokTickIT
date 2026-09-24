/**
 * TicketWorkflowControls — ui-spec.md §5 (Ticket Status / Workflow Controls)
 *
 * The single status control shared by both Ticket Detail screens:
 *   * StaffTicketDetailPage  (IT Staff / Administrator, /staff/tickets/:id)
 *   * TicketDetailPage       (Requester, /tickets/:ticketNumber)
 *
 * It renders ONE button per transition the server says the current (role ×
 * current status) pair permits, per specification.md §5.1. Impermissible
 * transitions are simply absent from the DOM — the same defence-in-depth pattern
 * the Actions Taken panel uses for Requester write controls (§4.2) — because
 * hiding a control is never the authorization check itself (BR-15); the server
 * re-checks the whole matrix on every request.
 *
 * The single documented exception (§5): moving to Resolved when BR-09's
 * Actions-Taken precondition is unmet. The role and status DO permit it, so the
 * button is rendered but `disabled`, with an accessible explanation — IT Staff
 * must understand the option exists and what is blocking it.
 *
 * Concurrency (BR-12/FR-16): the badge is deliberately NOT updated
 * optimistically (§5 verbatim). On submit the button goes busy, the badge stays
 * put, and only a server-confirmed 200 advances it. A `409 STALE_VERSION` (or a
 * race-time `403`) triggers `onReload` + a non-blocking banner and discards the
 * intended transition, so the user re-submits against the fresh state rather
 * than silently overwriting or silently retrying.
 *
 * A Requester additionally sees "This looks resolved to me" — a separate,
 * visually secondary advisory button (FR-08/BR-08) that never changes status.
 */

import { useState } from "react";
import Badge from "../shared/Badge";
import Button from "../shared/Button";
import StatusChangeConfirm, { STATUS_LABELS } from "./StatusChangeConfirm";
import { apiClient } from "../../lib/apiClient";
import type { AuthUser } from "../../contexts/AuthContext";
import styles from "./TicketWorkflowControls.module.css";

// ─── Types ──────────────────────────────────────────────────────────────

/** The workflow slice of a Ticket the control both needs and reports back. */
export interface WorkflowTicketState {
  status: string;
  version: number;
  resolvedAt: string | null;
  requesterConfirmedResolved: boolean;
  requesterConfirmedResolvedAt: string | null;
  allowedStatusTransitions: string[];
}

interface TicketWorkflowControlsProps {
  /** Internal integer Ticket id — the `:ticketId` the §2 endpoints take. */
  ticketId: number;
  /** The caller, used to decide whether the advisory button applies. */
  currentUser: AuthUser;
  currentStatus: string;
  version: number;
  resolvedAt: string | null;
  /** Role-aware, window-filtered permitted targets from the server (§5.1). */
  allowedTransitions: string[];
  /** BR-09's live precondition — false disables only the Resolved button. */
  hasActionsWithResult: boolean;
  requesterConfirmedResolved: boolean;
  requesterConfirmedResolvedAt: string | null;
  /**
   * Render the current-status badge inside the control. Default true; the
   * Requester page already shows it in its read-only header grid, so it passes
   * false there to avoid a duplicate badge.
   */
  showStatusBadge?: boolean;
  /** Merge the server-confirmed workflow state back into the page. */
  onTicketUpdated: (state: WorkflowTicketState) => void;
  /** Re-fetch the whole Ticket (409/403 reconciliation). */
  onReload: () => void | Promise<void>;
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** §6.3 parity: these targets confirm first; every other transition applies immediately. */
const CONFIRMATION_REQUIRED = ["RESOLVED", "CLOSED", "CANCELLED"];

const RESOLVE_BLOCKED_NOTE = "Add at least one Actions Taken with a result before resolving.";

function isStaff(role: AuthUser["role"]): boolean {
  return role === "IT_STAFF" || role === "ADMINISTRATOR";
}

function newIdempotencyKey(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

// ─── Component ──────────────────────────────────────────────────────────

export default function TicketWorkflowControls({
  ticketId,
  currentUser,
  currentStatus,
  version,
  resolvedAt,
  allowedTransitions,
  hasActionsWithResult,
  requesterConfirmedResolved,
  requesterConfirmedResolvedAt,
  showStatusBadge = true,
  onTicketUpdated,
  onReload,
}: TicketWorkflowControlsProps) {
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const isRequester = !isStaff(currentUser.role);
  const resolveBlocked = allowedTransitions.includes("RESOLVED") && !hasActionsWithResult;

  // ─── Status transition ────────────────────────────────────────────────
  async function applyTransition(target: string) {
    setBusyTarget(target);
    setError(null);
    setSuccess(null);
    setBanner(null);
    setConfirmTarget(null);

    try {
      const response = await apiClient(`/api/tickets/${ticketId}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": newIdempotencyKey(),
        },
        body: JSON.stringify({ targetStatus: target, version }),
      });

      if (response.ok) {
        const data = (await response.json()) as { ticket: WorkflowTicketState };
        // §5: the badge advances only now, from the server-confirmed state.
        onTicketUpdated({
          status: data.ticket.status,
          version: data.ticket.version,
          resolvedAt: data.ticket.resolvedAt,
          requesterConfirmedResolved: data.ticket.requesterConfirmedResolved,
          requesterConfirmedResolvedAt: data.ticket.requesterConfirmedResolvedAt,
          allowedStatusTransitions: data.ticket.allowedStatusTransitions,
        });
        setSuccess(`Status updated to ${STATUS_LABELS[data.ticket.status] ?? data.ticket.status}.`);
        return;
      }

      const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
      const code = body.error?.code;

      if (code === "STALE_VERSION") {
        // Reload the authoritative state; discard the intent (no silent retry).
        await onReload();
        setBanner("This Ticket was updated by someone else — refreshed to the latest version.");
        return;
      }
      if (response.status === 403) {
        // Role/timing changed since the screen rendered — a race, not a
        // validation problem on the submitted fields (§5).
        await onReload();
        setBanner(
          "This action is no longer available — the page has been refreshed to reflect the Ticket's current state.",
        );
        return;
      }

      setError(
        code === "ACTIONS_REQUIRED"
          ? RESOLVE_BLOCKED_NOTE
          : body.error?.message ?? "Couldn't change the status. Please try again.",
      );
    } catch {
      setError("Couldn't change the status. Please check your connection and try again.");
    } finally {
      setBusyTarget(null);
      setConfirmBusy(false);
    }
  }

  function requestTransition(target: string) {
    setError(null);
    setSuccess(null);
    setBanner(null);
    if (CONFIRMATION_REQUIRED.includes(target)) {
      setConfirmTarget(target);
      return;
    }
    void applyTransition(target);
  }

  // ─── Requester advisory confirmation (FR-08 / BR-08) ──────────────────
  async function submitRequesterConfirmation() {
    setConfirming(true);
    setError(null);
    setSuccess(null);
    setBanner(null);

    try {
      const response = await apiClient(`/api/tickets/${ticketId}/requester-confirmation`, {
        method: "POST",
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
        setError(body.error?.message ?? "Couldn't record your confirmation. Please try again.");
        return;
      }

      const data = (await response.json()) as {
        requesterConfirmedResolved: boolean;
        requesterConfirmedResolvedAt: string | null;
      };
      // BR-08: status is untouched by construction.
      onTicketUpdated({
        status: currentStatus,
        version,
        resolvedAt,
        requesterConfirmedResolved: data.requesterConfirmedResolved,
        requesterConfirmedResolvedAt: data.requesterConfirmedResolvedAt,
        allowedStatusTransitions: allowedTransitions,
      });
      setSuccess("Thanks — your IT Staff will review this.");
    } catch {
      setError("Couldn't record your confirmation. Please check your connection and try again.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className={styles.controls} data-testid="workflow-controls">
      {showStatusBadge && (
        <div className={styles.statusRow}>
          <span className={styles.statusLabel}>Current Status</span>
          <Badge variant="status" value={currentStatus} />
        </div>
      )}

      {/* §5: non-blocking reconciliation banner (STALE_VERSION / 403 race). */}
      {banner && (
        <div className={styles.banner} role="status" data-testid="workflow-banner">
          {banner}
        </div>
      )}

      {/* §5: the transition affordances — only what the server permits. */}
      {allowedTransitions.length === 0 ? (
        <p className={styles.muted} data-testid="workflow-no-transitions">
          No status changes are available for this ticket right now.
        </p>
      ) : (
        <div className={styles.buttonGroup} role="group" aria-label="Available status changes">
          {allowedTransitions.map((target) => {
            const blocked = target === "RESOLVED" && !hasActionsWithResult;
            const disabled = blocked || busyTarget !== null;
            const label = STATUS_LABELS[target] ?? target;
            return (
              <Button
                key={target}
                variant="secondary"
                disabled={disabled}
                aria-disabled={disabled || undefined}
                title={blocked ? RESOLVE_BLOCKED_NOTE : undefined}
                aria-describedby={blocked ? "workflow-resolve-blocked" : undefined}
                data-testid={`workflow-transition-${target}`}
                onClick={() => requestTransition(target)}
              >
                {busyTarget === target ? `Updating…` : `Move to ${label}`}
              </Button>
            );
          })}
        </div>
      )}

      {resolveBlocked && (
        <p className={styles.note} id="workflow-resolve-blocked" data-testid="workflow-resolve-blocked-note">
          {RESOLVE_BLOCKED_NOTE}
        </p>
      )}

      {error && (
        <div className={styles.error} role="alert" data-testid="workflow-error">
          {error}
        </div>
      )}
      {success && (
        <p className={styles.success} role="status" data-testid="workflow-success">
          {success}
        </p>
      )}

      {/* §5: the Requester's advisory acknowledgement — separate and secondary,
          never styled like the authoritative status control. */}
      {isRequester && (
        <div className={styles.requesterConfirm} data-testid="requester-confirmation">
          {requesterConfirmedResolved ? (
            <p className={styles.muted} data-testid="requester-confirmation-done">
              You told IT Staff this looks resolved
              {requesterConfirmedResolvedAt
                ? ` on ${formatDate(requesterConfirmedResolvedAt)}`
                : ""}
              . Your IT Staff will review and confirm.
            </p>
          ) : (
            <>
              <Button
                variant="tertiary"
                disabled={confirming}
                data-testid="requester-confirmation-button"
                onClick={() => void submitRequesterConfirmation()}
              >
                {confirming ? "Sending…" : "This looks resolved to me"}
              </Button>
              <p className={styles.helper} data-testid="requester-confirmation-helper">
                Your IT Staff will review and confirm.
              </p>
            </>
          )}
        </div>
      )}

      {/* Confirmation step for Resolved / Closed / Cancelled (§6.3 parity). */}
      {confirmTarget && (
        <StatusChangeConfirm
          from={currentStatus}
          to={confirmTarget}
          busy={confirmBusy}
          error={error}
          onConfirm={() => {
            setConfirmBusy(true);
            void applyTransition(confirmTarget);
          }}
          onCancel={() => {
            setConfirmTarget(null);
            setError(null);
          }}
        />
      )}
    </div>
  );
}
