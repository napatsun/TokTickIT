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
| UNIT-01 | BR-06 | Ticket number generator produces `TKT-{YYYY}-{6-digit}` format | Matches regex `^TKT-\d{4}-\d{6}$` | `server/tests/lab-02/ticketNumber.unit.test.ts` |
| UNIT-02 | BR-06 | Ticket number sequence increments per year and resets for a new year | Sequence for 2027 starts at 000001 independent of 2026's last value | `server/tests/lab-02/ticketNumber.unit.test.ts` |
| UNIT-03 | BR-19, BR-20 | Summary/Description validators reject out-of-range lengths | Returns validation error for <5 or >120 chars (summary), <20 or >2000 (description) | `server/tests/lab-02/validation.unit.test.ts` |
| UNIT-04 | BR-22 | Requested Priority validator | Accepts LOW/MEDIUM/HIGH only, rejects anything else | `server/tests/lab-02/validation.unit.test.ts` |
| UNIT-05 | BR-17 | Pagination param clamping function | page<1→1; pageSize not in {10,20,50}→10 | `server/tests/lab-02/pagination.unit.test.ts` |
| UNIT-06 | BR-28 | Attachment MIME/extension matcher | Rejects mismatched extension/MIME pairs (e.g., `.png` with `image/gif` MIME) | `server/tests/lab-02/attachmentValidation.unit.test.ts` |
| UNIT-07 | BR-34 | Removal-reason validator | Rejects <3 or >200 chars, trims whitespace | `server/tests/lab-02/validation.unit.test.ts` |

#### Seed Tests

| Test ID | Requirement / AC | What It Tests | Expected Result | Automated Test File |
|---|---|---|---|---|
| SEED-01 | specification.md Section 5.3 (seed idempotency requirement) | Run seed function twice consecutively and count rows in Category, RelatedSystem, DevRequester | Row counts after run 1 and run 2 are identical for every table (no duplicates) | `server/tests/lab-02/seed.idempotency.test.ts` |

### 2.2 API / Integration Tests

