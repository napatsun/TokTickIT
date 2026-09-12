# TokTickIT — Sprint 3 UI Specification (Zen Green)

Reuses all Lab 2 Zen Green tokens: color palette, spacing scale, typography, card/badge/button components, form validation placement, and responsive breakpoints (mobile < 640px, tablet 640–1024px, desktop > 1024px). New screens must not introduce a second visual language.

---

## 1. Global Application Shell

**Purpose:** Wraps every authenticated screen; shows identity and role-scoped navigation.

**Elements**
- Top bar: product wordmark, current user's **Name** + **Role badge** (Requester / IT Staff / Administrator), **Logout** button.
- Left/top nav (responsive collapses to a hamburger menu on mobile): only destinations permitted for the current role are rendered — never rendered-but-disabled.
  - Requester: "My Tickets", "Create Ticket".
  - IT Staff: "Ticket Queue".
  - Administrator: "User Management".
- Removed from Lab 2: Development Requester dropdown and "Change Requester" action — fully deleted, not hidden.

**Modes:** N/A (structural shell). **Feedback:** a full-shell skeleton loader while `GET /api/auth/me` resolves on app boot; redirect to Login on 401.

---

## 2. Login Screen

**Route:** `/login` (public)

**Fields:** Email (text, required, email format), Password (password input, required), "Log in" button.

**States**
| State | Behavior |
|---|---|
| Idle | Fields empty/focused, button enabled once both fields non-empty |
| Validating | Inline field errors below each input (e.g., "Enter a valid email") |
| Busy | Button shows spinner + "Logging in…"; inputs disabled |
| Failure (invalid credentials) | Single generic banner: "Invalid email or password." No field-specific blame. |
| Failure (inactive account) | Single generic banner: "This account is unavailable. Contact your administrator." (Does not say "inactive" explicitly to avoid confirming account existence state beyond necessity — matches BR-09.) |
| Failure (server error) | Generic banner: "Something went wrong. Please try again." |
| Success | Redirect to Change Password (if `mustChangePassword`) or role home screen |

**Accessibility:** Labels bound to inputs via `for`/`id`; error banner has `role="alert"`; Enter key submits form; visible focus ring using Zen Green focus token.

---

## 3. Mandatory Change Password Screen

**Route:** `/change-password` (authenticated, forced when `mustChangePassword = true`; all other authenticated routes redirect here until resolved)

**Fields:** New Password, Confirm New Password, "Save and Continue" button. No "Current Password" field required in Lab 3 (user already authenticated with the initial password).

**Validation**
- Minimum 8 characters, at least one letter and one number (inline hint shown below field, always visible, not just on error).
- Confirm must match New Password exactly.

**States:** Idle → Validating (inline errors) → Busy (saving) → Success (redirect into app, `mustChangePassword` cleared) → Failure (safe generic error banner, e.g., "Could not update password. Please try again.").

**Guard rule:** Attempting to navigate away (deep link, back button, direct URL) to any other authenticated route while `mustChangePassword = true` redirects back here — enforced by both route guard (UX) and backend 403 on any non-exempt endpoint (security).

---

## 4. Requester — Ticket List / Detail (Regression + New)

**Route:** `/tickets` (list), `/tickets/:id` (detail) — Requester role

**Regression:** All Lab 2 list/detail/create/attachment functionality is preserved, now scoped to `req.session.userId` instead of a selector value. No visual change required beyond removing the selector from the shell.

