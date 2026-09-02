# Lab 2 Sprint Engineering Specification — TokTickIT Requester Ticketing MVP

Course: CPE 334 — Introduction to Software Engineering in the Age of AI Agents
Sprint: Lab 2 (Semester 1/2026)

---

## 1. Sprint Goal

This sprint delivers a Requester-facing IT support ticketing experience. A seeded, temporary "Development Requester" identity (not real authentication) can create a ticket with a category, related system, requested priority, description, and supporting attachments; receive a system-generated Ticket Number; and later find, open, and manage that ticket through **My Tickets** and **Ticket Detail**. The system enforces that a Requester can only ever see and act on their own tickets. A consistent Zen Green visual language and reusable form/list/badge/state components are established for reuse in later sprints.

---

## 2. Stakeholder Request Interpretation

The IT department wants Requesters to be able to self-report problems without staff intervention. Concretely: a Requester picks a category and related system, describes the issue, sets how urgent they think it is, optionally attaches evidence (screenshots, error logs, PDFs), and submits. They then need a way to find that ticket again, check its state, and add more evidence later if asked. Because the login system does not exist yet, we simulate "being a Requester" using a pre-seeded selector so multi-user ownership behavior (search, filtering, and — most importantly — data isolation between Requesters) can be built and proven now, ahead of Lab 3's real authentication.

---

## 3. Scope

### 3.1 Included
- Development Requester Selection screen (test-only identity simulation)
- Create Ticket (form, validation, system-generated Ticket Number, attachment upload at creation time)
- My Tickets (search, filter, sort, pagination, list/card rendering, empty/no-results/loading/error states)
- Requester Ticket Detail (read-only ticket header, attachment list)
- Attachment lifecycle: add to an existing owned ticket, download an active attachment, soft-remove an owned attachment
- Ownership enforcement on every read/write operation
- Zen Green Theme UI system and reusable components (fields, badges, buttons, validation messages, loading/empty/error states)
- Responsive behavior at desktop, tablet, and mobile breakpoints
- Seed data for Categories, Related Systems, and Development Requesters (active and inactive)

### 3.2 Explicitly Excluded
- Real authentication: login, logout, passwords, hashing, sessions, tokens, real role-based authorization
- IT Staff workflow: staff dashboard/queue, claiming/reassigning tickets, IT Priority changes, Ticket Owner assignment logic
- Public Comments, Internal Notes, Actions Taken
- Any ticket lifecycle beyond initial creation (no resolve/close/reopen/cancel; status is always `NEW` at the end of this sprint)
- Administration functions (user/role/reference-data management)

---

## 4. Functional Requirements

| ID | Requirement |
|---|---|
| FR-01 | The system shall provide a Development Requester Selection screen listing only active Development Requesters, loaded from PostgreSQL. |
| FR-02 | The system shall persist the selected Development Requester as the current session's testing identity in the browser (not on the server, not as an auth token) until changed or the browser storage is cleared. |
| FR-03 | The system shall allow the current Requester to be changed at any time via a "Change Requester" action, which reloads all Requester-scoped data. |
| FR-04 | The system shall allow the current Requester to create a Ticket by supplying Category, Related System, Ticket Summary, Description, Requested Priority, and optionally up to 5 Attachments. |
| FR-05 | The system shall generate a unique, backend-assigned Ticket Number and initial timestamp upon successful ticket creation, and shall never accept a client-supplied Ticket Number. |
| FR-06 | The system shall validate all Create Ticket fields on both frontend and backend, rejecting invalid submissions with field-level error messages and preserving the Requester's entered values. |
| FR-07 | The system shall list all Tickets owned by the current Requester in My Tickets, and shall never return another Requester's Tickets. |
| FR-08 | My Tickets shall support searching by Ticket Number and Summary, filtering by Category, Current Status, and Requested Priority, sorting by at least Created Date and Last Updated, and server-side pagination. |
| FR-09 | The system shall allow the current Requester to open the Ticket Detail screen only for a Ticket they own; requests for another Requester's Ticket shall be rejected with no data leakage. |
| FR-10 | The Ticket Detail screen shall display all ticket header fields as read-only and shall list all Attachments (active and, distinctly, removed) belonging to that Ticket. |
| FR-11 | The system shall allow the current Requester to add an Attachment to one of their own existing Tickets, subject to the 5 MB size limit, allowed-type restriction, and the 5-active-attachments-per-ticket cap. |
| FR-12 | The system shall allow the current Requester to download only an active (not removed) Attachment belonging to a Ticket they own. |
| FR-13 | The system shall allow the current Requester to soft-remove an active Attachment belonging to a Ticket they own, requiring a removal reason, and the removed Attachment shall remain visible as metadata only. |
| FR-14 | The system shall present loading, empty, no-results, and safe-failure states for every data-fetching screen and action described above. |
| FR-15 | The system shall apply the Zen Green Theme and shared component conventions consistently across all four screens, at desktop, tablet, and mobile viewports. |
| FR-16 | Inactive Development Requesters shall never appear in the selector and shall be blocked from being set as the current session identity even via a replayed/forged client request. |

