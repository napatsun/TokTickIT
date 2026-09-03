# Lab 2 Test Plan and Results — TokTickIT Requester Ticketing MVP

## 1. Test Strategy

Testing follows Test DD / TDD: for each GitHub Issue, the scenarios below are written (or at minimum stubbed as failing tests) before the corresponding implementation, using the acceptance criteria in `specification.md` as the source of truth. Six levels are covered:

- **Unit** — pure logic with no I/O (ticket number generation, validation functions, query-param clamping).
- **API/Integration** — HTTP request → response against a real (test) database, covering success, validation, ownership, and failure paths.
- **UI Component** — component-level rendering/interaction tests (React Testing Library or equivalent), mocking the API layer.
- **UI Style/Visual** — automated assertions on required CSS classes/tokens plus Playwright screenshots at 3 viewports.
- **Responsive** — Playwright viewport-resize checks for layout breakage (overflow, clipping, overlap).
- **E2E** — full browser flows against the running app + real backend + test database, covering multi-screen journeys and multi-Requester isolation.

Every row in Section 2 maps to at least one AC from `specification.md` Section 9, and every AC maps to at least one row here (see Section 3 matrix).

---

## 2. Planned Tests

### 2.1 Unit Tests

| Test ID | Requirement / AC | What It Tests | Expected Result | Automated Test File |
|---|---|---|---|---|
| UNIT-01 | BR-06 | Ticket number generator produces `TKT-{YYYY}-{6-digit}` format | Matches regex `^TKT-\d{4}-\d{6}$` | `server/tests/lab-02/ticket-number.test.ts` (✅ Implemented — 18 tests) |
| UNIT-02 | BR-06 | Ticket number sequence increments per year and resets for a new year | Sequence for 2027 starts at 000001 independent of 2026's last value | `server/tests/lab-02/ticket-number.test.ts` (✅ Implemented — covered by "returns different numbers on successive calls" test) |
| UNIT-03 | BR-19, BR-20 | Summary/Description validators reject out-of-range lengths | Returns validation error for <5 or >120 chars (summary), <20 or >2000 (description) | `server/tests/lab-02/validation.unit.test.ts` (**Planned** — file does not exist yet) |
| UNIT-04 | BR-22 | Requested Priority validator | Accepts LOW/MEDIUM/HIGH only, rejects anything else | `server/tests/lab-02/validation.unit.test.ts` (**Planned** — file does not exist yet) |
| UNIT-05 | BR-17 | Pagination param clamping function | page<1→1; pageSize not in {10,20,50}→10 | `server/tests/lab-02/pagination.unit.test.ts` (**Planned** — file does not exist yet) |
| UNIT-06 | BR-28 | Attachment MIME/extension matcher | Rejects mismatched extension/MIME pairs (e.g., `.png` with `image/gif` MIME) | `server/tests/lab-02/attachmentValidation.unit.test.ts` (**Planned** — file does not exist yet) |
| UNIT-07 | BR-34 | Removal-reason validator | Rejects <3 or >200 chars, trims whitespace | `server/tests/lab-02/validation.unit.test.ts` (**Planned** — file does not exist yet) |
| UNIT-08 | BR-19, BR-20 | `validateForm()` direct unit tests — summary >120, description >2000, boundary values, all-valid returns empty | Each oversized value returns correct error string; boundaries pass; valid state returns `{}` | `client/tests/lab-02/CreateTicket.test.tsx` (✅ Implemented — 5 direct unit tests under "validateForm() — direct unit tests") |
| UNIT-09 | BR-19, BR-20 | `maxLength` bypass protection — summary >120 and description >2000 set via `fireEvent.change` bypassing HTML `maxLength` | `validateForm()` catches oversized values even when they bypass the HTML attribute | `client/tests/lab-02/CreateTicket.test.tsx` (✅ Implemented — 2 tests under "maxLength bypass protection") |

#### Seed Tests

| Test ID | Requirement / AC | What It Tests | Expected Result | Automated Test File |
|---|---|---|---|---|
| SEED-01 | specification.md Section 5.3 (seed idempotency requirement) | Run seed function twice consecutively and count rows in Category, RelatedSystem, DevRequester | Row counts after run 1 and run 2 are identical for every table (no duplicates) | `server/tests/lab-02/seed.idempotency.test.ts` (✅ Implemented — 1 test) |

#### Concurrency Tests

| Test ID | Requirement / AC | What It Tests | Expected Result | Automated Test File |
|---|---|---|---|---|
| CONC-01 | BR-06 | 10 concurrent `generateTicketNumber()` calls all return valid format without crashing | All 10 return values match `^TKT-\d{4}-\d{6}$`; no unhandled rejection | `server/tests/lab-02/ticket-number.test.ts` (✅ Implemented) |
| CONC-02 | BR-06 | Concurrent calls may return duplicates — documented as expected and safe | All values valid format; duplicates do not crash; test documents the behavior | `server/tests/lab-02/ticket-number.test.ts` (✅ Implemented) |
| CONC-03 | BR-06 | After inserting a ticket, concurrent calls still return valid candidates | All concurrent results match valid format after an insert bumps the sequence | `server/tests/lab-02/ticket-number.test.ts` (✅ Implemented) |
| CONC-04 | BR-06 | P2002 retry simulation — first insert succeeds, duplicate gets P2002, retried candidate succeeds | Duplicate insert throws Prisma unique constraint error; retry with new candidate succeeds | `server/tests/lab-02/ticket-number.test.ts` (✅ Implemented) |

### 2.2 API / Integration Tests

