# TokTickIT — Sprint 4 Engineering Specification
**Lab 4: Actions Taken, Dashboards, and Final Regression**
CPE 334 — Introduction to Software Engineering in the Age of AI Agents

---

## 1. Sprint Goal

Sprint 4 delivers the ability for IT Staff to record and track the actual work performed against a
Ticket through a new **Actions Taken** child record, enforces a hardened Ticket status/resolution
workflow so that only IT Staff can formally resolve work, and adds concise role-appropriate
**Dashboards** for Requesters and IT Staff that summarize operational data without replacing the
existing detailed list and detail screens. The sprint also hardens the full application built in Labs
1–3 (regression, accessibility, responsiveness, safe-failure handling) so the product is ready for
final demonstration.

## 2. Stakeholder Request (Interpretation)

The stakeholder confirmed that Ticket intake and Requester/IT-Staff communication already work
(Labs 1–3) but there is no durable record of the work actually performed on a Ticket. They asked for:
a repeatable, auditable **Actions Taken** log per Ticket (date/time, description, result, who performed
it, whether follow-up is needed, follow-up note, and where to find related attachments); confirmation
that the Ticket Owner remains the single point of coordination even though other IT Staff may log
actions; a resolution process where a Requester can only *suggest* that an issue looks fixed, while
only IT Staff can move a Ticket to **Resolved**; and lightweight dashboards for Requesters and IT
Staff that link out to the existing detailed screens rather than duplicating them.

## 3. Scope

### 3.1 Included
- Actions Taken data model, CRUD API, and UI on the Ticket Detail screen.
- Full Ticket status lifecycle enforcement, including the resolution gate.
- Requester Dashboard and IT Staff Dashboard (Administrator reuses IT Staff dashboard).
- Database migration/backfill preserving all Lab 1–3 data.
- Regression hardening of authentication, authorization, Requester/IT Staff/Administrator
  screens, comments, notes, attachments, and user management.
- Accessibility, responsiveness, and Zen Green visual-consistency polish.

### 3.2 Explicitly Excluded (per handout §4.2)
- Automatic SLA clocks, escalation engines, on-call scheduling, breach notifications.
- Email/SMS/LINE/push or other external notification services.
- Inventory/spare-parts/purchasing/cost accounting.
- Time-sheet billing, payroll, labor-cost calculation.
- Multi-level approval workflows and electronic signatures.
- Advanced BI tools, custom report builders, export warehouses.
- Multi-tenant organizations and production-scale cloud operations.
- Any feature not explicitly approved in this document.

## 4. Functional Requirements

**Terminology convention (applies to this entire document):** "**owns / owned by**" refers
exclusively to the `requesterId` relationship (the Requester who submitted the Ticket). "**assigned
to**" or "**Ticket Owner**" refers exclusively to the `assigneeId` relationship (the IT Staff member
coordinating the Ticket, per BR-02). The two are never used interchangeably below.

