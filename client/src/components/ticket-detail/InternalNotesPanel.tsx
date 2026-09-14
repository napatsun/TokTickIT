/**
 * InternalNotesPanel — ui-spec.md §6.6 (IT Staff Ticket Detail) — BR-04, BR-16-18
 *
 * Internal Notes are visible ONLY to IT Staff and Administrators. This panel is
 * deliberately, visibly different from PublicCommentsPanel (FR-23):
 *   - tinted background + amber border instead of the plain surface
 *   - a lock icon before the heading
 *   - a header that states the audience explicitly:
 *     "Internal Notes (IT Staff & Administrator only)"
 *
 * Behaviour (chronological list, append-only composer, 2,000-char counter,
 * draft-preserving failure banner) is shared with Public Comments through
 * ContentThread — only the endpoint, copy, and variant differ.
 *
 * Security note: this panel is a UX affordance, not the boundary. The
 * `/api/staff/tickets/:id/notes` routes are role-guarded server-side and return
 * 403 with no note content to a Requester (SEC-03, SEC-06b).
 */

import ContentThread from "./ContentThread";
import styles from "./ContentThread.module.css";

interface InternalNotesPanelProps {
  /** Path of the internal-notes collection, e.g. "/api/staff/tickets/42/notes". */
  notesPath: string;
}

/** Inline lock icon — pairs with the explicit header text (§9: not colour-only). */
function LockIcon() {
  return (
    <svg
      className={styles.lockIcon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-testid="internal-notes-lock"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export default function InternalNotesPanel({ notesPath }: InternalNotesPanelProps) {
  return (
    <ContentThread
      variant="internal"
      headingId="internal-notes-heading"
      heading="Internal Notes (IT Staff & Administrator only)"
      hint="Private operational notes. Requesters never see this content."
      endpoint={notesPath}
      composerLabel="Add an internal note"
      composerPlaceholder="Add an operational note for IT Staff…"
      submitLabel="Add Note"
      busyLabel="Saving…"
      emptyMessage="No internal notes yet."
      successMessage="Internal note added."
      textareaId="internal-note"
      headingIcon={<LockIcon />}
      testIds={{
        item: "note-item",
        empty: "notes-empty",
        counter: "note-counter",
        success: "note-success",
        error: "note-error",
      }}
    />
  );
}