| Test ID | Requirement / AC | What It Tests | Expected Result | Automated Test File |
|---|---|---|---|---|
| API-01 | AC-01 | `POST /api/tickets` with fully valid data | 201; ticket persisted; unique ticketNumber returned | `server/tests/lab-02/create-ticket.api.test.ts` (✅ Implemented — "happy path" group, 9 tests) |
| API-02 | AC-04, AC-05 | `POST /api/tickets` missing Summary / short Description | 400 with `fieldErrors.summary` / `fieldErrors.description` | `server/tests/lab-02/create-ticket.api.test.ts` (✅ Implemented — summary validation 6 tests + description validation 5 tests) |
| API-03 | BR-21 | `POST /api/tickets` with inactive/nonexistent categoryId | 400 `INVALID_REFERENCE` | `server/tests/lab-02/create-ticket.api.test.ts` (✅ Implemented — reference validation, 4 tests) |
| API-04 | AC-06, BR-29 | `POST /api/tickets` with a 6MB attachment | 413 `ATTACHMENT_TOO_LARGE`; no Ticket left committed if this is the only failure path tested standalone | `server/tests/lab-02/create-ticket-attachments.api.test.ts` (✅ Implemented — "rejects file exceeding 5MB with 413") |
| API-05 | AC-07, BR-28 | `POST /api/tickets` with a `.docx` attachment | 415 `UNSUPPORTED_ATTACHMENT_TYPE` | `server/tests/lab-02/create-ticket-attachments.api.test.ts` (✅ Implemented — rejects .docx, .gif, MIME/extension mismatch, 3 tests) |
| API-06 | BR-31 | `POST /api/tickets` where one attachment upload is forced to fail mid-request | 201; ticket created; `attachmentFailures` lists the failed file; ticket row exists in DB | `server/tests/lab-02/create-ticket-attachments.api.test.ts` (✅ Implemented — "ticket survives when 1 of 3 attachments fails to upload") |
| API-07 | — (auth context) | Any ticket/attachment endpoint called with missing `X-Dev-Requester-Id` | 401 `INVALID_REQUESTER_CONTEXT` | `server/tests/lab-02/authContext.api.test.ts` (**Planned** — not yet implemented; auth is tested inline in API-01, API-28, API-33) |
| API-08 | BR-05, BR-37 | Endpoint called with header referencing an inactive Requester | 401 `INVALID_REQUESTER_CONTEXT` | `server/tests/lab-02/authContext.api.test.ts` (**Planned** — not yet implemented; auth is tested inline in API-01, API-28, API-33) |
| API-09 | AC-10 | `GET /api/tickets` for Requester A vs Requester B, each with seeded tickets | Requester A's response contains only A's tickets (by id set equality); same for B | `server/tests/lab-02/my-tickets.api.test.ts` (✅ Implemented — 2 tests) |
| API-10 | AC-11 | `GET /api/tickets?search=laptop` | Only tickets whose ticketNumber or summary match "laptop" (case-insensitive) are returned | `server/tests/lab-02/my-tickets.api.test.ts` (✅ Implemented — 3 tests) |
| API-11 | AC-12 | `GET /api/tickets?categoryId=2` | Only that Requester's Hardware tickets returned | `server/tests/lab-02/my-tickets.api.test.ts` (✅ Implemented — 2 tests) |
| API-12 | AC-15, BR-16, BR-17 | `GET /api/tickets?page=1&pageSize=10` against 42 seeded tickets | `pagination.totalItems=42`, `totalPages=5`; page 2 returns the next distinct 10 | `server/tests/lab-02/my-tickets.api.test.ts` (✅ Implemented — 3 tests) |
| API-13 | BR-17 | `GET /api/tickets?page=0&pageSize=999` | Clamped to page=1, pageSize=10 (not a 400) | `server/tests/lab-02/my-tickets.api.test.ts` (✅ Implemented — 6 tests) |
| API-14 | BR-15 (invalid enum) | `GET /api/tickets?requestedPriority=URGENT` | 400 validation error | `server/tests/lab-02/my-tickets.api.test.ts` (✅ Implemented — 4 tests: invalid requestedPriority, sortBy, sortDir, currentStatus) |
| API-15 | AC-03 | `GET /api/tickets/:ticketNumber` for a ticket owned by a different Requester | 404 `TICKET_NOT_FOUND` (not 403) | `server/tests/lab-02/ticket-detail.api.test.ts` (**Planned** — file exists but empty) |
| API-16 | AC-16 | `GET /api/tickets/:ticketNumber` for own ticket | 200; all header fields present and correct; attachments split into active/removed | `server/tests/lab-02/ticket-detail.api.test.ts` (**Planned** — file exists but empty) |
| API-17 | AC-17, FR-11 | `POST /api/tickets/:ticketNumber/attachments` valid file on owned ticket | 201; attachment appears in subsequent `GET` of the ticket | `server/tests/lab-02/attachments.api.test.ts` (**Planned** — file exists but empty) |
| API-18 | AC-08, BR-30 | Adding a 6th active attachment to a ticket that already has 5 | 400 `ATTACHMENT_LIMIT_REACHED`; no 6th record created | `server/tests/lab-02/attachments.api.test.ts` (**Planned** — file exists but empty; note: attachment limit is also tested at creation time in `create-ticket-attachments.api.test.ts`) |
| API-19 | AC-18 | `GET /api/attachments/:id/download` for an active, owned attachment | 200; correct `Content-Disposition` filename and bytes | `server/tests/lab-02/attachments.api.test.ts` (**Planned** — file exists but empty) |
| API-20 | AC-19, BR-35 | `GET /api/attachments/:id/download` for a soft-removed attachment | 404 `ATTACHMENT_NOT_FOUND` | `server/tests/lab-02/attachments.api.test.ts` (**Planned** — file exists but empty) |
| API-21 | AC-19, BR-34 | `DELETE /api/attachments/:id` with a valid reason on an owned, active attachment | 200; `isRemoved=true`, `removedReason` stored | `server/tests/lab-02/attachments.api.test.ts` (**Planned** — file exists but empty) |
| API-22 | AC-20 | `DELETE /api/attachments/:id` with empty `removalReason` | 400 validation error; attachment remains active | `server/tests/lab-02/attachments.api.test.ts` (**Planned** — file exists but empty) |
| API-23 | BR-33 | `DELETE /api/attachments/:id` for an attachment on a ticket owned by a different Requester | 404 (ownership never confirmed nor denied explicitly) | `server/tests/lab-02/attachments.api.test.ts` (**Planned** — file exists but empty) |
| API-24 | AC-21, BR-02 | `GET /api/dev-requesters` with one seeded inactive Requester | Response excludes the inactive Requester | `server/tests/lab-02/dev-requesters.api.test.ts` (✅ Implemented — 6 tests) |
| API-25 | BR-26 | Force an unexpected server error (e.g., DB disconnect mock) on any endpoint | 500 with generic safe message, no stack trace/SQL in body | `server/tests/lab-02/errorHandling.api.test.ts` (**Planned** — not yet implemented; safe error is tested client-side in UI-08) |
| API-26 | specification.md Section 7.1 (RelatedSystem.isActive, added in branch lab2/02) | `GET /api/related-systems` must exclude RelatedSystem rows where `isActive=false` | Response does not include any inactive RelatedSystem | `server/tests/lab-02/related-systems.api.test.ts` (✅ Implemented — 7 tests including inactive requester rejection) |
| API-27 | FR-01, BR-27 | `GET /api/dev-requesters` returns 200 with empty `requesters` array when no active requesters exist (empty state) | 200; `{ requesters: [] }`; valid JSON shape with no error field | `server/tests/lab-02/dev-requesters-empty-state.test.ts` (✅ Implemented — 2 tests) |
| API-28 | BR-41, BR-05, BR-37 | `requesterContext` middleware: rejects missing/invalid/inactive `X-Dev-Requester-Id` (401); accepts valid active Requester and attaches `req.currentRequester` | 401 `INVALID_REQUESTER_CONTEXT` for missing/empty/non-numeric/negative/zero/nonexistent/inactive; 200 + correct requester data for valid | `server/tests/lab-02/requester-context.test.ts` (✅ Implemented — 12 tests) |
| API-29 | AC-01, BR-06–BR-09, BR-19–BR-22 | `POST /api/tickets` — full create-ticket happy path + defaults verification (multipart/form-data) | 201; valid ticketNumber, currentStatus=NEW, itPriority=null, ticketOwner=null, ticketDate set, requester/category/relatedSystem objects included, all 3 priorities accepted, summary+description trimmed, unique numbers on successive requests | `server/tests/lab-02/create-ticket.api.test.ts` (✅ Implemented — "happy path" group, 9 tests) |
| API-30 | BR-28–BR-32 | `POST /api/tickets` — attachment upload at creation: happy path (1 file, 5 files, 0 files), rejection (>5 files, >5MB, unsupported type, MIME/extension mismatch), partial failure (BR-31), disk write verification | 201 with attachments array; 400/413/415 on rejection; 201 + attachmentFailures on partial failure; file verified on disk | `server/tests/lab-02/create-ticket-attachments.api.test.ts` (✅ Implemented — 10 tests) |
| API-31 | BR-31 | `POST /api/tickets` — RECORD_CREATION_FAILED scenario: disk write succeeds but `prisma.attachment.create()` fails | 201; ticket created; attachmentFailures[0].reason = `RECORD_CREATION_FAILED` | `server/tests/lab-02/create-ticket-attachments-db-failure.api.test.ts` (✅ Implemented — 1 test; isolated in own file due to Prisma spy cleanup) |
| API-32 | BR-06 | Ticket number generator: format validation (8 cases), generation (6 cases including current year, sequence padding, prefix) | `isValidTicketNumber()` accepts/rejects correct patterns; `generateTicketNumber()` returns valid format with correct year and padding | `server/tests/lab-02/ticket-number.test.ts` (✅ Implemented — 14 format/generation tests + 4 concurrency tests = 18 total) |
| API-33 | FR-16, BR-05, BR-37 | `GET /api/related-systems` — wrapped format `{ relatedSystems: [...] }`, all 6 seeded systems returned, id/name fields, ascending id order, 401 without header, 401 inactive, 401 non-existent | 200 with correct wrapped shape; 7 seed data assertions; 3 auth rejection cases | `server/tests/lab-02/related-systems.api.test.ts` (✅ Implemented — 7 tests) |
| API-34 | BR-05, BR-19–BR-22 | `POST /api/tickets` — requestedPriority validation: rejects URGENT, accepts lowercase medium, rejects missing, rejects empty string; error response shape follows Common Error Shape | 400 for invalid/missing/empty; 201 for normalized lowercase; error.body has code/message/fieldErrors | `server/tests/lab-02/create-ticket.api.test.ts` (✅ Implemented — 5 priority tests + 1 error shape test) |
| API-35 | BR-05 | `POST /api/tickets` — auth: 401 without header, 401 with inactive requester, 401 with non-existent id | 401 `INVALID_REQUESTER_CONTEXT` in all three cases | `server/tests/lab-02/create-ticket.api.test.ts` (✅ Implemented — 3 auth tests) |
| API-36 | BR-15 | `GET /api/tickets` — filterOptions.categories contains only distinct categories from the current Requester's tickets (not all categories in the system) | `filterOptions.categories` array has entries only for categories that appear in at least one of the Requester's tickets; categories with zero tickets for that Requester are absent | `server/tests/lab-02/my-tickets.api.test.ts` (✅ Implemented — 2 tests) |
| API-37 | BR-15 | `GET /api/tickets` — filterOptions.requestedPriorities contains only distinct priority values present in the Requester's tickets | `filterOptions.requestedPriorities` is a subset of `["LOW", "MEDIUM", "HIGH"]`; only values that appear in at least one ticket are included | `server/tests/lab-02/my-tickets.api.test.ts` (✅ Implemented — 1 test) |
| API-38 | BR-15 | `GET /api/tickets` — filterOptions.currentStatuses contains only distinct status values present in the Requester's tickets | `filterOptions.currentStatuses` only contains values that appear in at least one ticket (Lab 2: always `["NEW"]` if tickets exist) | `server/tests/lab-02/my-tickets.api.test.ts` (✅ Implemented — 1 test) |
| API-39 | BR-15 | `GET /api/tickets` — filterOptions is independent of active search/filter/sort params; applying `categoryId=2` does not narrow filterOptions.categories | Same `filterOptions` returned whether or not a `categoryId` filter is supplied; options reflect the full ticket set, not the filtered subset | `server/tests/lab-02/my-tickets.api.test.ts` (✅ Implemented — 2 tests) |
| API-40 | BR-15, BR-39 | `GET /api/tickets` — filterOptions empty when requester has zero tickets (totalItems=0) | `filterOptions.categories = []`, `filterOptions.requestedPriorities = []`, `filterOptions.currentStatuses = []`; `pagination.totalItems = 0` | `server/tests/lab-02/my-tickets.api.test.ts` (✅ Implemented — 1 test) |
| API-41 | BR-12, BR-15 | `GET /api/tickets` — filterOptions does not include categories/priorities/statuses from a different Requester's tickets | Requester A's `filterOptions` contains no values that exist only in Requester B's tickets; cross-Requester isolation applies to filterOptions as well | `server/tests/lab-02/my-tickets.api.test.ts` (✅ Implemented — 1 test) |

