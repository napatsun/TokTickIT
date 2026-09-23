# TokTickIT — Sprint 4 UI Specification (`ui-spec.md`)

Design language: **Zen Green** (established Lab 2, extended Lab 3). This document defines the
final screen contracts, states, responsive rules, and accessibility checklist for Lab 4. It
supersedes ambiguity but does not replace `specification.md`, which is authoritative for business
rules.

---

## 1. Design Tokens (reused, not redefined)

| Token | Usage |
|---|---|
| `--color-primary` (Zen Green, e.g. `#1E5B45`) | Header bar, primary buttons, active nav |
| `--color-success` | `Resolved` / `Closed` badges, positive deltas |
| `--color-warning` | `Waiting for Requester`, follow-up-required badge |
| `--color-info` | `Open` / `New` badges |
| `--color-danger` | `Cancelled` badge, validation errors, destructive actions |
| `--color-surface`, `--color-surface-alt` | Card backgrounds |
| `--radius-card` | Card corner radius (reuse Lab 2/3 value) |
| `--shadow-card` | Card elevation (reuse Lab 2/3 value) |

No new colors are introduced in Lab 4; status colors must reuse the exact mapping already used on
Ticket badges in Lab 2/3 so a status reads identically on Dashboard cards, Ticket list rows, and
Ticket Detail.

**Canonical status values used below** (`New`, `Open`, `InProgress`, `WaitingForRequester`,
`Resolved`, `Closed`, `Reopened`, `Cancelled`) are defined once in `specification.md` §5.1 and must
be used verbatim in every `status=` query parameter in this document; the parenthetical prose names
("In Progress", "Waiting for Requester") are display labels only.

**`status=open-work` is not a real status value.** It is a documented client-side/route-level filter
alias recognized by the Ticket List page only, expanding to the full open-work set defined in
`specification.md` BR-14: `status IN (New, Open, InProgress, WaitingForRequester, Reopened)`. It
must never be sent to a dashboard aggregate endpoint — those endpoints (`api-spec.md` §3.1/§3.2)
already return pre-computed counts per individual status/group and have no `status` query parameter
at all.

**Important — the alias is only safe for a drill-down whose card counts the *entire* open-work set.**
Several dashboard cards intentionally count a *subset* of the open-work set (e.g. the Requester
Dashboard's "My Open Tickets" card excludes `InProgress`, because that status has its own separate
card, per `api-spec.md` §3.2). Using `status=open-work` on such a card's drill-down would show more
Tickets than the card's number implies. The rule for every drill-down link in this document is:

> **A card's drill-down must filter on exactly the status set used in that card's `counts.*`
> calculation in `api-spec.md` — no more, no less.** Use the `open-work` alias only when the card's
> calculation *is* the full open-work set; otherwise spell out the exact status list.

The Ticket List page supports comma-separated multi-value `status` filters (e.g.,
`status=InProgress,Reopened`) as well as the `status=open-work` alias, so any card can link to its
precise status set whether or not that set equals the full open-work group.

---

## 2. Screen: IT Staff Dashboard (`/dashboard`, role: IT Staff, Administrator)

### 2.1 Layout
- Header: existing Zen Green app bar with nav items `Dashboard | Create Ticket | Profile`; `Dashboard` shows active-page underline/background per existing nav convention.
- Welcome row: `Welcome back, {firstName}!` + subtitle + a `Refresh` button (manual re-fetch, shows a subtle spinner on the button while loading).
- Metric card row (5 cards, reused Card component): **New**, **Open**, **In Progress** (includes `Reopened` Tickets, `api-spec.md` §3.1), **Waiting for Requester**, **My Assigned**. The first four cards show a delta vs. the last 24 hours (`+3 from yesterday`) rendered with an icon **and** text (not color alone); **My Assigned** shows only the value with no delta chip, since assignment changes are not status transitions and are out of scope for the delta indicator (`api-spec.md` §3.1).
- Two-column content row below the fold:
  - Left (wider): **My Recent Tickets** — list of 5 rows (Ticket code, one-line title, status badge, last-updated timestamp), header includes a `View all` link.
  - Right (narrower): **Quick Actions** — icon buttons: `Create Ticket`, `Search Tickets`, `My Queue`.

### 2.2 Data Contract
Backed by `GET /api/dashboard/staff` (see `api-spec.md`). Every card/list is backend-computed; the UI performs no client-side aggregation of full Ticket collections.

