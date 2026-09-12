# TokTickIT — Sprint 3 Engineering Specification

**Course:** CPE 334 Introduction to Software Engineering in the Age of AI Agents
**Sprint:** Lab 3 — Users, Roles, IT Staff Ticketing, and Admin Screens
**Status:** Draft v1.0 — authored before implementation PRs (see commit history / reviewer.md for timestamp evidence)

---

## 1. Sprint Goal

Sprint 3 replaces the temporary Development Requester selector introduced in Lab 2 with real, credential-based authentication and server-side role-based authorization. It delivers the first operational IT Staff workflow (shared Ticket Queue, Ticket Detail, ownership, IT Priority, Public Comments, Internal Notes, and permitted status transitions) and a minimalist Administrator User Management screen (create, edit, activate/deactivate, role assignment, and initial-password reset). At the end of the sprint, TokTickIT supports three authenticated roles — Requester, IT Staff, and Administrator — each restricted to its permitted navigation and actions, with every protected operation enforced on the backend rather than only hidden in the UI.

## 2. Stakeholder Request (Interpretation)

The stakeholder needs the system to move from a development convenience (the Requester selector) to production-realistic identity. Concretely:

- Every user must log in with email + password before doing anything.
- A user issued an initial password by an Administrator must be forced to set a new password before reaching any other screen.
- Requesters keep all Lab 2 ticket capabilities, but their identity now comes from their session, not a client-supplied ID, and they gain the ability to post Public Comments and flag a ticket as "appears resolved" (a signal only — not a formal status change).
- IT Staff need one shared queue to find unclaimed or owned work, claim/reassign tickets, set IT Priority (independent from the Requester's Requested Priority), move tickets through a controlled status lifecycle, and separate public communication (Public Comments) from private operational notes (Internal Notes).
- Administrators are scoped narrowly: they manage accounts, not tickets. They can list/search users, create accounts with one role, edit basic info, activate/deactivate, and reset a user to a new initial (must-change) password. They cannot delete users, assign multiple roles, or manage departments — all deferred to a later sprint.
- Authorization must be enforced server-side for every endpoint and screen; a disabled button is a UX nicety, not a security boundary.

## 3. Scope

### 3.1 In Scope
- Email + password authentication, logout, current-user endpoint, mandatory first-login password change.
- Role-based navigation and server-side authorization for Requester, IT Staff, Administrator.
- Migration of Lab 2 Development Requester data into a real `User` model; removal of the Requester selector.
- Continued Requester ownership protection for all Lab 2 Ticket/Attachment functions, now driven by session identity.
- IT Staff Ticket Queue (search, filter, sort, pagination) and Ticket Detail (claim/reassign, IT Priority, status transitions, Public Comments, Internal Notes).
- Minimalist Administrator User Management (list, search, optional role filter, create, edit, activate/deactivate, reset initial password).
- Data model and REST API evolution without discarding Lab 2 Ticket/Attachment/Category/Related System data.
- Zen Green UI extensions reusing Lab 2 tokens and components.

### 3.2 Explicitly Excluded
- Email invitations, password-reset emails, MFA, social login, SSO.
- Self-registration / Requester-created accounts.
- Actions Taken (deferred to Lab 4), formal SLA calculation, escalation, notification services.
- Dashboards / KPI analytics beyond simple queue counts.
- Multi-tenant orgs, departments, customer administration.
- Production-grade deployment / cloud infrastructure changes.
- Multiple roles per user; user deletion; bulk operations; import/export; account-history screens.
- Department, organization, profile-photo, or other extended profile management.
- Email delivery of initial passwords or reset links.
- Account unlocking, admin-approval workflows, advanced identity management.
- Mandatory pagination, multi-column sorting, or multiple simultaneous filters on the user list (single filter + search is sufficient).

## 4. Functional Requirements

**Authentication**
- **FR-01** The system shall allow a user to authenticate with email and password and establish an authenticated session.
- **FR-02** The system shall reject authentication for inactive accounts with a generic, non-information-leaking error.
- **FR-03** The system shall reject authentication for invalid email/password combinations with a generic error that does not reveal which field was wrong.
- **FR-04** The system shall expose a "current user" endpoint returning the authenticated user's id, name, email, role, and `mustChangePassword` flag.
- **FR-05** The system shall allow an authenticated user to log out, invalidating the session/token.
- **FR-06** The system shall force any user with `mustChangePassword = true` into a Change Password screen and block access to all other authenticated screens/APIs (except logout and current-user) until a new password is saved.
- **FR-07** The system shall validate the new password against minimum complexity rules and require a matching confirmation field.

**Authorization / Navigation**
- **FR-08** The system shall determine navigation options solely from the authenticated user's role.
- **FR-09** The system shall enforce role and ownership checks on every protected API endpoint, independent of any UI state.
- **FR-10** The system shall return HTTP 401 for unauthenticated requests and HTTP 403 for authenticated-but-forbidden requests, without leaking the existence of resources the user cannot access.

**Requester Regression**
- **FR-11** The system shall remove the Development Requester selector and the "Change Requester" action.
- **FR-12** The system shall derive the Requester identity for all ticket-creation and ticket-management operations from the authenticated session, never from a client-supplied `requesterId`.
- **FR-13** The system shall allow a Requester to view and manage only Tickets and Attachments they own.
- **FR-14** The system shall allow a Requester to post Public Comments on their own Tickets.
- **FR-15** The system shall allow a Requester to mark a Ticket as "Problem Appears Resolved" without changing the formal Ticket status.

**IT Staff Ticket Queue**
- **FR-16** The system shall provide a Ticket Queue listing all Tickets, with search by ticket number/summary, filter by status/priority/ownership, sort by defined sortable fields, and pagination.
- **FR-17** The system shall allow IT Staff/Administrator to open Ticket Detail from the Queue.

**IT Staff Ticket Operations**
- **FR-18** The system shall allow IT Staff/Administrator to claim an unassigned Ticket (set themselves as Ticket Owner).
- **FR-19** The system shall allow IT Staff/Administrator to reassign Ticket ownership to another active IT Staff/Administrator user.
- **FR-20** The system shall allow IT Staff/Administrator to set/update IT Priority independently of Requested Priority.
- **FR-21** The system shall allow IT Staff/Administrator to change Ticket status only along permitted transitions (see §4.5 of the handout / §7 below).
- **FR-22** The system shall allow IT Staff/Administrator to post Public Comments and create Internal Notes on any Ticket.
- **FR-23** The system shall render Public Comments and Internal Notes as visually and structurally distinct so private content cannot be mistaken for public content.

**Administrator User Management**
- **FR-24** The system shall allow an Administrator to view a list of users (Name, Email, Role, Status).
- **FR-25** The system shall allow an Administrator to search users by name or email and optionally filter by role.
- **FR-26** The system shall allow an Administrator to create a user with name, email, one role, activation state, and an initial password.
- **FR-27** The system shall allow an Administrator to edit a user's name, email, role, and activation state.
- **FR-28** The system shall allow an Administrator to set a new initial password for a user, forcing `mustChangePassword = true`.
- **FR-29** The system shall prevent creating or editing a user to a duplicate email address.
- **FR-30** The system shall prevent an Administrator from deactivating their own account.
- **FR-31** The system shall prevent deactivating or changing the role of the last remaining active Administrator.

## 5. Business Rules

| BR ID | Business Rule |
|---|---|
| BR-01 | Only an active user with valid credentials may authenticate. |
| BR-02 | A user marked `mustChangePassword = true` cannot access the normal application until a new valid password is saved. |
| BR-03 | The authenticated session identity, not a client-supplied `requesterId`, determines ownership of Requester operations. |
| BR-04 | Public Comments are visible to the Requester, IT Staff, and Administrator. Internal Notes are visible only to IT Staff and Administrator. |
| BR-05 | A Requester may indicate a problem appears resolved, but cannot set a Ticket to Resolved or Closed. |
| BR-06 | Login attempts with a correct email but wrong password, or a non-existent email, return the same generic "invalid email or password" message. |
| BR-07 | Passwords are never stored or logged in plain text; only a salted hash is persisted. |
| BR-08 | Logging out invalidates the current session/token immediately; subsequent requests with the old credential are rejected with 401. |
| BR-09 | An inactive user cannot authenticate, even with correct credentials; the error message does not distinguish "inactive" from "wrong password" to the end user beyond a neutral "account unavailable" notice, and never confirms whether the email exists. |
| BR-10 | Email addresses are unique across all users regardless of role. |
| BR-11 | The current-user endpoint never returns the password hash or any credential material. |
| BR-12 | A Ticket has at most one primary Ticket Owner, who must be an active IT Staff or Administrator user; a Ticket may be unassigned (`ownerId = null`). |
| BR-13 | Claiming a Ticket is only permitted when it is currently unassigned; reassigning is permitted at any time by IT Staff/Administrator. |
| BR-14 | IT Priority defaults to the Requester's Requested Priority at Ticket creation and can thereafter be changed only by IT Staff or Administrator. |
| BR-15 | Requested Priority is immutable after Ticket creation; only the Requester's original submission is stored there. |
| BR-16 | Public Comments and Internal Notes are append-only in Lab 3; no edit or delete operation exists. |
| BR-17 | Empty or whitespace-only Public Comments/Internal Notes are rejected with a validation error. |
| BR-18 | Public Comments and Internal Notes are limited to 2,000 characters and are rendered with output-encoding/escaping to prevent script injection. |
| BR-19 | Ticket status transitions must follow the permitted transition matrix in §7; any other transition is rejected with 409 Conflict. |
| BR-20 | Only IT Staff/Administrator may change Ticket status; a Requester's "appears resolved" flag is stored separately and never overwrites `status`. |
| BR-21 | A new user is always created with exactly one role: Requester, IT Staff, or Administrator. |
| BR-22 | Deactivating a user does not delete their historical Tickets, Comments, or Notes; ownership and authorship references remain intact. |
| BR-23 | An Administrator cannot deactivate their own account. |
| BR-24 | The system must always retain at least one active Administrator; the last active Administrator cannot be deactivated or have their role changed. |
| BR-25 | Setting a new initial password for a user always sets `mustChangePassword = true` for that user. |
| BR-26 | Validation errors for user creation/editing (duplicate email, invalid role, empty name) return 422 with field-level messages; they never reveal whether a conflicting email belongs to an active or inactive account. |
| BR-27 | All Lab 2 Ticket/Attachment functions continue to operate correctly for a migrated Requester after migration (regression safety). |

## 6. UI Specification Summary

Full detail is in `ui-spec.md`. Summary of screens:

| Screen | Roles | Purpose |
|---|---|---|
| Login | All (unauthenticated) | Email/password entry, validation, busy state, safe failure feedback |
| Change Password (mandatory) | Any user with `mustChangePassword=true` | Forced password reset before entering the app |
| App Shell / Navigation | All (authenticated) | Shows current user, role, role-scoped nav, Logout |
| Requester Ticket List / Detail (regression) | Requester | Lab 2 functions + Public Comments + "Problem Appears Resolved" |
| IT Staff Ticket Queue | IT Staff, Administrator | Search/filter/sort/paginate; open Ticket Detail |
| IT Staff Ticket Detail | IT Staff, Administrator | Claim/reassign, IT Priority, status transitions, Public Comments, Internal Notes, Attachments |
| Administrator User Management | Administrator | List/search/filter users; create/edit; activate/deactivate; reset initial password |

All screens reuse Zen Green tokens, cards, badges, buttons, and validation placement from Lab 2. Each screen defines view/create/edit modes and feedback states for loading, saving, success, validation, empty, no-results, forbidden, and safe failure — see `ui-spec.md` §"Screen Modes and Feedback Matrix".

## 7. Data Changes

### 7.1 New/Modified Prisma Models (conceptual)

```
enum Role {
  REQUESTER
  IT_STAFF
  ADMINISTRATOR
}

enum TicketStatus {
  NEW
  OPEN
  IN_PROGRESS
  WAITING_FOR_REQUESTER
  RESOLVED
  CLOSED
  REOPENED
  CANCELLED
}

model User {
  id                  String   @id @default(cuid())
  name                String
  email               String   @unique
  passwordHash        String
  role                Role
  isActive            Boolean  @default(true)
  mustChangePassword  Boolean  @default(false)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  ticketsCreated      Ticket[]        @relation("RequesterTickets")
  ticketsOwned        Ticket[]        @relation("OwnerTickets")
  publicComments      PublicComment[]
  internalNotes       InternalNote[]
}

model Ticket {
  // existing Lab 2 fields retained: id, ticketNumber, summary, description,
  // categoryId, relatedSystemId, requestedPriority, createdAt, updatedAt, attachments...
  requesterId              String
  requester                User          @relation("RequesterTickets", fields: [requesterId], references: [id])
  ownerId                  String?
  owner                    User?         @relation("OwnerTickets", fields: [ownerId], references: [id])
  itPriority               Priority      // same enum as requestedPriority, defaults to requestedPriority on create
  status                   TicketStatus  @default(NEW)
  requesterMarkedResolved  Boolean       @default(false)
  requesterMarkedResolvedAt DateTime?
  publicComments           PublicComment[]
  internalNotes            InternalNote[]
}

model PublicComment {
  id        String   @id @default(cuid())
  ticketId  String
  ticket    Ticket   @relation(fields: [ticketId], references: [id])
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])
  content   String
  createdAt DateTime @default(now())
}

model InternalNote {
  id        String   @id @default(cuid())
  ticketId  String
  ticket    Ticket   @relation(fields: [ticketId], references: [id])
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])
  content   String
  createdAt DateTime @default(now())
}
```

Indexes: unique index on `User.email`; index on `Ticket.status`, `Ticket.ownerId`, `Ticket.requesterId` to support Queue search/sort/filter/pagination.

### 7.2 Migration from Lab 2
1. Add `User` table and enums via Prisma migration.
2. For each distinct Development Requester used in Lab 2 seed/demo data, create a corresponding `User` row with `role = REQUESTER`, a documented local-dev initial password, and `mustChangePassword = true`.
3. Backfill `Ticket.requesterId` from the migrated Development Requester mapping; verify referential integrity (no orphaned tickets).
4. Add `ownerId`, `itPriority` (backfilled from `requestedPriority`), `status` (backfilled to `NEW` unless already tracked), and `requesterMarkedResolved` columns to `Ticket` with safe defaults.
5. Remove any client-side "current Development Requester" state/selector code; remove the corresponding now-obsolete API parameter (`requesterId` in request bodies is ignored server-side going forward — see BR-03).
6. Verify via regression tests (`tests.md`) that all pre-existing Tickets/Attachments remain queryable and owned correctly after migration.

### 7.3 Seed Data
- 4 active Requesters + 1 inactive Requester.
- 3 active IT Staff + 1 inactive IT Staff.
- 1 active Administrator.
- Tickets distributed across statuses/priorities/owners (including some unassigned).
- Sample Public Comments and Internal Notes with no sensitive data.
- Seed script is idempotent (safe to re-run); documented local-only credentials (e.g., `Password123!` per seeded account, all flagged `mustChangePassword = true` except the Administrator's own testing accounts, which are documented separately).

## 8. API Contract (Summary)

Full detail in `api-spec.md`. Endpoint groups:
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password`
- `GET/POST /api/tickets`, `GET/PATCH /api/tickets/:id`, Attachment endpoints (Lab 2, now session-scoped)
- `GET /api/staff/tickets` (Queue), `GET /api/staff/tickets/:id`
- `POST /api/staff/tickets/:id/claim`, `POST /api/staff/tickets/:id/assign`
- `PATCH /api/staff/tickets/:id/priority`, `PATCH /api/staff/tickets/:id/status`
- `POST/GET /api/tickets/:id/comments` (Public), `POST/GET /api/staff/tickets/:id/notes` (Internal)
- `GET /api/admin/users`, `POST /api/admin/users`, `PATCH /api/admin/users/:id`, `POST /api/admin/users/:id/reset-password`

Authentication: HTTP-only, secure, `SameSite=Lax` session cookie issued at login; server-side session store keyed by session id; CSRF token required for state-changing requests when cookie-based auth is used. All responses exclude `passwordHash`.

## 9. Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-01 | Given an active user with valid credentials, when they log in, then the backend establishes an authenticated session and returns the user's id, name, role, and `mustChangePassword` flag. |
| AC-02 | Given a user with `mustChangePassword = true`, when login succeeds, then all non-password-change screens/APIs remain unavailable until a valid new password is saved. |
| AC-03 | Given an authenticated Requester, when the client supplies a different `requesterId` in a request body, then the backend still applies the authenticated identity and never returns another Requester's data. |
| AC-04 | Given a Requester account, when an Internal Note endpoint is requested, then the operation is rejected with 403 and no note content is returned. |
| AC-05 | Given invalid credentials or a non-existent email, when login is attempted, then the response is a generic "invalid email or password" error with no indication of which field was wrong. |
| AC-06 | Given an inactive user, when login is attempted with correct credentials, then authentication is rejected without revealing account existence beyond a generic message. |
| AC-07 | Given an unassigned Ticket, when IT Staff clicks "Claim", then `ownerId` is set to that IT Staff user and the Ticket no longer appears as unassigned. |
| AC-08 | Given a Ticket already owned by another IT Staff user, when a second IT Staff member attempts to claim it, then the request is rejected (already assigned) and reassignment must be used instead. |
| AC-09 | Given any Ticket, when IT Staff updates IT Priority, then Requested Priority remains unchanged and IT Priority reflects the new value. |
| AC-10 | Given a Ticket in status X, when a status change to a non-permitted status Y is requested, then the backend returns 409 Conflict and the status remains X. |
| AC-11 | Given a Requester viewing their own Ticket, when they click "Problem Appears Resolved", then `requesterMarkedResolved = true` is recorded and the formal `status` field is unchanged. |
| AC-12 | Given an Administrator, when they create a user with an email that already exists, then the request is rejected with a 422 field-level validation error and no user is created. |
| AC-13 | Given the last remaining active Administrator, when any Administrator (including themself) attempts to deactivate that account or change its role, then the request is rejected. |
| AC-14 | Given an Administrator resets a user's password, when that user next logs in, then `mustChangePassword = true` forces them to the Change Password screen before any other screen loads. |
| AC-15 | Given a non-Administrator user, when they call any `/api/admin/*` endpoint, then the backend returns 403 regardless of frontend navigation state. |
| AC-16 | Given a migrated Lab 2 Ticket, when its original Requester logs in with their migrated account, then they can view and manage that Ticket exactly as in Lab 2. |
| AC-17 | Given a Public Comment posted by a Requester, when IT Staff or Administrator views the Ticket, then the comment is visible; given an Internal Note posted by IT Staff, when the Requester views the same Ticket, then the note is not present in the response at all. |

Every criterion above maps to at least one planned test in `tests.md`.

## 10. Definition of Done (Product Completion)

- [ ] All FR-01 through FR-31 implemented and demonstrable end-to-end.
- [ ] All BR-01 through BR-27 enforced server-side with corresponding automated tests passing.
- [ ] All AC-01 through AC-17 covered by at least one passing automated test (unit, API, or E2E) traceable in `tests.md`.
- [ ] Lab 2 Requester regression suite passes against the migrated data model with no functional loss.
- [ ] No endpoint relies solely on frontend hiding for protection; direct API calls by an unauthorized role are verified (via tests) to be rejected.
- [ ] Passwords are hashed (never plain text) in the database and never present in logs, responses, or seed documentation as real secrets.
- [ ] Zen Green design consistency verified across Login, Change Password, Requester, Queue, Ticket Detail, and User Management screens on desktop, tablet, and mobile.
- [ ] Idempotent seed script produces the documented minimum accounts and Ticket distribution.
- [ ] GitHub Issues for Sprint 3 are all in "Done"; PRs merged via `lab3-staging` → `main` with recorded reviews (`reviewer.md`).
- [ ] `specification.md`, `ui-spec.md`, `api-spec.md`, and `tests.md` are internally consistent and reflect the final implementation (not aspirational only).

## 11. Assumptions and Decisions

1. **Session mechanism:** Server-side session with an HTTP-only secure cookie (not a bearer JWT in localStorage), to avoid XSS-based token theft and to simplify logout invalidation. CSRF protection via a synchronized token on state-changing requests.
2. **"Appears resolved" semantics:** Modeled as a boolean + timestamp on the Ticket, fully independent of `status`, since the handout is explicit that Requesters cannot set Resolved/Closed themselves.
3. **Cancellation authority:** Ticket cancellation is restricted to IT Staff/Administrator only in Lab 3 (not exposed to Requesters), since the handout does not explicitly grant Requesters a cancel action beyond Lab 2 behavior, and hiding this reduces risk of accidental data loss on active work.
4. **Reassignment vs. claim:** "Claim" is only valid on an unassigned Ticket; moving ownership between two already-assigned IT Staff members always uses "Reassign," to keep the two actions and their authorization checks distinct and auditable.
5. **Initial passwords for migrated Lab 2 Requesters:** Generated deterministically for local development only (documented in `README` under a "Seed Credentials" section), never emailed, consistent with the exclusion of email delivery from scope.
6. **Password complexity rule:** Minimum 8 characters, at least one letter and one number — a reasonable local-lab standard given MFA/advanced identity management is out of scope.
7. **Pagination default:** Queue page size defaults to 10 with configurable `page`/`pageSize` query parameters, matching the example UI mock in the handout (Showing 1 to 10 of 67).