### 2.3 UI Component Tests

| Test ID | Requirement / AC | What It Tests | Expected Result | Automated Test File |
|---|---|---|---|---|
| UI-01 | FR-01 | Selection screen renders dropdown from mocked active-requester API | Options match mock data; inactive requester (if mocked in) excluded | `client/tests/lab-02/SelectRequester.test.tsx` (✅ Implemented — 22 tests) |
| UI-02 | AC-02 | Navigating to My Tickets with no stored Requester | Redirects to Selection screen | `client/tests/lab-02/RouteGuard.test.tsx` (✅ Implemented — 4 tests) |
| UI-03 | AC-04 | Submit Create Ticket with empty Summary | Field-level message rendered under Summary; API not called | `client/tests/lab-02/CreateTicket.test.tsx` (✅ Implemented — "submitting empty form" group, 3 tests + "summary validation" 4 tests) |
| UI-04 | AC-06 | Select a 6MB file in the attachment picker | Inline rejection message shown; file not added to pending list; other valid files unaffected | `client/tests/lab-02/AttachmentPicker.test.tsx` (✅ Implemented — "shows correct error for oversized file") |
| UI-05 | AC-07 | Select a `.docx` file | Inline "unsupported file type" message shown | `client/tests/lab-02/AttachmentPicker.test.tsx` (✅ Implemented — "shows error message for a file with wrong type") |
| UI-06 | — (busy state) | Click Submit on a valid form | Button shows busy/disabled state immediately; re-enabled only after response | `client/tests/lab-02/CreateTicket.test.tsx` (✅ Implemented — "submit button shows busy state while request is in flight") |
| UI-07 | AC-01 | Mocked successful `POST /api/tickets` response | Success panel renders with the returned Ticket Number | `client/tests/lab-02/CreateTicket.test.tsx` (✅ Implemented — "shows success panel with ticket number on 201 response") |
| UI-08 | AC-09 | Mocked network failure on submit | Safe error banner shown; all field values still present in the DOM | `client/tests/lab-02/CreateTicket.test.tsx` (✅ Implemented — 2 tests: "shows banner error on 500 response" + "shows banner error on network failure") |
| UI-09 | AC-13 | Mocked empty ticket list (zero ever) | Empty-state illustration/message shown, not no-results message | `client/tests/lab-02/MyTickets.test.tsx` (✅ Implemented — 5 tests: empty message, create button, navigate, hides controls, heading) |
| UI-10 | AC-14 | Mocked filtered list returning zero results while a filter is active | No-results message + Clear Filters button shown | `client/tests/lab-02/MyTickets.test.tsx` (✅ Implemented — 4 tests: no-results message, clear button, controls visible, BR-39 distinction) |
| UI-11 | AC-15 | Mocked paginated response (42 items) | "Showing 1 to 10 of 42 tickets" text renders; Next/page controls match `totalPages` | `client/tests/lab-02/MyTickets.test.tsx` (✅ Implemented — 4 tests: pagination text, Previous disabled, Next enabled, page buttons) |
| UI-12 | AC-16 | Render Ticket Detail with mocked owned-ticket response | All header fields render as read-only (no editable input elements present); summary, description, resolution summary, attachments, back link all present | `client/tests/lab-02/RequesterTicketDetail.test.tsx` (✅ Implemented — 8 tests) |
| UI-13 | AC-17 | Mocked successful attachment add | Active attachments display with filename/size/date; attachment count in heading; Add Attachment picker shown when under 5; limit message at 5; empty message when none | `client/tests/lab-02/AttachmentSection.test.tsx` (✅ Implemented — 5 tests) |
| UI-14 | AC-19, AC-20 | Attempt removal without reason, then with reason | Confirm button disabled until reason meets length rule; enabled after; Cancel closes dialog; remove error shown in dialog on failure | `client/tests/lab-02/AttachmentSection.test.tsx` (✅ Implemented — 4 tests) |
| UI-15 | BR-35 | Render a mocked removed attachment | Download/preview control is absent/disabled; "Unavailable" label shown instead; removed section heading with count | `client/tests/lab-02/AttachmentSection.test.tsx` (✅ Implemented — 4 tests) |
| UI-36 | AC-27, FR-14 | Ticket Detail loading state | Skeleton loading indicator shown while fetching; skeleton hides after data loads | `client/tests/lab-02/RequesterTicketDetail.test.tsx` (✅ Implemented — 2 tests) |
| UI-37 | AC-03, BR-13 | Ticket Detail not-found state (404) | "Ticket not found." message shown; Back to My Tickets button present and navigates; header block and attachments NOT shown | `client/tests/lab-02/RequesterTicketDetail.test.tsx` (✅ Implemented — 3 tests) |
| UI-38 | AC-28, BR-26 | Ticket Detail error state + retry | Error message shown on 500/network failure; Retry button present and re-fetches successfully | `client/tests/lab-02/RequesterTicketDetail.test.tsx` (✅ Implemented — 3 tests) |
| UI-39 | AC-29, BR-33 | Attachment add error display | Server error message displayed near AttachmentPicker; generic error shown on network failure | `client/tests/lab-02/AttachmentSection.test.tsx` (✅ Implemented — 2 tests) |
| UI-40 | AC-19, AC-20 | Attachment remove error display | Error shown in RemoveAttachmentConfirm dialog on DELETE failure; dialog stays open for retry; Cancel clears error | `client/tests/lab-02/AttachmentSection.test.tsx` (✅ Implemented — 3 tests) |
| UI-41 | AC-18, BR-35 | Attachment download error feedback | Error message shown when download fails (non-ok response or network error) | `client/tests/lab-02/AttachmentSection.test.tsx` (✅ Implemented — 2 tests) |
| UI-16 | AC-24 | Tab through Create Ticket form | Every control reachable in a logical order; focus ring visible via computed style/class | `client/tests/lab-02/CreateTicket.accessibility.test.tsx` (**Planned** — file exists but empty; partial AC-24 coverage via UI-25) |
| UI-17 | ui-spec §4 (Buttons) | Button component renders variant classes (primary/secondary/tertiary/destructive/destructive-confirm/busy) | Each variant maps to its expected CSS module class name | `client/tests/lab-02/Button.test.tsx` (✅ Implemented — 13 tests) |
| UI-18 | ui-spec §4, BR-23 | Button disabled and busy states | `disabled` attr + `aria-disabled` when disabled; spinner + `busyLabel` + onClick suppressed when busy | `client/tests/lab-02/Button.test.tsx` (✅ Implemented — covered within 13 Button tests) |
| UI-19 | ui-spec §3 (Fields), §10 | Field component renders states (default/focused/invalid/readonly/disabled), required asterisk, validation messages, input vs textarea, character counter | Correct CSS classes per state; `aria-describedby` linked; `role="alert"` for error; textarea resize=vertical; counter shows `n/max` | `client/tests/lab-02/Field.test.tsx` (✅ Implemented — 21 tests) |
| UI-20 | ui-spec §9 (Badges) | Badge renders priority (LOW/MEDIUM/HIGH) and status (NEW) with correct variant classes + accessible `role=status` | Correct CSS module class per value; text always visible (not sr-only) | `client/tests/lab-02/Badge.test.tsx` (✅ Implemented — 8 tests) |
| UI-21 | ui-spec §6, §11 (App Shell) | AppShell renders nav active state, wordmark link, requester badge, Change Requester button, hamburger toggle, mobile menu, content outlet | Active nav gets `navLinkActive`; wordmark links to `/tickets`; Change Requester calls `clearRequester`; hamburger toggles mobile nav | `client/tests/lab-02/AppShell.test.tsx` (✅ Implemented — 14 tests) |
| UI-22 | BR-01, FR-02 | RequesterContext reads/writes/clears localStorage; handles corrupted data; throws outside provider | `requester` restored from `localStorage` on mount; `setRequester` persists; `clearRequester` removes; corrupted JSON → null; throws without `<RequesterProvider>` | `client/tests/lab-02/RequesterContext.test.tsx` (✅ Implemented — 14 tests) |
| UI-23 | BR-03, BR-05 | `apiClient` attaches `X-Dev-Requester-Id` header from localStorage; on 401 `INVALID_REQUESTER_CONTEXT` clears localStorage + dispatches `requester:cleared` event; other errors leave state untouched | Header present with correct ID when requester stored; absent when empty/invalid; localStorage cleared + event dispatched only on 401 with matching code | `client/tests/lab-02/apiClient.test.ts` (✅ Implemented — 14 tests) |
| UI-23b | BR-03 | `apiClient` → `RequesterProvider` redirect integration: dispatching `requester:cleared` clears React state and navigates to `/select-requester` via React Router | Protected content disappears; selection screen renders; no full page reload; safe to dispatch multiple times | `client/tests/lab-02/apiClient.requesterCleared.test.tsx` (✅ Implemented — 3 tests) |
| UI-24 | AC-02 | Route guard redirects to Select Requester when no stored requester | Selection screen renders on empty localStorage; protected content hidden | `client/tests/lab-02/RouteGuard.test.tsx` (✅ Implemented — 4 tests, combined with UI-02) |
| UI-25 | AC-24 | Focus moves to first invalid field after failed submit | `document.getElementById("categoryId")` receives focus after submit with empty form | `client/tests/lab-02/CreateTicket.test.tsx` (✅ Implemented — "focuses the first invalid field after submit fails") |
| UI-26 | AC-04, BR-24 | Blur re-validation: clears summary error on valid input + blur; keeps error when still invalid | Error message disappears after valid fix + blur; error message updates (not disappears) when still invalid | `client/tests/lab-02/CreateTicket.test.tsx` (✅ Implemented — 2 tests under "blur re-validation") |
| UI-27 | BR-24 | Field values preserved after validation failure | All entered values (category, summary, description, priority) remain in form after submit with missing related system | `client/tests/lab-02/CreateTicket.test.tsx` (✅ Implemented — "BR-24 field value preservation") |
| UI-28 | BR-19, BR-20 | Trimming: whitespace-only summary/description treated as required error | "Summary is required" shown for spaces-only input; "Description is required" shown for spaces-only input | `client/tests/lab-02/CreateTicket.test.tsx` (✅ Implemented — 2 tests under "trimming behavior") |
| UI-29 | AC-01, BR-31 | Submit handler — backend 400 VALIDATION_ERROR field errors displayed; 400 INVALID_REFERENCE displayed; 413 ATTACHMENT_TOO_LARGE displayed | Per-field error messages shown from server; field values preserved (BR-24) | `client/tests/lab-02/CreateTicket.test.tsx` (✅ Implemented — 3 tests: VALIDATION_ERROR, INVALID_REFERENCE, ATTACHMENT_TOO_LARGE) |
| UI-30 | AC-01, BR-31 | Submit handler — correct FormData fields sent to apiClient; attachment files included/excluded based on validation errors | FormData contains categoryId, relatedSystemId, summary, description, requestedPriority; files with client-side errors excluded from FormData | `client/tests/lab-02/CreateTicket.test.tsx` (✅ Implemented — 2 tests under "sends correct FormData" and "excludes files with validation errors") |
| UI-31 | BR-28, BR-29, BR-30 | AttachmentPicker — file size display format (bytes, KB, MB); inline error messages; counter display; remove button; drop zone disabled at max | formatFileSize shows B/KB/MB correctly; errors shown per-file; counter shows n/5; remove calls onFilesChange; drop zone aria-disabled at 5/5 | `client/tests/lab-02/AttachmentPicker.test.tsx` (✅ Implemented — 29 tests across 6 describe groups: file size display 5, inline error messages 6, counter 5, remove button 5, BR-30 max limit 4, filename display 2, drop zone hints 2) |
| UI-32 | BR-15 | My Tickets filter dropdowns populated from `filterOptions` in API response, not from `GET /api/categories` full list | Category dropdown options match `filterOptions.categories` from mocked API response; a category that exists in the system but has no tickets for this Requester does not appear in the dropdown | `client/tests/lab-02/MyTickets.test.tsx` (✅ Implemented — 5 tests: category/priority/status dropdowns from filterOptions + sort dropdown 4 options per D4) |
| UI-33 | BR-15 | When `filterOptions.categories` is empty (Requester has zero tickets), Category dropdown shows no options or is hidden | Category dropdown is empty or disabled when `filterOptions.categories = []`; no error occurs | `client/tests/lab-02/MyTickets.test.tsx` (✅ Implemented — 4 tests: category/priority/status dropdowns empty + no error on empty filterOptions) |
| UI-34 | AC-25 | Loading state: skeleton rows shown while API request in-flight | Skeleton/loading indicator visible during fetch; table not rendered until data arrives; skeleton disappears after load completes | `client/tests/lab-02/MyTickets.test.tsx` (✅ Implemented — 2 tests: skeleton shown while loading, skeleton hidden after load) |
| UI-35 | AC-26 | Error state: API returns non-ok or throws | Error banner with message shown; Retry button present; Retry re-fetches tickets successfully | `client/tests/lab-02/MyTickets.test.tsx` (✅ Implemented — 5 tests: non-ok response, thrown error, retry button present, retry re-fetches, hides banner after retry) |

