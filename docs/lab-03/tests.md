# TokTickIT — Sprint 3 Test Plan (Test DD / TDD)

This plan is authored before/alongside implementation per course policy. "Final" column is updated as tests are actually run against `main`; it must reflect real automated results at submission time, not aspirational status.

Legend for **Type**: `UNIT` unit test · `API` API/integration test · `UI` UI component test · `SEC` security/authorization test · `MIG` migration/regression test · `E2E` end-to-end test · `RESP` responsive/visual test.

---

## 1. Authentication

| Test ID | Type | Requirement/AC | What It Tests | Expected Result | Automated Test File | Final |
|---|---|---|---|---|---|---|
| API-01 | API | AC-01 | Valid login (active user, correct credentials) | 200, session cookie set, safe user payload (no password hash) returned | `server/tests/lab-03/auth.api.test.ts` | Pending |
| API-02 | API | AC-05, BR-06 | Login with wrong password | 401, generic `INVALID_CREDENTIALS`, no field-level hint | `server/tests/lab-03/auth.api.test.ts` | Pending |
| API-03 | API | AC-05, BR-06 | Login with non-existent email | 401, same generic message as API-02 | `server/tests/lab-03/auth.api.test.ts` | Pending |
| API-04 | API | AC-06, BR-09 | Login attempt on inactive account with correct password | 401, generic "account unavailable" message, no distinction from wrong-password case at the response-shape level | `server/tests/lab-03/auth.api.test.ts` | Pending |
| API-05 | API | BR-01 | Login with missing email/password fields | 422 field-level validation errors | `server/tests/lab-03/auth.api.test.ts` | Pending |
| API-06 | API | FR-05, BR-08 | Logout invalidates session | 200 on logout; subsequent authenticated call with old cookie returns 401 | `server/tests/lab-03/auth.api.test.ts` | Pending |
| API-07 | API | FR-04, BR-11 | `GET /api/auth/me` for authenticated user | 200, returns id/name/email/role/mustChangePassword, never passwordHash | `server/tests/lab-03/auth.api.test.ts` | Pending |
| API-08 | API | AC-02, BR-02 | Any protected endpoint called while `mustChangePassword=true` | 403 `PASSWORD_CHANGE_REQUIRED` for all routes except `/auth/logout`, `/auth/me`, `/auth/change-password` | `server/tests/lab-03/auth.api.test.ts` | Pending |
| API-09 | API | FR-07 | Change password with weak new password / mismatched confirmation | 422 field-level errors, `mustChangePassword` remains true | `server/tests/lab-03/auth.api.test.ts` | Pending |
| API-10 | API | AC-14 | Change password with valid new password | 200, `mustChangePassword` becomes false, subsequent protected calls succeed | `server/tests/lab-03/auth.api.test.ts` | Pending |
| UNIT-01 | UNIT | BR-07 | Password hashing function | Produces salted hash, never equals plaintext, verify() matches correct password only | `server/tests/lab-03/password-hash.unit.test.ts` | Pending |
| E2E-02 | E2E | AC-02 | Initial-password login then mandatory change, full browser flow | Login → redirected to Change Password → normal app inaccessible until saved → app opens after valid change | `e2e/lab-03/first-login.spec.ts` | Pending |
| E2E-01 | E2E | AC-01, AC-05 | Full login flow: valid login, invalid login, busy state | Correct redirect, correct error banners, spinner shown during request | `e2e/lab-03/authentication.spec.ts` | Pending |
| UI-01 | UI | Login screen §2 | Login form renders validation, busy, and failure states correctly | Component snapshot/interaction matches spec states | `client/.lab-03 tests/Login.test.tsx` | Pending |
| UI-02 | UI | Change Password screen §3 | Form validates length/match rules, shows inline hints | Correct inline validation messages | `client/.lab-03 tests/ChangePassword.test.tsx` | Pending |

## 2. Authorization / Role Navigation