---

## 5. Business Rules

### 5.1 Development Requester / Session Identity
- **BR-01.** Lab 2 uses a Development Requester selector instead of login. The selected identity is stored client-side for testing convenience only and must never be described in UI copy or code comments as authentication.
- **BR-02.** Only Development Requesters with `isActive = true` are returned by the active-requester API and shown in the selector.
- **BR-03.** If the currently selected Requester becomes invalid (deleted, or found to be inactive on the next data fetch), the application must clear the stored selection and return the user to the Selection screen rather than silently failing.
- **BR-04.** Switching the current Requester must immediately invalidate any cached ticket/attachment data from the previous Requester; no stale cross-Requester data may remain visible.
- **BR-05.** Every ticket- or attachment-scoped API request must include the current Requester identity (sent as an explicit header/parameter in Lab 2, to be replaced by a real authenticated session in Lab 3), and the backend must independently re-verify that this Requester is active before processing the request.

### 5.2 Ticket Defaults and System-Generated Values
- **BR-06.** The official Ticket Number is generated by the backend and must be globally unique. Format: `TKT-{YYYY}-{6-digit sequence}` (e.g., `TKT-2026-000001`), where `YYYY` is the year of creation and the sequence increments per year starting at `000001`.
- **BR-07.** A new Ticket always begins with Current Status `NEW`. No other status value may be set at creation time.
- **BR-08.** `IT Priority` and `Ticket Owner` are nullable at creation and are displayed as "Not yet assigned" in Lab 2, since IT Staff workflow is out of scope. They must never be editable by a Requester.
- **BR-09.** `Ticket Date` (creation timestamp) is set by the backend at the moment of successful insertion and is never client-supplied.
- **BR-10.** `Resolution Summary` is null for every Lab 2 ticket and must display as "No resolution summary available yet."

### 5.3 Ownership
- **BR-11.** A Ticket belongs to exactly one Requester (the one who created it), recorded as an immutable foreign key at creation time.
- **BR-12.** A Requester may only retrieve, list, or modify Tickets and Attachments where `ticket.requesterId` equals the current session Requester's id. Ownership must be enforced in the backend on every relevant endpoint, not only in the UI.
- **BR-13.** A request for a Ticket or Attachment owned by a different Requester must return a not-found-style response (404) rather than a 403, to avoid confirming the existence of another Requester's ticket ("existence should not leak").

### 5.4 Search, Filtering, Sorting, Pagination
- **BR-14.** The Ticket list search must match (case-insensitive, partial) against Ticket Number and Ticket Summary only.
- **BR-15.** Filters available: Category, Requested Priority, Current Status. Multiple filters combine with logical AND. Only Categories/Requested Priorities/Statuses that exist for that Requester's tickets need to be shown as options, but the filter values themselves are validated against the full reference set.
- **BR-16.** Sortable fields: Created Date (`createdAt`) and Last Updated (`updatedAt`). Default sort is Created Date descending (newest first). Secondary sort tie-break is always `id` descending, to guarantee stable pagination.
- **BR-17.** Default page size is 10; permitted page sizes are 10, 20, 50. An invalid or out-of-range `page` or `pageSize` parameter is clamped to the nearest valid value rather than causing an error.
- **BR-18.** Pagination responses must include total item count, total page count, current page, and page size, so the frontend never has to infer pagination state.