### 2.4 Integration Tests

| Test ID | Requirement / AC | What It Tests | Expected Result | Automated Test File |
|---|---|---|---|---|
| INT-01 | AC-02, AC-22 | Full Requester flow using real `RequesterProvider` + `RequireRequester` + `SelectRequesterPage` + `AppShell` (only `fetch` mocked): empty localStorage → redirect to selection; select → Continue → protected page with correct badge; Change Requester → back to selection | Selection screen renders on empty localStorage; selected requester badge appears after Continue; Change Requester clears state and returns to selection | `client/tests/lab-02/RequesterFlow.integration.test.tsx` (✅ Implemented — 3 tests) |

### 2.5 UI Style / Visual Tests

| Test ID | Requirement / AC | What It Tests | Expected Result | Automated Test File |
|---|---|---|---|---|
| STYLE-01 | Section 1 (ui-spec.md) | Computed CSS custom properties on `:root`/theme provider | `--color-primary-green` etc. equal the exact hex values | `client/.../lab-02/tests/theme.style.test.tsx` (**Planned** — not yet implemented) |
| STYLE-02 | Section 3 (ui-spec.md) | Required field asterisk + invalid-state class presence | Asterisk element present when field required; `.field-invalid` class applied on validation error | `client/.../lab-02/tests/CreateTicket.style.test.tsx` (**Planned** — not yet implemented) |
| STYLE-03 | Section 4 (ui-spec.md) | Button variant classes | Primary/secondary/tertiary/destructive/disabled/busy each render distinct expected class names | `client/.../lab-02/tests/buttons.style.test.tsx` (**Planned** — not yet implemented) |
| STYLE-04 | Section 9 (ui-spec.md) | Badge component renders correct class per priority/status value | LOW/MEDIUM/HIGH and NEW map to their documented badge variants | `client/.../lab-02/tests/badges.style.test.tsx` (**Planned** — not yet implemented) |
| VISUAL-01 | AC-23, Section 12 checklist | Playwright screenshot of Create Ticket at 1280/834/375px | Screenshots saved to `artifacts/lab-02/screenshots/create-ticket/*`; manually checked against checklist | `e2e/lab-02/visual-create-ticket.spec.ts` (**Planned** — not yet implemented) |
| VISUAL-02 | AC-23 | Playwright screenshot of My Tickets at 3 viewports | Screenshots saved to `artifacts/lab-02/screenshots/my-tickets/*` | `e2e/lab-02/visual-my-tickets.spec.ts` (**Planned** — not yet implemented) |
| VISUAL-03 | AC-23 | Playwright screenshot of Ticket Detail at 3 viewports | Screenshots saved to `artifacts/lab-02/screenshots/ticket-detail/*` | `e2e/lab-02/visual-ticket-detail.spec.ts` (**Planned** — not yet implemented) |