| ID | Requirement |
|---|---|
| FR-01 | IT Staff and Administrators can create an Actions Taken entry on any Ticket they are authorized to access. |
| FR-02 | The author of an Actions Taken entry may edit it within the permitted edit window (see BR-11); Administrators may additionally edit any entry at any time. |
| FR-03 | A Ticket detail view renders an Actions Taken list/table ordered chronologically by **`actionDateTime`, oldest first** (the primary sort key); entries that share the exact same `actionDateTime` are ordered by a stable secondary sort of `createdAt` then `id`, so tie-breaking never depends on ambiguous or non-deterministic ordering. |
| FR-04 | Creating an Actions Taken entry requires the user to supply: Action Date/Time, Action Description, Result, Follow-Up Required (boolean), and — conditionally — Follow-up Note; Attachment Notes is optional free text. `Performed By` is not a user-supplied input; it is always system-generated from the session (BR-03) and shown to the user only as read-only confirmation text. |
| FR-05 | The system prevents saving an Actions Taken entry when Follow-Up Required = true and Follow-up Note is empty. |
| FR-06 | Requesters can view (read-only) all Actions Taken entries on Tickets they own; they cannot create, edit, or delete entries. |
| FR-07 | The Ticket status control exposes only the transitions permitted from the current status and the current user's role (§5). |
| FR-08 | A Requester can submit a "looks resolved" acknowledgement on their own Ticket; this is stored as advisory feedback and does NOT change Ticket status. |
| FR-09 | Only IT Staff/Administrator can transition a Ticket into `Resolved`, and only after at least one Actions Taken entry with `Result` populated exists on that Ticket. |
| FR-10 | The IT Staff Dashboard returns: New count, Open count, In Progress count, Waiting for Requester count, "My Assigned" count (Tickets whose `assigneeId` = current user, i.e. Tickets *assigned to* the current IT Staff member, not Tickets they submitted as a Requester), and a "My Recent Tickets" list (last 5 by `updatedAt` across Tickets assigned to the current user or unassigned). |
| FR-11 | The Requester Dashboard returns: My Open Tickets, In Progress, Resolved, Closed counts (scoped to Tickets whose `requesterId` = the authenticated Requester only) and a "My Recent Tickets" list (last 5 by `updatedAt`). |
| FR-12 | Every dashboard metric card and list row is a clickable drill-down that opens the correctly filtered Ticket Queue/List or the Ticket Detail screen. |
| FR-13 | Dashboard endpoints never return full Ticket collections; they return only the aggregated counts and the small "recent" list required by the UI. |
| FR-14 | All Lab 2/3 functionality (auth, Ticket CRUD, Public Comments, Internal Notes, Attachments, Administrator user management) remains fully functional after the Lab 4 migration. |
| FR-15 | Duplicate submissions caused by double-click or network retry on Actions Taken creation and on Ticket status transitions are prevented (idempotent submit or de-duplication check). |
| FR-16 | Concurrent edits to the same Ticket status are detected and rejected with a safe conflict response rather than silently overwritten (see BR-12). |

## 5. Business Rules

