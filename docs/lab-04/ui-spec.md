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
| `--color-success` | `RESOLVED` / `CLOSED` badges, positive deltas |
| `--color-warning` | `WAITING_FOR_REQUESTER`, follow-up-required badge |
| `--color-info` | `OPEN` / `NEW` badges |
| `--color-danger` | `CANCELLED` badge, validation errors, destructive actions |
| `--color-surface`, `--color-surface-alt` | Card backgrounds |
| `--radius-card` | Card corner radius (reuse Lab 2/3 value) |
| `--shadow-card` | Card elevation (reuse Lab 2/3 value) |

No new colors are introduced in Lab 4; status colors must reuse the exact mapping already used on
Ticket badges in Lab 2/3 so a status reads identically on Dashboard cards, Ticket list rows, and
Ticket Detail.

**Canonical status values used below** (`NEW`, `OPEN`, `IN_PROGRESS`, `WAITING_FOR_REQUESTER`,
`RESOLVED`, `CLOSED`, `REOPENED`, `CANCELLED`) are defined once in `specification.md` §5.1 and must
be used in every `status=`/`currentStatus=` query parameter in this document; the prose names
("In Progress", "Waiting for Requester") are display labels applied only at render time by the
badge component.

**Implementation Note (`feature/lab4-07-final-hardening-regression`) — case-insensitive filter
tolerance.** The server normalizes inbound status filters: both Ticket List endpoints trim and
upper-case each comma-separated value (`server/src/routes/staff-tickets.ts` for the staff queue's
`status` param, `server/src/app.ts`'s `GET /api/tickets` for the requester list's `currentStatus`
param) before validating against the enum, so `status=InProgress` matches `IN_PROGRESS`. This
tolerance exists so older Lab 2/3 links keep working; it is a leniency, not a second canonical
form — every drill-down documented here uses the UPPER_SNAKE_CASE spelling.

**`status=open-work` is not a real status value.** It is a documented client-side/route-level filter
alias recognized by both Ticket List pages only (staff queue and requester list), expanding to the
full open-work set defined in `specification.md` BR-14: `status IN (NEW, OPEN, IN_PROGRESS,
WAITING_FOR_REQUESTER, REOPENED)`. It
must never be sent to a dashboard aggregate endpoint — those endpoints (`api-spec.md` §3.1/§3.2)
already return pre-computed counts per individual status/group and have no `status` query parameter
at all.

**Important — the alias is only safe for a drill-down whose card counts the *entire* open-work set.**
Several dashboard cards intentionally count a *subset* of the open-work set (e.g. the Requester
Dashboard's "My Open Tickets" card excludes `IN_PROGRESS`, because that status has its own separate
card, per `api-spec.md` §3.2). Using `status=open-work` on such a card's drill-down would show more
Tickets than the card's number implies. The rule for every drill-down link in this document is:

> **A card's drill-down must filter on exactly the status set used in that card's `counts.*`
> calculation in `api-spec.md` — no more, no less.** Use the `open-work` alias only when the card's
> calculation *is* the full open-work set; otherwise spell out the exact status list.

The Ticket List pages support comma-separated multi-value `status` filters (e.g.,
`status=IN_PROGRESS,REOPENED`) as well as the `status=open-work` alias, so any card can link to its
precise status set whether or not that set equals the full open-work group.

---

## 2. Screen: IT Staff Dashboard (`/dashboard`, role: IT Staff, Administrator)