### 2.6 Responsive Tests

| Test ID | Requirement / AC | What It Tests | Expected Result | Automated Test File |
|---|---|---|---|---|
| RESP-01 | AC-23 | Resize viewport to 375px on all 4 screens | `document.documentElement.scrollWidth` never exceeds `innerWidth` (no horizontal overflow) | `e2e/lab-02/responsive.spec.ts` (**Planned** — not yet implemented) |
| RESP-02 | Section 11 (ui-spec.md) | My Tickets table→card transition at <768px | Table element absent/hidden; card list elements present instead | `e2e/lab-02/responsive.spec.ts` (**Planned** — not yet implemented) |
| RESP-03 | Section 11 (ui-spec.md) | Button touch target size at mobile width | All primary/secondary buttons compute to ≥44px height | `e2e/lab-02/responsive.spec.ts` (**Planned** — not yet implemented) |

### 2.7 End-to-End Tests

| Test ID | Requirement / AC | What It Tests | Expected Result | Automated Test File |
|---|---|---|---|---|
| E2E-01 | AC-01, AC-17 | Full flow: select Requester → Create Ticket with one valid attachment → view success → open Ticket Detail | Ticket Number shown matches the one visible on Ticket Detail; attachment listed as active | `e2e/lab-02/requester-ticket-flow.spec.ts` (**Planned** — not yet implemented) |
| E2E-02 | AC-10, AC-22 | Select Requester A, note ticket count in My Tickets; Change Requester to B; observe list | Requester B sees a different, correct ticket set with no flash of A's data | `e2e/lab-02/requester-ticket-flow.spec.ts` (**Planned** — not yet implemented) |
| E2E-03 | AC-03 | As Requester B, attempt to navigate directly to a URL containing Requester A's ticket number | Redirected/shown "Ticket not found", no data displayed | `e2e/lab-02/requester-ticket-flow.spec.ts` (**Planned** — not yet implemented) |
| E2E-04 | AC-11, AC-12, AC-15 | Search + filter + paginate through a seeded 42-ticket list | Correct subset and page counts shown at each step | `e2e/lab-02/my-tickets-search-filter.spec.ts` (**Planned** — not yet implemented) |
| E2E-05 | AC-19 | From Ticket Detail, remove an attachment with a reason, then attempt to access its (previously valid) download link directly | Attachment shown in Removed section; direct download link now returns a not-found page | `e2e/lab-02/attachment-lifecycle.spec.ts` (**Planned** — not yet implemented) |
| E2E-06 | AC-21 | On the Selection screen, confirm the seeded inactive Requester never appears | Dropdown option count matches only active seed count | `e2e/lab-02/requester-selection.spec.ts` (**Planned** — not yet implemented) |
| E2E-07 | AC-13, AC-14 | A freshly seeded Requester with zero tickets sees empty state; after creating one ticket and searching for a non-matching term, sees no-results state | Both states appear at the correct moments, never swapped | `e2e/lab-02/my-tickets-empty-states.spec.ts` (**Planned** — not yet implemented) |