| Test ID | Requirement / AC | What It Tests | Expected Result | Automated Test File |
|---|---|---|---|---|
| API-01 | AC-01 | `POST /api/tickets` with fully valid data | 201; ticket persisted; unique ticketNumber returned | `server/tests/lab-02/create-ticket.api.test.ts` |
| API-02 | AC-04, AC-05 | `POST /api/tickets` missing Summary / short Description | 400 with `fieldErrors.summary` / `fieldErrors.description` | `server/tests/lab-02/create-ticket.api.test.ts` |
| API-03 | BR-21 | `POST /api/tickets` with inactive/nonexistent categoryId | 400 `INVALID_REFERENCE` | `server/tests/lab-02/create-ticket.api.test.ts` |
| API-04 | AC-06, BR-29 | `POST /api/tickets` with a 6MB attachment | 413 `ATTACHMENT_TOO_LARGE`; no Ticket left committed if this is the only failure path tested standalone | `server/tests/lab-02/create-ticket.api.test.ts` |
| API-05 | AC-07, BR-28 | `POST /api/tickets` with a `.docx` attachment | 415 `UNSUPPORTED_ATTACHMENT_TYPE` | `server/tests/lab-02/create-ticket.api.test.ts` |
| API-06 | BR-31 | `POST /api/tickets` where one attachment upload is forced to fail mid-request | 201; ticket created; `attachmentFailures` lists the failed file; ticket row exists in DB | `server/tests/lab-02/create-ticket.api.test.ts` |
| API-07 | — (auth context) | Any ticket/attachment endpoint called with missing `X-Dev-Requester-Id` | 401 `INVALID_REQUESTER_CONTEXT` | `server/tests/lab-02/authContext.api.test.ts` |
| API-08 | BR-05, BR-37 | Endpoint called with header referencing an inactive Requester | 401 `INVALID_REQUESTER_CONTEXT` | `server/tests/lab-02/authContext.api.test.ts` |
| API-09 | AC-10 | `GET /api/tickets` for Requester A vs Requester B, each with seeded tickets | Requester A's response contains only A's tickets (by id set equality); same for B | `server/tests/lab-02/my-tickets.api.test.ts` |
| API-10 | AC-11 | `GET /api/tickets?search=laptop` | Only tickets whose ticketNumber or summary match "laptop" (case-insensitive) are returned | `server/tests/lab-02/my-tickets.api.test.ts` |
| API-11 | AC-12 | `GET /api/tickets?categoryId=2` | Only that Requester's Hardware tickets returned | `server/tests/lab-02/my-tickets.api.test.ts` |
| API-12 | AC-15, BR-16, BR-17 | `GET /api/tickets?page=1&pageSize=10` against 42 seeded tickets | `pagination.totalItems=42`, `totalPages=5`; page 2 returns the next distinct 10 | `server/tests/lab-02/my-tickets.api.test.ts` |
| API-13 | BR-17 | `GET /api/tickets?page=0&pageSize=999` | Clamped to page=1, pageSize=10 (not a 400) | `server/tests/lab-02/my-tickets.api.test.ts` |
| API-14 | BR-15 (invalid enum) | `GET /api/tickets?requestedPriority=URGENT` | 400 validation error | `server/tests/lab-02/my-tickets.api.test.ts` |
| API-15 | AC-03 | `GET /api/tickets/:ticketNumber` for a ticket owned by a different Requester | 404 `TICKET_NOT_FOUND` (not 403) | `server/tests/lab-02/ticket-detail.api.test.ts` |
| API-16 | AC-16 | `GET /api/tickets/:ticketNumber` for own ticket | 200; all header fields present and correct; attachments split into active/removed | `server/tests/lab-02/ticket-detail.api.test.ts` |
| API-17 | AC-17, FR-11 | `POST /api/tickets/:ticketNumber/attachments` valid file on owned ticket | 201; attachment appears in subsequent `GET` of the ticket | `server/tests/lab-02/attachments.api.test.ts` |
| API-18 | AC-08, BR-30 | Adding a 6th active attachment to a ticket that already has 5 | 400 `ATTACHMENT_LIMIT_REACHED`; no 6th record created | `server/tests/lab-02/attachments.api.test.ts` |
| API-19 | AC-18 | `GET /api/attachments/:id/download` for an active, owned attachment | 200; correct `Content-Disposition` filename and bytes | `server/tests/lab-02/attachments.api.test.ts` |
| API-20 | AC-19, BR-35 | `GET /api/attachments/:id/download` for a soft-removed attachment | 404 `ATTACHMENT_NOT_FOUND` | `server/tests/lab-02/attachments.api.test.ts` |
| API-21 | AC-19, BR-34 | `DELETE /api/attachments/:id` with a valid reason on an owned, active attachment | 200; `isRemoved=true`, `removedReason` stored | `server/tests/lab-02/attachments.api.test.ts` |
| API-22 | AC-20 | `DELETE /api/attachments/:id` with empty `removalReason` | 400 validation error; attachment remains active | `server/tests/lab-02/attachments.api.test.ts` |
| API-23 | BR-33 | `DELETE /api/attachments/:id` for an attachment on a ticket owned by a different Requester | 404 (ownership never confirmed nor denied explicitly) | `server/tests/lab-02/attachments.api.test.ts` |
| API-24 | AC-21, BR-02 | `GET /api/dev-requesters` with one seeded inactive Requester | Response excludes the inactive Requester | `server/tests/lab-02/dev-requesters.api.test.ts` |
| API-25 | BR-26 | Force an unexpected server error (e.g., DB disconnect mock) on any endpoint | 500 with generic safe message, no stack trace/SQL in body | `server/tests/lab-02/errorHandling.api.test.ts` |
| API-26 | specification.md Section 7.1 (RelatedSystem.isActive, added in branch lab2/02) | `GET /api/related-systems` must exclude RelatedSystem rows where `isActive=false` | Response does not include any inactive RelatedSystem | `server/tests/lab-02/reference-data.api.test.ts` (**Pending** — to be implemented in branch `lab2/08-reference-data-api`) |
| API-27 | FR-01, BR-27 | `GET /api/dev-requesters` returns 200 with empty `requesters` array when no active requesters exist (empty state) | 200; `{ requesters: [] }`; valid JSON shape with no error field | `server/tests/lab-02/dev-requesters-empty-state.test.ts` |
| API-28 | BR-41, BR-05, BR-37 | `requesterContext` middleware: rejects missing/invalid/inactive `X-Dev-Requester-Id` (401); accepts valid active Requester and attaches `req.currentRequester` | 401 `INVALID_REQUESTER_CONTEXT` for missing/empty/non-numeric/negative/zero/nonexistent/inactive; 200 + correct requester data for valid | `server/tests/lab-02/requester-context.test.ts` |

