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
        <div className={styles.errorBanner}>
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
    </div>
  );
}
