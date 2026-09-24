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
import TicketWorkflowControls, {
  type WorkflowTicketState,
} from "../components/ticket-detail/TicketWorkflowControls";
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
  // Lab 4 §7.2 / §5.1 — the Requester workflow control's inputs.
  version: number;
  resolvedAt: string | null;
  requesterConfirmedResolved: boolean;
  requesterConfirmedResolvedAt: string | null;
  hasActionsWithResult: boolean;
  allowedStatusTransitions: string[];
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

  // ─── Workflow control (ui-spec.md §5) ────────────────────────────────
  // The shared control owns its own busy/conflict micro-state; the page only
  // merges the server-confirmed workflow slice into its ticket.
  const handleTicketUpdated = useCallback((next: WorkflowTicketState) => {
    setTicket((current) =>
      current
        ? {
            ...current,
            currentStatus: next.status,
            version: next.version,
            resolvedAt: next.resolvedAt,
            requesterConfirmedResolved: next.requesterConfirmedResolved,
            requesterConfirmedResolvedAt: next.requesterConfirmedResolvedAt,
            allowedStatusTransitions: next.allowedStatusTransitions,
          }
        : current,
    );
  }, []);

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

      {/* §5: the Requester workflow control — the only status transitions a
          Requester may make (cancel own / reopen own within BR-10), plus the
          advisory "This looks resolved to me" acknowledgement (FR-08/BR-08).
          The control is deliberately separate from and secondary to any
          authoritative status change, which only IT Staff can make. */}
      {user && (
        <section className={styles.resolveSection} data-testid="workflow-section">
          <h2 className={styles.summaryTitle}>Status &amp; Resolution</h2>
          <TicketWorkflowControls
            ticketId={ticket.id}
            currentUser={user}
            currentStatus={ticket.currentStatus}
            version={ticket.version}
            resolvedAt={ticket.resolvedAt}
            allowedTransitions={ticket.allowedStatusTransitions}
            hasActionsWithResult={ticket.hasActionsWithResult}
            requesterConfirmedResolved={ticket.requesterConfirmedResolved}
            requesterConfirmedResolvedAt={ticket.requesterConfirmedResolvedAt}
            showStatusBadge={false}
            onTicketUpdated={handleTicketUpdated}
            onReload={fetchTicketDetail}
          />
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
    </div>
  );
}
