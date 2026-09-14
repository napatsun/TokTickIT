/**
 * PublicCommentsPanel — ui-spec.md §4 (Requester Ticket Detail)
 *
 * Reads GET /api/tickets/:ticketNumber/comments and appends through
 * POST /api/tickets/:ticketNumber/comments.
 *
 * States (§4):
 *   Idle    — composer enabled, "Post Comment" disabled while empty/whitespace
 *   Busy    — posting (spinner button, composer disabled)
 *   Success — the created comment is appended to the list, draft cleared
 *   Failure — inline banner above the textarea; the draft text is preserved so
 *             the user never loses what they typed
 *
 * Ordering: api-spec.md §2 fixes chronological (oldest-first) order, so the
 * newest comment appears at the bottom, matching typical thread UX.
 *
 * BR-18: max 2,000 characters with a live counter; content is rendered as text
 * so React escapes it (no script injection).
 */

import { useCallback, useEffect, useState } from "react";
import Button from "../shared/Button";
import { apiClient } from "../../lib/apiClient";
import styles from "./PublicCommentsPanel.module.css";

// ─── Types ──────────────────────────────────────────────────────────────

export interface PublicComment {
  id: string;
  ticketId: number;
  authorId: string;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: string;
}

interface PublicCommentsPanelProps {
  ticketNumber: string;
}

export const MAX_COMMENT_LENGTH = 2000;

// ─── Helpers ────────────────────────────────────────────────────────────

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ROLE_LABELS: Record<string, string> = {
  REQUESTER: "Requester",
  IT_STAFF: "IT Staff",
  ADMINISTRATOR: "Administrator",
};

// ─── Component ──────────────────────────────────────────────────────────

export default function PublicCommentsPanel({ ticketNumber }: PublicCommentsPanelProps) {
  const [comments, setComments] = useState<PublicComment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  const trimmedDraft = draft.trim();
  const canSubmit = trimmedDraft.length > 0 && !isPosting;

  // ─── Load comments ────────────────────────────────────────────────────
  const fetchComments = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const response = await apiClient(`/api/tickets/${ticketNumber}/comments`);

      if (!response.ok) {
        setLoadError("Couldn't load comments.");
        return;
      }

      const data = (await response.json()) as { items?: PublicComment[] };
      setComments(Array.isArray(data.items) ? data.items : []);
    } catch {
      setLoadError("Couldn't load comments.");
    } finally {
      setIsLoading(false);
    }
  }, [ticketNumber]);

  useEffect(() => {
    void fetchComments();
  }, [fetchComments]);

  // ─── Post a comment ───────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!canSubmit) return;

      setIsPosting(true);
      setPostError(null);
      setPosted(false);

      try {
        const response = await apiClient(`/api/tickets/${ticketNumber}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: trimmedDraft }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          setPostError(
            body?.error?.message ?? "Couldn't post your comment. Please try again.",
          );
          return; // draft intentionally preserved
        }

        const created = (await response.json()) as PublicComment;
        setComments((current) => [...current, created]);
        setPosted(true);
        setDraft("");
      } catch {
        setPostError("Couldn't post your comment. Please check your connection and try again.");
      } finally {
        setIsPosting(false);
      }
    },
    [canSubmit, ticketNumber, trimmedDraft],
  );

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <section className={styles.section} aria-labelledby="public-comments-heading">
      <h2 className={styles.heading} id="public-comments-heading">
        Public Comments
      </h2>
      <p className={styles.hint}>
        Visible to you, IT Staff, and Administrators.
      </p>

      {/* Comment list */}
      {isLoading && <p className={styles.mutedText}>Loading comments…</p>}

      {!isLoading && loadError && (
        <div className={styles.errorBanner} role="alert">
          <p>{loadError}</p>
          <Button variant="tertiary" onClick={fetchComments}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !loadError && comments.length === 0 && (
        <p className={styles.mutedText} data-testid="comments-empty">
          No comments yet. Add the first update for IT Staff.
        </p>
      )}

      {!isLoading && !loadError && comments.length > 0 && (
        <ul className={styles.list}>
          {comments.map((comment) => (
            <li key={comment.id} className={styles.comment} data-testid="comment-item">
              <div className={styles.commentMeta}>
                <span className={styles.author}>{comment.authorName}</span>
                <span className={styles.roleBadge}>
                  {ROLE_LABELS[comment.authorRole] ?? comment.authorRole}
                </span>
                <span className={styles.timestamp}>
                  {formatDateTime(comment.createdAt)}
                </span>
              </div>
              <p className={styles.content}>{comment.content}</p>
            </li>
          ))}
        </ul>
      )}

      {/* Composer */}
      <form className={styles.form} onSubmit={handleSubmit}>
        {postError && (
          <div className={styles.errorBanner} role="alert" data-testid="comment-error">
            <p>{postError}</p>
          </div>
        )}

        {posted && (
          <p className={styles.successMessage} role="status" data-testid="comment-success">
            Comment posted.
          </p>
        )}

        <label className={styles.label} htmlFor="public-comment">
          Add a comment
        </label>
        <textarea
          id="public-comment"
          name="comment"
          className={styles.textarea}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setPosted(false);
          }}
          rows={4}
          maxLength={MAX_COMMENT_LENGTH}
          disabled={isPosting}
          placeholder="Share an update with IT Staff…"
        />

        <div className={styles.formFooter}>
          <span className={styles.charCount} data-testid="comment-counter">
            {draft.length}/{MAX_COMMENT_LENGTH}
          </span>
          <Button
            variant={isPosting ? "busy" : "primary"}
            busyLabel="Posting…"
            type="submit"
            disabled={!canSubmit}
          >
            Post Comment
          </Button>
        </div>
      </form>
    </section>
  );
}