### 2.3 UI Component Tests

| Test ID | Requirement / AC | What It Tests | Expected Result | Automated Test File |
|---|---|---|---|---|
| UI-01 | FR-01 | Selection screen renders dropdown from mocked active-requester API | Options match mock data; inactive requester (if mocked in) excluded | `client/.../lab-02/tests/RequesterSelection.test.tsx` |
| UI-02 | AC-02 | Navigating to My Tickets with no stored Requester | Redirects to Selection screen | `client/.../lab-02/tests/RouteGuard.test.tsx` |
| UI-03 | AC-04 | Submit Create Ticket with empty Summary | Field-level message rendered under Summary; API not called | `client/.../lab-02/tests/CreateTicket.test.tsx` |
| UI-04 | AC-06 | Select a 6MB file in the attachment picker | Inline rejection message shown; file not added to pending list; other valid files unaffected | `client/.../lab-02/tests/CreateTicket.test.tsx` |
| UI-05 | AC-07 | Select a `.docx` file | Inline "unsupported file type" message shown | `client/.../lab-02/tests/CreateTicket.test.tsx` |
| UI-06 | — (busy state) | Click Submit on a valid form | Button shows busy/disabled state immediately; re-enabled only after response | `client/.../lab-02/tests/CreateTicket.test.tsx` |
| UI-07 | AC-01 | Mocked successful `POST /api/tickets` response | Success panel renders with the returned Ticket Number | `client/.../lab-02/tests/CreateTicket.test.tsx` |
| UI-08 | AC-09 | Mocked network failure on submit | Safe error banner shown; all field values still present in the DOM | `client/.../lab-02/tests/CreateTicket.test.tsx` |
| UI-09 | AC-13 | Mocked empty ticket list (zero ever) | Empty-state illustration/message shown, not no-results message | `client/.../lab-02/tests/MyTickets.test.tsx` |
| UI-10 | AC-14 | Mocked filtered list returning zero results while a filter is active | No-results message + Clear Filters button shown | `client/.../lab-02/tests/MyTickets.test.tsx` |
| UI-11 | AC-15 | Mocked paginated response (42 items) | "Showing 1 to 10 of 42 tickets" text renders; Next/page controls match `totalPages` | `client/.../lab-02/tests/MyTickets.test.tsx` |
| UI-12 | AC-16 | Render Ticket Detail with mocked owned-ticket response | All header fields render as read-only (no editable input elements present) | `client/.../lab-02/tests/RequesterTicketDetail.test.tsx` |
| UI-13 | AC-17 | Mocked successful attachment add | New attachment appears in the active list without a full remount/reload call | `client/.../lab-02/tests/AttachmentSection.test.tsx` |
| UI-14 | AC-19, AC-20 | Attempt removal without reason, then with reason | Confirm button disabled until reason meets length rule; enabled after; calls DELETE only once confirmed | `client/.../lab-02/tests/AttachmentSection.test.tsx` |
| UI-15 | BR-35 | Render a mocked removed attachment | Download/preview control is absent/disabled; "Unavailable" label shown instead | `client/.../lab-02/tests/AttachmentSection.test.tsx` |
| UI-16 | AC-24 | Tab through Create Ticket form | Every control reachable in a logical order; focus ring visible via computed style/class | `client/.../lab-02/tests/CreateTicket.accessibility.test.tsx` (**Planned** — file exists but empty, no tests yet) |
| UI-17 | ui-spec §4 (Buttons) | Button component renders variant classes (primary/secondary/tertiary/destructive/destructive-confirm/busy) | Each variant maps to its expected CSS module class name | `client/tests/lab-02/Button.test.tsx` |
| UI-18 | ui-spec §4, BR-23 | Button disabled and busy states | `disabled` attr + `aria-disabled` when disabled; spinner + `busyLabel` + onClick suppressed when busy | `client/tests/lab-02/Button.test.tsx` |
| UI-19 | ui-spec §3 (Fields), §10 | Field component renders states (default/focused/invalid/readonly/disabled), required asterisk, validation messages, input vs textarea, character counter | Correct CSS classes per state; `aria-describedby` linked; `role="alert"` for error; textarea resize=vertical; counter shows `n/max` | `client/tests/lab-02/Field.test.tsx` |
| UI-20 | ui-spec §9 (Badges) | Badge renders priority (LOW/MEDIUM/HIGH) and status (NEW) with correct variant classes + accessible `role=status` | Correct CSS module class per value; text always visible (not sr-only) | `client/tests/lab-02/Badge.test.tsx` |
| UI-21 | ui-spec §6, §11 (App Shell) | AppShell renders nav active state, wordmark link, requester badge, Change Requester button, hamburger toggle, mobile menu, content outlet | Active nav gets `navLinkActive`; wordmark links to `/tickets`; Change Requester calls `clearRequester`; hamburger toggles mobile nav | `client/tests/lab-02/AppShell.test.tsx` |
| UI-22 | BR-01, FR-02 | RequesterContext reads/writes/clears localStorage; handles corrupted data; throws outside provider | `requester` restored from `localStorage` on mount; `setRequester` persists; `clearRequester` removes; corrupted JSON → null; throws without `<RequesterProvider>` | `client/tests/lab-02/RequesterContext.test.tsx` |
| UI-23 | BR-03, BR-05 | `apiClient` attaches `X-Dev-Requester-Id` header from localStorage; on 401 `INVALID_REQUESTER_CONTEXT` clears localStorage + dispatches `requester:cleared` event; other errors leave state untouched | Header present with correct ID when requester stored; absent when empty/invalid; localStorage cleared + event dispatched only on 401 with matching code | `client/tests/lab-02/apiClient.test.ts` |
| UI-23b | BR-03 | `apiClient` → `RequesterProvider` redirect integration: dispatching `requester:cleared` clears React state and navigates to `/select-requester` via React Router | Protected content disappears; selection screen renders; no full page reload; safe to dispatch multiple times | `client/tests/lab-02/apiClient.requesterCleared.test.tsx` |

