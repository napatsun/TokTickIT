/**
 * StaffTicketDetailPage — IT Staff Ticket Detail (ui-spec.md §6)
 * Route: /staff/tickets/:id — IT Staff, Administrator
 *
 * Data sources (api-spec.md §3, all keyed by the internal Ticket `id`):
 *   GET   /api/staff/tickets/:id           full detail + attachments
 *   GET   /api/staff/owners                active IT Staff/Administrator picker
 *   POST  /api/staff/tickets/:id/claim     only while unassigned (BR-13)
 *   POST  /api/staff/tickets/:id/assign    reassign to an active IT Staff/Admin (BR-12)
 *   PATCH /api/staff/tickets/:id/priority  IT Priority only, never Requested (BR-14/15)
 *   PATCH /api/staff/tickets/:id/status    matrix-enforced (BR-19, ui-spec §6.1)
 *
 * Sections:
 *   1. Header (read-only)
 *   2. Ownership & Priority (Claim/Reassign, Requested Priority read-only, IT Priority editable)
 *   3. Status (only the permitted next states; confirm dialog for Resolved/Closed/Cancelled)
 *   4. Requester "appears resolved" signal banner
 *   5. Public Comments  — shared requester component, staff endpoint
 *   6. Internal Notes   — visually distinct panel
 *   7. Attachments (read-only continuity)
 *
 * Every editable control owns its own inline busy/success/failure micro-state so
 * one failed action never blocks the rest of the screen (§6 States).
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Badge from "../components/shared/Badge";
import Button from "../components/shared/Button";
import Field from "../components/shared/Field";
import PublicCommentsPanel from "../components/ticket-detail/PublicCommentsPanel";
import InternalNotesPanel from "../components/ticket-detail/InternalNotesPanel";
import StatusChangeConfirm, {
  STATUS_LABELS,
} from "../components/ticket-detail/StatusChangeConfirm";
import { apiClient } from "../lib/apiClient";
import styles from "./StaffTicketDetailPage.module.css";

// ─── Types ──────────────────────────────────────────────────────────────

interface StaffTicket {
  id: number;
  ticketNumber: string;
  createdAt: string;
  updatedAt: string;
  summary: string;
  description: string;
  category: { id: number; name: string };
  relatedSystem: { id: number; name: string };
  requester: { id: string; name: string; email: string };
  owner: { id: string; name: string; email: string } | null;
  requestedPriority: string;
  itPriority: string;
  status: string;
  requesterMarkedResolved: boolean;
  requesterMarkedResolvedAt: string | null;
  resolutionSummary: string | null;
  allowedStatusTransitions: string[];
}

interface AttachmentItem {
  id: number;
  originalFileName: string;
  fileSizeBytes: number;
  mimeType: string;
  uploadedAt: string;
}

interface RemovedAttachmentItem {
  id: number;
  originalFileName: string;
  fileSizeBytes: number;
  removedAt: string | null;
  removedReason: string | null;
}

interface OwnerOption {
  id: string;
  name: string;
  email: string;
}

type PageStatus = "loading" | "ready" | "not-found" | "forbidden" | "error";

const IT_PRIORITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

/** §6.3: these transitions must be confirmed before they are applied. */
const CONFIRMATION_REQUIRED = ["RESOLVED", "CLOSED", "CANCELLED"];

// ─── Helpers ────────────────────────────────────────────────────────────

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-GB", {
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

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

// ─── Component ──────────────────────────────────────────────────────────