### 2.3 Interaction / Drill-down
| Element | Destination |
|---|---|
| "New" card | `/tickets?status=New` |
| "Open" card | `/tickets?status=Open` |
| "In Progress" card | `/tickets?status=InProgress,Reopened` (multi-value filter — the card count folds `Reopened` into In Progress per `api-spec.md` §3.1, so the drill-down must include both) |
| "Waiting for Requester" card | `/tickets?status=WaitingForRequester` |
| "My Assigned" card | `/tickets?assignee=me&status=New,Open,InProgress,WaitingForRequester,Reopened` — **must** carry this explicit status list (equivalently `status=open-work`, since `counts.myAssigned` in `api-spec.md` §3.1 is scoped to the *full* open-work set for the current assignee and excludes `Closed`/`Cancelled`). Filtering on `assignee=me` alone would surface the user's `Closed`/`Cancelled` Tickets too, which the card's number never counts. |
| Recent Ticket row | `/tickets/:id` (Ticket Detail) |
| "View all" | `/tickets` (unfiltered queue) |
| Quick Action: Create Ticket | `/tickets/new` |
| Quick Action: Search Tickets | `/tickets?focus=search` |
| Quick Action: My Queue | `/tickets?assignee=me&status=open-work` |

The Ticket List page supports comma-separated multi-value `status` filters (e.g., `status=InProgress,Reopened`) in addition to the `status=open-work` alias defined in §1.

### 2.4 States
- **Loading**: skeleton cards (5 placeholder rectangles) + skeleton rows (5 placeholder lines) — reuse Lab 2/3 skeleton component; no layout shift when real data arrives.
- **Empty** (e.g., "My Assigned" = 0): card still renders with value `0` and label unchanged; "My Recent Tickets" empty state shows existing empty-state illustration/text component ("No recent Tickets yet.") with a `Create Ticket` CTA.
- **Forbidden**: `/dashboard` is a single route that renders one of two components based on the authenticated session's role — a Requester session always renders the Requester Dashboard component (§3), never this one, so there is no route to "redirect away from." Defense in depth: even if the wrong component were somehow rendered, `GET /api/dashboard/staff` independently returns `403 Forbidden` for a Requester session (`api-spec.md` §3.1), so no staff data can reach the client to begin with — the UI never renders staff data and then hides it.
- **Safe failure**: on API error, cards show a small inline error state per card group ("Couldn't load metrics — Retry") with a `Retry` button; page does not blank out entirely (partial-failure tolerant).

### 2.5 Responsive
- **Desktop (≥1024px)**: 5 cards in one row; two-column content row (recent list : quick actions ≈ 2:1).
- **Tablet (768–1023px)**: cards wrap 3+2; content row stacks to single column (recent list above quick actions).
- **Mobile (<768px)**: cards stack 1-per-row (or 2-per-row compact) in a vertical scroll; no horizontal scrolling of the card row; recent Ticket rows collapse the timestamp under the title on a second line.

---

## 3. Screen: Requester Dashboard (`/dashboard`, role: Requester)

### 3.1 Layout
- Same header pattern; nav items `My Tickets | Create Ticket | Profile`.
- Welcome row: `Welcome, {firstName}!` + subtitle.
- Metric card row (4 cards): **My Open Tickets**, **In Progress**, **Resolved**, **Closed** — each card includes a `View all` link beneath the value (not just a card-level click, to make the drill-down affordance explicit and screen-reader-labelled).
- Two-column content row: **My Recent Tickets** (5 rows) + **Quick Actions** (`Create Ticket`, `View My Tickets`).

### 3.2 Data Contract
Backed by `GET /api/dashboard/requester`, scoped strictly to `requesterId = current user` at the query layer (never filtered client-side).

### 3.3 Drill-down
| Element | Destination |
|---|---|
| My Open Tickets | `/my-tickets?status=New,Open,WaitingForRequester,Reopened` — **must not** use the `status=open-work` alias here: `counts.myOpen` in `api-spec.md` §3.2 deliberately **excludes `InProgress`** (which has its own dedicated card below), while the `open-work` alias includes it. Using the alias would show more Tickets than the card's number counts. |
| In Progress | `/my-tickets?status=InProgress` |
| Resolved | `/my-tickets?status=Resolved` |
| Closed | `/my-tickets?status=Closed` |
| Recent Ticket row | `/tickets/:id` |
| Quick Action: View My Tickets | `/my-tickets` |

### 3.4 States
Same loading-skeleton, per-card/list empty-state, and safe-partial-failure pattern as §2.4. **Forbidden**: same single-route-renders-by-role pattern as §2.4 — an IT Staff/Administrator session renders the Staff Dashboard (§2), never this component. There is no route or parameter for viewing a different Requester's dashboard; `GET /api/dashboard/requester` (`api-spec.md` §3.2) is always scoped to the caller's own session and accepts no target-user parameter, so "another Requester's data" is not a reachable state to guard against.

