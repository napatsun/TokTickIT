# Lab 2 UI Specification — Zen Green Theme (TokTickIT)

## 1. Color Tokens

| Token | Hex | Usage |
|---|---|---|
| `--color-primary-green` | `#006B3C` | App header background, primary button fill, strong emphasis text |
| `--color-secondary-green` | `#0B7A46` | Active tab underline, focus ring accent, links, hover states on secondary elements |
| `--color-pale-green` | `#EAF6EF` | Selected row/card background, success panel background, subtle section emphasis |
| `--color-bg-page` | `#F5FAF7` | Page background (near-white, quiet green tint; corrects handout typo `#F5FF7F6`) |
| `--color-surface` | `#FFFFFF` | Card/panel surfaces, with `1px solid #DDE7E1` border and `0 1px 3px rgba(0,0,0,0.06)` shadow |
| `--color-text` | `#1E2B24` | Default body text (dark charcoal-green, not pure black) |
| `--color-text-muted` | `#5B6B62` | Secondary/help text, timestamps |
| `--color-field-editable-bg` | `#FFFFFF` | Editable input background |
| `--color-field-editable-border` | `#C7D3CC` | Editable input border (default state) |
| `--color-field-readonly-bg` | `#F1EFE7` | Read-only field background (warm ivory) |
| `--color-error` | `#B3261E` | Error text/border |
| `--color-error-bg` | `#FBEAE9` | Error message background chip |
| `--color-warning` | `#B8860B` | Warning/amber callout text |
| `--color-warning-bg` | `#FFF6E0` | Warning callout background |
| `--color-success` | `#0B7A46` | Success text (reuses secondary green) |
| `--color-success-bg` | `#EAF6EF` | Success panel background (reuses pale green) |
| `--color-disabled-bg` | `#E9ECEA` | Disabled control background |
| `--color-disabled-text` | `#9AA5A0` | Disabled control text |

**Implementation-added tokens** (added during Badge component implementation — not in original spec handout):

| Token | Hex | Usage |
|---|---|---|
| `--color-priority-low-bg` | `#e8edea` | Priority LOW badge background (gray-green pale, lighter than `--color-pale-green`) |
| `--color-priority-low-text` | `#3d4f46` | Priority LOW badge text |
| `--color-priority-high-bg` | `#fde8e7` | Priority HIGH badge background (red-tinted, lighter than `--color-error-bg`) |
| `--color-priority-high-text` | `#9a1f1a` | Priority HIGH badge text |

Priority MEDIUM badge reuses existing `--color-warning-bg` / `--color-warning` (amber, already in Section 1).

Non-color redundancy: every status/priority badge also carries text (not color alone); every error also carries an icon + message text; disabled controls also carry `cursor: not-allowed` and reduced opacity, not color alone.

## 2. Typography and Spacing

- Font family: system UI stack (`-apple-system, "Segoe UI", Roboto, sans-serif`) — no external font dependency required.
- Base size 16px; H1 24px/700, H2 20px/600, H3 16px/600, body 14–16px/400, help/meta text 12–13px/400.
- Spacing scale (4px base unit): 4, 8, 12, 16, 24, 32, 48px. Form field vertical rhythm: 16px gap between fields, 24px between field groups/sections, 32px before the action row.
- Line length for Description textarea capped at a comfortable reading width (~80ch) even on wide desktop layouts.

## 3. Field States

| State | Visual Treatment |
|---|---|
| Editable, default | White bg, `1px solid var(--color-field-editable-border)`, 6px border-radius |
| Editable, focused | Border becomes `var(--color-secondary-green)`, 2px focus ring (`box-shadow`), never removed for keyboard users |
| Editable, invalid | Border becomes `var(--color-error)`; error message rendered directly below the field in `var(--color-error)` text, 13px, with a small icon |
| Read-only | `var(--color-field-readonly-bg)` background, no border-radius change, text in `var(--color-text-muted)`, no focus ring (not tabbable), subtle "lock" icon optional |
| Disabled | `var(--color-disabled-bg)` background, `var(--color-disabled-text)` text, `cursor: not-allowed`, `aria-disabled="true"` |

