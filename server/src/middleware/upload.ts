/**
 * Multer Upload Middleware — BR-28, BR-29, BR-30
 *
 * Configures multer for POST /api/tickets multipart/form-data parsing.
 *
 * Storage: memoryStorage() — file buffers held in request memory.
 *   Files are written to disk by attachmentStorage service after
 *   the ticket record is committed (Phase 4+).
 *
 * Validation (two-layer):
 *   1. fileFilter: rejects unsupported MIME types before buffering (BR-28)
 *   2. limits: fileSize ≤ 5MB, files ≤ 5 (BR-29, BR-30)
 *
 * Error handling:
 *   Multer errors are caught by the Express error middleware in app.ts
 *   and mapped to appropriate HTTP status codes:
 *   - LIMIT_FILE_SIZE → 413 ATTACHMENT_TOO_LARGE
 *   - LIMIT_FILE_COUNT → 400 VALIDATION_ERROR
 *   - Custom MIME rejection → 415 UNSUPPORTED_ATTACHMENT_TYPE
 */

import multer from "multer";

// ─── Constants ──────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB (BR-29)
const MAX_FILES = 5; // BR-30

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

// ─── Custom error for MIME type rejection ────────────────────────────────

export class UnsupportedMimeTypeError extends Error {
  constructor(public fileName: string) {
    super(`Unsupported file type: ${fileName}`);
    this.name = "UnsupportedMimeTypeError";
  }
}

// ─── Multer instance ────────────────────────────────────────────────────

/**
 * Multer instance configured for ticket attachment uploads.
 *
 * Usage in route:
 *   app.post("/api/tickets", upload.array("attachments", 5), handler)
 *
 * When no files are sent (0 attachments), multer still processes the
 * multipart body and populates req.body with text fields.
 */
export const upload = multer({
  storage: multer.memoryStorage(),

  // BR-28: Only allow JPEG, PNG, WEBP, PDF
  fileFilter: (_req, file, callback) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      callback(null, true);
    } else {
      // Pass custom error — Express error handler will map to 415
      callback(new UnsupportedMimeTypeError(file.originalname));
    }
  },

  limits: {
    fileSize: MAX_FILE_SIZE, // BR-29
    files: MAX_FILES,        // BR-30
  },
});
