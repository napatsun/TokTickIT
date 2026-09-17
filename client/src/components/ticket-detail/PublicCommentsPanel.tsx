/**
 * PublicCommentsPanel — ui-spec.md §4 (Requester) and §6.5 (IT Staff) — BR-04
 *
 * Public Comments are visible to the Requester, IT Staff, and Administrator, so
 * this is the SAME component in both views; only the endpoint differs:
 *
 *   Requester  → /api/tickets/:ticketNumber/comments   (own ticket only, §2)
 *   IT Staff   → /api/staff/tickets/:id/comments       (any ticket, §3)
 *
 * All list/composer behaviour lives in ContentThread so the Requester panel and
 * the IT Staff panel can never drift apart. Callers pass the collection path.
 */

import ContentThread from "./ContentThread";

interface PublicCommentsPanelProps {
  /**
   * Path of the public-comments collection for this ticket, e.g.
   * "/api/tickets/TKT-2026-000008/comments" (Requester) or
   * "/api/staff/tickets/42/comments" (IT Staff).
   */
  commentsPath: string;
}

export default function PublicCommentsPanel({ commentsPath }: PublicCommentsPanelProps) {
  return (
    <ContentThread
      variant="public"
      headingId="public-comments-heading"
      heading="Public Comments"
      hint="Visible to you, IT Staff, and Administrators."
      endpoint={commentsPath}
      composerLabel="Add a comment"
      composerPlaceholder="Share an update with IT Staff…"
      submitLabel="Post Comment"
      busyLabel="Posting…"
      emptyMessage="No comments yet. Add the first update for IT Staff."
      successMessage="Comment posted."
      textareaId="public-comment"
      testIds={{
        item: "comment-item",
        empty: "comments-empty",
        counter: "comment-counter",
        success: "comment-success",
        error: "comment-error",
      }}
    />
  );
}