Required-field marker: a red asterisk (`*`) immediately after the label text, `var(--color-error)` colored. The asterisk never substitutes for the validation message — both are always present when applicable.

Validation message placement: always directly beneath its field, never only summarized at the top of the form. A form-level summary banner may additionally appear at the top on submit failure, but per-field messages are mandatory regardless.

## 4. Button Hierarchy

| Variant | Style | Usage |
|---|---|---|
| Primary | Solid `var(--color-primary-green)` fill, white text | Submit Ticket, Continue, Post Comment-equivalent primary actions |
| Secondary | White fill, `var(--color-secondary-green)` border and text | Cancel, Change Requester |
| Tertiary | Text-only, `var(--color-secondary-green)` | "Clear filters", "View all" links |
| Destructive | White fill, `var(--color-error)` border and text; solid `var(--color-error)` fill on the confirm step | Remove Attachment (confirm step) |
| Disabled | `var(--color-disabled-bg)`/`var(--color-disabled-text)`, no hover effect | Any button whose action is currently unavailable |
| Busy | Same fill as Primary but with a spinner replacing/preceding the label and label text such as "Submitting…"; button is disabled during busy state | Submit button while a request is in flight |

Every icon-only button (e.g., a small "×" remove icon) has a visible `aria-label` and a native `title` tooltip.

## 5. Screen: Development Requester Selection

**Layout:** Centered single-column card, max-width ~480px, on `--color-bg-page`.

**Elements, top to bottom:**
1. TokTickIT wordmark/logo
2. Heading: "Select Development Requester"
3. Explanatory banner (amber `--color-warning-bg`, not an error color): "This is for testing only and is not a login screen."
4. Label "Development Requester *" + dropdown (native `<select>` or accessible combobox) populated from `GET /api/dev-requesters`
5. Helper text: "Only active development requesters are shown."
6. Info callout (pale-green): "Authentication coming in Lab 3 — this selection will be replaced with secure authentication."
7. Action row: secondary "Cancel" (disabled/no-op in Lab 2, or hidden) + primary "Continue" (disabled until a Requester is chosen)

**States:**
- *Loading*: dropdown replaced by a skeleton/placeholder with a spinner and text "Loading requesters…"
- *Empty* (no active Requesters returned): dropdown area replaced by a message "No active Development Requesters are available. Please contact the administrator." Continue button disabled.
- *Error* (API failure): red-bordered inline banner "Could not load Development Requesters. [Retry]" — Retry re-issues the request.
- *Success/selected*: Continue enabled; on click, stores the selection and navigates to My Tickets.

**Accessibility:** dropdown has a real `<label for>` association; all interactive elements reachable via Tab; Continue is keyboard-activatable (Enter/Space).

## 6. Application Shell

- Header bar: `var(--color-primary-green)` background, white TokTickIT wordmark on the left.
- Primary nav: "My Tickets" | "Create Ticket" — active item shown with a `var(--color-secondary-green)` underline/pill and higher-weight text; both keyboard and mouse operable.
- Right side: current Requester's name in a rounded pill badge + a "Change Requester" secondary button, which returns to the Selection screen (clearing the stored selection).
- Mobile (<768px): nav collapses into a hamburger menu; the current-Requester pill remains visible or moves into the menu, but is never hidden entirely.

## 7. Screen: Create Ticket

**Layout (desktop ≥992px):** Single card, max-width ~840px, centered, sections stacked top-to-bottom as below; two-column sub-grid within the "Classification" section only.

1. **Header row** — "Create Ticket" title + (once submitted successfully) a read-only "Ticket Number" chip.
2. **System-generated info (read-only)** — Ticket Date (blank/"—" before submission; filled after success). Shown so the layout doesn't jump between create and post-success states.
3. **Classification (2-column grid on desktop, stacked on mobile)** — Category* (select), Related System* (select).
4. **Requested Priority*** — segmented control or select with 3 options: Low / Medium / High, each also shown as a small colored badge preview.
5. **Summary*** — single-line text input, 120 max length enforced live with a small "n/120" counter.
6. **Description*** — multiline textarea, resizable vertically only, min-height ~120px, 2000 max length with live counter.
7. **Attachments** — drag-and-drop + "Browse files" button; shows a running list of selected files with name, size, and a remove (×) icon before submission; inline error per rejected file (wrong type / too large); counter "n/5".
8. **Actions** — Secondary "Cancel" (returns to My Tickets, discarding the form) + Primary "Submit Ticket" (busy state while in flight).