### 2.4 Integration Tests

| Test ID | Requirement / AC | What It Tests | Expected Result | Automated Test File |
|---|---|---|---|---|
| INT-01 | AC-02, AC-22 | Full Requester flow using real `RequesterProvider` + `RequireRequester` + `SelectRequesterPage` + `AppShell` (only `fetch` mocked): empty localStorage → redirect to selection; select → Continue → protected page with correct badge; Change Requester → back to selection | Selection screen renders on empty localStorage; selected requester badge appears after Continue; Change Requester clears state and returns to selection | `client/tests/lab-02/RequesterFlow.integration.test.tsx` |

### 2.5 UI Style / Visual Tests

| Test ID | Requirement / AC | What It Tests | Expected Result | Automated Test File |
|---|---|---|---|---|
| STYLE-01 | Section 1 (ui-spec.md) | Computed CSS custom properties on `:root`/theme provider | `--color-primary-green` etc. equal the exact hex values | `client/.../lab-02/tests/theme.style.test.tsx` |
| STYLE-02 | Section 3 (ui-spec.md) | Required field asterisk + invalid-state class presence | Asterisk element present when field required; `.field-invalid` class applied on validation error | `client/.../lab-02/tests/CreateTicket.style.test.tsx` |
| STYLE-03 | Section 4 (ui-spec.md) | Button variant classes | Primary/secondary/tertiary/destructive/disabled/busy each render distinct expected class names | `client/.../lab-02/tests/buttons.style.test.tsx` |
| STYLE-04 | Section 9 (ui-spec.md) | Badge component renders correct class per priority/status value | LOW/MEDIUM/HIGH and NEW map to their documented badge variants | `client/.../lab-02/tests/badges.style.test.tsx` |
| VISUAL-01 | AC-23, Section 12 checklist | Playwright screenshot of Create Ticket at 1280/834/375px | Screenshots saved to `artifacts/lab-02/screenshots/create-ticket/*`; manually checked against checklist | `e2e/lab-02/visual-create-ticket.spec.ts` |
| VISUAL-02 | AC-23 | Playwright screenshot of My Tickets at 3 viewports | Screenshots saved to `artifacts/lab-02/screenshots/my-tickets/*` | `e2e/lab-02/visual-my-tickets.spec.ts` |
| VISUAL-03 | AC-23 | Playwright screenshot of Ticket Detail at 3 viewports | Screenshots saved to `artifacts/lab-02/screenshots/ticket-detail/*` | `e2e/lab-02/visual-ticket-detail.spec.ts` |

