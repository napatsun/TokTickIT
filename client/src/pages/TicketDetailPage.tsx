/**
 * TicketDetailPage — §9 Requester Ticket Screen (View Mode)
 *
 * Fetches ticket detail from GET /api/tickets/:ticketNumber and renders:
 *   - Back link to My Tickets
 *   - Header block (read-only grid)
 *   - Summary / Description
 *   - Resolution Summary
 *   - AttachmentSection (active + removed attachments, add/download/remove)
 *
 * Desktop ≥992px: two-region layout (header + attachments)
 * States: loading skeleton, not-found, happy path
 */

import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Field from "../components/shared/Field";
import Badge from "../components/shared/Badge";
import Button from "../components/shared/Button";
import AttachmentSection from "../components/ticket-detail/AttachmentSection";
import PublicCommentsPanel from "../components/ticket-detail/PublicCommentsPanel";
import ActionsTakenPanel from "../components/ticket-detail/ActionsTakenPanel";
import { AuthContext } from "../contexts/AuthContext";
import { useContext } from "react";
import ResolveMarkConfirm from "../components/ticket-detail/ResolveMarkConfirm";
import { apiClient } from "../lib/apiClient";
import styles from "./TicketDetailPage.module.css";

// ─── Types ──────────────────────────────────────────────────────────────

interface TicketData {
  id: number;
  ticketNumber: string;
  ticketDate: string;
  requester: { id: number; fullName: string };
  category: { id: number; name: string };
  relatedSystem: { id: number; name: string };
  summary: string;
  description: string;
  requestedPriority: string;
  itPriority: string | null;
  currentStatus: string;
  ticketOwner: string | null;
  resolutionSummary: string | null;
  // BR-05/BR-20: separate from `currentStatus` — never a formal status change.
  requesterMarkedResolved?: boolean;
  requesterMarkedResolvedAt?: string | null;
}

interface AttachmentData {
  id: number;
  originalFileName: string;
  fileSizeBytes: number;
  mimeType: string;
  uploadedAt: string;
}

interface RemovedAttachmentData {
  id: number;
  originalFileName: string;
  fileSizeBytes: number;
  removedAt: string | null;
  removedReason: string | null;
}