### 3.5 Responsive
Same breakpoint behavior as §2.5, with 4 cards instead of 5 (desktop: one row; tablet: 2×2; mobile: stacked).

---

## 4. Screen Addition: Actions Taken Panel (on existing Ticket Detail)

### 4.1 Placement
Appended as a new section below the existing Public Comments and Internal Notes areas on Ticket
Detail, titled **"Actions Taken."** Section header includes a count badge (e.g., "Actions Taken (3)").

### 4.2 View Mode (default, all roles with Ticket access)
- Table/list, one row per non-voided Actions Taken, oldest first: `Date/Time | Description (truncated to 2 lines, "Show more" toggle) | Result | Performed By | Follow-up` (badge: "Follow-up needed" in `--color-warning` or "No follow-up" muted).
- Row expands (accordion) to reveal `Attachment Notes` and, if edited, an "Edited {relativeTime} by {editor}" caption.
- Requesters see this table read-only, identical data, with the "Add Actions Taken" control removed entirely from the DOM (not just visually hidden), per FR-06 ("Requesters do not create or change Actions Taken"). The corresponding server-side enforcement guarantee (control-hiding is never treated as authorization) is BR-15, and is verified independently by `AUTH-04`/`API-27` in `tests.md`.

### 4.3 Create Mode (IT Staff / Administrator only)
- A prominent `+ Add Actions Taken` button opens an inline form (not a full-page navigation) directly above the table.
- Form fields, in order: Action Date/Time (datetime picker, defaults to now, cannot be future — client-validated and server-validated per BR-04), Action Description (textarea, required), Result (textarea, required), Follow-Up Required? (toggle/checkbox), Follow-up Note (textarea, appears/required only when toggle is on — conditional field per BR-05, with a live inline validation message), Attachment Notes (single-line text, optional). "Performed By" is **not** an editable field; it is shown as static text ("Will be recorded as: {currentUser.name}") for transparency.
- Submit button shows a loading spinner and is disabled during submission to prevent double-submit (FR-15); on success, the form collapses and the new row appears at the bottom of the table with a brief highlight animation; on validation error, the offending field is flagged inline with an accessible `aria-describedby` error message and focus moves to the first invalid field.
- Cancel discards the draft after a confirmation if any field has been touched (protects entered data per the Lab 4 handout §8.5, "important forms protect entered data after recoverable failures").