| Test ID | Type | Requirement/AC | What It Tests | Expected Result | Automated Test File | Final |
|---|---|---|---|---|---|---|
| SEC-01 | SEC | FR-10, AC-15 | Requester calls any `/api/admin/*` endpoint directly | 403 for every admin route, regardless of frontend state | `server/tests/lab-03/authorization.api.test.ts` | Pending |
| SEC-02 | SEC | FR-10, AC-15 | IT Staff calls any `/api/admin/*` endpoint directly | 403 | `server/tests/lab-03/authorization.api.test.ts` | Pending |
| SEC-03 | SEC | AC-04, BR-04 | Requester calls `GET/POST /api/staff/tickets/:id/notes` | 403, no note content in response body | `server/tests/lab-03/authorization.api.test.ts` | Pending |
| SEC-04 | SEC | FR-09 | Requester calls `/api/staff/tickets` (Queue) directly | 403 | `server/tests/lab-03/authorization.api.test.ts` | Pending |
| SEC-05 | SEC | AC-03, BR-03 | Requester submits ticket-create/update body with a different `requesterId` | Backend ignores supplied `requesterId`; ticket is owned by session user only | `server/tests/lab-03/authorization.api.test.ts` | Pending |
| SEC-06a | SEC | AC-17, BR-04 | Schema-level guard (added in feature/lab3-03-requester-regression): `GET /api/tickets/:ticketNumber` response contains no `internalNotes`/`internalNote` key, checked recursively + as a raw-JSON substring, so the assertion still fails loudly if a future query ever starts including the relation | No internal-data key present in the Requester detail response, today and after the model is added | `server/tests/lab-02/ticket-detail.api.test.ts` (L359-394) | Pass |
| SEC-06b | SEC | AC-17, BR-04 | Full cross-role assertion (feature/lab3-04-staff-ticketing, once `InternalNote` model exists): IT Staff-authored Internal Note; Requester fetches same ticket's comment/notes payload via every Requester-reachable endpoint | Internal Note absent entirely from every Requester-facing response | `server/tests/lab-03/authorization.api.test.ts` | Pending — un-skip once InternalNote model lands |
| SEC-07 | SEC | Ownership | Requester A requests Requester B's ticket by ID | 404 (not 403) to avoid existence leak | `server/tests/lab-03/authorization.api.test.ts` | Pending |
| SEC-08 | SEC | Unauthenticated | Any protected endpoint called with no session cookie | 401 for every protected route | `server/tests/lab-03/authorization.api.test.ts` | Pending |
| E2E-03 | E2E | FR-08 | Role-based navigation rendering for each of the 3 roles | Only permitted nav destinations visible per role; direct URL nav to a forbidden route redirects/blocks | `e2e/lab-03/authentication.spec.ts` | Pending |

## 3. Requester Regression & New Features

| Test ID | Type | Requirement/AC | What It Tests | Expected Result | Automated Test File | Final |
|---|---|---|---|---|---|---|
| MIG-01 | MIG | AC-16, BR-27 | Migrated Lab 2 Requester logs in and lists their pre-existing Tickets | All pre-Lab-3 Tickets visible, correctly owned, Attachments intact | `server/tests/lab-03/migration.api.test.ts` | Pending |
| MIG-02 | MIG | §7.2 spec | Development-Requester selector code path is fully removed | No selector component renders; no client state referencing old selector remains (static check + E2E) | `e2e/lab-03/authentication.spec.ts` | Pending |
| API-11 | API | FR-14, BR-16, BR-17 | Requester posts a Public Comment (valid, empty, whitespace-only, > 2000 chars) | Valid: 201; empty/whitespace: 422; too long: 422 | `server/tests/lab-03/comments-notes.api.test.ts` | Pending |
| API-12 | API | FR-15, AC-11, BR-05, BR-20 | Requester marks Ticket "appears resolved" | 200, `requesterMarkedResolved=true`, `status` field unchanged | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pending |
| API-13 | API | BR-05 | Requester attempts to directly PATCH ticket `status` | Endpoint not reachable by Requester role / 403 if attempted via staff endpoint | `server/tests/lab-03/authorization.api.test.ts` | Pending |
| UI-03 | UI | Requester Ticket Detail §4 | Public Comments panel renders list + post form + character counter | Correct render and disabled state for empty input | `client/.lab-03 tests/StaffTicketDetail.test.tsx` (shared component) | Pending |
| E2E-04 | E2E | Full Requester flow | Login as migrated Requester → view ticket → post public comment → mark appears-resolved → logout | All steps succeed with correct UI feedback at each stage | `e2e/lab-03/staff-ticket-flow.spec.ts` (Requester portion) | Pending |

## 4. IT Staff Ticket Queue