export default function StaffTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [ticket, setTicket] = useState<StaffTicket | null>(null);
  const [attachments, setAttachments] = useState<{
    active: AttachmentItem[];
    removed: RemovedAttachmentItem[];
  }>({ active: [], removed: [] });
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [pageStatus, setPageStatus] = useState<PageStatus>("loading");

  // Ownership control
  const [selectedOwner, setSelectedOwner] = useState("");
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [ownerSaved, setOwnerSaved] = useState<string | null>(null);

  // IT Priority control
  const [priorityBusy, setPriorityBusy] = useState(false);
  const [priorityError, setPriorityError] = useState<string | null>(null);
  const [prioritySaved, setPrioritySaved] = useState(false);

  // Status control
  const [selectedStatus, setSelectedStatus] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusSaved, setStatusSaved] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState<string | null>(null);

  // ─── Load ─────────────────────────────────────────────────────────────
  const fetchDetail = useCallback(async () => {
    if (!id) return;

    setPageStatus("loading");
    try {
      const response = await apiClient(`/api/staff/tickets/${id}`);

      if (response.status === 404) {
        setPageStatus("not-found");
        return;
      }
      if (response.status === 403) {
        setPageStatus("forbidden");
        return;
      }
      if (!response.ok) {
        setPageStatus("error");
        return;
      }

      const data = (await response.json()) as {
        ticket: StaffTicket;
        attachments: { active: AttachmentItem[]; removed: RemovedAttachmentItem[] };
      };

      setTicket(data.ticket);
      setAttachments(data.attachments ?? { active: [], removed: [] });
      setSelectedStatus("");
      setPageStatus("ready");
    } catch {
      setPageStatus("error");
    }
  }, [id]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  // Owner picker for Reassign (BR-12: active IT Staff/Administrator only).
  useEffect(() => {
    let cancelled = false;

    async function loadOwners() {
      try {
        const response = await apiClient("/api/staff/owners");
        if (!response.ok) return;
        const data = (await response.json()) as { items?: OwnerOption[] };
        if (!cancelled) setOwners(Array.isArray(data.items) ? data.items : []);
      } catch {
        // The picker degrades to an empty list; Claim still works.
      }
    }

    void loadOwners();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Ownership actions ────────────────────────────────────────────────
  async function claimTicket() {
    if (!id) return;
    setOwnerBusy(true);
    setOwnerError(null);
    setOwnerSaved(null);

    try {
      const response = await apiClient(`/api/staff/tickets/${id}/claim`, { method: "POST" });

      if (!response.ok) {
        setOwnerError(await readErrorMessage(response, "Couldn't claim this ticket."));
        return;
      }

      const data = (await response.json()) as { ticket: StaffTicket };
      setTicket(data.ticket);
      setOwnerSaved(`Claimed by ${data.ticket.owner?.name ?? "you"}.`);
    } catch {
      setOwnerError("Couldn't claim this ticket. Please try again.");
    } finally {
      setOwnerBusy(false);
    }
  }

  async function reassignTicket() {
    if (!id || !selectedOwner) return;
    setOwnerBusy(true);
    setOwnerError(null);
    setOwnerSaved(null);

    try {
      const response = await apiClient(`/api/staff/tickets/${id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId: selectedOwner }),
      });

      if (!response.ok) {
        setOwnerError(await readErrorMessage(response, "Couldn't reassign this ticket."));
        return;
      }

      const data = (await response.json()) as { ticket: StaffTicket };
      setTicket(data.ticket);
      setSelectedOwner("");
      setOwnerSaved(`Reassigned to ${data.ticket.owner?.name ?? "the selected owner"}.`);
    } catch {
      setOwnerError("Couldn't reassign this ticket. Please try again.");
    } finally {
      setOwnerBusy(false);
    }
  }

  // ─── IT Priority ──────────────────────────────────────────────────────
  async function savePriority(next: string) {
    if (!id) return;
    setPriorityBusy(true);
    setPriorityError(null);
    setPrioritySaved(false);

    try {
      const response = await apiClient(`/api/staff/tickets/${id}/priority`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itPriority: next }),
      });

      if (!response.ok) {
        setPriorityError(await readErrorMessage(response, "Couldn't update IT priority."));
        return;
      }

      const data = (await response.json()) as { ticket: StaffTicket };
      setTicket(data.ticket);
      setPrioritySaved(true);
    } catch {
      setPriorityError("Couldn't update IT priority. Please try again.");
    } finally {
      setPriorityBusy(false);
    }
  }

  // ─── Status ───────────────────────────────────────────────────────────
  async function applyStatus(next: string) {
    if (!id) return;
    setStatusBusy(true);
    setStatusError(null);
    setStatusSaved(false);

    try {
      const response = await apiClient(`/api/staff/tickets/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });

      if (!response.ok) {
        setStatusError(await readErrorMessage(response, "Couldn't change the status."));
        return;
      }

      const data = (await response.json()) as { ticket: StaffTicket };
      setTicket(data.ticket);
      setSelectedStatus("");
      setStatusSaved(true);
      setConfirmStatus(null);
    } catch {
      setStatusError("Couldn't change the status. Please try again.");
    } finally {
      setStatusBusy(false);
    }
  }

  function requestStatusChange() {
    if (!selectedStatus) return;
    setStatusError(null);
    setStatusSaved(false);

    if (CONFIRMATION_REQUIRED.includes(selectedStatus)) {
      setConfirmStatus(selectedStatus);
      return;
    }
    void applyStatus(selectedStatus);
  }

  // ─── Render: page states ──────────────────────────────────────────────
  if (pageStatus === "loading") {
    return (
      <div className={styles.page}>
        <div className={styles.skeleton} aria-busy="true" aria-label="Loading ticket">
          <div className={styles.skeletonLine} style={{ width: "40%" }} />
          <div className={styles.skeletonLine} style={{ width: "100%" }} />
          <div className={styles.skeletonLine} style={{ width: "75%" }} />
        </div>
      </div>
    );
  }

  if (pageStatus === "not-found") {
    return (
      <div className={styles.page}>
        <div className={styles.stateCard} data-testid="staff-detail-not-found">
          <h2 className={styles.stateTitle}>Ticket not found.</h2>
          <Button variant="primary" onClick={() => navigate("/staff/queue")}>
            Back to Ticket Queue
          </Button>
        </div>
      </div>
    );
  }

  if (pageStatus === "forbidden") {
    return (
      <div className={styles.page}>
        <div className={styles.stateCard} data-testid="staff-detail-forbidden">
          <h2 className={styles.stateTitle}>You don&apos;t have access to this ticket.</h2>
          <Button variant="primary" onClick={() => navigate("/staff/queue")}>
            Back to Ticket Queue
          </Button>
        </div>
      </div>
    );
  }

  if (pageStatus === "error" || !ticket) {
    return (
      <div className={styles.page}>
        <div className={styles.errorBanner} role="alert" data-testid="staff-detail-error">
          <p>Couldn&apos;t load this ticket. Retry.</p>
          <Button variant="tertiary" onClick={() => void fetchDetail()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // ─── Render: populated ────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <div className={styles.backLink}>
        <Button variant="tertiary" onClick={() => navigate("/staff/queue")}>
          ← Back to Ticket Queue
        </Button>
      </div>

      {/* 1. Header (read-only) */}
      <section className={styles.section} data-testid="staff-ticket-header">
        <h1 className={styles.title}>Ticket Detail</h1>

        <div className={styles.fieldGrid}>
          <Field state="readonly" label="Ticket No." type="input" value={ticket.ticketNumber} />
          <Field state="readonly" label="Created Date" type="input" value={formatDate(ticket.createdAt)} />
          <Field state="readonly" label="Category" type="input" value={ticket.category.name} />
          <Field
            state="readonly"
            label="Related System"
            type="input"
            value={ticket.relatedSystem.name}
          />
          <Field state="readonly" label="Requester" type="input" value={ticket.requester.name} />
        </div>

        <h2 className={styles.summaryTitle}>{ticket.summary}</h2>
        <Field
          state="readonly"
          label="Description"
          type="textarea"
          value={ticket.description}
          rows={5}
        />
      </section>

      {/* 4. Requester "appears resolved" signal — distinct from the Status badge */}
      {ticket.requesterMarkedResolved && (
        <div className={styles.requesterSignal} role="status" data-testid="requester-signal">
          <span aria-hidden="true">ℹ</span>
          <p>
            Requester marked this as appears-resolved on{" "}
            {ticket.requesterMarkedResolvedAt
              ? formatDate(ticket.requesterMarkedResolvedAt)
              : "an earlier date"}
            . The formal Status is unchanged.
          </p>
        </div>
      )}

      {/* 2. Ownership & Priority */}
      <section className={styles.section} data-testid="ownership-priority">
        <h2 className={styles.sectionTitle}>Ownership &amp; Priority</h2>

        <div className={styles.controlBlock}>
          <div className={styles.controlHeaderRow}>
            <span className={styles.controlLabel}>Owner</span>
            <span className={styles.ownerValue} data-testid="owner-display">
              {ticket.owner ? ticket.owner.name : "Unassigned"}
            </span>
          </div>

          {/* §9: each inline failure is announced (role="alert") AND bound to
              the control it belongs to, so the message is read in context. */}
          {ownerError && (
            <div
              className={styles.inlineError}
              role="alert"
              id="owner-error"
              data-testid="owner-error"
            >
              {ownerError}
            </div>
          )}
          {ownerSaved && (
            <p className={styles.inlineSuccess} role="status" data-testid="owner-success">
              {ownerSaved}
            </p>
          )}

          <div className={styles.controlActions}>
            {!ticket.owner && (
              <Button
                variant={ownerBusy ? "busy" : "primary"}
                busyLabel="Claiming…"
                onClick={() => void claimTicket()}
                disabled={ownerBusy}
                aria-describedby={ownerError ? "owner-error" : undefined}
              >
                Claim
              </Button>
            )}

            <label className={styles.inlineLabel} htmlFor="reassign-owner">
              Reassign owner
              <select
                id="reassign-owner"
                className={styles.select}
                value={selectedOwner}
                onChange={(event) => setSelectedOwner(event.target.value)}
                disabled={ownerBusy}
                aria-invalid={ownerError ? true : undefined}
                aria-describedby={ownerError ? "owner-error" : undefined}
              >
                <option value="">Select an IT Staff member…</option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </label>

            <Button
              variant="secondary"
              onClick={() => void reassignTicket()}
              disabled={ownerBusy || selectedOwner === ""}
            >
              Reassign
            </Button>
          </div>
        </div>

        <div className={styles.controlBlock}>
          <div className={styles.controlHeaderRow}>
            <span className={styles.controlLabel}>Requested Priority</span>
            {/* BR-15: read-only — only the Requester's original submission is stored here. */}
            <Badge variant="priority" value={ticket.requestedPriority} />
          </div>

          <label className={styles.inlineLabel} htmlFor="it-priority">
            IT Priority
            <select
              id="it-priority"
              className={styles.select}
              value={ticket.itPriority}
              onChange={(event) => void savePriority(event.target.value)}
              disabled={priorityBusy}
              aria-invalid={priorityError ? true : undefined}
              aria-describedby={priorityError ? "priority-error" : undefined}
            >
              {IT_PRIORITY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option.charAt(0) + option.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>

          {priorityError && (
            <div
              className={styles.inlineError}
              role="alert"
              id="priority-error"
              data-testid="priority-error"
            >
              {priorityError}
            </div>
          )}
          {prioritySaved && (
            <p className={styles.inlineSuccess} role="status" data-testid="priority-success">
              IT priority updated.
            </p>
          )}
        </div>
      </section>

      {/* 3. Status */}
      <section className={styles.section} data-testid="status-control">
        <h2 className={styles.sectionTitle}>Status</h2>

        <div className={styles.controlHeaderRow}>
          <span className={styles.controlLabel}>Current Status</span>
          <Badge variant="status" value={ticket.status} />
        </div>

        {/* Only the permitted next states from ui-spec.md §6.1 are offered. */}
        <div className={styles.controlActions}>
          <label className={styles.inlineLabel} htmlFor="change-status">
            Change Status
            <select
              id="change-status"
              className={styles.select}
              value={selectedStatus}
              onChange={(event) => {
                setSelectedStatus(event.target.value);
                setStatusSaved(false);
              }}
              disabled={statusBusy || ticket.allowedStatusTransitions.length === 0}
              aria-invalid={statusError ? true : undefined}
              aria-describedby={statusError ? "status-error" : undefined}
            >
              <option value="">Select a status…</option>
              {ticket.allowedStatusTransitions.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status] ?? status}
                </option>
              ))}
            </select>
          </label>

          <Button
            variant="secondary"
            onClick={requestStatusChange}
            disabled={statusBusy || selectedStatus === ""}
          >
            Change Status
          </Button>
        </div>

        {ticket.allowedStatusTransitions.length === 0 && (
          <p className={styles.mutedText}>
            This ticket is in a terminal status and cannot be moved.
          </p>
        )}

        {statusError && (
          <div
            className={styles.inlineError}
            role="alert"
            id="status-error"
            data-testid="status-error"
          >
            {statusError}
          </div>
        )}
        {statusSaved && (
          <p className={styles.inlineSuccess} role="status" data-testid="status-success">
            Status updated.
          </p>
        )}
      </section>

      {/* 5. Public Comments — same component as the Requester view (§6.5) */}
      <PublicCommentsPanel commentsPath={`/api/staff/tickets/${ticket.id}/comments`} />

      {/* 6. Internal Notes — visually distinct, IT-only (§6.6) */}
      <InternalNotesPanel notesPath={`/api/staff/tickets/${ticket.id}/notes`} />

      {/* 7. Attachments (read-only continuity) */}
      <section className={styles.section} data-testid="staff-attachments">
        <h2 className={styles.sectionTitle}>Attachments</h2>
        {attachments.active.length === 0 ? (
          <p className={styles.mutedText}>No attachments.</p>
        ) : (
          <ul className={styles.attachmentList}>
            {attachments.active.map((attachment) => (
              <li key={attachment.id} className={styles.attachmentItem}>
                <span className={styles.attachmentName}>{attachment.originalFileName}</span>
                <span className={styles.mutedText}>
                  {formatFileSize(attachment.fileSizeBytes)} · {formatDate(attachment.uploadedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* §6.3 confirmation for Resolved / Closed / Cancelled */}
      {confirmStatus && (
        <StatusChangeConfirm
          from={ticket.status}
          to={confirmStatus}
          busy={statusBusy}
          error={statusError}
          onConfirm={() => void applyStatus(confirmStatus)}
          onCancel={() => {
            setConfirmStatus(null);
            setStatusError(null);
          }}
        />
      )}
    </div>
  );
}