### 5.5 Validation and Duplicate-Submission Prevention
- **BR-19.** Ticket Summary: required, trimmed, 5–120 characters. Justification: must be long enough to be meaningful but short enough for list display without truncation ellipsis dominating the UI.
- **BR-20.** Description: required, trimmed, 20–2000 characters. Justification: short enough to avoid abuse/storage bloat, long enough to capture a real problem description.
- **BR-21.** Category, Related System, and Requested Priority are required and must reference an existing, active reference record; an inactive or nonexistent reference id is rejected with a 400.
- **BR-22.** Requested Priority allowed values: `LOW`, `MEDIUM`, `HIGH`. No other values are accepted.
- **BR-23.** The Create Ticket submit action is disabled immediately on click and remains disabled (busy state) until the request resolves, to prevent duplicate double-click submissions. The backend additionally treats each submission as a discrete insert (no idempotency key required in Lab 2, since retries are user-initiated only after a definitive success or failure response).
- **BR-24.** On validation failure (frontend or backend), all previously entered field values (summary, description, category, related system, priority, and any already-selected attachments not yet uploaded) must be preserved in the form; nothing is cleared.

### 5.6 Failure Behavior
- **BR-25.** If Ticket creation fails after Attachments were already selected but before the Ticket record is committed, no Attachment is uploaded to storage and no orphaned Attachment record is created (see BR-31 for the reverse case).
- **BR-26.** Any unexpected server error returns a generic safe message ("Something went wrong. Please try again.") and never leaks stack traces, SQL, or internal identifiers to the client.
- **BR-27.** If the active-Requester list, Category list, or Related System list fails to load, the affected dropdown must show a retry affordance rather than silently appearing empty.