| Test ID | Type | Requirement/AC | What It Tests | Expected Result | Automated Test File | Final |
|---|---|---|---|---|---|---|
| API-14 | API | FR-16 | Queue default listing (no filters) | 200, paginated result, default sort by createdAt desc | `server/tests/lab-03/staff-queue.api.test.ts` | Pending |
| API-15 | API | FR-16 | Queue search `q` by ticket number and by summary substring | Correct filtered subset returned for both cases | `server/tests/lab-03/staff-queue.api.test.ts` | Pending |
| API-16 | API | FR-16 | Queue filter by `status`, `priority`, `owner=unassigned`, `owner=me` | Each filter returns only matching tickets | `server/tests/lab-03/staff-queue.api.test.ts` | Pending |
| API-17 | API | FR-16 | Queue sort by `itPriority` and `status`, both `asc`/`desc` | Correct ordering in response | `server/tests/lab-03/staff-queue.api.test.ts` | Pending |
| API-18 | API | FR-16 | Pagination with `page`/`pageSize`, including out-of-range page | Correct slice returned; out-of-range page returns empty `items` with correct `total`/`totalPages` | `server/tests/lab-03/staff-queue.api.test.ts` | Pending |
| API-19 | API | Invalid query params | Invalid `sortBy`/`status`/`priority` enum value | 400 with safe message | `server/tests/lab-03/staff-queue.api.test.ts` | Pending |
| UI-04 | UI | IT Staff Queue §5 | Table renders columns, badges, pagination footer per handout mock | Matches expected structure; mobile breakpoint renders stacked cards | `client/.lab-03 tests/StaffTicketQueue.test.tsx` | Pending |
| UI-05 | UI | IT Staff Queue §5 | Empty and no-results states | Correct message + "Clear filters" affordance shown | `client/.lab-03 tests/StaffTicketQueue.test.tsx` | Pending |
| RESP-01 | RESP | §9 responsive | Queue screen at 375px/768px/1280px | No horizontal overflow, no clipping, card layout on mobile | `artifacts/lab-03/screenshots/staff-queue/` (manual + Playwright viewport test) | Pending |

## 5. IT Staff Ticket Operations (Ownership, Priority, Status, Comments, Notes)

| Test ID | Type | Requirement/AC | What It Tests | Expected Result | Automated Test File | Final |
|---|---|---|---|---|---|---|
| API-20 | API | AC-07, BR-12, BR-13 | Claim an unassigned ticket | 200, `ownerId` set to caller | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pending |
| API-21 | API | AC-08, BR-13 | Claim an already-assigned ticket | 409 `ALREADY_ASSIGNED` | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pending |
| API-22 | API | FR-19 | Reassign ticket to another active IT Staff | 200, `ownerId` updated | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pending |
| API-23 | API | BR-12 | Reassign ticket to an inactive user or a Requester | 422 `INVALID_OWNER` | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pending |
| API-24 | API | AC-09, BR-14, BR-15 | Update IT Priority | 200, `itPriority` changes, `requestedPriority` unchanged | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pending |
| API-25 | API | AC-10, BR-19 | Attempt disallowed status transition (e.g., New → Closed) | 409 `INVALID_TRANSITION` with allowed list, status unchanged | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pending |
| API-26 | API | BR-19 | Attempt every permitted transition in the matrix (parameterized) | 200 for each, status updates correctly | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pending |
| API-27 | API | FR-22, BR-16-18 | IT Staff posts Public Comment and Internal Note (valid/empty/too-long) | Correct 201/422 per case for both endpoints | `server/tests/lab-03/comments-notes.api.test.ts` | Pending |
| API-08 (dup ref) | API | AC-04 | (see Authorization §2, SEC-03) Requester blocked from notes | — | `server/tests/lab-03/notes.apitest.ts` | Pending |
| UI-06 | UI | IT Staff Ticket Detail §6 | Public Comments and Internal Notes render as visually distinct panels | Snapshot confirms distinct styling/labels | `client/.lab-03 tests/StaffTicketDetail.test.tsx` | Pending |
| UI-07 | UI | IT Staff Ticket Detail §6 | Status control only offers permitted next-states for current status | Rendered options match transition matrix exactly | `client/.lab-03 tests/StaffTicketDetail.test.tsx` | Pending |
| E2E-05 | E2E | Full IT Staff flow | Login as IT Staff → open queue → claim ticket → set IT Priority → change status → post public comment → add internal note | All steps succeed, correct UI feedback and final ticket state | `e2e/lab-03/staff-ticket-flow.spec.ts` | Pending |
| RESP-02 | RESP | §9 responsive | Ticket Detail screen at 375px/768px/1280px | No overflow/clipping; Internal Notes panel remains visually distinct on mobile | `artifacts/lab-03/screenshots/staff-ticket-detail/` | Pending |

## 6. Administrator User Management

