/**
 * ContentThread — the ONE read/write panel implementation behind both
 * "Public Comments" (ui-spec.md §4/§6.5) and "Internal Notes" (§6.6).
 *
 * Why one component: the two panels share every behaviour the spec describes —
 * chronological oldest-first list, author + role + timestamp, append-only
 * composer, live 2,000-character counter (BR-18), disabled submit while empty or
 * whitespace-only (BR-17), and a failure banner that preserves the draft. Only
 * the endpoint, the copy, the test ids, and the visual variant differ.
 *
 * The variant is NOT cosmetic-only: `variant="internal"` renders the tinted,
 * lock-prefixed panel required by §6.6 so private content can never be mistaken
 * for public content (FR-23). Callers must pass the matching endpoint — the
 * internal variant is only ever pointed at the IT-Staff notes route, which the
 * backend independently restricts to IT Staff/Administrator (BR-04, SEC-06b).
 *
 * BR-18 rendering note: content is rendered as text, so React escapes it.
 */

import { useCallback, useEffect, useState } from "react";
import Badge from "../shared/Badge";
import Button from "../shared/Button";
import { apiClient } from "../../lib/apiClient";
import styles from "./ContentThread.module.css";

// ─── Types ──────────────────────────────────────────────────────────────

export interface ThreadEntry {
  id: string;
  ticketId: number;
  authorId: string;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: string;
}

export interface ContentThreadTestIds {
  item: string;
  empty: string;
  counter: string;
  success: string;
  error: string;
}

export interface ContentThreadProps {
  /** Stable id for the panel heading (aria-labelledby target). */
  headingId: string;
  heading: string;
  hint: string;
  /** Collection path used for both GET and POST. */
  endpoint: string;
  composerLabel: string;
  composerPlaceholder: string;
  submitLabel: string;
  busyLabel: string;
  emptyMessage: string;
  successMessage: string;
  testIds: ContentThreadTestIds;
  /** "public" = plain surface; "internal" = tinted + lock icon (§6.6). */
  variant: "public" | "internal";
  /** Optional element rendered before the heading (used for the lock icon). */
  headingIcon?: React.ReactNode;
  /** Floor for resubmission, e.g. to focus a textarea in tests. */
  textareaId: string;
}

export const MAX_CONTENT_LENGTH = 2000;

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


// ─── Component ──────────────────────────────────────────────────────────

export default function ContentThread({
  headingId,
  heading,
  hint,
  endpoint,
  composerLabel,
  composerPlaceholder,
  submitLabel,
  busyLabel,
  emptyMessage,
  successMessage,
  testIds,
  variant,
  headingIcon,
  textareaId,
}: ContentThreadProps) {
  const [entries, setEntries] = useState<ThreadEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  const trimmedDraft = draft.trim();
  const canSubmit = trimmedDraft.length > 0 && !isPosting;

  const loadLabel = variant === "internal" ? "notes" : "comments";

  // ─── Load ─────────────────────────────────────────────────────────────
  const fetchEntries = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const response = await apiClient(endpoint);

      if (!response.ok) {
        setLoadError(`Couldn't load ${loadLabel}.`);
        return;
      }

      const data = (await response.json()) as { items?: ThreadEntry[] };
      setEntries(Array.isArray(data.items) ? data.items : []);
    } catch {
      setLoadError(`Couldn't load ${loadLabel}.`);
    } finally {
      setIsLoading(false);
    }
  }, [endpoint, loadLabel]);

  useEffect(() => {
    void fetchEntries();
  }, [fetchEntries]);

  // ─── Post ─────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!canSubmit) return;

      setIsPosting(true);
      setPostError(null);
      setPosted(false);

      try {
        const response = await apiClient(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: trimmedDraft }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          setPostError(body?.error?.message ?? `Couldn't post your ${loadLabel}. Please try again.`);
          return; // draft intentionally preserved
        }

        const created = (await response.json()) as ThreadEntry;
        // Append: the list is chronological (oldest-first), newest last (§4).
        setEntries((current) => [...current, created]);
        setPosted(true);
        setDraft("");
      } catch {
        setPostError(
          `Couldn't post your ${loadLabel}. Please check your connection and try again.`,
        );
      } finally {
        setIsPosting(false);
      }
    },
    [canSubmit, endpoint, loadLabel, trimmedDraft],
  );

  const sectionClass = [
    styles.section,
    variant === "internal" ? styles.internalSection : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      className={sectionClass}
      aria-labelledby={headingId}
      data-testid={variant === "internal" ? "internal-notes-panel" : "public-comments-panel"}
      data-variant={variant}
    >
      <h2 className={styles.heading} id={headingId}>
        {headingIcon}
        {heading}
      </h2>
      <p className={styles.hint}>{hint}</p>

      {/* List */}
      {isLoading && <p className={styles.mutedText}>Loading {loadLabel}…</p>}

      {!isLoading && loadError && (
        <div className={styles.errorBanner} role="alert">
          <p>{loadError}</p>
          <Button variant="tertiary" onClick={fetchEntries}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !loadError && entries.length === 0 && (
        <p className={styles.mutedText} data-testid={testIds.empty}>
          {emptyMessage}
        </p>
      )}

      {!isLoading && !loadError && entries.length > 0 && (
        <ul className={styles.list}>
          {entries.map((entry) => (
            <li key={entry.id} className={styles.comment} data-testid={testIds.item}>
              <div className={styles.commentMeta}>
                <span className={styles.author}>{entry.authorName}</span>
                {/* Shared role badge (§9 consistency): the same component and
                    the same per-role colours as the App Shell header and the
                    Administrator user list, so a role never looks different
                    from screen to screen. Text is always present, so colour is
                    never the sole indicator. */}
                <Badge variant="role" value={entry.authorRole} />
                <span className={styles.timestamp}>{formatDateTime(entry.createdAt)}</span>
              </div>
              <p className={styles.content}>{entry.content}</p>
            </li>
          ))}
        </ul>
      )}

      {/* Composer */}
      <form className={styles.form} onSubmit={handleSubmit}>
        {postError && (
          <div
            className={styles.errorBanner}
            role="alert"
            id={`${textareaId}-error`}
            data-testid={testIds.error}
          >
            <p>{postError}</p>
          </div>
        )}

        {posted && (
          <p className={styles.successMessage} role="status" data-testid={testIds.success}>
            {successMessage}
          </p>
        )}

        <label className={styles.label} htmlFor={textareaId}>
          {composerLabel}
        </label>
        <textarea
          id={textareaId}
          name={textareaId}
          className={styles.textarea}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setPosted(false);
          }}
          rows={4}
          maxLength={MAX_CONTENT_LENGTH}
          disabled={isPosting}
          placeholder={composerPlaceholder}
          /* §9: the failure banner and the live character counter are both
             associated with the composer, so a screen reader announces them
             in the context of the field the user is typing into. */
          aria-invalid={postError ? true : undefined}
          aria-describedby={
            postError ? `${textareaId}-error ${textareaId}-counter` : `${textareaId}-counter`
          }
        />

        <div className={styles.formFooter}>
          <span
            className={styles.charCount}
            id={`${textareaId}-counter`}
            data-testid={testIds.counter}
          >
            {draft.length}/{MAX_CONTENT_LENGTH}
          </span>
          <Button
            variant={isPosting ? "busy" : "primary"}
            busyLabel={busyLabel}
            type="submit"
            disabled={!canSubmit}
          >
            {submitLabel}
          </Button>
        </div>
      </form>
    </section>
  );
}