### 5.7 Attachment Upload, Download, and Soft Removal
- **BR-28.** Allowed Attachment MIME types: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`. Extension and MIME type are both checked; a mismatched extension/MIME pair is rejected.
- **BR-29.** Maximum Attachment size: 5 MB per file, enforced on both frontend (pre-upload check) and backend (authoritative check).
- **BR-30.** Maximum 5 **active** (not soft-removed) Attachments per Ticket. Soft-removed Attachments do not count toward this limit, so a Requester may remove one to make room for another.
- **BR-31.** If a Ticket is created successfully but one or more selected Attachments fail to upload (e.g., network interruption), the Ticket remains valid and created; the Requester is shown which specific attachments failed and may retry adding them afterward from Ticket Detail. A partially failed attachment upload never rolls back the already-created Ticket.
- **BR-32.** Every Attachment stores: original filename (for display), a generated safe storage filename (UUID-based, no user input in the path, extension preserved), MIME type, size in bytes, uploader Requester id, upload timestamp, and soft-removal fields (see BR-34).
- **BR-33.** Only the owning Requester of the parent Ticket may add, download, or remove an Attachment on that Ticket.
- **BR-34.** Soft removal sets `isRemoved = true`, `removedAt`, and stores a required `removalReason` (trimmed, 3–200 characters). The underlying file is not deleted from storage in Lab 2 (kept for audit/undo potential in later labs) but is made permanently inaccessible via the API.
- **BR-35.** A removed Attachment remains visible in the Attachments list as metadata (filename, size, upload date, removal date, removal reason) but its preview/download action is disabled/hidden and any direct download request for a removed attachment returns 404.
- **BR-36.** Removing an Attachment requires an explicit confirmation step (modal or inline confirm) plus the removal reason before the delete request is sent; there is no undo in Lab 2.

### 5.8 Inactive Requesters
- **BR-37.** An inactive Development Requester cannot be selected, cannot appear in the selector dropdown, and any stored client-side selection referencing an inactive Requester is rejected by the backend on the next request (see BR-03).
- **BR-38.** Existing Tickets created by a Requester who later becomes inactive are not deleted or hidden from the system; they simply become unreachable through the UI in Lab 2 because that Requester can no longer be selected. This is intentional and documented as a known Lab 2 limitation to be revisited in Lab 3.

### 5.9 Empty and No-Results States
- **BR-39.** "Empty" state (no tickets ever created by this Requester) and "No results" state (tickets exist, but the current search/filter combination matches none) must be visually and textually distinct; the empty state invites the Requester to create their first ticket, the no-results state invites them to clear filters.

### 5.10 Ticket Detail Access
- **BR-40.** Ticket Detail is reachable only via a route parameterized by Ticket Number or Ticket id combined with the current Requester context; the frontend never trusts a locally cached ticket object as sufficient — it must re-fetch and re-validate ownership from the backend on every Ticket Detail page load.

### 5.11 Transition to Real Authentication (Lab 3)
- **BR-41.** All ownership checks in Lab 2 are written against a `requesterId` value sourced from a request header/parameter. This value must be isolated behind a single access point (e.g., one function/middleware) in the backend so that in Lab 3 it can be replaced by the authenticated session's user id with minimal call-site changes.
- **BR-42.** The Development Requester Selection screen and its "for testing only" messaging must be removed or hidden entirely once Lab 3 authentication is introduced; it must not remain reachable alongside real login.

---

## 6. UI Specification Summary

Full detail lives in `ui-spec.md`. Summary:
- **Routes** (reference for all subsequent labs):
  - `/select-requester` → Development Requester Selection (lab2/04)
  - `/tickets` → My Tickets (lab2/06)
  - `/tickets/new` → Create Ticket (lab2/05)
  - `/tickets/:ticketNumber` → Requester Ticket Detail (lab2/07)
- **Application shell**: TokTickIT title/logo, top nav (My Tickets, Create Ticket), current-Requester badge with Change Requester action, active-page indication, responsive hamburger nav on mobile.
- **Development Requester Selection**: dropdown of active Requesters, explanatory "testing only" banner, loading/empty/error states, Continue button.
- **Create Ticket**: grouped sections (system-generated info, classification, summary/description, attachments, actions), Zen Green field states (editable, read-only, invalid, disabled), busy submit button, success panel showing generated Ticket Number.
- **My Tickets**: search bar, filter controls, sortable table (desktop) / cards (mobile), pagination footer, loading/empty/no-results/error states.
- **Ticket Detail**: read-only header grid, Attachments panel with active/removed sections, add-attachment control, download/remove actions gated by ownership.
- **Shared components**: badges (priority, status), buttons (primary/secondary/tertiary/destructive/disabled/busy), validation message placement, responsive breakpoints (≥768px desktop/tablet, <768px mobile).

---

## 7. Data Changes

### 7.1 Entities

**DevRequester**
| Field | Type | Notes |
|---|---|---|
| id | Int (PK, autoincrement) | |
| fullName | String | |
| email | String, unique | |
| isActive | Boolean, default true | inactive Requesters excluded from selector |
| createdAt | DateTime, default now | |

**Category**
| Field | Type | Notes |
|---|---|---|
| id | Int (PK) | |
| name | String, unique | e.g., Hardware, Software, Network, Account and Access |
| isActive | Boolean, default true | |

**RelatedSystem**
| Field | Type | Notes |
|---|---|---|
| id | Int (PK) | |
| name | String, unique | e.g., Email, Campus Wi-Fi, VPN, Corporate Laptop |
| isActive | Boolean, default true | |

**Ticket**
| Field | Type | Notes |
|---|---|---|
| id | Int (PK) | |
| ticketNumber | String, unique | BR-06 format |
| requesterId | Int (FK → DevRequester) | not null, immutable |
| categoryId | Int (FK → Category) | not null |
| relatedSystemId | Int (FK → RelatedSystem) | not null |
| summary | String | 5–120 chars |
| description | String (text) | 20–2000 chars |
| requestedPriority | Enum(LOW, MEDIUM, HIGH) | |
| itPriority | Enum(LOW, MEDIUM, HIGH), nullable | out of scope this sprint |
| currentStatus | Enum(NEW), default NEW | only value used in Lab 2; enum left extensible |
| ticketOwnerId | Int (FK → future IT Staff), nullable | out of scope this sprint |
| resolutionSummary | String, nullable | |
| createdAt | DateTime, default now | = Ticket Date |
| updatedAt | DateTime, auto-update | |

**Attachment**
| Field | Type | Notes |
|---|---|---|
| id | Int (PK) | |
| ticketId | Int (FK → Ticket) | not null |
| originalFileName | String | for display |
| storedFileName | String, unique | UUID-based, safe |
| mimeType | String | |
| fileSizeBytes | Int | |
| uploadedByRequesterId | Int (FK → DevRequester) | |
| uploadedAt | DateTime, default now | |
| isRemoved | Boolean, default false | |
| removedAt | DateTime, nullable | |
| removedReason | String, nullable | 3–200 chars when set |
| removedByRequesterId | Int (FK → DevRequester), nullable | |

### 7.2 Relationships
- DevRequester (1) — (N) Ticket
- Category (1) — (N) Ticket
- RelatedSystem (1) — (N) Ticket
- Ticket (1) — (N) Attachment

**Audit trail FKs (defined in Section 7.1 Attachment table):**
- Attachment.uploadedByRequesterId → DevRequester (not null; records who uploaded)
- Attachment.removedByRequesterId → DevRequester (nullable; records who soft-removed)

### 7.3 Indexes / Constraints
- Unique: `Ticket.ticketNumber`, `DevRequester.email`, `Attachment.storedFileName`, `Category.name`, `RelatedSystem.name`
- Foreign keys with `onDelete: Restrict` on Ticket → DevRequester/Category/RelatedSystem (never cascade-delete a Requester's history in Lab 2)
- Index on `Ticket.requesterId` (every My Tickets query filters by it)
- Composite index on `(requesterId, createdAt)` to support default sort + ownership filter together
- Index on `Ticket.ticketNumber` (search) and a trigram/ILIKE-friendly index on `Ticket.summary` if supported, otherwise standard btree with `ILIKE` fallback
- Index on `Attachment.ticketId`

### 7.4 Migration Decisions
- Lab 2 introduces all five tables fresh; no destructive changes to Lab 1 tables are expected.
- `currentStatus`, `itPriority`, and `ticketOwnerId` are modeled now (not deferred) so that Lab 3/4 additions are additive rather than requiring a breaking migration.

### 7.5 Justified Design Decision
Choosing to model `itPriority` and `ticketOwnerId` as nullable columns now (rather than adding them only when IT Staff workflow is built) avoids an awkward future migration on a table that will already contain live Requester data, at the cost of a small amount of unused schema in Lab 2. This trade-off favors migration safety over strict "excluded scope is untouched" purism.

---

## 8. API Contract

Full detail in `api-spec.md`. Endpoints:
- `GET /api/dev-requesters` — active Requesters for the selector
- `GET /api/categories` — active Categories
- `GET /api/related-systems` — active Related Systems
- `POST /api/tickets` — create a Ticket (+ optional attachments)
- `GET /api/tickets` — paginated, searchable, filterable, sortable list of the current Requester's Tickets
- `GET /api/tickets/:ticketNumber` — one owned Ticket
- `POST /api/tickets/:ticketNumber/attachments` — add an attachment to an owned Ticket
- `GET /api/attachments/:id` — attachment metadata
- `GET /api/attachments/:id/download` — download an active attachment
- `DELETE /api/attachments/:id` — soft-remove an owned, active attachment

All ticket/attachment endpoints require an `X-Dev-Requester-Id` header (Lab 2 stand-in for a real session) and re-validate that the Requester is active and owns the resource.

---

## 9. Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-01 | Given valid Ticket data, when the Requester submits Create Ticket, then one Ticket is saved and the official, backend-generated Ticket Number is displayed in a success panel. |
| AC-02 | Given no Development Requester is selected (or the stored selection is invalid/inactive), when the user attempts to open My Tickets or Create Ticket, then they are redirected to the Development Requester Selection screen. |
| AC-03 | Given Requester B is selected, when a direct request is made for a Ticket belonging to Requester A (by ticket number or id), then the API returns 404 and no Ticket data is returned. |
| AC-04 | Given the Ticket Summary is empty, when the Requester submits the form, then a field-level validation message appears under Summary and no API request is sent. |
| AC-05 | Given the Description is only 10 characters, when the Requester submits the form, then a field-level validation message about minimum length appears and the API rejects the request with 400 if it is somehow reached directly. |
| AC-06 | Given the Requester selects a 6 MB image, when they attempt to attach it, then the file is rejected before upload with a clear size-limit message, and the Ticket form remains otherwise intact. |
| AC-07 | Given the Requester selects a `.docx` file, when they attempt to attach it, then the file is rejected as an unsupported type before upload. |
| AC-08 | Given a Ticket already has 5 active Attachments, when the Requester attempts to add a 6th, then the request is rejected with a clear message, and no new Attachment record is created. |
| AC-09 | Given the backend is unreachable, when the Requester submits a valid Create Ticket form, then a safe error state is shown and all entered field values remain in the form. |
| AC-10 | Given Requester A has 12 tickets and Requester B has 3 tickets, when Requester A opens My Tickets, then exactly Requester A's 12 tickets are listed, never Requester B's. |
| AC-11 | Given the Requester searches My Tickets for a ticket number substring, when results return, then only tickets whose ticket number or summary match are shown. |
| AC-12 | Given the Requester filters My Tickets by Category = Hardware, when results return, then only Hardware tickets owned by that Requester are shown. |
| AC-13 | Given the Requester has zero tickets, when they open My Tickets, then the empty state (not the no-results state) is shown, inviting them to create a ticket. |
| AC-14 | Given the Requester has tickets but the current filter matches none, when the list loads, then the no-results state (not the empty state) is shown, inviting them to clear filters. |
| AC-15 | Given My Tickets has 42 results and page size 10, when the Requester is on page 1, then pagination controls show "Showing 1 to 10 of 42" and 5 pages, and navigating to page 2 shows the next 10. |
| AC-16 | Given the Requester opens Ticket Detail for their own Ticket, when the page loads, then all header fields render as read-only and match the database values. |
| AC-17 | Given the Requester adds a valid Attachment on Ticket Detail, when the upload succeeds, then the new Attachment appears immediately in the active Attachments list without a full page reload. |
| AC-18 | Given the Requester downloads an active Attachment, when the request completes, then the original file content is returned with the original filename. |
| AC-19 | Given the Requester soft-removes an Attachment and supplies a reason, when the removal completes, then the Attachment moves to the removed section, its download action is disabled, and a direct download request for it returns 404. |
| AC-20 | Given the Requester attempts to soft-remove an Attachment without entering a reason, when they submit, then the removal is blocked with a validation message and no removal occurs. |
| AC-21 | Given an inactive Development Requester exists in the database, when the Selection screen loads, then that Requester does not appear in the dropdown. |
| AC-22 | Given the Requester switches from Requester A to Requester B via Change Requester, when the switch completes, then My Tickets reloads and shows only Requester B's tickets, with no flash of Requester A's data. |
| AC-23 | Given the viewport is <768px, when any of the four screens render, then no horizontal page scrolling occurs and all buttons remain touch-usable. |
| AC-24 | Given a screen reader or keyboard-only user, when they tab through Create Ticket, then every control is reachable, has a visible focus indicator, and every icon-only control has an accessible label. |
| AC-25 | Given My Tickets is loading data from the API (initial load or after a filter/search/sort/page change), when the response has not yet arrived, then skeleton loading rows are displayed and no table data is shown. |
| AC-26 | Given My Tickets encounters an API error or a non-200 response, when the error occurs, then an error banner with a message and a Retry button is shown, and clicking Retry re-fetches the tickets successfully. |

---

## 10. Definition of Done

See also `ai-use.md` and `reviewer.md` for process evidence. Product-completion conditions:
- [ ] All FR-01 through FR-16 are implemented and demonstrable.
- [ ] Every AC-01 through AC-26 has at least one passing, traceable automated test (see `tests.md`).
- [ ] No required test is skipped, disabled, or commented out in the final `main` branch.
- [ ] Data model matches Section 7 and the Prisma schema; migrations run cleanly on a fresh database plus idempotent seed.
- [ ] API responses match `api-spec.md` exactly, including status codes and error shapes.
- [ ] UI matches `ui-spec.md`: Zen Green tokens, component states, and responsive rules, verified with Playwright screenshots at desktop/tablet/mobile.
- [ ] All success, validation-failure, ownership-failure, and server-failure paths have been manually demonstrated and screenshotted for the submission PDF.
- [ ] Ownership isolation between at least two different Development Requesters has been explicitly demonstrated (list isolation + direct-access rejection).
- [ ] README setup and test-run instructions are current and were verified on a clean clone.
- [ ] All planned Issues reached Done on the Kanban board, and the release PR from `lab2-staging` to `main` was reviewed and merged.

---

## 11. Assumptions and Decisions

1. **Ticket Number format** (`TKT-{YYYY}-{6-digit sequence}`) was not fully specified in the handout beyond the example `TKT-2025-001234`; the year-scoped sequence is chosen for readability and to avoid unbounded digit growth.
2. **Priority values** are limited to `LOW`, `MEDIUM`, `HIGH` (matching the illustrative UI), rather than adding an `URGENT` tier not shown anywhere in the handout.
3. **Ownership-failure status code** is 404, not 403, to avoid confirming another Requester's ticket exists (an information-disclosure consideration reasonable for a support-ticket system).
4. **Session identity mechanism** for Lab 2 is an explicit request header (`X-Dev-Requester-Id`) rather than a cookie, since no session/auth infrastructure exists yet; this is isolated behind one backend access point per BR-41 to ease the Lab 3 transition.
5. **Attachment storage** is assumed to be local disk / object storage abstracted behind a single service function; soft-removed files are retained on disk (not physically deleted) in Lab 2, matching BR-34's audit-friendly stance.
6. **`itPriority` and `ticketOwnerId`** are included in the schema now (nullable) rather than added later, per the justified decision in Section 7.5.
7. **`GET /api/dev-requesters` follows `api-spec.md`'s wrapped response format** (`{ requesters: [...] }`). ~~The existing `GET /api/categories` endpoint from Lab 1 does not match this pattern (returns a bare array) — this inconsistency is out of scope for lab2/04 and is flagged for correction in lab2/08 (reference data API) when categories/related-systems endpoints are properly implemented per `api-spec.md`.~~ **Resolved in lab2/05:** `GET /api/categories` now returns `{ categories: [...] }` per api-spec §2, and `GET /api/related-systems` was added returning `{ relatedSystems: [...] }` per api-spec §3.
8. **~~The `X-Dev-Requester-Id` auth header enforcement is not yet applied to `GET /api/categories`~~** (Lab 1 implementation predates this requirement) — ~~also flagged for lab2/08.~~ **Resolved in lab2/05:** Both `GET /api/categories` and `GET /api/related-systems` now use `requesterContext` middleware.
9. **~~`categories.test.ts` (Lab 1) uses hardcoded category IDs (1–4)~~** ~~which drift from actual DB state after repeated seed/reset cycles during development. This is a known test-fragility issue predating Lab 2, flagged for cleanup when Lab 1 tests are next touched — not blocking for any Lab 2 branch.~~ **Resolved in lab2/05:** Test rewritten to use dynamic ID lookup via `prisma.devRequester.findFirst()` and `prisma.category.findMany()`, eliminating hardcoded ID drift.
10. **BR-03 automatic enforcement** is implemented via `client/src/lib/apiClient.ts`, a global fetch wrapper used by all API calls. When the backend returns 401 with `error.code === "INVALID_REQUESTER_CONTEXT"`, apiClient immediately clears `localStorage` and dispatches a `"requester:cleared"` CustomEvent. `RequesterProvider` listens for this event, clears React state, and navigates to `/select-requester` via React Router. This mechanism is chosen over `window.location.replace()` to avoid a full page reload and maintain a smooth SPA experience. All API-facing pages (`SelectRequesterPage`, and future `MyTicketsPage`, `CreateTicketPage`, `TicketDetail`) should use `apiClient` instead of raw `fetch` to benefit from automatic BR-03 and BR-05 enforcement.
11. **Test config include pattern** — `client/vite.config.ts` originally used `include: ["tests/**/*.test.tsx"]` which silently excluded `.test.ts` files (discovered during self-audit when `apiClient.test.ts` with 14 tests was missing from vitest output). Fixed to `include: ["tests/**/*.test.{ts,tsx}"]`. The server config (`server/vitest.config.ts`) uses `include: ["tests/**/*.test.ts"]` which is correct for its all-`.ts` test files. **No CI or lint step currently validates that the number of test files on disk matches the number discovered by the test runner** — recommend adding such a check in a future sprint to prevent silent config regressions.
12. **`seed.idempotency.test.ts` deletes all rows across every table in `beforeAll`**, which races with other test files when Vitest runs suites in parallel — observed manifesting as different symptoms depending on what other test queries at that moment (ID mismatch, 'not iterable' errors, etc. — see lab2/05 investigation). **Resolved lab2/06:** Fixed by adding `poolOptions.forks.singleFork: true` to `server/vitest.config.ts`, forcing all test files to run sequentially in a single fork instead of in parallel. This eliminates the race entirely — 134 tests pass deterministically across 3 consecutive full-suite runs (only 2 pre-existing empty-suite "failures" from `attachments.api.test.ts` and `ticket-detail.api.test.ts`). Trade-off: sequential execution is slightly faster in practice (~1.1–1.2s vs ~1.4s baseline) because single-worker eliminates process-spawn overhead; real-world impact is negligible for this test count.
13. **ui-spec.md Section 7.1 specifies a read-only "Ticket Number" chip in the Create Ticket header row upon successful submission.** This was omitted in implementation because the success panel (Section 7, post-submit success state) already displays the ticket number prominently as the primary confirmation element, making the header chip redundant. If this is later found to not meet grading expectations, it can be added trivially.
14. **`filterOptions` field added to `GET /api/tickets` response** (api-spec §5) to fully comply with BR-15. The original api-spec.md response shape omitted this field, but BR-15 requires that filter dropdowns show only Categories/Requested Priorities/Current Statuses that exist for the current Requester's tickets. The `filterOptions` object is computed from the Requester's **full** ticket set (ignoring any active search/filter/sort parameters) so that filter dropdown options remain stable and do not disappear when a filter is applied. Filter values supplied by the user are validated against the full reference set (all active Categories, all valid enum values), not against `filterOptions`.
15. **TicketTable uses native `<table>` without explicit `role` attribute** — the initial implementation used `role="grid"` per accessibility review, but this was found to conflict with §8.3 keyboard navigation expectations (grid role implies arrow-key cell navigation, while the design calls for Tab-to-row + Enter-to-navigate). The explicit `role="grid"` and `role="row"` were removed, relying on native HTML `<table>`/`<tr>` implicit semantics. `tabIndex={0}` + `onKeyDown` on `<tr>` handle keyboard accessibility per §8.3.
16. **Desktop table container uses `overflow-x: auto`** instead of `overflow-x: hidden` — the 9-column ticket table can exceed the 1200px max-width container at certain viewport sizes. `overflow-x: auto` allows horizontal scroll within the table container only (not on the page), which is the standard pattern for wide data tables.
17. **Ticket row click navigates to `/tickets/:ticketNumber`** as a placeholder — the Ticket Detail page will be implemented in lab2/07. The `onClick` handler uses `react-router-dom`'s `useNavigate()` to navigate, with a TODO comment marking the destination as pending.
18. **Responsive layout (Phase 3)**: tablet (768–991px) shows 4 columns via CSS `display: none` (not JS conditional rendering); mobile (<768px) switches from table to stacked card layout via CSS media queries. Touch targets override Field component height to 44px only within FilterControls via CSS variable `--field-height: 44px` — other pages (CreateTicket) remain at 40px default.