**Post-submit states:**
- *Success*: the whole form area is replaced by a pale-green success panel showing the generated Ticket Number in large text, a short confirmation sentence, and two actions: "View Ticket" (goes to Ticket Detail) and "Create Another Ticket" (resets the form).
- *Validation failure*: form remains, invalid fields get red borders + messages beneath them, and a form-level summary banner appears above the fields listing "Please fix N field(s) below." Focus moves to the first invalid field.
- *API/server failure*: a red banner appears above the Actions row: "We couldn't submit your ticket. Please try again." All field values remain exactly as entered; the Submit button returns to its normal (non-busy) enabled state.
- *Attachment rejected*: the specific file's row shows a red inline message ("Exceeds 5 MB limit" / "Unsupported file type") and is not added to the pending list; other valid selections are unaffected.

**Tablet (768–991px):** Classification grid becomes single-column but Summary/Description keep full available width (2-column form abandoned in favor of readability).

**Mobile (<768px):** Everything stacks vertically; Attachments list shows filename truncated with ellipsis in the middle (never hiding the extension) plus full name on tap/focus; Actions row buttons become full-width and stack (Submit above Cancel).

## 8. Screen: My Tickets

**Layout (desktop ≥992px):** Full-width page (max-width ~1200px centered).

1. **Page header** — "My Tickets" title + subtitle "View and track all of your support requests." + primary "Create Ticket" button top-right.
2. **Controls row** — Search input (icon + placeholder "Search by ticket number or summary…"), Category filter, Requested Priority filter, Current Status filter, Sort dropdown (Created Date / Last Updated, each asc/desc), "Clear filters" tertiary button (visible only when ≥1 filter/search is active).
3. **Table (desktop)** — columns: Ticket No., Created Date, Summary, Category, Requested Priority (badge), IT Priority (badge or "—"), Current Status (badge), Ticket Owner ("Unassigned" if null), Last Updated. Rows are clickable (whole row, not just the ticket number) and keyboard-focusable, navigating to Ticket Detail.
4. **Pagination footer** — "Showing X to Y of Z tickets" + Previous/Next + page number buttons, matching the handout example.

**States:**
- *Loading*: skeleton rows (5–8 placeholder rows) instead of the table body; controls row remains interactive-looking but disabled during initial load.
- *Empty* (zero tickets ever): illustration/icon + "You haven't created any tickets yet." + primary "Create your first ticket" button. Controls row (search/filter) is hidden or disabled in this exact state since there is nothing to search.
- *No results* (filters active, zero matches): "No tickets match your search/filters." + tertiary "Clear filters" button. Controls row remains visible and active.
- *Error*: red banner replacing the table area: "Couldn't load your tickets. [Retry]".

**Badges:** Requested/IT Priority — Low (gray-green pale bg), Medium (amber), High (red-tinted, not full error red to distinguish "high priority" from "error"). Current Status — New (pale-green bg, secondary-green text) is the only value in Lab 2 but the badge component supports future values.

**Tablet (768–991px):** Table becomes a condensed 2-column-per-row card-like table (fewer visible columns: Ticket No., Summary, Status, Last Updated primarily; remaining fields revealed on row expand or in Ticket Detail).

**Mobile (<768px):** Table replaced entirely by a stacked card list — each card shows Ticket No. + Status badge on the top line, Summary below, then a meta row (Category · Requested Priority · Last Updated) in muted small text. Cards are full-width, tappable, with adequate (≥44px) touch target height.

## 9. Screen: Requester Ticket Detail

**Layout (desktop ≥992px):** Two-region layout — Ticket header info block (top) and Attachments panel (below), clearly visually separated (divider + section heading), consistent with excluding Comments/Notes/Actions Taken from Lab 2.