**New — Public Comments panel (Ticket Detail):**
- Reads: reverse-chronological list of Public Comments, each showing author name, role badge, timestamp, content.
- Write: textarea (max 2,000 chars, live counter), "Post Comment" button, disabled while empty/whitespace-only.
- States: Idle, Busy (posting), Success (comment appended optimistically or on confirmed response), Failure (inline banner above the textarea, comment text preserved so the user doesn't lose their draft).

**New — "Problem Appears Resolved" action:**
- Button visible only when Ticket status is one of `OPEN, IN_PROGRESS, WAITING_FOR_REQUESTER` and `requesterMarkedResolved = false`.
- On click: confirmation dialog ("This tells IT Staff the issue seems fixed. IT Staff will still need to formally close the ticket. Continue?") → Confirm → Busy → Success (badge "You marked this as resolved on {date}" appears; button hides) → Failure (safe banner, state unchanged).
- This action never changes the visible **Status** badge — the Status badge and the "Requester marked resolved" indicator are visually distinct elements so users are not confused about formal ticket state.

---

## 5. IT Staff Ticket Queue

**Route:** `/staff/queue` — IT Staff, Administrator

**Layout (desktop):** Table matching the handout mock — columns: Ticket No., Created Date, Summary, Category, Req. Priority, IT Priority, Status, Owner, with an "Open" row action.

**Controls**
- Search box: "Search by ticket number or summary…" (debounced, min 2 chars).
- Filters panel: Status (multi- or single-select — Lab 3 requires only basic filtering, single active filter set at a time per column is sufficient), Priority, Ownership ("Unassigned" / "Mine" / "All").
- Sort: clickable column headers for sortable fields (Created Date, IT Priority, Status) with asc/desc indicator.
- Pagination: "Showing X to Y of Z tickets" + Previous/Next + page numbers, matching handout mock exactly.

**Responsive (mobile/tablet):** Table collapses to a stacked card list — one card per Ticket showing Ticket No., Summary, Status badge, IT Priority badge, Owner, Created Date, with the same "Open" action; search/filter/sort controls move into a collapsible "Filters" drawer.

**States**
| State | Behavior |
|---|---|
| Loading | Skeleton rows (desktop) / skeleton cards (mobile) |
| Populated | Table/cards as above |
| Empty (no tickets at all) | Centered message: "No tickets yet." |
| No results (search/filter yields nothing) | "No tickets match your search/filters." + "Clear filters" action |
| Failure | Retry banner: "Couldn't load the queue. Retry." |

---

## 6. IT Staff Ticket Detail

**Route:** `/staff/tickets/:id` — IT Staff, Administrator

**Layout:** Extends the Lab 2 Ticket Detail layout with grouped sections:
1. **Ticket Header:** Ticket No., Summary, Category, Related System, Created Date, Requester name — read-only.
2. **Ownership & Priority (editable):**
   - Owner: shows current owner or "Unassigned"; "Claim" button (only when unassigned) or "Reassign" (dropdown of active IT Staff/Administrator, only when already assigned or to change owner).
   - Requested Priority: read-only badge.
   - IT Priority: editable select (Low/Medium/High/Urgent — same scale as Requested Priority), saves on change with inline confirmation.
3. **Status:** current Status badge + "Change Status" control showing only the statuses permitted from the current state (per transition matrix in §7 below); a confirmation dialog is required for terminal/irreversible-feeling transitions (Resolved, Closed, Cancelled).
4. **Requester Signal:** if `requesterMarkedResolved = true`, a distinct info banner: "Requester marked this as appears-resolved on {date}."
5. **Public Comments:** same component as Requester view, but IT Staff can also post here.
6. **Internal Notes:** visually distinct panel — different background tint + a lock icon + header "Internal Notes (IT Staff & Administrator only)" — to make accidental cross-posting very unlikely. Same write/read pattern as Public Comments (append-only, 2,000 char limit, author + timestamp).
7. **Attachments:** Lab 2 attachment list, read-only continuity (view/download only in Lab 3).

**States:** Standard Loading / Populated / Forbidden (403 → "You don't have access to this ticket.") / Not Found (404 → "Ticket not found.") / Failure (retry banner) for the page as a whole; each editable control (Owner, IT Priority, Status) has its own inline Busy/Success/Failure micro-state so one failed action doesn't block the rest of the screen.

### 6.1 Ticket Status Transition Matrix (permitted, IT Staff/Administrator only)

| From ↓ / To → | Open | In Progress | Waiting for Requester | Resolved | Closed | Reopened | Cancelled |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| New | ✔ | ✔ | | | | | ✔ |
| Open | | ✔ | ✔ | | | | ✔ |
| In Progress | | | ✔ | ✔ | | | ✔ |
| Waiting for Requester | | ✔ | | ✔ | | | ✔ |
| Resolved | | | | | ✔ | ✔ | |
| Closed | | | | | | ✔ | |
| Reopened | | ✔ | ✔ | | | | ✔ |
| Cancelled | | | | | | | |

Any cell left blank is a non-permitted transition and must be rejected with 409 by the backend (BR-19) and simply not offered as an option in the "Change Status" control on the frontend.

---

## 7. Administrator — User Management

**Route:** `/admin/users` — Administrator only

**List view**
- Columns: Name, Email, Role (badge), Status (Active/Inactive badge), Edit action.
- Search box: "Search by name or email…".
- Role filter: single-select dropdown (All / Requester / IT Staff / Administrator).
- No pagination, multi-column sort, or multi-filter required (explicitly excluded) — a simple scrollable list is sufficient for the seeded data volume.
- "Create User" button (top-right) opens the Create modal/panel.

**Create User (modal or side panel)**
- Fields: Name, Email, Role (single-select), Active (toggle, default true), Initial Password (text, admin-set; helper text: "User must change this password at first login").
- Validation: required fields, valid email format, duplicate-email check (inline error under Email: "This email is already in use.").
- States: Idle → Validating → Busy (Creating…) → Success (toast "User created." + list refreshes + modal closes) → Failure (generic banner inside modal, form values preserved).

**Edit User (modal or side panel)**
- Editable: Name, Email, Role, Active toggle.
- Separate, clearly labeled sub-action: **"Set New Initial Password"** (its own small form/button, distinct from the main Save action) — sets a new password and forces `mustChangePassword = true` for that user; requires its own confirmation ("This resets {name}'s password. They will need to set a new one at next login. Continue?").
- Guard rules surfaced in UI (in addition to backend enforcement):
  - If this is the currently logged-in Administrator: the Active toggle is disabled with tooltip "You cannot deactivate your own account."
  - If this is the last active Administrator: the Role select and Active toggle are disabled with tooltip "At least one active Administrator is required."
- States: same Idle/Validating/Busy/Success/Failure pattern as Create.

**Feedback states for the whole screen:** Loading (skeleton list), Empty (no users — should not realistically occur post-seed, but message: "No users found."), No results (search/filter yields nothing + "Clear filters"), Forbidden (non-Administrator hitting the route directly → redirect + toast "You don't have access to this page."), Failure (retry banner).

---

## 8. Screen Modes and Feedback Matrix (Cross-Cutting)

Every screen above must implement, where applicable: **Loading, Populated/View, Create, Edit, Validating, Busy/Saving, Success, Empty, No-Results, Forbidden, Not-Found, Conflict, Safe-Failure.** "Safe failure" always means a generic, non-leaking message plus a retry affordance — never a raw stack trace or backend error string.

## 9. Responsive and Accessibility Requirements

Same baseline as Lab 2, applied to all new/modified screens:
- All screens usable without horizontal scroll at 375px (mobile), 768px (tablet), and 1280px+ (desktop) widths.
- All interactive controls reachable and operable via keyboard (Tab/Shift+Tab/Enter/Space); visible focus indicator using the Zen Green focus token.
- Color is never the sole indicator of state — Status/Priority/Role badges pair color with text label.
- Form errors are associated with their field via `aria-describedby` and announced via `role="alert"` regions.
- Sufficient color contrast (WCAG AA) maintained for all new badge/banner colors introduced (e.g., the Internal Notes panel tint).
- Screenshots for Part 9 of the submission must demonstrate: no clipping, no overlap, no horizontal overflow, consistent badge rendering, and correct editable-vs-read-only field styling across desktop/tablet/mobile for: Login, Change Password, Requester Ticket Detail (with Public Comments), IT Staff Queue, IT Staff Ticket Detail (with Internal Notes visible), and Admin User Management.