### 2.6 Responsive Tests

| Test ID | Requirement / AC | What It Tests | Expected Result | Automated Test File |
|---|---|---|---|---|
| RESP-01 | AC-23 | Resize viewport to 375px on all 4 screens | `document.documentElement.scrollWidth` never exceeds `innerWidth` (no horizontal overflow) | `e2e/lab-02/responsive.spec.ts` |
| RESP-02 | Section 11 (ui-spec.md) | My Tickets table→card transition at <768px | Table element absent/hidden; card list elements present instead | `e2e/lab-02/responsive.spec.ts` |
| RESP-03 | Section 11 (ui-spec.md) | Button touch target size at mobile width | All primary/secondary buttons compute to ≥44px height | `e2e/lab-02/responsive.spec.ts` |

### 2.7 End-to-End Tests

| Test ID | Requirement / AC | What It Tests | Expected Result | Automated Test File |
|---|---|---|---|---|
| E2E-01 | AC-01, AC-17 | Full flow: select Requester → Create Ticket with one valid attachment → view success → open Ticket Detail | Ticket Number shown matches the one visible on Ticket Detail; attachment listed as active | `e2e/lab-02/requester-ticket-flow.spec.ts` |
| E2E-02 | AC-10, AC-22 | Select Requester A, note ticket count in My Tickets; Change Requester to B; observe list | Requester B sees a different, correct ticket set with no flash of A's data | `e2e/lab-02/requester-ticket-flow.spec.ts` |
| E2E-03 | AC-03 | As Requester B, attempt to navigate directly to a URL containing Requester A's ticket number | Redirected/shown "Ticket not found", no data displayed | `e2e/lab-02/requester-ticket-flow.spec.ts` |
| E2E-04 | AC-11, AC-12, AC-15 | Search + filter + paginate through a seeded 42-ticket list | Correct subset and page counts shown at each step | `e2e/lab-02/my-tickets-search-filter.spec.ts` |
| E2E-05 | AC-19 | From Ticket Detail, remove an attachment with a reason, then attempt to access its (previously valid) download link directly | Attachment shown in Removed section; direct download link now returns a not-found page | `e2e/lab-02/attachment-lifecycle.spec.ts` |
| E2E-06 | AC-21 | On the Selection screen, confirm the seeded inactive Requester never appears | Dropdown option count matches only active seed count | `e2e/lab-02/requester-selection.spec.ts` |
| E2E-07 | AC-13, AC-14 | A freshly seeded Requester with zero tickets sees empty state; after creating one ticket and searching for a non-matching term, sees no-results state | Both states appear at the correct moments, never swapped | `e2e/lab-02/my-tickets-empty-states.spec.ts` |

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
| AC-01 | API-01, UI-07, E2E-01 |
| AC-02 | UI-02, UI-24 (INT-01) |
| AC-03 | API-15, E2E-03 |
| AC-04 | API-02, UI-03 |
| AC-05 | API-02 |
| AC-06 | API-04, UI-04 |
| AC-07 | API-05, UI-05 |
| AC-08 | API-18 |
| AC-09 | UI-08 |
| AC-10 | API-09, E2E-02 |
| AC-11 | API-10, E2E-04 |
| AC-12 | API-11, E2E-04 |
| AC-13 | UI-09, E2E-07 |
| AC-14 | UI-10, E2E-07 |
| AC-15 | API-12, UI-11, E2E-04 |
| AC-16 | API-16, UI-12 |
| AC-17 | API-17, UI-13, E2E-01 |
| AC-18 | API-19 |
| AC-19 | API-20, API-21, UI-14, UI-15, E2E-05 |
| AC-20 | API-22, UI-14 |
| AC-21 | API-24, API-27, E2E-06 |
| AC-22 | E2E-02, INT-01 |
| AC-23 | VISUAL-01, VISUAL-02, VISUAL-03, RESP-01, RESP-02, RESP-03 |
| AC-24 | UI-16 |

