/**
 * Attachment Storage Service — BR-32, BR-34
 *
 * Handles physical file storage for ticket attachments.
 * Files are stored on local disk at server/uploads/{safeFileName}.
 *
 * safeFileName format: UUID-based, extension preserved (BR-32).
 * Example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890.pdf"
 *
 * Soft-removed files are NOT deleted from disk (BR-34) — they remain
 * for audit/undo potential in later labs but are made inaccessible
 * via the API (isRemoved = true).
 *
 * This service is used by:
 *   - POST /api/tickets (Phase 4: attachment upload at creation time)
 *   - POST /api/tickets/:ticketNumber/attachments (branch #06)
 *   - GET /api/attachments/:id/download (branch #07)
 */

import fs from "node:fs/promises";
import path from "node:path";

// ─── Constants ──────────────────────────────────────────────────────────

export const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

// ─── Directory management ───────────────────────────────────────────────

/**
 * Ensure the uploads directory exists. Idempotent — safe to call multiple times.
 * Creates the directory recursively if it doesn't exist.
 */
export async function ensureUploadDirExists(): Promise<void> {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

// ─── File write ─────────────────────────────────────────────────────────

/**
 * Save an attachment file to disk.
 *
 * @param buffer - The file content as a Buffer (from multer memoryStorage)
 * @param safeFileName - UUID-based filename with extension (e.g. "a1b2c3d4.pdf")
 * @returns The full path to the saved file
 * @throws If directory creation or file write fails
 */
export async function saveAttachmentFile(
  buffer: Buffer,
  safeFileName: string,
): Promise<string> {
  await ensureUploadDirExists();

  // Validate safeFileName — must not contain path separators (BR-32 safety)
  if (
    safeFileName.includes("/") ||
    safeFileName.includes("\\") ||
    safeFileName.includes("..")
  ) {
    throw new Error(`Invalid safeFileName: ${safeFileName}`);
  }

  const filePath = path.join(UPLOADS_DIR, safeFileName);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

// ─── File read ──────────────────────────────────────────────────────────

/**
 * Read an attachment file from disk.
 *
 * @param safeFileName - UUID-based filename with extension
 * @returns The file content as a Buffer
 * @throws If the file does not exist
 */
export async function readAttachmentFile(
  safeFileName: string,
): Promise<Buffer> {
  const filePath = path.join(UPLOADS_DIR, safeFileName);
  return fs.readFile(filePath);
}

// ─── File path helper ───────────────────────────────────────────────────

/**
 * Get the full filesystem path for an attachment's stored file.
 * Used by GET /api/attachments/:id/download with res.download().
 *
 * @param safeFileName - UUID-based filename with extension
 * @returns The full path to the file on disk
 */
export function getAttachmentFilePath(safeFileName: string): string {
  return path.join(UPLOADS_DIR, safeFileName);
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Generate a safe storage filename from the original filename.
 * Uses crypto.randomUUID() + preserves the original extension.
 *
 * @param originalFileName - The user's original filename (e.g. "screenshot.png")
 * @returns A safe filename (e.g. "a1b2c3d4-e5f6-7890-abcd-ef1234567890.png")
 */
export function generateSafeFileName(originalFileName: string): string {
  const ext = path.extname(originalFileName);
  return `${crypto.randomUUID()}${ext}`;
}

/**
 * Validate that a file's MIME type and extension are consistent (BR-28).
 *
 * @param originalFileName - The user's original filename
 * @param mimeType - The MIME type from the upload
 * @returns true if the extension matches the MIME type
 */
export function isMimeTypeExtConsistent(
  originalFileName: string,
  mimeType: string,
): boolean {
  const ext = path.extname(originalFileName).toLowerCase();
  const mimeToExt: Record<string, string[]> = {
    "image/jpeg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "image/webp": [".webp"],
    "application/pdf": [".pdf"],
  };
  const allowedExts = mimeToExt[mimeType];
  if (!allowedExts) return false;
  return allowedExts.includes(ext);
}
