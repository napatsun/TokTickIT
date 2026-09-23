# TokTickIT — Sprint 4 Test Plan & Traceability (`tests.md`)

This plan is written before/alongside implementation (Test DD). Every row maps to at least one
Acceptance Criterion in `specification.md` §9. "Final" column is updated to `Pass`/`Fail` with a
link to the CI run once implementation is complete.

Legend for **Type**: `UNIT` (isolated function/module), `API` (integration against running API +
test DB), `UI` (component test, e.g. React Testing Library), `STYLE` (visual/style assertion),
`RESP` (responsive/breakpoint check), `AUTH` (authorization/role check), `WORKFLOW` (status
transition), `MIGRATION` (migration/regression of existing data), `PERF` (performance smoke),
`E2E` (Playwright/Cypress end-to-end).

---

## 1. Actions Taken

| Test ID | Type | Requirement/AC | What It Tests | Expected Result | Automated Test File | Final |
|---|---|---|---|---|---|---|
| API-01 | API | FR-01, AC-01 | IT Staff creates a valid Actions Taken | `201`, saved under correct Ticket, `performedById` = actor | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-02 | API | BR-03 | Client attempts to override `performedById` in payload | Field is ignored/overridden by server session value | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-03 | API | AC-01 | Create a valid Actions Taken (baseline happy path, per handout example) | Created under the correct Ticket and actor | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-04 | API | BR-05, AC-07 | `followUpRequired=true` with empty `followUpNote` | `422 VALIDATION_ERROR` naming `followUpNote` | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-05 | API | BR-05 | `followUpRequired=false` with non-empty `followUpNote` | `422` (note must be empty when not required) | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-06 | API | BR-04 | `actionDateTime` in the future | `422 VALIDATION_ERROR` | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-07 | API | AC-06 | Requester calls `POST /actions` directly | `403 FORBIDDEN_ROLE` | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-08 | API | BR-15 | Ticket-access denial on the Actions Taken routes: a Requester requesting another Requester's Ticket, and any caller against a `ticketId` that does not exist (Lab 3's staff queue gives every IT Staff/Administrator access to every *existing* Ticket — see the Implementation Note below) | `403 FORBIDDEN_TICKET_ACCESS` for the Requester-not-owner case; `404 TICKET_NOT_FOUND` for a non-existent `ticketId` — a staff-wide `FORBIDDEN_TICKET_ACCESS` is unreachable by design | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-09 | API | BR-11 | Author edits own entry within 15 min | `200`, fields updated, `editedAt/editedById` set | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-10 | API | BR-11 | Non-author IT Staff edits entry within window | `403 NOT_AUTHOR` | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-11 | API | BR-11 | Author edits own entry after 15 min | `403 EDIT_WINDOW_EXPIRED` | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-12 | API | BR-11 | Administrator edits/voids any entry any time | `200`, `isVoided=true` with `voidReason` stored | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-13 | API | FR-03 | `GET /actions` ordering | Returns oldest-first, stable secondary sort | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-14 | API | FR-15, AC-11 | Duplicate submit with same `Idempotency-Key` within the 5-second window | Only one row persisted; both calls return same `201` body | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-14b | API | FR-15, AC-11 | Duplicate submit with same `Idempotency-Key` after the 5-second window has elapsed | Treated as a new, independent create — two rows persisted | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-28 | API | §7.1 spec, BR-11 | `PATCH .../actions/:id` with `isVoided=true` and empty/missing `voidReason` | `422 VALIDATION_ERROR` naming `voidReason` | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-29 | API | §1.3 api-spec | Author edits `actionDateTime` within edit window to a valid past value | `200`, `actionDateTime` updated | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-30 | API | §1.3 api-spec, BR-04 | Author edits `actionDateTime` to a future value | `422 VALIDATION_ERROR` | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-31 | API | §1.2 api-spec | Requester calls `GET .../actions?includeVoided=true` | `403 FORBIDDEN_QUERY_PARAM` | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-38 | API | §1.3 api-spec, AC-06 | Requester calls `PATCH .../actions/:actionId` directly (any body, own or others' Ticket) | `403 FORBIDDEN_ROLE` — same code/semantics as `POST` (API-07); read access to a Requester's own Ticket (§1.2) does not extend to this endpoint | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-39 | API | §1.3 api-spec | `PATCH` with a `ticketId` that does not exist, for any `actionId` | `404 TICKET_NOT_FOUND` — confirms the Ticket-existence check runs, and rejects, before any Action lookup is attempted | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-39b | API | §1.3 api-spec | `PATCH` with a valid, existing `ticketId` but an `actionId` that does not exist under that Ticket | `404 ACTION_NOT_FOUND` — paired with API-39, confirms the check order is Ticket first, Action second (a request with both a bad `ticketId` and a bad `actionId` must return `TICKET_NOT_FOUND`, not `ACTION_NOT_FOUND`) | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-40 | API | §1.3 api-spec, BR-11 | Administrator attempts to edit a field (e.g. `description` or `result`) on an entry that already has `isVoided=true` | `409 Conflict (ENTRY_VOIDED)` — voiding is permanently one-way; even an Administrator cannot edit a voided entry's other fields | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-41 | API | §1.3 api-spec, BR-11 | Administrator attempts to set `isVoided: false` on an entry that already has `isVoided=true` ("un-void") | `409 Conflict (ENTRY_VOIDED)` — un-voiding is never permitted, regardless of caller role | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| UNIT-01 | UNIT | BR-05 | Follow-up-note conditional validator (pure function) | Returns valid/invalid per truth table (4 cases) | `server/tests/lab-04/validators/actionTaken.unit.test.ts` | Pass |
| UI-01 | UI | §4.3 ui-spec | Create form shows/hides Follow-up Note based on toggle | Field appears only when toggle is on; required marker shown | `client/.../lab-04 tests/ActionsTaken.test.tsx` | Pass |
| UI-02 | UI | §4.3 ui-spec, FR-15, AC-11 | Submit button disabled while request in flight | Second click before response does not fire a second request | `client/.../lab-04 tests/ActionsTaken.test.tsx` | Pass |
| UI-03 | UI | §4.5 ui-spec | Failed submit preserves entered form values | All fields retain user input after a simulated 500 error | `client/.../lab-04 tests/ActionsTaken.test.tsx` | Pass |
| UI-04 | UI | §4.2 ui-spec | Requester view renders no create/edit controls in DOM | `queryByRole('button', {name: /add actions taken/i})` returns null | `client/.../lab-04 tests/ActionsTaken.test.tsx` | Pass |
| E2E-01 | E2E | AC-01, AC-07 | Full create flow incl. validation error then success | User creates Actions Taken, sees it appear in list | `e2e/lab-04/actions-taken-flow.spec.ts` | Pass |

**Implementation Note (`feature/lab4-03-actions-taken-api`).** The `API-01`…`API-14b`,
`API-28`…`API-31`, `API-38`…`API-41` and `UNIT-01` rows above are implemented in this branch
(`server/tests/lab-04/actions-taken.api.test.ts`, `server/tests/lab-04/validators/actionTaken.unit.test.ts`).
Points where this plan met the shipped codebase, resolved before implementation:

1. **API-08 cannot be a staff-wide `403`.** Lab 3's `/api/staff` router is deliberately a shared queue
   ("any IT Staff member or Administrator may operate on any Ticket", `api-spec.md` §3 of Lab 3) and
   BR-02 relies on it ("any active IT Staff/Administrator with access may author an Actions Taken
   entry; `performedById` may differ from the Ticket's `ownerId`"). No Ticket is therefore unreachable
   by a staff caller, and the test asserts the two denials that *do* exist: `FORBIDDEN_TICKET_ACCESS`
   for a Requester reading a Ticket they do not own (§1.2), and `TICKET_NOT_FOUND` for a `ticketId`
   that does not exist. Tickets have no soft-delete column, so "soft-deleted" is not a distinct case.
2. **Validation errors are asserted as `error.fieldErrors`**, matching the Lab 2/3 envelope that the
   existing server routes and clients already emit and read (`api-spec.md` §1.
   Implementation Note). `API-04`/`API-28` therefore assert `fieldErrors.followUpNote` and
   `fieldErrors.voidReason` respectively.
3. **`API-14`/`API-14b` use the 5-second window** (`IDEMPOTENCY_WINDOW_SECONDS = 5`), so `API-14b`
   waits past 5s before its second submission — that is what makes "treated as a new, independent
   create" observable rather than assumed.
4. **`UNIT-01` targets the pure conditional-follow-up validator** exported from
   `server/src/lib/actionTaken.ts` (`validateFollowUpNote`), exercised as a truth table over
   (`followUpRequired`, `followUpNote`) including the whitespace-only and 3-character boundaries.
5. **`UI-01`…`UI-04` and `E2E-01`/`E2E-05` are out of scope for this branch** by instruction — they
   belong to `feature/lab4-04-actions-taken-ui` and the end-to-end suite. `API-15`…`API-21b`,
   `API-32`/`API-33`, `AUTH-01` and `WORKFLOW-01` belong to the ticket-workflow branch; this branch
   never touches `PATCH /status`, `requester-confirmation`, or the dashboards.

## 2. Ticket Workflow & Resolution

| Test ID | Type | Requirement/AC | What It Tests | Expected Result | Automated Test File | Final |
|---|---|---|---|---|---|---|
| API-15 | API | BR-09, AC-04 | Resolve attempt with zero Actions Taken | `409 ACTIONS_REQUIRED` | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-16 | API | BR-09, AC-03 | Resolve attempt with ≥1 Actions Taken (result set) | `200`, status=`Resolved`, `resolvedAt` set | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| WORKFLOW-01 | WORKFLOW | BR-07, BR-15 | Exhaustive matrix sweep of `specification.md` §5.1: for every (fromStatus × targetStatus) cell, attempt the transition once per role. Two distinct rejection reasons are asserted separately — this test must **not** collapse them into a single expected code: (a) if the cell is `—` (no role can make that transition from that status), every role's attempt → `409 INVALID_STATUS_TRANSITION`; (b) if the cell lists specific permitted roles, any role **not** in that list attempting the same transition → `403 FORBIDDEN_ROLE` (this is the general case that AUTH-01 below spot-checks for one specific combination) | Case (a): `409 INVALID_STATUS_TRANSITION` for every role. Case (b): `200` for a listed role, `403 FORBIDDEN_ROLE` for every other role. No cell/role combination is ever expected to return `409` for a pure role mismatch, or `403` for a genuinely unreachable target status | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-17 | API | BR-12, AC-08 | Two clients submit status change; second uses stale `version` | First `200`; second `409 STALE_VERSION` with `currentState` | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-18 | API | BR-10, AC-09 | Requester reopens own Ticket 10 days after `resolvedAt` | `403 REOPEN_WINDOW_EXPIRED` | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-19 | API | BR-10 | Requester reopens own Ticket 2 days after `resolvedAt` | `200`, status=`Reopened` | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-20 | API | BR-10 | IT Staff reopens Ticket at any time | `200`, regardless of window | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-21 | API | FR-08, BR-08, AC-05 | Requester submits "looks resolved" confirmation | `200`; `requesterConfirmedResolved=true`; Ticket `status` unchanged | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-21b | API | FR-08, §7.2 spec | Requester confirmation is followed immediately by an IT Staff status transition using the pre-confirmation `version` | `200` — status transition succeeds; confirms the two writes never conflict on `version` | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-32 | API | FR-15, AC-14 | Duplicate `PATCH /status` submit with same `Idempotency-Key` within 5s | Status changes/`version` increments exactly once; second call returns identical `200` body | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-33 | API | §7.3 spec | Successful status transition writes exactly one `TicketStatusHistory` row with correct `fromStatus`/`toStatus`/`changedById` | Row exists and matches | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| AUTH-01 | AUTH | BR-15 | Requester attempts `PATCH /status` on own Ticket to `Resolved` | `403 FORBIDDEN_ROLE` — a role-mismatch case of WORKFLOW-01's case (b) above, spot-checked explicitly because it is the transition most likely to be attempted by a Requester in practice | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| AUTH-02 | AUTH | BR-14 | `Cancelled` Ticket excluded from IT Staff open-work counts | Verified via API-24 below (cross-ref) | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| UI-05 | UI | §5 ui-spec | Status control renders only permitted transitions for current role/status | Disallowed options absent from DOM entirely | `client/.../lab-04 tests/TicketWorkflow.test.tsx` | Pass |
| UI-06 | UI | §5 ui-spec | Resolve button disabled with tooltip when Actions Taken precondition unmet | Button `disabled`, accessible tooltip text present | `client/.../lab-04 tests/TicketWorkflow.test.tsx` | Pass |
| E2E-02 | E2E | AC-03 | Full resolution flow: add Actions Taken → resolve Ticket → badge updates | Ticket badge shows `Resolved`; Requester later reopens within window | `e2e/lab-04/ticket-resolution.spec.ts` | Pass |

## 3. Dashboards

| Test ID | Type | Requirement/AC | What It Tests | Expected Result | Automated Test File | Final |
|---|---|---|---|---|---|---|
| API-22 | API | FR-11, AC-02 | Requester A's dashboard never includes Requester B's Tickets | Response counts/list scoped strictly to caller | `server/tests/lab-04/requester-dashboard.api.test.ts` | Pass |
| API-23 | API | FR-11 | Requester dashboard calculation correctness | Counts match direct DB query for seeded fixture | `server/tests/lab-04/requester-dashboard.api.test.ts` | Pass |
| API-24 | API | FR-10, BR-14 | Staff dashboard counts exclude Cancelled Tickets | `counts.*` match DB query excluding `Cancelled` | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| API-25 | API | FR-10 | `myAssigned` scoped to `ownerId = current user`, excludes Closed/Cancelled | Matches expected fixture count | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| API-26 | API | §6.2 handout | Dashboard response payload size/shape | Response contains only `counts`, `deltas`, `recentTickets` (≤5 items) — never a full Ticket array | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| API-34 | API | BR-14 | Seed a `Reopened` Ticket assigned to current user; fetch staff dashboard | Counted in `counts.inProgress` and `counts.myAssigned`, not in a separate bucket | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| API-35 | API | BR-14 | Seed a `Reopened` Ticket owned by current Requester; fetch requester dashboard | Counted in `counts.myOpen` | `server/tests/lab-04/requester-dashboard.api.test.ts` | Pass |
| API-36 | API | BR-13, §7.3 spec | Trigger 2 status transitions into `Open` within the last 24h, then fetch staff dashboard | `deltas.open` reflects exactly those transitions, computed against live `TicketStatusHistory` rows (no cached counter involved — verified by asserting the value changes immediately after a new transition, within the same test, with no cache-invalidation step) | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| API-37 | API | §3.1 api-spec | Fetch staff dashboard with zero `TicketStatusHistory` rows in the last 24h (fresh seed) | `deltas.*` are all `0` (never `null`) | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| AUTH-03 | AUTH | AC-02 | Requester calls `/api/dashboard/staff` | `403 FORBIDDEN_ROLE` | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| UI-07 | UI | AC-10 | Staff Dashboard renders zero-value card correctly (not error) | Card shows `0` with label, no error banner | `client/.../lab-04 tests/StaffDashboard.test.tsx` | Pass |
| UI-08 | UI | §2.4 ui-spec | Dashboard partial-failure: one card group fails, rest render | Only failed section shows retry; others show data | `client/.../lab-04 tests/StaffDashboard.test.tsx` | Pass |
| UI-09 | UI | §3.4 ui-spec | Requester Dashboard empty "recent tickets" state | Renders empty-state component with CTA | `client/.../lab-04 tests/RequesterDashboard.test.tsx` | Pass |
| RESP-01 | RESP | §2.5, §3.5 ui-spec | Dashboard card grid reflow at 1024/768/375px widths | Cards wrap/stack per spec; no horizontal scroll | `client/.../lab-04 tests/StaffDashboard.test.tsx` | Pass |
| E2E-03 | E2E | AC-02, FR-12 | Drill-down from every dashboard card/row to correct filtered destination | URL/query params match §2.3/§3.3 ui-spec mapping | `e2e/lab-04/dashboards.spec.ts` | Pass |

## 4. Migration & Regression (Labs 1–3)

| Test ID | Type | Requirement/AC | What It Tests | Expected Result | Automated Test File | Final |
|---|---|---|---|---|---|---|
| MIGRATION-01 | MIGRATION | §7.5 spec | Migration applied against seeded Lab-3-shaped DB snapshot | Zero data loss; all existing Tickets/Users/Comments/Notes/Attachments intact | `server/tests/lab-04/migration.test.ts` | Pass |
| MIGRATION-02 | MIGRATION | §7.5 spec | Legacy Ticket with zero Actions Taken | Renders empty state; dashboard counts unaffected; not blocked from any transition not gated by BR-09 | `server/tests/lab-04/migration.test.ts` | Pass |
| MIGRATION-03 | MIGRATION | §7.6 spec | Seed script run twice in sequence | No duplicate/erroring rows (idempotent) | `server/tests/lab-04/migration.test.ts` | Pass |
| REGRESSION-01 | API | AC-12 | Full Lab 2/3 auth test suite re-run | All pass unchanged | `server/tests/lab-02/*`, `server/tests/lab-03/*` | Pass |
| REGRESSION-02 | API | AC-12 | Public Comments, Internal Notes, Attachments endpoints re-run | All pass unchanged | `server/tests/lab-02/*`, `server/tests/lab-03/*` | Pass |
| REGRESSION-03 | API | AC-12 | Administrator user-management endpoints re-run | All pass unchanged | `server/tests/lab-02/admin-users.api.test.ts` | Pass |
| REGRESSION-04 | UI | AC-12 | My Tickets / Ticket Detail component suites re-run | All pass unchanged | `client/.../lab-02 tests/*`, `client/.../lab-03 tests/*` | Pass |
| E2E-04 | E2E | AC-12 | Representative end-to-end regression: login → create Ticket → comment → attach file → note → view as each role | Full flow completes without error across all three roles | `e2e/lab-04/regression-smoke.spec.ts` | Pass |

## 5. Cross-Cutting: Auth, Concurrency, Safe Failure, Performance

| Test ID | Type | Requirement/AC | What It Tests | Expected Result | Automated Test File | Final |
|---|---|---|---|---|---|---|
| AUTH-04 | AUTH | handout §4.3, BR-15 | Full role × endpoint matrix for all new endpoints (Requester/IT Staff/Admin × 7 new endpoints) | Every disallowed combination returns `401`/`403`, never `200` | `server/tests/lab-04/authorization-matrix.api.test.ts` | Pass |
| API-27 | API | BR-15 | Direct API call bypassing UI for every write endpoint | Server-side checks still enforced identically to UI-mediated calls | `server/tests/lab-04/authorization-matrix.api.test.ts` | Pass |
| PERF-01 | PERF | §6.2 handout | Dashboard endpoints respond under load-free baseline | `GET /api/dashboard/staff` and `/requester` respond in <300ms against seeded dataset (smoke, not load test) | `server/tests/lab-04/perf-smoke.test.ts` | Pass |
| E2E-05 | E2E | FR-15, AC-11, AC-14 | Rapid double-click on Actions Taken submit and on status-transition button in the real browser | Only one record/transition results in each case | `e2e/lab-04/actions-taken-flow.spec.ts` | Pass |

---

## 6. Traceability Matrix (Acceptance Criteria → Tests)

| AC | Covered By |
|---|---|
| AC-01 | API-01, API-03, E2E-01 |
| AC-02 | API-22, API-23, AUTH-03, E2E-03 |
| AC-03 | API-16, E2E-02 |
| AC-04 | API-15 |
| AC-05 | API-21 |
| AC-06 | API-07, API-38 |
| AC-07 | API-04, E2E-01 |
| AC-08 | API-17 |
| AC-09 | API-18, API-19, API-20 |
| AC-10 | UI-07 |
| AC-11 | API-14, API-14b, UI-02, E2E-05 |
| AC-12 | REGRESSION-01…04, E2E-04, MIGRATION-01…03 |
| AC-13 | (Accessibility checklist, `ui-spec.md` §8 — manual verification with screenshot/axe-core scan, logged in `reviewer.md`) |
| AC-14 | API-32, E2E-05 |

---

## 7. Execution Notes

- All `API`/`UNIT`/`MIGRATION` tests run against an isolated test database (`.env.test`), reset/reseeded per suite run.
- `UI` tests use React Testing Library with mocked API responses (no live network).
- `E2E` tests run against a locally built + seeded staging instance via Playwright, executed in CI on every PR into `lab4-staging` and again before merge to `main`.
- Final "Pass/Fail" column and CI run links are updated in this file as the last step before submission, alongside the console/log output referenced in Part 3 of the submission PDF.