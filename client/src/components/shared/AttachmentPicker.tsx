/**
 * AttachmentPicker — ui-spec.md §7.7 (Attachments section)
 *
 * Drag-and-drop zone + "Browse files" button for selecting attachments.
 * Shows a running list of selected files with name, size, and remove (×)
 * icon before submission. Inline error per rejected file (wrong type / too
 * large). Counter "n/5".
 *
 * Parent-controlled state: files array and onChange callback are passed in,
 * so CreateTicketPage can include valid files in FormData on submit and
 * clear the list on "Create Another Ticket".
 *
 * §11 Responsive: filename truncated with ellipsis in the middle on mobile
 * (never hiding the extension); full name available on tap/focus.
 */

import { useRef, useState, useCallback, type DragEvent } from "react";
import styles from "./AttachmentPicker.module.css";

// ─── Types ──────────────────────────────────────────────────────────────

export interface PendingFile {
  file: File;
  /** Client-side rejection reason. If set, file is not included in submit. */
  error?: string;
}

interface AttachmentPickerProps {
  /** Current list of pending files (controlled by parent). */
  files: PendingFile[];
  /** Called when files are added or removed. */
  onFilesChange: (files: PendingFile[]) => void;
  /** Max number of files allowed (default 5, per BR-30). */
  maxFiles?: number;
}

// ─── Constants ──────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB (BR-29)
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WEBP",
  "application/pdf": "PDF",
};
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf"]);
const ACCEPT_ATTR = ".jpg,.jpeg,.png,.webp,.pdf";

// ─── Helpers ────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

function validateFile(file: File): string | undefined {
  // BR-29: check size first
  if (file.size > MAX_FILE_SIZE) {
    return `Exceeds ${formatFileSize(MAX_FILE_SIZE)} limit`;
  }

  // BR-28: check MIME type
  if (!ALLOWED_TYPES[file.type]) {
    // Also check extension as fallback (BR-28: both are checked)
    const ext = getFileExtension(file.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return "Unsupported file type";
    }
  }

  return undefined; // valid
}

// ─── Component ──────────────────────────────────────────────────────────

export default function AttachmentPicker({
  files,
  onFilesChange,
  maxFiles = 5,
}: AttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Count valid (no error) files
  const validCount = files.filter((f) => !f.error).length;
  const isAtLimit = validCount >= maxFiles;

  const addFiles = useCallback(
    (newFiles: FileList | File[]) => {
      const arr = Array.from(newFiles);
      const updated = [...files];

      for (const file of arr) {
        // BR-30: check max files (only count valid ones)
        const currentValid = updated.filter((f) => !f.error).length;
        if (currentValid >= maxFiles) {
          break;
        }

        const error = validateFile(file);
        updated.push({ file, error });
      }

      onFilesChange(updated);
    },
    [files, onFilesChange, maxFiles],
  );

  function handleRemove(index: number) {
    const updated = files.filter((_, i) => i !== index);
    onFilesChange(updated);
  }

  // ─── Drag handlers ──────────────────────────────────────────────

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      // Reset input so same file can be re-selected
      e.target.value = "";
    }
  }

  function handleBrowseClick() {
    if (isAtLimit) return;
    inputRef.current?.click();
  }

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <div className={styles.picker}>
      {/* Drop zone */}
      <div
        className={`${styles.dropZone} ${dragOver && !isAtLimit ? styles.dropZoneActive : ""} ${isAtLimit ? styles.dropZoneDisabled : ""}`}
        onDragEnter={isAtLimit ? undefined : handleDragEnter}
        onDragOver={isAtLimit ? undefined : handleDragOver}
        onDragLeave={isAtLimit ? undefined : handleDragLeave}
        onDrop={isAtLimit ? undefined : handleDrop}
        onClick={handleBrowseClick}
        role="button"
        tabIndex={isAtLimit ? -1 : 0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !isAtLimit) {
            e.preventDefault();
            handleBrowseClick();
          }
        }}
        aria-label={isAtLimit ? "Maximum attachments reached" : "Drop files here or click to browse"}
        aria-disabled={isAtLimit}
      >
        <span className={styles.dropZoneIcon} aria-hidden="true">
          📎
        </span>
        <span className={styles.dropZoneText}>
          Drag and drop files here, or{" "}
          <span className={styles.dropZoneBrowse}>browse files</span>
        </span>
        <span className={styles.dropZoneHint}>
          JPG, PNG, WEBP, PDF — max {formatFileSize(MAX_FILE_SIZE)} each
        </span>
      </div>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        className={styles.fileInput}
        multiple
        accept={ACCEPT_ATTR}
        onChange={handleInputChange}
        aria-hidden="true"
        tabIndex={-1}
        disabled={isAtLimit}
      />

      {/* Pending file list */}
      {files.length > 0 && (
        <div className={styles.fileList}>
          {files.map((pf, index) => (
            <div
              key={`${pf.file.name}-${index}`}
              className={`${styles.fileRow} ${pf.error ? styles.fileRowError : ""}`}
            >
              <span className={styles.fileIcon} aria-hidden="true">
                {pf.error ? "⚠️" : "📄"}
              </span>
              <div className={styles.fileInfo}>
                <span
                  className={`${styles.fileName} ${pf.error ? styles.fileNameError : ""}`}
                  title={pf.file.name}
                >
                  {pf.file.name}
                </span>
                {!pf.error && (
                  <span className={styles.fileSize}>
                    {formatFileSize(pf.file.size)}
                  </span>
                )}
                {pf.error && (
                  <span className={styles.fileError} role="alert">
                    {pf.error}
                  </span>
                )}
              </div>
              <button
                type="button"
                className={styles.fileRemove}
                onClick={() => handleRemove(index)}
                aria-label={`Remove ${pf.file.name}`}
                title={`Remove ${pf.file.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Counter */}
      <div className={styles.counter}>
        {validCount}/{maxFiles}
      </div>
    </div>
  );
}