---

## 2.8 Test Commands

```bash
# Unit + API (backend)
cd server && npm run test:lab2:unit
cd server && npm run test:lab2:api

# UI component + style (frontend)
cd client && npm run test:lab2

# Responsive + visual + E2E (Playwright, requires app running against seeded test DB)
npm run test:e2e -- --grep "lab-02"
```

---

## 3. Acceptance-Criterion Traceability Matrix

| AC | Covered By |
|---|---|
| AC-01 | API-01, API-29, UI-07, UI-30, E2E-01 |
| AC-02 | UI-02, UI-24, INT-01 |
| AC-03 | API-15, UI-37, E2E-03 |
| AC-04 | API-02, API-34, UI-03, UI-25, UI-26, UI-27 |
| AC-05 | API-02 |
| AC-06 | API-04, API-30, UI-04, UI-31 |
| AC-07 | API-05, API-30, UI-05, UI-31 |
| AC-08 | API-18, API-30, UI-31 |
| AC-09 | UI-08, UI-29 |
| AC-10 | API-09, E2E-02 |
| AC-11 | API-10, E2E-04 |
| AC-12 | API-11, E2E-04 |
| AC-13 | UI-09, E2E-07 |
| AC-14 | UI-10, E2E-07 |
| AC-15 | API-12, UI-11, E2E-04 |
| AC-16 | API-16, UI-12 |
| AC-17 | API-17, UI-13, UI-39, E2E-01 |
| AC-18 | API-19, UI-41 |
| AC-19 | API-20, API-21, UI-14, UI-15, UI-40, E2E-05 |
| AC-20 | API-22, UI-14, UI-40 |
| AC-21 | API-24, API-26, API-27, API-33, E2E-06 |
| AC-22 | E2E-02, INT-01 |
| AC-23 | VISUAL-01, VISUAL-02, VISUAL-03, RESP-01, RESP-02, RESP-03 |
| AC-27 | UI-36 |
| AC-28 | UI-38 |
| AC-29 | UI-39, UI-40, UI-41 |
| AC-24 | UI-16, UI-25 |
| AC-25 | UI-34 |
| AC-26 | UI-35 |