1. **Back link** — "← Back to My Tickets" at the top.
2. **Header block (read-only grid, 2–3 columns on desktop, 1 column on mobile):** Ticket No., Ticket Date, Category, Related System, Requester (always the current Requester's own name here), Requested Priority (badge), IT Priority (badge or "Not yet assigned"), Current Status (badge), Ticket Owner ("Not yet assigned" if null).
3. **Summary / Description block** — Summary as a subheading-style line, Description in a read-only multi-line block below.
4. **Resolution Summary** — "No resolution summary available yet." shown in muted italic text when null.
5. **Attachments panel** — heading "Attachments (n active)"; each active attachment row shows filename, size, uploaded date, Download button, Remove (destructive) button. A separate, visually distinct "Removed" sub-section (collapsed/expandable, muted styling) lists removed attachments with filename, size, removed date, and removal reason — no download/preview control at all, replaced by a muted "Unavailable" label.
6. **Add Attachment control** — same drag-and-drop/Browse component as Create Ticket, reused as a shared component, disabled once 5 active attachments exist (with a message explaining why).

**Remove flow:** clicking Remove opens a small confirm dialog requiring a removal reason (textarea, 3–200 chars) before the destructive "Confirm Removal" button becomes enabled; Cancel closes without changes.

**States:**
- *Loading*: header block and attachments panel both show skeletons.
- *Not found / not owned*: page shows a centered message "Ticket not found." with a "Back to My Tickets" button — never partial data.
- *Add-attachment error*: inline message under the drop zone identical in style to Create Ticket's attachment errors.
- *Download of removed attachment attempted via stale link*: results in the same "not found" safe message, never a broken/blank response.

**Mobile (<768px):** Header grid collapses to a single column of label/value pairs; Attachments rows stack file info above its action buttons (full-width buttons) rather than side-by-side.

## 10. Shared Component Rules (recap)
- Labels always above their control, consistent weight (600) and 13–14px size.
- One consistent input height (40px) across all text/select inputs; Description textarea alone is taller (≥120px) and vertically resizable only, never horizontally, and never so tall it pushes Attachments off-screen without scrolling.
- Icons never replace required button text; they may sit alongside it.
- Focus outlines use the secondary-green ring at 2px and are never suppressed with `outline: none` without a replacement focus style.

## 11. Responsive Rules Summary

| Viewport | Rule |
|---|---|
| Desktop ≥992px | Multi-column layout as specified per screen; page content centered with max-width; table view for My Tickets |
| Tablet 768–991px | Two-column where practical; Summary/Description get full width; My Tickets table condenses columns |
| Mobile <768px | Everything stacks vertically; buttons full-width and touch-friendly (≥44px height); My Tickets becomes a card list; no horizontal page scroll under any circumstance |
| All sizes | No clipped labels, no overlapping validation messages, no hidden buttons, attachment filenames never fully hidden (truncate with ellipsis, full name available on focus/tap) |

## 12. Visual Inspection Checklist (used for Part 9 of the submission)

- [ ] Primary/secondary/pale green tokens match the hex values in Section 1 exactly (checked via computed style, not eyeballing)
- [ ] Editable vs. read-only fields are visually distinguishable at a glance on every screen
- [ ] Every required field shows both the asterisk and (when invalid) a message directly beneath it
- [ ] Button hierarchy (primary/secondary/tertiary/destructive/disabled/busy) is visually distinct and consistent across all 4 screens
- [ ] No clipped text, overlapping elements, or unintended horizontal scroll at 1280px, 834px, and 375px widths (Playwright screenshots stored under `artifacts/lab-02/screenshots/{create-ticket,my-tickets,ticket-detail}/{desktop,tablet,mobile}.png`)
- [ ] Priority and Status badges use consistent shapes/colors across My Tickets and Ticket Detail
- [ ] Empty state and No-results state in My Tickets are visually distinguishable from each other
- [ ] Focus indicator is visible when tabbing through Create Ticket and the Attachment remove-confirmation dialog