### 4.4 Edit Mode
- Within `EDIT_WINDOW_MINUTES` of creation, the author sees an "Edit" affordance on their own **non-voided** rows; Administrators see "Edit" on every **non-voided** row regardless of window. Edit reuses the create form pre-filled, and on save sets `editedAt`/`editedById` (visible per §4.2).
- Administrators additionally see a "Void" action (soft-delete) requiring a short reason (BR-11), also **only on non-voided rows**.
- **Voided rows are permanently read-only, even for Administrators.** Per `api-spec.md` §1.3, voiding is one-way: once `isVoided = true`, every `PATCH` against that entry — including one attempted by an Administrator, and including one that only touches an unrelated field — is rejected with `409 ENTRY_VOIDED`. Accordingly, a row shown under the "Show voided" toggle (below) renders **no** Edit and **no** Void control at all (not disabled — absent from the DOM, consistent with the hidden-vs-disabled convention used elsewhere in this document), only its data and its void reason/timestamp.
- Voided rows are hidden from the default view but visible under a "Show voided" disclosure toggle for audit purposes (IT Staff/Administrator only — Requesters never see this toggle, since a Requester's `GET /actions?includeVoided=true` call is itself rejected with `403 FORBIDDEN_QUERY_PARAM` per `api-spec.md` §1.2). Toggling it on re-fetches the panel's data via `GET /api/tickets/:ticketId/actions?includeVoided=true`; toggling it off re-fetches with `includeVoided=false` (the default), rather than filtering an already-fetched list client-side, so the toggle's state always reflects what the server actually returned.

### 4.5 States
- **Loading**: skeleton rows matching the table shape.
- **Empty**: "No Actions Taken recorded yet." + (IT Staff/Admin only) inline `+ Add Actions Taken` CTA.
- **Forbidden**: Requester never sees create/edit controls in the DOM.
- **Safe failure**: on submit failure, form retains all entered values and shows a dismissible error banner ("Couldn't save — check your connection and try again"), never clears the draft.

---

## 5. Ticket Status / Workflow Controls (Ticket Detail)

- Status is shown as a badge (reuse Lab 2/3 badge component, non-color cue = badge always includes the status text, never color-only).
- Available transitions render as a button group or a `<select>` + `Update Status` button; **only** transitions permitted for (current status × current role) per `specification.md` §5.1 are present — disabled options are not shown at all, not just grayed out, to avoid confusing empty-permission affordances.
- Attempting `Resolved` when BR-09's Actions-Taken precondition is not met: the button is present (so IT Staff understands the option exists) but disabled with a tooltip/inline note: "Add at least one Actions Taken with a result before resolving."
- On submit, the status control shows a brief loading state (spinner on the "Update Status" button; the badge itself does **not** change yet — this is deliberately *not* optimistic UI, because the transition may be rejected by the server's `version` check, BR-12). On `200 OK`, the badge updates to the server-confirmed status and a toast/inline confirmation appears. On `409 Conflict` (`STALE_VERSION`), the badge and available transitions refresh to the server's returned `currentState` and a non-blocking banner appears ("This Ticket was updated by someone else — refreshed to the latest version"); the user's original submission is discarded and they must re-evaluate and re-submit against the fresh state. On `409 ACTIONS_REQUIRED` or `409 INVALID_STATUS_TRANSITION`, the badge is unchanged and an inline error explains why (§4.5-style safe failure).
- The two `403 Forbidden` outcomes defined in `api-spec.md` §2.1 (`FORBIDDEN_ROLE`, `REOPEN_WINDOW_EXPIRED`) are only reachable here as a **race**, not as a normal user path: because the control only ever renders transitions permitted for the current role/status (per the "hidden, not disabled" rule above), a client would only see one of these codes if the caller's role or the eligibility window changed between when the screen rendered and when the request reached the server (e.g., the reopen window expired in the seconds it took the Requester to click, or the Requester's session/role was revoked). On either `403`, the badge is left unchanged, the status control is re-fetched/re-rendered from a fresh `GET` of the Ticket so any transition that is no longer eligible disappears from the control, and an inline banner explains the outcome in plain language ("This action is no longer available — the page has been refreshed to reflect the Ticket's current state."). This mirrors the `409 STALE_VERSION` refresh-and-discard behavior above rather than treating a `403` here as a validation error on the submitted fields.
- Requester's "This looks resolved to me" is a separate, clearly secondary button (never styled identically to the authoritative status control) with helper text: "Your IT Staff will review and confirm."

---

## 6. Navigation

- `Dashboard` nav item added for all three roles, pointing to the role-appropriate dashboard route; the active state (underline + bold + `aria-current="page"`) follows the existing Lab 2/3 nav convention exactly — no new active-state style is introduced.

---

## 7. Responsive Rules (applies globally, same as Labs 2–3)

| Breakpoint | Rule |
|---|---|
| Desktop ≥1024px | Full multi-column layouts as designed above. |
| Tablet 768–1023px | Card rows wrap; two-column content areas stack to one column where noted. |
| Mobile <768px | Single-column stacking everywhere; tables convert to stacked "card" rows (label:value pairs) rather than horizontally scrolling; no element causes `overflow-x` on `<body>`. |

---

## 8. Accessibility Checklist (must be completed with evidence before submission)

- [ ] All interactive elements (cards, rows, buttons, form fields) are reachable via keyboard `Tab`/`Shift+Tab` in a logical order.
- [ ] A visible focus outline (not just a browser default that a reset stylesheet may have removed) is present on every focusable element.
- [ ] Every status/priority badge conveys meaning via text label, not color alone.
- [ ] Metric cards used as links/buttons have an accessible name that includes both the label and value (e.g., `aria-label="New tickets: 14, view all"`).
- [ ] Form fields have associated `<label>`s; conditional fields (Follow-up Note) are announced when they appear (`aria-live="polite"` region or focus management).
- [ ] Validation errors are programmatically associated with their field (`aria-describedby`) and focus moves to the first error on failed submit.
- [ ] Modal/inline dialogs (if any) trap focus and are dismissible via `Esc`.
- [ ] No content is clipped, no controls overlap, and no page requires horizontal scrolling at any breakpoint in §7.
- [ ] Color contrast for all new text/badges meets at least WCAG AA (4.5:1 normal text, 3:1 large text/icons).
- [ ] Screenshot evidence captured at desktop, tablet, and mobile widths for: IT Staff Dashboard, Requester Dashboard, Actions Taken panel (view + create), and the status transition control.

---

## 9. Removed / Cleaned Up From Earlier Labs

- Any temporary placeholder dashboard stub, unused test routes, or duplicate status-badge components from Labs 2–3 must be removed.
- Any console warnings/errors triggered by these screens must be resolved before submission (§8.5 of the handout).