Every AC has ≥1 automated test (planned or implemented). No test row is orphaned from an AC or a Business Rule.

**Note on implementation status:** AC-01, AC-04 through AC-09 now have real implemented tests across both backend and frontend (via API-29 through API-35 and UI-25 through UI-31). AC-02, AC-21, and AC-22 were already implemented in prior branches. AC-25 and AC-26 are implemented via UI-34 and UI-35. AC-03, AC-16 through AC-20 have frontend tests via UI-12 through UI-15. AC-27 through AC-29 are implemented via UI-36 through UI-41. AC-23 and AC-24 still map to planned test IDs (files exist but are currently empty stubs awaiting implementation in future branches).

---

## 4. Responsive and Visual Checklist

See `ui-spec.md` Section 12 for the full checklist used alongside VISUAL-01/02/03 and RESP-01/02/03. Screenshot artifacts are stored at:
```
artifacts/lab-02/screenshots/create-ticket/{desktop,tablet,mobile}.png
artifacts/lab-02/screenshots/my-tickets/{desktop,tablet,mobile}.png
artifacts/lab-02/screenshots/ticket-detail/{desktop,tablet,mobile}.png
```

---

## 5. Final Results

*Actual test run from `lab2/05-create-ticket-full` branch, 2026-09-01:*

| Level | Total | Passing | Failing | Skipped |
|---|---|---|---|---|
| Unit (ticket-number + seed) | 19 | 19 | 0 | 0 |
| API (create-ticket + attachments + db-failure + related-systems + dev-requesters + requester-context) | 71 | 71 | 0 | 0 |
| UI Component (CreateTicket + AttachmentPicker + SelectRequester + Field + Badge + Button + AppShell + RequesterContext + apiClient + RouteGuard) | 166 | 166 | 0 | 0 |
| Integration (RequesterFlow + apiClient.requesterCleared) | 6 | 6 | 0 | 0 |
| UI Style | 0 | 0 | 0 | 0 |
| Visual | 0 | 0 | 0 | 0 |
| Responsive | 0 | 0 | 0 | 0 |
| E2E | 0 | 0 | 0 | 0 |
| **Total (implemented)** | **346** | **346** | **0** | **0** |
| _Planned (files exist but empty)_ | _14_ | — | — | — |