| Test ID | Type | Requirement/AC | What It Tests | Expected Result | Automated Test File | Final |
|---|---|---|---|---|---|---|
| API-28 | API | FR-24, FR-25 | List users, search by name/email, filter by role | Correct filtered/searched subset returned | `server/tests/lab-03/users-admin.api.test.ts` | Pending |
| API-29 | API | FR-26, BR-21, BR-25 | Create user with one role and initial password | 201, `mustChangePassword=true` forced, password never returned | `server/tests/lab-03/users-admin.api.test.ts` | Pending |
| API-30 | API | AC-12, FR-29, BR-10 | Create/edit user with duplicate email | 422 field-level error, no user created/mutated | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-31 | API | FR-27 | Edit user's name/email/role/activation state | 200, fields updated correctly | `server/tests/lab-03/users-admin.api.test.ts` | Pending |
| API-32 | API | AC-13, FR-30, BR-23 | Administrator attempts to deactivate own account | 409 `SELF_DEACTIVATION`, no change persisted | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-33 | API | AC-13, FR-31, BR-24 | Deactivate or change role of the last active Administrator (by a different admin, if only one exists in test fixture) | 409 `LAST_ACTIVE_ADMIN`, no change persisted | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-34 | API | AC-14, FR-28, BR-25 | Reset a user's password to a new initial password | 200, target user's `mustChangePassword=true`; next login forces change (cross-check with API-08 style test) | `server/tests/lab-03/users-admin.api.test.ts` | Pending |
| API-35 | API | Invalid role | Create/edit user with an invalid role string | 422 validation error | `server/tests/lab-03/users-admin.api.test.ts` | Pending |
| SEC-09 | SEC | AC-15 | Non-Administrator attempts every `/api/admin/*` endpoint | 403 for each | `server/tests/lab-03/authorization.api.test.ts` | Pending |
| UI-08 | UI | Admin User Management §7 | List, search, role filter, Create/Edit modal render and validate correctly | Matches spec states (Idle/Validating/Busy/Success/Failure) | `client/.lab-03 tests/UserManagement.test.tsx` | Pending |
| UI-09 | UI | Admin User Management §7 | Self-deactivation and last-admin guard rules disable controls in UI | Toggle/role select disabled with correct tooltip in both guard scenarios | `client/.lab-03 tests/UserManagement.test.tsx` | Pending |
| E2E-06 | E2E | Full Admin flow | Login as Administrator → search/filter users → create user → edit user → reset password → attempt self-deactivation (blocked) | All steps succeed or are correctly blocked with visible feedback | `e2e/lab-03/user-administration.spec.ts` | Pending |
| RESP-03 | RESP | §9 responsive | User Management screen at 375px/768px/1280px | No overflow/clipping, responsive list/table | `artifacts/lab-03/screenshots/user-management/` | Pending |

## 7. Data Migration & Seed

| Test ID | Type | Requirement/AC | What It Tests | Expected Result | Automated Test File | Final |
|---|---|---|---|---|---|---|
| MIG-03 | MIG | §7.2, §7.3 spec | Seed script run twice in a row | Idempotent — second run does not duplicate users/tickets | `server/tests/lab-03/migration.api.test.ts` | Pending |
| MIG-04 | MIG | §7.3 spec | Seed data volume check | ≥4 active + 1 inactive Requester; ≥3 active + 1 inactive IT Staff; ≥1 active Administrator present | `server/tests/lab-03/migration.api.test.ts` | Pending |
| MIG-05 | MIG | §7.2 spec | Pre-existing Ticket/Attachment referential integrity post-migration | No orphaned Tickets; all `requesterId` FKs resolve to a valid User | `server/tests/lab-03/migration.api.test.ts` | Pending |

## 8. Accessibility & Cross-Cutting Safe-Failure

| Test ID | Type | Requirement/AC | What It Tests | Expected Result | Automated Test File | Final |
|---|---|---|---|---|---|---|
| UI-10 | UI | §9 accessibility | Form error regions use `role="alert"`, labels bound via `for`/`id` across Login/Change Password/Create-Edit User forms | Automated a11y assertions (e.g., jest-axe) pass with no critical violations | `client/.lab-03 tests/*` (shared a11y checks) | Pending |
| SEC-10 | SEC | §6 api-spec safe errors | Any endpoint's 500 response body | Contains only generic message, no stack trace or internal detail | `server/tests/lab-03/authorization.api.test.ts` | Pending |
| API-36 | API | §6 api-spec safe errors | Cross-owner ticket fetch (Requester B fetching Requester A's ticket) vs. non-existent ticket ID | Identical `404` shape for both cases (no existence leak) | `server/tests/lab-03/authorization.api.test.ts` | Pending |

---

## 9. Acceptance-Criteria Traceability Summary

| AC | Covered by |
|---|---|
| AC-01 | API-01, E2E-01 |
| AC-02 | API-08, E2E-02 |
| AC-03 | SEC-05 |
| AC-04 | SEC-03 |
| AC-05 | API-02, API-03, E2E-01 |
| AC-06 | API-04 |
| AC-07 | API-20 |
| AC-08 | API-21 |
| AC-09 | API-24 |
| AC-10 | API-25 |
| AC-11 | API-12 |
| AC-12 | API-30 |
| AC-13 | API-32, API-33 |
| AC-14 | API-10, API-34 |
| AC-15 | SEC-01, SEC-02, SEC-09 |
| AC-16 | MIG-01 |
| AC-17 | SEC-06a, SEC-06b |

Every AC has at least one mapped, executable automated test. "Final" status in every table above must be updated to **Pass/Fail** with a link/reference to the actual CI or local test run output before submission (Part 3 of the grading rubric requires complete passing output from `main`).