interface TicketDetailResponse {
  ticket: TicketData;
  attachments: {
    active: AttachmentData[];
    removed: RemovedAttachmentData[];
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * ui-spec.md §4: "Problem Appears Resolved" is offered only for these statuses
 * and only while the marker has not already been set.
 */
const RESOLVE_MARK_ELIGIBLE_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER"];

// ─── Component ──────────────────────────────────────────────────────────

export default function TicketDetailPage() {
  const { ticketNumber } = useParams<{ ticketNumber: string }>();
  const navigate = useNavigate();
  // §4: the Actions Taken panel renders read-only for the Requester; the
  // create/edit/void controls are absent from the DOM entirely (§4.2).
  // Null-guarded context read (see StaffTicketDetailPage for the rationale).
  const auth = useContext(AuthContext);
  const user = auth?.user ?? null;

  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [attachments, setAttachments] = useState<{
    active: AttachmentData[];
    removed: RemovedAttachmentData[];
  }>({ active: [], removed: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ─── "Problem Appears Resolved" state (ui-spec.md §4) ────────────────
  const [showResolveConfirm, setShowResolveConfirm] = useState(false);
  const [isMarkingResolved, setIsMarkingResolved] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // ─── Fetch ticket detail ──────────────────────────────────────────
  const fetchTicketDetail = useCallback(async () => {
    if (!ticketNumber) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient(`/api/tickets/${ticketNumber}`);

      if (!response.ok) {
        if (response.status === 404) {
          setError("not-found");
        } else {
          setError("Couldn't load ticket details.");
        }
        return;
      }

      const data: TicketDetailResponse = await response.json();
      setTicket(data.ticket);
      setAttachments(data.attachments);
    } catch {
      setError("Couldn't load ticket details.");
    } finally {
      setIsLoading(false);
    }
  }, [ticketNumber]);

  useEffect(() => {
    fetchTicketDetail();
  }, [fetchTicketDetail]);

  // ─── Handlers ─────────────────────────────────────────────────────

  const handleAttachmentAdded = useCallback(() => {
    fetchTicketDetail();
  }, [fetchTicketDetail]);

  const handleAttachmentRemoved = useCallback(() => {
    fetchTicketDetail();
  }, [fetchTicketDetail]);

  // ─── "Problem Appears Resolved" ──────────────────────────────────────
  const handleResolveMarkConfirm = useCallback(async () => {
    if (!ticketNumber) return;

    setIsMarkingResolved(true);
    setResolveError(null);

    try {
      const response = await apiClient(`/api/tickets/${ticketNumber}/resolve-mark`, {
        method: "POST",
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setResolveError(
          body?.error?.message ?? "Couldn't record your response. Please try again.",
        );
        return; // dialog stays open, state unchanged
      }

      const data = (await response.json()) as {
        requesterMarkedResolved: boolean;
        requesterMarkedResolvedAt: string | null;
      };

      // The formal status is untouched (BR-20) — only the marker changes.
      setTicket((current) =>
        current
          ? {
              ...current,
              requesterMarkedResolved: data.requesterMarkedResolved,
              requesterMarkedResolvedAt: data.requesterMarkedResolvedAt,
            }
          : current,
      );
      setShowResolveConfirm(false);
    } catch {
      setResolveError(
        "Couldn't record your response. Please check your connection and try again.",
      );
    } finally {
      setIsMarkingResolved(false);
    }
  }, [ticketNumber]);

  // ─── Render: Loading state ────────────────────────────────────────
  if (isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.backLink}>
          <Button variant="tertiary" onClick={() => navigate("/tickets")}>
            ← Back to My Tickets
          </Button>
        </div>
        <div className={styles.skeleton} aria-label="Loading ticket details">
          <div className={styles.skeletonLine} style={{ width: "40%" }} />
          <div className={styles.skeletonLine} style={{ width: "100%" }} />
          <div className={styles.skeletonLine} style={{ width: "80%" }} />
          <div className={styles.skeletonLine} style={{ width: "60%" }} />
        </div>
      </div>
    );
  }

  // ─── Render: Not found state ──────────────────────────────────────
  if (error === "not-found") {
    return (
      <div className={styles.page}>
        <div className={styles.notFound}>
          <h2>Ticket not found.</h2>
          <Button variant="primary" onClick={() => navigate("/tickets")}>
            Back to My Tickets
          </Button>
        </div>
      </div>
    );
  }

  // ─── Render: Error state ──────────────────────────────────────────
  if (error) {
    return (
      <div className={styles.page}>
        {/* Safe failure (§8): a generic message plus a retry affordance, never
            a raw backend string. role="alert" announces it, matching every
            other failure banner in the app (this one was the only one missing
            it — feature/lab3-06 consistency pass). */}
        <div className={styles.errorBanner} role="alert" data-testid="requester-detail-error">
          <p>{error}</p>
          <Button variant="tertiary" onClick={fetchTicketDetail}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // ─── Render: Happy path ───────────────────────────────────────────
  if (!ticket) return null;

  const canMarkResolved =
    RESOLVE_MARK_ELIGIBLE_STATUSES.includes(ticket.currentStatus) &&
    !ticket.requesterMarkedResolved;

  return (
    <div className={styles.page}>
      {/* §9.1: Back link */}
      <div className={styles.backLink}>
        <Button variant="tertiary" onClick={() => navigate("/tickets")}>
          ← Back to My Tickets
        </Button>
      </div>

      {/* §9.2: Header block — read-only grid */}
      <section className={styles.headerBlock}>
        <h1 className={styles.title}>Ticket Detail</h1>

        <div className={styles.fieldGrid}>
          <Field state="readonly" label="Ticket No." type="input" value={ticket.ticketNumber} />
          <Field state="readonly" label="Ticket Date" type="input" value={formatDate(ticket.ticketDate)} />
          <Field state="readonly" label="Category" type="input" value={ticket.category.name} />
          <Field state="readonly" label="Related System" type="input" value={ticket.relatedSystem.name} />
          <Field state="readonly" label="Requester" type="input" value={ticket.requester.fullName} />
          <div className={styles.badgeField}>
            <label className={styles.fieldLabel}>Requested Priority</label>
            <Badge variant="priority" value={ticket.requestedPriority} />
          </div>
          <div className={styles.badgeField}>
            <label className={styles.fieldLabel}>IT Priority</label>
            {ticket.itPriority ? (
              <Badge variant="priority" value={ticket.itPriority} />
            ) : (
              <span className={styles.mutedText}>Not yet assigned</span>
            )}
          </div>
          <div className={styles.badgeField}>
            <label className={styles.fieldLabel}>Current Status</label>
            <Badge variant="status" value={ticket.currentStatus} />
          </div>
          <Field
            state="readonly"
            label="Ticket Owner"
            type="input"
            value={ticket.ticketOwner ?? "Not yet assigned"}
          />
        </div>
      </section>

      {/* §9.3: Summary / Description */}
      <section className={styles.summarySection}>
        <h2 className={styles.summaryTitle}>{ticket.summary}</h2>
        <Field state="readonly" label="Description" type="textarea" value={ticket.description} rows={6} />
      </section>

      {/* §9.4: Resolution Summary */}
      <section className={styles.resolutionSection}>
        <p className={styles.resolutionText}>
          {ticket.resolutionSummary ?? "No resolution summary available yet."}
        </p>
      </section>

      {/* §4: "Problem Appears Resolved" — visually distinct from the Status
          badge; it never implies a formal status change (BR-05/BR-20). */}
      {(canMarkResolved || ticket.requesterMarkedResolved) && (
        <section className={styles.resolveSection} data-testid="resolve-mark-section">
          {ticket.requesterMarkedResolved ? (
            <p className={styles.requesterResolvedMarker} data-testid="requester-resolved-badge">
              You marked this as resolved on{" "}
              {ticket.requesterMarkedResolvedAt
                ? formatDate(ticket.requesterMarkedResolvedAt)
                : "an earlier date"}
              . IT Staff will confirm and close the ticket.
            </p>
          ) : (
            <>
              <p className={styles.resolveHint}>
                Has IT fixed the problem? Let them know it looks resolved.
              </p>
              <Button variant="secondary" onClick={() => setShowResolveConfirm(true)}>
                Problem Appears Resolved
              </Button>
            </>
          )}
        </section>
      )}

      {/* Divider */}
      <hr className={styles.divider} />

      {/* §9.5-6: Attachments panel */}
      <AttachmentSection
        ticketNumber={ticket.ticketNumber}
        activeAttachments={attachments.active}
        removedAttachments={attachments.removed}
        onAttachmentAdded={handleAttachmentAdded}
        onAttachmentRemoved={handleAttachmentRemoved}
      />

      {/* §4: Public Comments panel (Requester route — own ticket only) */}
      <PublicCommentsPanel commentsPath={`/api/tickets/${ticket.ticketNumber}/comments`} />

      {/* Lab 4 §4: Actions Taken — appended below Public Comments (read-only
          view for the owning Requester, per FR-06). */}
      {user && ticket && <ActionsTakenPanel ticketId={ticket.id} currentUser={user} />}

      {/* §4: confirmation dialog for the appears-resolved action */}
      {showResolveConfirm && (
        <ResolveMarkConfirm
          onConfirm={handleResolveMarkConfirm}
          onCancel={() => {
            setShowResolveConfirm(false);
            setResolveError(null);
          }}
          busy={isMarkingResolved}
          error={resolveError}
        />
      )}
    </div>
  );
}
