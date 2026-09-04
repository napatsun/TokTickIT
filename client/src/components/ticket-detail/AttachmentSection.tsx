/**
 * AttachmentSection — §9.5-6 Attachments panel
 *
 * Renders:
 *   - Heading "Attachments (n active)"
 *   - Active attachment rows: filename, size, uploaded date, Download, Remove
 *   - Removed attachments sub-section: filename, size, removed date, reason, "Unavailable"
 *   - Add Attachment control (AttachmentPicker, disabled at 5 active)
 *
 * §34: Soft removal — removed attachments visible as metadata only
 * §35: Download disabled for removed attachments
 */

import { useState, useCallback } from "react";
import Button from "../shared/Button";
import AttachmentPicker, { type PendingFile } from "../shared/AttachmentPicker";
import RemoveAttachmentConfirm from "./RemoveAttachmentConfirm";
import { apiClient } from "../../lib/apiClient";
import styles from "./AttachmentSection.module.css";

// ─── Types ──────────────────────────────────────────────────────────────

interface ActiveAttachment {
  id: number;
  originalFileName: string;
  fileSizeBytes: number;
  mimeType: string;
  uploadedAt: string;
}

interface RemovedAttachment {
  id: number;
  originalFileName: string;
  fileSizeBytes: number;
  removedAt: string | null;
  removedReason: string | null;
}

interface AttachmentSectionProps {
  ticketNumber: string;
  activeAttachments: ActiveAttachment[];
  removedAttachments: RemovedAttachment[];
  onAttachmentAdded: () => void;
  onAttachmentRemoved: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ─── Component ──────────────────────────────────────────────────────────

const MAX_ACTIVE = 5; // BR-30

export default function AttachmentSection({
  ticketNumber,
  activeAttachments,
  removedAttachments,
  onAttachmentAdded,
  onAttachmentRemoved,
}: AttachmentSectionProps) {
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const activeCount = activeAttachments.length;
  const canAddMore = activeCount < MAX_ACTIVE;

  // ─── Download handler ─────────────────────────────────────────────
  const handleDownload = useCallback(
    (attachmentId: number, fileName: string) => {
      setDownloadError(null);
      const baseUrl =
        import.meta.env.VITE_API_URL ?? "http://localhost:3000";
      const url = `${baseUrl}/api/attachments/${attachmentId}/download`;

      apiClient(url)
        .then(async (response) => {
          if (!response.ok) {
            setDownloadError("Download failed. The file may have been removed.");
            return;
          }
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
        })
        .catch(() => {
          setDownloadError("Download failed. Please check your connection and try again.");
        });
    },
    [],
  );

  // ─── Add attachment handler ───────────────────────────────────────
  const handleUpload = useCallback(async () => {
    if (pendingFiles.length === 0) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      for (const pf of pendingFiles) {
        if (!pf.error) {
          formData.append("attachments", pf.file);
        }
      }

      const response = await apiClient(
        `/api/tickets/${ticketNumber}/attachments`,
        { method: "POST", body: formData },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        setUploadError(
          errorData?.error?.message ?? "Failed to upload attachment.",
        );
        return;
      }

      // Success — clear pending files and re-fetch
      setPendingFiles([]);
      onAttachmentAdded();
    } catch {
      setUploadError("Failed to upload attachment.");
    } finally {
      setIsUploading(false);
    }
  }, [pendingFiles, ticketNumber, onAttachmentAdded]);

  // ─── Remove handler ──────────────────────────────────────────────
  const handleRemoveConfirm = useCallback(
    async (reason: string) => {
      if (removingId === null) return;

      setRemoveError(null);

      try {
        const response = await apiClient(
          `/api/attachments/${removingId}`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ removalReason: reason }),
          },
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          setRemoveError(
            errorData?.error?.message ?? "Failed to remove attachment. Please try again.",
          );
          return;
        }

        setRemovingId(null);
        setRemoveError(null);
        onAttachmentRemoved();
      } catch {
        setRemoveError("Failed to remove attachment. Please check your connection and try again.");
      }
    },
    [removingId, onAttachmentRemoved],
  );

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <section className={styles.section}>
      {/* §9.5: Heading */}
      <h2 className={styles.heading}>
        Attachments ({activeCount} active)
      </h2>

      {/* Active attachments */}
      {activeAttachments.length > 0 && (
        <div className={styles.attachmentList}>
          {activeAttachments.map((att) => (
            <div key={att.id} className={styles.attachmentRow}>
              <div className={styles.attachmentInfo}>
                <span className={styles.fileName}>{att.originalFileName}</span>
                <span className={styles.fileMeta}>
                  {formatFileSize(att.fileSizeBytes)} · Uploaded{" "}
                  {formatDate(att.uploadedAt)}
                </span>
              </div>
              <div className={styles.attachmentActions}>
                <Button
                  variant="tertiary"
                  onClick={() => handleDownload(att.id, att.originalFileName)}
                >
                  Download
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setRemovingId(att.id)}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No active attachments message */}
      {activeAttachments.length === 0 && (
        <p className={styles.emptyText}>No active attachments.</p>
      )}

      {/* §9.6: Add Attachment control */}
      {canAddMore ? (
        <div className={styles.addSection}>
          <AttachmentPicker
            files={pendingFiles}
            onFilesChange={setPendingFiles}
            maxFiles={MAX_ACTIVE - activeCount}
          />
          {pendingFiles.some((f) => !f.error) && (
            <Button
              variant={isUploading ? "busy" : "primary"}
              busyLabel="Uploading…"
              onClick={handleUpload}
              disabled={isUploading}
            >
              Upload Attachment{pendingFiles.filter((f) => !f.error).length > 1 ? "s" : ""}
            </Button>
          )}
          {uploadError && (
            <p className={styles.uploadError}>{uploadError}</p>
          )}
        </div>
      ) : (
        <p className={styles.limitText}>
          Maximum of {MAX_ACTIVE} active attachments reached. Remove one to add another.
        </p>
      )}

      {/* Removed attachments sub-section */}
      {removedAttachments.length > 0 && (
        <div className={styles.removedSection}>
          <h3 className={styles.removedHeading}>
            Removed ({removedAttachments.length})
          </h3>
          {removedAttachments.map((att) => (
            <div key={att.id} className={styles.removedRow}>
              <div className={styles.attachmentInfo}>
                <span className={styles.fileName}>{att.originalFileName}</span>
                <span className={styles.fileMeta}>
                  {formatFileSize(att.fileSizeBytes)}
                  {att.removedAt && ` · Removed ${formatDate(att.removedAt)}`}
                  {att.removedReason && ` · ${att.removedReason}`}
                </span>
              </div>
              <span className={styles.unavailableLabel}>Unavailable</span>
            </div>
          ))}
        </div>
      )}

      {/* Download error feedback */}
      {downloadError && (
        <p className={styles.uploadError} role="alert">
          {downloadError}
        </p>
      )}

      {/* Remove confirmation dialog */}
      {removingId !== null && (
        <RemoveAttachmentConfirm
          onConfirm={handleRemoveConfirm}
          onCancel={() => { setRemovingId(null); setRemoveError(null); }}
          error={removeError}
        />
      )}
    </section>
  );
}