| ID | Rule |
|---|---|
| BR-01 | An Actions Taken entry belongs to exactly one Ticket (`ticketId` is required and immutable after creation). |
| BR-02 | The Ticket Owner (`assigneeId` on Ticket) coordinates the Ticket as a whole, but any active IT Staff/Administrator with access may author an Actions Taken entry; `performedById` on the entry may differ from the Ticket's `assigneeId`. |
| BR-03 | `performedById` is always set automatically from the authenticated session; it is never a client-supplied, editable field. |
| BR-04 | `actionDateTime` defaults to server time at creation but may be backdated by IT Staff/Administrator to reflect when work actually occurred, and must not be a future timestamp. |
| BR-05 | If `followUpRequired = true`, `followUpNote` must be a non-empty string (min 3 characters); otherwise `followUpNote` must be null/empty. |
| BR-06 | `attachmentNotes` is optional free text and does not itself create or validate a file attachment; it only points the reader to where a file/screenshot can be found (e.g., an existing Attachment record's title or an external location). |
| BR-07 | Ticket status transitions are only permitted per the matrix in §5.1; any other transition attempt is rejected by the backend with HTTP 409 regardless of what the client UI displays. |
| BR-08 | A Requester's "looks resolved" acknowledgement is stored as `requesterConfirmedResolved: true` + timestamp on the Ticket but never triggers an automatic status change. |
| BR-09 | A Ticket can only move to `Resolved` when: (a) the actor is IT Staff/Administrator, (b) the Ticket's current status is `InProgress` or `WaitingForRequester`, and (c) at least one Actions Taken entry exists with a non-empty `result`. |
| BR-10 | A Ticket can move to `Reopened` only from `Resolved` or `Closed`, and only by IT Staff/Administrator, or by the Requester who owns the Ticket within 7 days of the `resolvedAt` timestamp (configurable constant `REOPEN_WINDOW_DAYS = 7`). |
| BR-11 | An Actions Taken entry may be edited by its author within 15 minutes of creation (`EDIT_WINDOW_MINUTES = 15`) to correct typos; after that window, only an Administrator may edit it, and every edit is recorded with an `editedAt`/`editedById` audit pair. Entries are never hard-deleted (append-only audit trail); Administrators may soft-delete (`isVoided`) with a reason, and once voided an entry is permanently frozen — no further edit, including by an Administrator, is ever permitted against it (`api-spec.md` §1.3). |
| BR-12 | Ticket status updates use optimistic concurrency: the client must send the Ticket's last-known `version` (integer, defined in §7.2, rationale in §7.4 Decision B). If the submitted `version` does not match the current server value, the API returns `409 Conflict` with the current server state so the client can reload and retry. `updatedAt` timestamp comparison is not used for concurrency control (superseded by `version`). |
| BR-13 | Dashboard counts and deltas are always computed live at request time from authoritative tables (`Ticket`, `ActionTaken`, `TicketStatusHistory` — see §7.1–§7.3); no pre-aggregated/cached counter is stored or read. |
| BR-14 | The canonical **open-work** status set is `{New, Open, InProgress, WaitingForRequester, Reopened}`. Cancelled Tickets are excluded from every open-work dashboard count; Closed Tickets are excluded as well. All statuses remain visible in detailed list/history views regardless of dashboard treatment. |
| BR-15 | All write endpoints re-check role and ownership/access server-side on every request; UI-only hiding of controls is never treated as authorization. |

### 5.1 Ticket Status Transition Matrix

**Canonical status enum (single source of truth for code, API, and DB).** The values below are the
*only* strings ever stored, sent over the API, or used in query parameters. The "Display Label"
column is UI-only text and must never be used in code, JSON, or query strings.

| Canonical enum value (code/API/DB) | Display Label (UI text only) |
|---|---|
| `New` | New |
| `Open` | Open |
| `InProgress` | In Progress |
| `WaitingForRequester` | Waiting for Requester |
| `Resolved` | Resolved |
| `Closed` | Closed |
| `Reopened` | Reopened |
| `Cancelled` | Cancelled |

`ui-spec.md` and `api-spec.md` must reference statuses using the canonical enum column above; the
Display Label is applied only at render time by the badge component.

| From \ To | `Open` | `InProgress` | `WaitingForRequester` | `Resolved` | `Closed` | `Reopened` | `Cancelled` |
|---|---|---|---|---|---|---|---|
| **`New`** | IT Staff/Admin | IT Staff/Admin | — | — | — | — | IT Staff/Admin, Requester (own Ticket) |
| **`Open`** | — | IT Staff/Admin | IT Staff/Admin | — | — | — | IT Staff/Admin, Requester (own Ticket) |
| **`InProgress`** | — | — | IT Staff/Admin | IT Staff/Admin (BR-09) | — | — | IT Staff/Admin |
| **`WaitingForRequester`** | — | IT Staff/Admin | — | IT Staff/Admin (BR-09) | — | — | IT Staff/Admin |
| **`Resolved`** | — | — | — | — | IT Staff/Admin (manual action) | IT Staff/Admin, Requester (own, BR-10) | — |
| **`Closed`** | — | — | — | — | — | IT Staff/Admin, Requester (own, within BR-10 window) | — |
| **`Reopened`** | — | IT Staff/Admin | IT Staff/Admin | — | — | — | IT Staff/Admin |
| **`Cancelled`** | — | — | — | — | — | — | *(no outbound transitions)* |

Notes:
- `—` means the transition is not permitted and must be rejected by the API with `409 Conflict` and an explicit error code `INVALID_STATUS_TRANSITION`.
- `Cancelled` is the only fully terminal status (no outbound transition of any kind). `Closed` is *not* fully terminal: it permits exactly one outbound path, `Closed → Reopened`, under BR-10.
- Lab 4 has **no automatic/idle-triggered transitions of any kind** (per §4.2 exclusions — no SLA clocks or background jobs). `Resolved → Closed` is always a manual IT Staff/Administrator action taken through the UI; there is no `CLOSE_GRACE_DAYS` constant and no auto-close path in this or any future column of this matrix within Lab 4's scope.
- `Reopened` Tickets are treated as active open work: for dashboard purposes a `Reopened` Ticket is included in the **IT Staff Dashboard's "In Progress" count** and in the **Requester Dashboard's "My Open Tickets" count** (see `api-spec.md` §3.1/§3.2 calculation rules and BR-14's open-work set).

## 6. UI Specification Summary

(Full detail in `ui-spec.md`.) Summary of screen structure:

- **IT Staff Dashboard** (`/dashboard`, IT Staff/Admin default landing page): 5 metric cards (New, Open, In Progress, Waiting for Requester, My Assigned), "My Recent Tickets" list (5 rows, status badge, updated date), "Quick Actions" panel (Create Ticket, Search Tickets, My Queue). All cards/rows are keyboard-and-mouse actionable drill-downs.
- **Requester Dashboard** (`/dashboard`, Requester default landing page): 4 metric cards (My Open, In Progress, Resolved, Closed), "My Recent Tickets" list (5 rows), "Quick Actions" panel (Create Ticket, View My Tickets).
- **Ticket Detail — Actions Taken panel**: appended below existing Public Comments/Internal Notes areas; list/table view (view mode) and a create form (create mode) gated by role; each row shows date/time, description (truncated with expand), result, performed-by, follow-up badge.
- **Ticket Workflow controls**: a status `<select>`/button-group on Ticket Detail that renders **only** the transitions permitted for (current role × current status) per §5.1 — impermissible transitions are omitted from the control entirely, not merely disabled. The single documented exception is the `→ Resolved` option when BR-09's Actions-Taken precondition is not yet met: because the *role and status* permit the transition (only the data precondition is unmet), that option is shown **disabled** with an explanatory tooltip rather than hidden, so IT Staff understands the option exists and what is blocking it. A Requester viewing a Ticket past the BR-10 reopen window simply sees no reopen control at all (hidden, not disabled), since role/timing eligibility — not a data precondition — is what fails there.
- Role-based navigation bar item "Dashboard" is added/kept active-highlighted for all three roles, reusing the existing Zen Green header component.

Reference: `ui-spec.md` for full component inventory, states, and accessibility checklist.

## 7. Data Changes

### 7.1 New Model — `ActionTaken`

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(cuid())` | PK |
| `ticketId` | `String` | FK → `Ticket.id`, `onDelete: Restrict`, indexed |
| `actionDateTime` | `DateTime` | Business-meaningful action time (BR-04); indexed for sort. This is the **primary** sort key for FR-03's ordering; `createdAt` and `id` serve only as tie-breakers when two entries share the same `actionDateTime`. |
| `description` | `String` (`Text`) | Required, min 5 chars |
| `result` | `String` (`Text`) | Required, min 3 chars |
| `performedById` | `String` | FK → `User.id`, auto-set from session (BR-03) |
| `followUpRequired` | `Boolean` `@default(false)` | |
| `followUpNote` | `String?` (`Text`) | Required iff `followUpRequired = true` (BR-05), enforced at API layer |
| `attachmentNotes` | `String?` (`Text`) | Optional |
| `isVoided` | `Boolean` `@default(false)` | Soft-delete flag (BR-11); once `true`, permanently immutable (`api-spec.md` §1.3) |
| `voidReason` | `String?` | Required iff `isVoided = true` |
| `createdAt` | `DateTime @default(now())` | Secondary sort key for FR-03 |
| `editedAt` | `DateTime?` | Set on edit (BR-11) |
| `editedById` | `String?` | FK → `User.id`, set on edit |

Indexes: `@@index([ticketId, actionDateTime])`, `@@index([performedById])`. The query backing FR-03's
list endpoint (`api-spec.md` §1.2) sorts `ORDER BY actionDateTime ASC, createdAt ASC, id ASC`; the
`[ticketId, actionDateTime]` index above serves the leading `ticketId`/`actionDateTime` predicate and
sort, and no separate index on `createdAt`/`id` is needed for correctness — ties on `actionDateTime`
are rare (same-Ticket entries created at the exact same millisecond) and the tie-break columns are
only there to make the result order deterministic across repeated identical queries, not to serve as
an additional query filter.

### 7.2 `Ticket` Model Additions

| Field | Type | Notes |
|---|---|---|
| `requesterConfirmedResolved` | `Boolean @default(false)` | BR-08 |
| `requesterConfirmedResolvedAt` | `DateTime?` | |
| `resolvedAt` | `DateTime?` | Set when status → `Resolved` (drives BR-10 reopen window). Persists unchanged through a subsequent `Resolved → Closed` transition, and is overwritten with a fresh timestamp the next time the Ticket enters `Resolved` again (e.g., after `Reopened → InProgress → Resolved`). |
| `version` | `Int @default(0)` | Optimistic concurrency token (BR-12). Incremented **only** on a successful Ticket **status transition** (`PATCH /tickets/:id/status`). It is explicitly *not* incremented by `requester-confirmation` (FR-08, `api-spec.md` §2.2) or by writes that do not change `status`, since those cannot race with a concurrent status change. |

### 7.3 New Model — `TicketStatusHistory` (audit trail; backs `api-spec.md` §2.1's `note` field and §3.1/§3.2 deltas)

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(cuid())` | PK |
| `ticketId` | `String` | FK → `Ticket.id`, indexed |
| `fromStatus` | `String` (enum, §5.1) | Status before the transition |
| `toStatus` | `String` (enum, §5.1) | Status after the transition |
| `changedById` | `String` | FK → `User.id`, from session |
| `changedAt` | `DateTime @default(now())` | Indexed for the live 24h delta queries in `api-spec.md` §3.1/§3.2 |
| `note` | `String?` | Optional short note supplied with the transition (`api-spec.md` §2.1) |

Indexes: `@@index([ticketId, changedAt])`, `@@index([toStatus, changedAt])`, `@@index([fromStatus, changedAt])`
(the latter two exist specifically to make the dashboard delta queries in `api-spec.md` §3.1/§3.2 fast
without needing a cached counter, per Decision C).

### 7.4 Relationships
- `Ticket 1 — N ActionTaken` (one Ticket may contain many Actions Taken; an Actions Taken belongs to exactly one Ticket, BR-01).
- `Ticket 1 — N TicketStatusHistory` (one row per status transition; append-only, never edited or deleted).
- `User 1 — N ActionTaken` via `performedById` (an IT Staff/Admin may perform many actions across many Tickets).
- `User 1 — N TicketStatusHistory` via `changedById`.
- Existing relationships from Labs 1–3 (`Ticket — User(assignee/requester)`, `Ticket — PublicComment`, `Ticket — InternalNote`, `Ticket — Attachment`) are unchanged.

### 7.5 Migration & Backfill Decisions
1. **Additive migration only.** All new fields are nullable or have defaults (`followUpRequired` defaults `false`, `version` defaults `0`, `requesterConfirmedResolved` defaults `false`), so the migration is backward-compatible and requires no destructive column changes to `Ticket`.
2. **Legacy Tickets with zero Actions Taken** are valid and expected: dashboard counts and the Actions Taken list simply render the documented empty state (`ui-spec.md`); BR-09's resolution gate applies going forward only — Tickets already `Resolved`/`Closed` before this migration are grandfathered and not reverted.
3. **Rollback plan:** migration is a single additive Prisma migration (`prisma migrate deploy`) that adds the `ActionTaken` and `TicketStatusHistory` tables plus the four new `Ticket` columns; rollback is `prisma migrate resolve --rolled-back <name>` plus a compensating migration dropping the two new tables/columns, tested against a copy of the seeded database before being run against any shared environment.
4. Design decisions justified:
   - **Decision A:** `ActionTaken` is append-only with soft-delete (`isVoided`) instead of hard delete, to preserve an auditable work history required by BR-11 and by the stakeholder's request for a "reliable way to plan and track the actual work."
   - **Decision B:** Optimistic concurrency via an integer `version` column — instead of `updatedAt` timestamp comparison — was chosen because integer comparison is unambiguous across client clock skew and simpler to test deterministically (BR-12, FR-16). `version` increments only on status transitions (not on every field write anywhere on the Ticket), so it detects exactly the one race condition this sprint cares about (two concurrent status changes) without forcing unrelated concurrent edits (e.g., a Requester's advisory confirmation) to conflict with each other.
   - **Decision C:** A lightweight, append-only `TicketStatusHistory` table (§7.3) is added instead of adding a free-floating "note" field with no backing store. Every status transition writes one row (`fromStatus`, `toStatus`, `changedById`, `changedAt`, optional `note`). This gives the optional status-change note a real home, and gives BR-07's transition-matrix enforcement and BR-12's concurrency checks something they would otherwise lack: a durable, queryable record of exactly which transitions actually happened, by whom, and when — which is what makes those rules auditable after the fact rather than only enforceable at request time. (This is a design decision made for this sprint's needs, not a requirement described by BR-11, which instead governs edit/void auditing on Actions Taken entries specifically, §7.1.) The same table also lets dashboard "delta vs. yesterday" values (`api-spec.md` §3.1/§3.2) be computed **live** by querying it — satisfying BR-13's "no cached/derived counters" requirement without needing a separate caching layer.

### 7.6 Seed Data Requirements
- Idempotent seed script (`upsert` keyed by stable business keys, safe to re-run).
- Tickets covering every status in §5.1, a mix of assigned/unassigned ownership, and every IT Priority value actually defined by the Lab 2/3 codebase (this document does not redefine that enum; the seed must cover whatever values it contains).
- At least one Ticket with **zero** Actions Taken, one with **exactly one**, and one with **multiple** Actions Taken (including at least one with `followUpRequired = true`).
- Enough data so IT Staff Dashboard and Requester Dashboard each show **non-zero** values for every metric card for the seeded demo users, and at least one seeded Requester whose dashboard legitimately shows a **zero** state for one card (to demonstrate the empty state).
- Seed a small number of backdated `TicketStatusHistory` rows (`changedAt` within the last 24–48 hours) alongside the seeded Tickets so the dashboard delta indicators (`api-spec.md` §3.1) have real data to compute against and are not all zero on first demo.

## 8. API Contract

Full detail in `api-spec.md`. Summary of new/changed endpoints:

- `POST /api/tickets/:ticketId/actions` — create Actions Taken
- `GET /api/tickets/:ticketId/actions` — list Actions Taken for a Ticket
- `PATCH /api/tickets/:ticketId/actions/:actionId` — edit within window / void (Admin)
- `PATCH /api/tickets/:ticketId/status` — status transition (replaces the Lab 3 status update endpoint), now enforcing §5.1 and `version`-based concurrency
- `POST /api/tickets/:ticketId/requester-confirmation` — Requester "looks resolved" acknowledgement
- `GET /api/dashboard/requester` — Requester dashboard aggregate
- `GET /api/dashboard/staff` — IT Staff / Administrator dashboard aggregate

All endpoints require authentication; authorization is re-checked per handout §4.3 role table on every request; all responses use the existing Lab 2/3 error envelope.

## 9. Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-01 | Given a permitted IT Staff user and valid data, when an Actions Taken is created, then it is saved under the correct Ticket with the authenticated creator as `performedById` and is immediately visible in the Ticket's Actions Taken list. |
| AC-02 | Given an authenticated Requester, when dashboard data is retrieved, then only metrics and recent Tickets owned by that Requester are returned, and Tickets belonging to other Requesters never appear. |
| AC-03 | Given an IT Staff user viewing a Ticket in `InProgress` with at least one Actions Taken with a non-empty `result`, when they transition the Ticket to `Resolved`, then the transition succeeds, `resolvedAt` is set, and the Requester's confirmation flag is not required. |
| AC-04 | Given a Ticket with zero Actions Taken, when IT Staff attempts to transition it to `Resolved`, then the API rejects the request with `409` and an `ACTIONS_REQUIRED` error code. |
| AC-05 | Given a Requester viewing their own Ticket, when they submit "looks resolved," then `requesterConfirmedResolved` is set to `true` on the Ticket but the Ticket's `status` field does not change. |
| AC-06 | Given a Requester, when they attempt `POST /api/tickets/:id/actions` directly against the API (bypassing the UI), then the API rejects the request with `403 Forbidden`. |
| AC-07 | Given `followUpRequired = true` and an empty `followUpNote`, when an Actions Taken create/update is submitted, then the API rejects it with `422 Validation Error` naming the `followUpNote` field. |
| AC-08 | Given two IT Staff users loading the same Ticket, when User A updates the status successfully and User B then submits a stale `version`, then User B's request is rejected with `409 Conflict` and the response includes the current server state. |
| AC-09 | Given a Ticket already `Resolved` for 10 days (beyond `REOPEN_WINDOW_DAYS`), when the owning Requester attempts to reopen it, then the API rejects the request; IT Staff/Administrator can still reopen it at any time. |
| AC-10 | Given the IT Staff Dashboard, when it loads for a user with 0 Tickets in a given status (e.g., no Tickets currently in `New`), then the corresponding card renders the documented empty state (a "0" value with an appropriate label), not an error. |
| AC-11 | Given repeated rapid double-clicks on "Create Actions Taken" with an identical `Idempotency-Key` within the 5-second idempotency window (`api-spec.md` §1.1), when both requests reach the server, then only one Actions Taken record is persisted and both responses return the same `201` body. |
| AC-12 | Given all Lab 2/3 regression scenarios (auth, My Tickets, Ticket Detail, Attachments, Public Comments, Internal Notes, Administrator user management), when re-executed after the Lab 4 migration, then all pass without behavior change. |
| AC-13 | Given a screen reader or keyboard-only user, when navigating the Dashboard and Actions Taken panel, then every actionable element is reachable via Tab, has a visible focus indicator, and has an accessible name. |
| AC-14 | Given repeated rapid double-clicks on a status-transition button (e.g., "Resolve") with an identical `Idempotency-Key` within the 5-second window, when both requests reach the server, then the status transition and its `version` increment happen exactly once; the second request returns the original `200` response rather than a spurious `409 STALE_VERSION`. |

## 10. Definition of Done (Product Completion Checklist)

- [ ] All FR-01…FR-16 implemented and demonstrable.
- [ ] All BR-01…BR-15 enforced server-side (verified with direct API calls bypassing the UI).
- [ ] Full status transition matrix (§5.1) implemented and covered by automated tests.
- [ ] Migration applies cleanly to a copy of the Lab 3 production-like database with zero data loss; rollback tested.
- [ ] Seed data satisfies §7.6 and is idempotent (`npm run seed` runnable twice with no errors/duplication).
- [ ] All endpoints in §8/`api-spec.md` implemented, documented, and authorization-tested for all three roles.
- [ ] IT Staff Dashboard and Requester Dashboard implemented per `ui-spec.md`, including loading/empty/forbidden/safe-failure states.
- [ ] Actions Taken panel implemented on Ticket Detail (list + create + edit-within-window) with role-correct visibility.
- [ ] All Acceptance Criteria AC-01…AC-14 pass via automated tests listed in `tests.md`, plus manual E2E verification.
- [ ] Full Lab 1–3 regression suite passes (AC-12).
- [ ] Responsive (desktop/tablet/mobile) and accessibility checklist in `ui-spec.md` completed with screenshot evidence.
- [ ] No console errors, broken links, placeholder text, or unfinished controls remain.
- [ ] README updated with current setup, seed, migrate, test, and demo instructions.
- [ ] `reviewer.md` and `ai-use.md` completed with PR links, review comments/approvals, and LLM usage reflection.

## 11. Assumptions and Decisions

| # | Assumption / Decision | Rationale |
|---|---|---|
| 1 | `REOPEN_WINDOW_DAYS = 7` and `EDIT_WINDOW_MINUTES = 15` are configurable constants, not hardcoded magic numbers, so grading/demo can adjust them without a redeploy. | Testability and reasonable defaults not specified by the handout. |
| 2 | Administrators are treated as a superset of IT Staff for all Actions Taken and workflow permissions (per handout §4.3), and additionally may void/edit any Actions Taken entry outside the normal edit window. | Handout explicitly states Admin "performs IT Staff behavior and retains administrative access." |
| 3 | `Resolved → Closed` has no automatic/idle-triggered path in Lab 4 at all (no `CLOSE_GRACE_DAYS`-style constant); it is reached only via an explicit IT Staff/Administrator action in the UI. | Keeps scope aligned with the explicit exclusion of SLA clocks/escalation engines (§4.2) and avoids an internally-inconsistent matrix that implies a background job the sprint doesn't build. |
| 4 | Dashboard "delta vs. yesterday" values are computed live from the new `TicketStatusHistory` table (§7.3) rather than from a cached/pre-aggregated counter. | Required to satisfy BR-13 ("no cached/derived counters that can drift") while still supporting the delta indicator shown in the handout's Dashboard mockup (§8.1 screenshot). |
| 5 | `Reopened` Tickets count toward the IT Staff Dashboard's "In Progress" card and the Requester Dashboard's "My Open Tickets" card (BR-14). No separate "Reopened" card is added, to keep the dashboards concise per the stakeholder's explicit request. | A reopened Ticket is, functionally, active work again; adding a 6th/5th card for a comparatively rare status would violate the "keep them concise" guidance in §3 of the handout. |
| 6 | Dashboard "recent" lists are capped at 5 rows to keep dashboards concise per the stakeholder's explicit request ("keep them concise and connected to the detailed screens"). | Direct stakeholder guidance in §3 of the handout. |
| 7 | `attachmentNotes` is a text hint field only; Lab 4 does not add new file-upload capability beyond what Attachments already provide from Lab 2/3. | Handout describes it as "what file to look for," not a new upload mechanism. |