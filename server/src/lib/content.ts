/**
 * Shared Public-Comment / Internal-Note content handling — BR-16, BR-17, BR-18
 *
 * There is exactly ONE validation path for user-authored ticket content, used
 * by all four endpoints:
 *
 *   POST /api/tickets/:ticketNumber/comments      (Requester, own ticket)
 *   POST /api/staff/tickets/:id/comments          (IT Staff/Administrator, any ticket)
 *   POST /api/staff/tickets/:id/notes             (IT Staff/Administrator only)
 *   (and their GET counterparts share `toContentDto`)
 *
 * The feature branch that introduced Internal Notes was explicitly required
 * NOT to re-implement the CONTENT_REQUIRED / CONTENT_TOO_LONG rules, so the
 * limits, trimming behaviour, error codes, and response shape live here and
 * nowhere else. A change to the 2,000-character limit (BR-18) therefore lands
 * once and applies to Requester comments, staff comments, and notes together.
 *
 * BR-18 rendering note: content is stored verbatim and rendered by React,
 * which escapes it on output, so stored script tags cannot execute.
 */

/** BR-18: hard limit for a single Public Comment or Internal Note. */
export const MAX_CONTENT_LENGTH = 2000;

/** The only fields either endpoint reads from the request body. */
export interface ContentBody {
  content?: unknown;
}

export interface ContentErrorBody {
  error: {
    code: "CONTENT_REQUIRED" | "CONTENT_TOO_LONG";
    message: string;
    fieldErrors: Record<string, string>;
  };
}

/**
 * Result of validating a comment/note body.
 *
 * On failure the handler simply does `res.status(result.status).json(result.body)`,
 * which keeps every caller's error response byte-identical for the same input.
 */
export type ContentResult =
  | { ok: true; content: string }
  | { ok: false; status: 422; body: ContentErrorBody };

/**
 * Validate and normalise a comment/note body.
 *
 * @param raw  the request body (any shape)
 * @param noun used only in the human-readable message ("Comment" / "Note");
 *             the machine-readable error codes are identical in both cases
 *             (api-spec.md §3: "same empty/length validation").
 */
export function validateContent(raw: unknown, noun: "Comment" | "Note" = "Comment"): ContentResult {
  const body = (raw ?? {}) as ContentBody;
  const content = typeof body.content === "string" ? body.content.trim() : "";

  // BR-17: empty or whitespace-only content is rejected.
  if (content.length === 0) {
    const message = `${noun} cannot be empty.`;
    return {
      ok: false,
      status: 422,
      body: {
        error: { code: "CONTENT_REQUIRED", message, fieldErrors: { content: message } },
      },
    };
  }

  // BR-18: hard 2,000 character limit (measured after trimming).
  if (content.length > MAX_CONTENT_LENGTH) {
    const message = `${noun} cannot exceed ${MAX_CONTENT_LENGTH} characters.`;
    return {
      ok: false,
      status: 422,
      body: {
        error: { code: "CONTENT_TOO_LONG", message, fieldErrors: { content: message } },
      },
    };
  }

  return { ok: true, content };
}

/** Row shape both PublicComment and InternalNote satisfy after `include: author`. */
export interface AuthoredContentRow {
  id: string;
  ticketId: number;
  authorId: string;
  content: string;
  createdAt: Date;
  author: { name: string; role: string };
}

/**
 * Map a PublicComment/InternalNote row to the documented response shape
 * (api-spec.md §2 comments, §3 notes). The two models are separate but expose
 * an identical projection, so the same mapper serves both.
 */
export function toContentDto(row: AuthoredContentRow) {
  return {
    id: row.id,
    ticketId: row.ticketId,
    authorId: row.authorId,
    authorName: row.author.name,
    authorRole: row.author.role,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}