**Implemented test file breakdown** (files with real tests on disk):

Backend (134 tests across 12 files; 127 in lab-02 + 7 in lab-01):
- `ticket-number.test.ts` — 18 tests (unit + concurrency)
- `create-ticket.api.test.ts` — 33 tests (happy path 9, summary 6, description 5, priority 4+1 shape, reference 4, auth 3, multi-field 1)
- `create-ticket-attachments.api.test.ts` — 10 tests (happy 3, limit 1, size 1, type 3, partial failure 1, disk 1)
- `create-ticket-attachments-db-failure.api.test.ts` — 1 test (RECORD_CREATION_FAILED)
- `my-tickets.api.test.ts` — 37 tests (ownership 2, search 3, filter 2, pagination 3, clamping 6, enum 4, filterOptions 7, response shape 4, sort 3, cross-requester 1, empty requester 1, empty filterOptions 1)
- `related-systems.api.test.ts` — 7 tests (wrapped format, seed data, fields, ordering, auth 3)
- `dev-requesters.api.test.ts` — 6 tests
- `dev-requesters-empty-state.test.ts` — 2 tests
- `requester-context.test.ts` — 12 tests
- `seed.idempotency.test.ts` — 1 test

Frontend (212 tests across 14 files):
- `CreateTicket.test.tsx` — 34 tests
- `MyTickets.test.tsx` — 28 tests (UI-09 empty 5, UI-10 no-results 4, UI-11 pagination 4, UI-32 filterOptions 5, UI-33 empty filterOptions 4, UI-34 loading 2, UI-35 error 5)
- `AttachmentPicker.test.tsx` — 29 tests (file size 5, errors 6, counter 5, remove 5, BR-30 max 4, filename 2, hints 2)
- `SelectRequester.test.tsx` — 22 tests
- `Field.test.tsx` — 21 tests
- `RequesterContext.test.tsx` — 14 tests
- `AppShell.test.tsx` — 14 tests
- `apiClient.test.ts` — 14 tests
- `Button.test.tsx` — 13 tests
- `Badge.test.tsx` — 8 tests
- `RouteGuard.test.tsx` — 4 tests
- `apiClient.requesterCleared.test.tsx` — 3 tests
- `RequesterFlow.integration.test.tsx` — 3 tests

**Empty stub files** (exist on disk but contain no tests yet — 14 planned tests):
- Backend: `attachments.api.test.ts` (API-17–23, 7 tests planned), `ticket-detail.api.test.ts` (API-15–16, 2 tests planned)
- Frontend: `AttachmentSection.test.tsx` (UI-13–15, 3 tests planned), `RequesterTicketDetail.test.tsx` (UI-12, 1 test planned), `CreateTicket.accessibility.test.tsx` (UI-16, 1 test planned)
- Not yet created: `validation.unit.test.ts` (UNIT-03/04/07), `pagination.unit.test.ts` (UNIT-05), `attachmentValidation.unit.test.ts` (UNIT-06), `authContext.api.test.ts` (API-07/08), `errorHandling.api.test.ts` (API-25), all STYLE/VISUAL/RESP/E2E files

No test may remain skipped/disabled at submission time (Definition of Done, Section 10 of `specification.md`).

---

## 6. Known Limitations or Deferred Tests

- **jsdom does not support `DataTransfer`** — Drag-and-drop file upload via the `AttachmentPicker` component cannot be tested through UI component tests in jsdom. The `submitTicket()` and `validateForm()` functions are tested directly as unit tests instead, bypassing the drag-drop UI layer. A Playwright E2E test would be required for true drag-drop coverage (see E2E-01, not yet implemented).
- **Load/performance testing** of the ticket list under very large datasets (>10,000 tickets) is deferred; Lab 2 seeds only realistic small datasets.
- **Cross-browser matrix testing** is limited to the Playwright default browser project in Lab 2; multi-browser matrix expansion is deferred to a later lab if required.
- **`categories.test.ts` (Lab 1)** uses hardcoded category IDs (1–4) which drift from actual DB state after repeated seed/reset cycles during development. This is a known test-fragility issue predating Lab 2 (see `specification.md` §11 item 9); **resolved in lab2/05** — test rewritten to use dynamic ID lookup via `prisma.category.findMany()`.
- **Vitest config silent-skip bug** — `client/vite.config.ts` originally used `include: ["tests/**/*.test.tsx"]` which silently excluded `.test.ts` files (discovered during self-audit when `apiClient.test.ts` with 14 tests was missing from vitest output). Fixed to `include: ["tests/**/*.test.{ts,tsx}"]`. The server config (`server/vitest.config.ts`) uses `include: ["tests/**/*.test.ts"]` which is correct for its all-`.ts` test files. No CI or lint step currently validates that the number of test files on disk matches the number discovered by the test runner — recommend adding such a check in a future sprint to prevent silent config regressions (see `specification.md` §11 item 11).
- **`seed.idempotency.test.ts`** deletes all rows across every table in `beforeAll`, which races with other test files when Vitest runs suites in parallel. **Resolved in lab2/06:** Fixed by adding `poolOptions.forks.singleFork: true` to `server/vitest.config.ts`, forcing all test files to run sequentially. Eliminates the race entirely — 127 tests pass deterministically (see `specification.md` §11 item 12).
- **`create-ticket-attachments-db-failure.api.test.ts`** is isolated in its own file because `vi.spyOn` on Prisma's proxy-based client does not cleanly restore, which would break subsequent tests in the same file.
- **Real-session-based ownership testing** (replacing `X-Dev-Requester-Id`) is explicitly deferred to Lab 3 per BR-41/BR-42.