### 2.1 Layout
- Header: existing Zen Green app bar. Nav items for IT Staff/Administrator: `Dashboard | Ticket Queue` (+ `User Management` for Administrator) — the queue is the role's home page; `Dashboard` shows active-page underline/background per existing nav convention.
- Welcome row: `Welcome back, {firstName}!` + subtitle + a `Refresh` button (manual re-fetch, shows a subtle spinner on the button while loading).
- Metric card row (5 cards, reused Card component): **New**, **Open**, **In Progress** (includes `REOPENED` Tickets, `api-spec.md` §3.1), **Waiting for Requester**, **My Assigned**. The first four cards show a delta vs. the last 24 hours (`+3 from yesterday`) rendered with an icon **and** text (not color alone); **My Assigned** shows only the value with no delta chip, since assignment changes are not status transitions and are out of scope for the delta indicator (`api-spec.md` §3.1).
- Two-column content row below the fold:
  - Left (wider): **My Recent Tickets** — list of 5 rows (Ticket code, one-line title, status badge, last-updated timestamp), header includes a `View all` link.
  - Right (narrower): **Quick Actions** — icon buttons: `Search Tickets`, `My Queue` (§2.3's Implementation Note explains why there is no `Create Ticket` action on the staff side).
- Second content row (added 2026-10-28, `specification.md` FR-17/FR-18 — the assignment's "current-user actions taken" + "recent or urgent tickets" requirements):
  - Left: **My Actions Taken** — the current IT Staff/Administrator user's 5 newest non-voided Actions Taken entries, newest `actionDateTime` first. Each row: Ticket number (drill-down to `/staff/tickets/:id`), one-line truncated description (with the full text as the row's accessible name/tooltip), action date/time, and a `Follow-up` badge when `followUpRequired = true`. The panel header carries **My follow-ups needed: N** (`myActions.followUpCount`, `api-spec.md` §3.1). Empty state: "No Actions Taken recorded yet." A Requester never sees this panel (the whole Dashboard is staff-only, §2.4).
  - Right: **Urgent Tickets** — the 5 longest-waiting `URGENT` open-work Tickets across the whole queue. Each row: Ticket number, one-line title, status badge, IT Priority badge, owner name or "Unassigned"; header carries a `View all urgent` link (§2.3). Empty state: "No urgent Tickets right now." `HIGH` is deliberately **not** treated as urgent (`specification.md` §11 decision 8), so the panel's rows always equal the `priority=URGENT` queue it links to.
- New `data-testid`s for the two new sections (existing ids unchanged): `my-actions-section`, `my-actions-row`, `my-actions-empty`, `my-actions-error`, `my-actions-skeleton`, `my-followups-count`, `urgent-tickets-section`, `urgent-ticket-row`, `urgent-tickets-empty`, `urgent-tickets-error`, `urgent-tickets-skeleton`, `urgent-view-all-link`.

### 2.2 Data Contract
Backed by `GET /api/dashboard/staff` (see `api-spec.md`). Every card/list is backend-computed; the UI performs no client-side aggregation of full Ticket collections.

### 2.3 Interaction / Drill-down

**Implementation Note (`feature/lab4-07-final-hardening-regression`).** The shipped Ticket List is
the IT Staff Queue at `/staff/queue` (component `StaffQueuePage`, served at `/staff/queue`, with a
nav item labelled "Ticket Queue") — there is no separate `/tickets` staff list. The staff
drill-downs below therefore target `/staff/queue` with the documented query parameters, and the
"My Assigned"/"My Queue" scope parameter is `owner=me` (`ownerId` — see `specification.md` §7.2's
Implementation Note renaming `assigneeId`), verified against `StaffDashboard.tsx` and asserted by
E2E-03 in `e2e/lab-04/dashboards.spec.ts`. An earlier draft of this table pointed at
`/tickets?assignee=me&…`; both the route and the parameter name were corrected to the shipped
implementation.

| Element | Destination |
|---|---|
| "New" card | `/staff/queue?status=NEW` |
| "Open" card | `/staff/queue?status=OPEN` |
| "In Progress" card | `/staff/queue?status=IN_PROGRESS,REOPENED` (multi-value filter — the card count folds `REOPENED` into In Progress per `api-spec.md` §3.1, so the drill-down must include both) |
| "Waiting for Requester" card | `/staff/queue?status=WAITING_FOR_REQUESTER` |
| "My Assigned" card | `/staff/queue?owner=me&status=NEW,OPEN,IN_PROGRESS,WAITING_FOR_REQUESTER,REOPENED` — **must** carry this explicit status list (equivalently `status=open-work`, since `counts.myAssigned` in `api-spec.md` §3.1 is scoped to the *full* open-work set for the current owner and excludes `CLOSED`/`CANCELLED`). Filtering on `owner=me` alone would surface the user's `CLOSED`/`CANCELLED` Tickets too, which the card's number never counts. |
| Recent Ticket row | `/staff/tickets/:id` (IT Staff Ticket Detail, internal integer id) |
| "View all" | `/staff/queue` (unfiltered queue) |
| "My Actions Taken" row | `/staff/tickets/:id` (IT Staff Ticket Detail; the row's Ticket number is the link, and the row itself is the button)
| "Urgent Tickets" row | `/staff/tickets/:id`
| "View all urgent" | `/staff/queue?priority=URGENT` (the queue seeds its IT Priority filter from this parameter, so the list matches the panel exactly)
| Quick Action: Search Tickets | `/staff/queue?focus=search` |
| Quick Action: My Queue | `/staff/queue?owner=me&status=open-work` |

(An earlier draft listed a `Create Ticket` Quick Action targeting `/tickets/new`; that route is
Requester-only in the shipped route guards, so the IT Staff Dashboard ships only the two Quick
Actions above — `Search Tickets` and `My Queue`.)

The staff queue supports comma-separated multi-value `status` filters (e.g.,
`status=IN_PROGRESS,REOPENED`) in addition to the `status=open-work` alias defined in §1.

### 2.4 States
- **Loading**: skeleton cards (5 placeholder rectangles) + skeleton rows (5 placeholder lines) — reuse Lab 2/3 skeleton component; no layout shift when real data arrives.
- **Empty** (e.g., "My Assigned" = 0): card still renders with value `0` and label unchanged; "My Recent Tickets" empty state renders the "No recent Tickets yet." empty-state component (asserted by UI-09/UI-10 in `tests.md`); the Requester Dashboard's quick panel carries the `Create Ticket` CTA (§3.1).
- **Forbidden**: `/dashboard` is a single route that renders one of two components based on the authenticated session's role — a Requester session always renders the Requester Dashboard component (§3), never this one, so there is no route to "redirect away from." Defense in depth: even if the wrong component were somehow rendered, `GET /api/dashboard/staff` independently returns `403 Forbidden` for a Requester session (`api-spec.md` §3.1), so no staff data can reach the client to begin with — the UI never renders staff data and then hides it.
- **Safe failure**: on API error, cards show a small inline error state per card group ("Couldn't load metrics — Retry") with a `Retry` button; page does not blank out entirely (partial-failure tolerant).
- **My Actions Taken / Urgent Tickets** (added 2026-10-28): each is its own loading/empty/safe-failure unit, exactly like the metric and recent groups above. Loading renders 5 skeleton rows with `aria-busy="true"` and no layout shift; empty renders the documented empty-state text (the header count stays visible as `0`); failure renders "Couldn't load your Actions Taken." / "Couldn't load urgent tickets." with a `Retry` button in a `role="alert"` region — never a stack trace — while every other section keeps rendering its own data (a failure in one section must not blank the others).

### 2.5 Responsive
- **Desktop (≥1024px)**: 5 cards in one row; two-column content row (recent list : quick actions ≈ 2:1).
- **Tablet (768–1023px)**: cards wrap 3+2; content row stacks to single column (recent list above quick actions).
- **Mobile (<768px)**: cards stack 1-per-row (or 2-per-row compact) in a vertical scroll; no horizontal scrolling of the card row; recent Ticket rows collapse the timestamp under the title on a second line.
- **New sections** (added 2026-10-28): the second content row is 2 columns (My Actions Taken : Urgent Tickets ≈ 1:1) on desktop and stacks to one column on tablet and mobile. Rows use wrapping flex layouts with `min-width: 0` and ellipsis/`overflow-wrap` for long titles and descriptions; no fixed pixel widths, so 390/768/1440 produce no horizontal document overflow (AC-19). At 390px the badges and timestamp wrap onto a second line under the title rather than being clipped.

---

## 3. Screen: Requester Dashboard (`/dashboard`, role: Requester)

### 3.1 Layout
- Same header pattern. Nav items for Requester: `Dashboard | My Tickets | Create Ticket` — My Tickets is the role's home page.
- Welcome row: `Welcome, {firstName}!` + subtitle.
- Metric card row (4 cards): **My Open Tickets**, **In Progress**, **Resolved**, **Closed** — each card includes a `View all` link beneath the value (not just a card-level click, to make the drill-down affordance explicit and screen-reader-labelled).
- Two-column content row: **My Recent Tickets** (5 rows) + **Quick Actions** (`Create Ticket` → `/tickets/new`, `View My Tickets` → `/tickets`).

### 3.2 Data Contract
Backed by `GET /api/dashboard/requester`, scoped strictly to `requesterId = current user` at the query layer (never filtered client-side).

### 3.3 Drill-down

**Implementation Note (`feature/lab4-07-final-hardening-regression`).** The Requester Ticket List is
`MyTicketsPage` at `/tickets`, and its status query parameter is **`currentStatus`** (not `status`) —
`MyTicketsPage` reads `searchParams.get("currentStatus")` and `GET /api/tickets` validates
`currentStatus` the same way the staff queue validates `status` (multi-value + `open-work` alias,
case-insensitively — see §1's tolerance note). Recent-list rows navigate by Ticket **code**
(`/tickets/:ticketNumber`), while the staff side navigates by internal id (`/staff/tickets/:id`).
All verified against `RequesterDashboard.tsx` and asserted by E2E-03 in
`e2e/lab-04/dashboards.spec.ts`.

| Element | Destination |
|---|---|
| My Open Tickets | `/tickets?currentStatus=NEW,OPEN,WAITING_FOR_REQUESTER,REOPENED` — **must not** use the `status=open-work` alias here: `counts.myOpen` in `api-spec.md` §3.2 deliberately **excludes `IN_PROGRESS`** (which has its own dedicated card below), while the `open-work` alias includes it. Using the alias would show more Tickets than the card's number counts. |
| In Progress | `/tickets?currentStatus=IN_PROGRESS` |
| Resolved | `/tickets?currentStatus=RESOLVED` |
| Closed | `/tickets?currentStatus=CLOSED` |
| Recent Ticket row | `/tickets/:ticketNumber` (Requester Ticket Detail, by Ticket code) |
| Quick Action: View My Tickets | `/tickets` |

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
- Requesters see this table read-only, identical data, with the "Add Actions Taken" control removed entirely from the DOM (not just visually hidden), per FR-06 ("Requesters do not create or change Actions Taken"). The corresponding server-side enforcement guarantee (control-hiding is never treated as authorization) is BR-15, and is verified independently by the role-denial tests spread across `server/tests/lab-04/actions-taken.api.test.ts` and `server/tests/lab-04/ticket-workflow.api.test.ts` (cited per-test in `tests.md`).

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
- Attempting `RESOLVED` when BR-09's Actions-Taken precondition is not met: the button is present (so IT Staff understands the option exists) but disabled with a tooltip/inline note: "Add at least one Actions Taken with a result before resolving."
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

## 8. Accessibility Checklist (completed with evidence on `feature/lab4-07-final-hardening-regression`)

Evidence abbreviations: **axe** = the 34 jest-axe scan call sites across 10 component suites (`client/tests/support/a11y.ts`; Lab 2/3/4 files, all passing in the current run — axe in jsdom validates roles, names, label/`for` binding, `aria-describedby` targets, duplicate ids, heading order, live regions and focusability; it cannot evaluate `color-contrast` in jsdom, which is verified numerically below). **walkthrough** = the scripted keyboard/responsive pass in `e2e/walkthrough/regression-walkthrough.spec.ts` (run via `playwright.walkthrough.config.ts`, observations logged live).

- [x] All interactive elements (cards, rows, buttons, form fields) are reachable via keyboard `Tab`/`Shift+Tab` in a logical order.
  — *Evidence:* walkthrough asserted the login tab order (email → password → submit) and that focus never escapes interactive surfaces; axe checks focusability of every interactive control in all 34 scans. DOM order equals visual order throughout Lab 4 screens (dashboard cards, recent-list buttons, Actions Taken rows); the only `tabIndex` values in `client/src` are `0` (My Tickets row activation), `-1` (read-only fields, dialog container) — no positive `tabIndex` anywhere.
- [x] A visible focus outline (not just a browser default that a reset stylesheet may have removed) is present on every focusable element.
  — *Evidence:* 20 `:focus-visible` rules across 10 CSS modules (Button, Field, Dialog, AppShell, queue controls, dashboards, ActionsTakenPanel, TicketWorkflowControls), all drawing the `--focus-ring-color` token (secondary green, 5.40:1 against the card surface — ≥3:1 non-text requirement); walkthrough asserted computed `outline`/`box-shadow` ≠ none on each login tab stop.
- [x] Every status/priority badge conveys meaning via text label, not color alone.
  — *Evidence:* the shared `Badge` component maps every `TicketStatus`/priority value to a human label ("In Progress", "Waiting for Requester", "URGENT"…); dashboard delta chips pair arrow icon + sign + value, so colour is never the sole indicator (covered by axe `link-name`/`button-name` scans).
- [x] Metric cards used as links/buttons have an accessible name that includes both the label and value.
  — *Evidence:* `StaffDashboard.tsx` `aria-label={`${card.label}: ${card.value}, view filtered queue`}` (and recent rows `${code}: ${title}, open ticket detail`); `RequesterDashboard.tsx` same pattern with "view filtered tickets".
- [x] Form fields have associated `<label>`s; conditional fields (Follow-up Note) are announced when they appear.
  — *Evidence:* `Field.tsx` renders `<label htmlFor={id}>` for every field (axe `label`/`form-label` scans pass); the conditional Follow-up Note reveal is announced by an `aria-live="polite" role="status"` region (`ActionsTakenPanel.tsx`), asserted in `ActionsTaken.test.tsx`; AdminUsersPage toasts live in an `aria-live="polite"` region.
- [x] Validation errors are programmatically associated with their field (`aria-describedby`) and focus moves to the first error on failed submit.
  — *Evidence:* `aria-describedby` wiring on the Actions Taken form fields, ContentThread composer, RemoveAttachmentConfirm, and TicketWorkflowControls; `Field.tsx` error node carries `role="alert"` with a stable id; `focusFirstInvalid()` (`ActionsTakenPanel.tsx`) and CreateTicketPage's equivalent move focus to the first invalid control on failed submit; axe `aria-describedby`-target scans pass.
- [x] Modal/inline dialogs (if any) trap focus and are dismissible via `Esc`.
  — *Evidence:* shared `Dialog.tsx` moves focus in on open, traps Tab/Shift+Tab, closes on Escape (unless a request is busy), returns focus to the trigger, and scopes Escape/trap to the top-most dialog when nested; walkthrough verified live: 30 Tabs never left the Create User dialog, Escape closed it, focus returned to the trigger.
- [x] No content is clipped, no controls overlap, and no page requires horizontal scrolling at any breakpoint in §7.
  — *Evidence:* walkthrough measured `scrollWidth − clientWidth` on Dashboard / My Tickets / Create Ticket at 1280/768/375 px — 0 px overflow on all nine combinations; RESP-01…05 e2e (dashboard reflow, Actions Taken 375 px stacked rows with the hidden-thead collapse fix, queue table↔cards breakpoint at 992 px) all pass in the current 47/47 e2e run. Shared field groups (including the Lab 3 Change Password screen) stack **label → input → always-visible hint → validation message** in normal flow with positive token gaps only — never a negative margin, `absolute` positioning or fixed height on a hint (asserted by `UI-15`, `tests.md`).
- [x] Color contrast for all new text/badges meets at least WCAG AA (4.5:1 normal text, 3:1 large text/icons).
  — *Evidence:* WCAG 2.x relative-luminance ratios computed from the exact `theme.scss` token values (method as `docs/lab-03/visual-checklist.md` §5); every Lab 4 pairing passes: delta chips UP/DOWN/FLAT 4.87 / 5.62 / 4.74 :1, Follow-up badge 4.94:1, workflow reconciliation banner 4.94:1, inline error 5.62:1, success message 5.40:1, metric value/label 14.72 / 5.64 :1, priority badges 7.37 / 6.91 :1; focus ring 5.40:1 (≥3:1). One non-text exception noted: the editable-field border `#C7D3CC` on white is 1.54:1 — an input's boundary is not the sole indicator of the field (each has a visible label and text-state tokens), matching WCAG 1.4.11's exception and the lab-03 checklist's deliberate exclusion of field borders.
- [x] Screenshot evidence captured at desktop, tablet, and mobile widths for: IT Staff Dashboard, Requester Dashboard, Actions Taken panel (view + create), and the status transition control.
  — *Evidence:* 15 PNGs captured live by `e2e/lab-04/screenshots.spec.ts` (9/9 passing) into `artifacts/lab-04/screenshots/{staff-dashboard,requester-dashboard,actions-taken,workflow-controls}/…-{1280,768,375}.png`; full-page captures verified as real rendered content (e.g. 375×3900 mobile full page, ~1500–2500 unique colours per sampled image).

---

## 9. Removed / Cleaned Up From Earlier Labs

- Any temporary placeholder dashboard stub, unused test routes, or duplicate status-badge components from Labs 2–3 must be removed.
- Any console warnings/errors triggered by these screens must be resolved before submission (§8.5 of the handout).