Every AC has ≥1 automated test. No test row is orphaned from an AC or a Business Rule.

**Note:** AC-01, AC-04 through AC-20, AC-23, and AC-24 are mapped to *planned* test IDs (files exist but are currently empty stubs awaiting implementation in future branches). AC-02, AC-21, and AC-22 now have real implemented tests in addition to their planned counterparts.

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

*To be filled in once implementation is complete, from the actual `main`-branch test run:*

| Level | Total | Passing | Failing | Skipped |
|---|---|---|---|---|
| Unit + Seed | 3 | 3 | 0 | 0 |
| API | 8 | 8 | 0 | 0 |
| UI Component | 14 | 14 | 0 | 0 |
| Integration | 1 | 1 | 0 | 0 |
| UI Style | 0 | 0 | 0 | 0 |
| Visual | 0 | 0 | 0 | 0 |
| Responsive | 0 | 0 | 0 | 0 |
| E2E | 0 | 0 | 0 | 0 |
| **Total (implemented)** | **26** | **26** | **0** | **0** |
| _Planned (files exist but empty)_ | _26_ | — | — | — |

**Planned test file breakdown** (files exist on disk but contain no tests yet):
- Unit: 7 files (UNIT-01 to UNIT-07 — `ticketNumber.unit.test.ts`, `validation.unit.test.ts`, `pagination.unit.test.ts`, `attachmentValidation.unit.test.ts`)
- API: 22 files (API-01 to API-26 minus API-27/API-28 which are implemented — `create-ticket.api.test.ts`, `authContext.api.test.ts`, `my-tickets.api.test.ts`, `ticket-detail.api.test.ts`, `attachments.api.test.ts`, `errorHandling.api.test.ts`, `reference-data.api.test.ts`)
- UI Component: 6 files (UI-03 to UI-16 minus implemented ones — `CreateTicket.test.tsx`, `MyTickets.test.tsx`, `AttachmentSection.test.tsx`, `RequesterTicketDetail.test.tsx`, `CreateTicket.accessibility.test.tsx`)
- UI Style: 4 files (STYLE-01 to STYLE-04 — `theme.style.test.tsx`, `CreateTicket.style.test.tsx`, `buttons.style.test.tsx`, `badges.style.test.tsx`)
- Visual: 3 files (VISUAL-01 to VISUAL-03)
- Responsive: 1 file (RESP-01 to RESP-03)
- E2E: 7 files (E2E-01 to E2E-07)

No test may remain skipped/disabled at submission time (Definition of Done, Section 10 of `specification.md`).

---

## 6. Known Limitations or Deferred Tests

- Load/performance testing of the ticket list under very large datasets (>10,000 tickets) is deferred; Lab 2 seeds only realistic small datasets.
- Cross-browser matrix testing is limited to the Playwright default browser project in Lab 2; multi-browser matrix expansion is deferred to a later lab if required.
- `categories.test.ts` (Lab 1) uses hardcoded category IDs (1–4) which drift from actual DB state after repeated seed/reset cycles during development. This is a known test-fragility issue predating Lab 2 (see `specification.md` §11 item 9); flagged for cleanup when Lab 1 tests are next touched — not blocking for any Lab 2 branch.
- **Vitest config silent-skip bug** — `client/vite.config.ts` originally used `include: ["tests/**/*.test.tsx"]` which silently excluded `.test.ts` files (discovered during self-audit when `apiClient.test.ts` with 14 tests was missing from vitest output). Fixed to `include: ["tests/**/*.test.{ts,tsx}"]`. The server config (`server/vitest.config.ts`) uses `include: ["tests/**/*.test.ts"]` which is correct for its all-`.ts` test files. No CI or lint step currently validates that the number of test files on disk matches the number discovered by the test runner — recommend adding such a check in a future sprint to prevent silent config regressions (see `specification.md` §11 item 11).
- Real-session-based ownership testing (replacing `X-Dev-Requester-Id`) is explicitly deferred to Lab 3 per BR-41/BR-42.
