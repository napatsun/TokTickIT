# TokTickIT — Sprint 3 REST API Specification

## 0. Conventions

- Base path: `/api`
- Format: JSON request/response bodies, UTF-8.
- Auth: HTTP-only, `Secure`, `SameSite=Lax` session cookie (`sid`) set on login. State-changing requests (`POST`/`PATCH`/`DELETE`) require header `X-CSRF-Token` matching a token issued alongside the session (double-submit cookie pattern).
- All authenticated responses exclude `passwordHash` and any credential material.
- Standard error envelope:
```json
{ "error": { "code": "STRING_CODE", "message": "human-readable safe message", "fields": { "email": "Email already in use" } } }
```
- Standard status-code usage across all endpoints below:
  - `400` invalid input shape/JSON
  - `401` not authenticated
  - `403` authenticated but forbidden (role/ownership)
  - `404` resource not found (or hidden as not found to avoid leaking existence to unauthorized roles)
  - `409` conflict (e.g., disallowed status transition, duplicate email at DB level)
  - `422` validation error (field-level)
  - `500` unexpected server error (generic message only, logged server-side with detail)

---

## 1. Authentication

### `POST /api/auth/login`
**Auth:** none
**Body:** `{ "email": "string", "password": "string" }`
**200:** `{ "user": { "id", "name", "email", "role", "isActive": true, "mustChangePassword": boolean } }` + sets session cookie.
**401:** generic `INVALID_CREDENTIALS` — used for wrong password, unknown email, AND inactive account alike (BR-06, BR-09). No field-level detail.
**422:** malformed email format / missing fields.

### `POST /api/auth/logout`
**Auth:** session required
**200:** `{ "success": true }`, session invalidated server-side and cookie cleared.
**401:** if no valid session.

### `GET /api/auth/me`
**Auth:** session required
**200:** `{ "id", "name", "email", "role", "isActive", "mustChangePassword" }`
**401:** no valid session.

### `POST /api/auth/change-password`
**Auth:** session required (allowed even when `mustChangePassword = true`; this is the one exempt endpoint)
**Body:** `{ "newPassword": "string", "confirmPassword": "string" }`
**200:** `{ "success": true }`; server sets `mustChangePassword = false`.
**422:** `{ "fields": { "newPassword": "Must be at least 8 characters and include a letter and a number", "confirmPassword": "Passwords do not match" } }`
**401:** no valid session.

**Middleware rule (BR-02, FR-06):** Any authenticated route other than `/api/auth/logout`, `/api/auth/me`, and `/api/auth/change-password` returns `403 { "error": { "code": "PASSWORD_CHANGE_REQUIRED" } }` while `mustChangePassword = true`.

---

## 2. Requester Ticket & Attachment APIs (Lab 2 continuation, session-scoped)

All endpoints below require an authenticated session with `role = REQUESTER` and apply `requesterId = session.userId` server-side; any `requesterId` field present in a request body is ignored (BR-03, AC-03).

### `GET /api/tickets`
Returns only Tickets owned by the session Requester. Supports Lab 2's existing query params (unchanged contract) for list filtering the Requester already had.
**200:** `{ "tickets": [ Ticket... ], "pagination": { ... }, "filterOptions": { ... } }` *(Lab 2 response shape, retained as-is in Lab 3 — not the generic `{ items, total }` shape used by newer endpoints. A shape unification is a documented backlog item, not required for Lab 3.)*

### `POST /api/tickets`
**Body:** Lab 2 fields (summary, description, categoryId, relatedSystemId, requestedPriority, attachments...). `requesterId` from body is ignored.
**201:** created Ticket; `itPriority` is server-set equal to `requestedPriority`; `status = NEW`; `ownerId = null`.
**422:** validation errors per Lab 2 rules.

### `GET /api/tickets/:ticketNumber`
**200:** Ticket detail, only if `ticket.requesterId === session.userId`. Response is additive over Lab 2: also includes `requesterMarkedResolved` and `requesterMarkedResolvedAt` so the UI can render the marker without a second call.
**403/404:** if the ticket belongs to another Requester, respond `404 NOT_FOUND` (do not reveal existence — avoids leaking another user's data, per §6.2 handout requirement). Cross-owner 404 body is byte-identical to a non-existent-ticket 404 body.

### Attachment endpoints
Unchanged Lab 2 contract, re-scoped to session identity in the same way as above.

### `POST /api/tickets/:ticketNumber/comments` (Public Comment, Requester)
**Body:** `{ "content": "string" }`
**201:** `{ "id", "ticketId", "authorId", "authorName", "authorRole", "content", "createdAt" }`
**422:** `{ "error": { "code": "CONTENT_REQUIRED" } }` if empty/whitespace-only, or `{ "error": { "code": "CONTENT_TOO_LONG", "fieldErrors": { "content": "..." } } }` if > 2000 chars.
**403/404:** if ticket not owned by session Requester → `404`.

### `GET /api/tickets/:ticketNumber/comments`
**200:** `{ "items": [ PublicComment... ] }` — ordered **oldest-first** (chronological reading order, newest at the bottom). This is the authoritative ordering; treat any other mention of ordering in this project as superseded by this line.

### `POST /api/tickets/:ticketNumber/resolve-mark` (Requester "Problem Appears Resolved")
**Auth:** Requester, own ticket only, and only when `status ∈ {OPEN, IN_PROGRESS, WAITING_FOR_REQUESTER}`.
**200:** `{ "requesterMarkedResolved": true, "requesterMarkedResolvedAt": "ISO-8601" }`. Does **not** alter `status` (BR-05, BR-20).
**409:** `INVALID_STATE` if ticket status is not eligible (e.g., already Closed) or already marked.

---

## 3. IT Staff Ticket Queue & Detail

Auth for all endpoints in this section: session required, `role ∈ {IT_STAFF, ADMINISTRATOR}`.

**Route param convention:** Endpoints in this section use `:id` — the internal Ticket `id`. Ground-truth note: `Ticket.id` is an `Int` (autoincrement, inherited from Lab 2), **not** a cuid — unlike `User.id`, which is a cuid. Any non-positive-integer `:id` returns a generic 404. This is a deliberate difference from §2's Requester-facing routes, which use `:ticketNumber` to match the shipped Lab 2 convention. Do not mix the two — the Queue/Ticket Detail screens navigate using internal `id` values returned by `GET /api/staff/tickets`.

### `GET /api/staff/owners`
**Auth:** `role ∈ {IT_STAFF, ADMINISTRATOR}`.
Read-only picker endpoint supplying the Reassign dropdown's candidate list, per ui-spec.md §6.2 ("a dropdown of active IT Staff/Administrator"). Added in feature/lab3-04-staff-ticketing since no other endpoint supplied this list at the time (`GET /api/admin/users` did not exist yet).
**200:** `{ "items": [ { "id", "name", "email" } ] }` — only active `IT_STAFF`/`ADMINISTRATOR` users.

### `GET /api/staff/tickets` (Queue)
**Query params:**
- `q` — free-text search against ticket number and summary (min 2 chars; ignored if shorter).
- `status` — one of the `TicketStatus` enum values.
- `priority` — filters on `itPriority`.
- `owner` — `unassigned` | `me` | a specific `userId`.
- `sortBy` — one of `createdAt | itPriority | status` (default `createdAt`).
- `sortDir` — `asc | desc` (default `desc`).
- `page` (default `1`), `pageSize` (default `10`, max `50`).
**200:**
```json
{
  "items": [ { "id","ticketNumber","createdAt","summary","category","requestedPriority","itPriority","status","owner": { "id","name" } | null } ],
  "page": 1, "pageSize": 10, "total": 67, "totalPages": 7
}
```
**400:** invalid `sortBy`/`status`/`priority` enum value, or `page`/`pageSize` out of range.

### `GET /api/staff/tickets/:id`
**200:** full Ticket detail including `requester { id, name, email }`, `owner`, `requestedPriority`, `itPriority`, `status`, `requesterMarkedResolved(+At)`, attachments.
**404:** ticket does not exist.
(No ownership restriction beyond role — any IT Staff/Administrator may view any Ticket, per handout's "shared Ticket Queue.")

### `POST /api/staff/tickets/:id/claim`
**200:** sets `ownerId = session.userId`. Returns updated Ticket.
**409:** `ALREADY_ASSIGNED` if `ownerId` is already set (BR-13) — client should use `/assign` instead.

### `POST /api/staff/tickets/:id/assign`
**Body:** `{ "ownerId": "string" }` — target must be an active IT Staff or Administrator.
**200:** updates `ownerId`. Allowed regardless of prior owner state.
**422:** `INVALID_OWNER` if target user is not active IT Staff/Administrator.
**404:** target user or ticket not found.

### `PATCH /api/staff/tickets/:id/priority`
**Body:** `{ "itPriority": "LOW|MEDIUM|HIGH|URGENT" }`
**200:** updates `itPriority` only; `requestedPriority` untouched (BR-15).
**422:** invalid enum value.

### `PATCH /api/staff/tickets/:id/status`
**Body:** `{ "status": "OPEN|IN_PROGRESS|WAITING_FOR_REQUESTER|RESOLVED|CLOSED|REOPENED|CANCELLED" }`
**200:** updates `status` if the transition from current status is permitted per the matrix in `ui-spec.md` §6.1.
**409:** `INVALID_TRANSITION` with `{ "from": "...", "to": "...", "allowed": [...] }` if not permitted (BR-19).

### `POST /api/staff/tickets/:id/comments` (Public Comment, staff-authored)
Same contract as the Requester's public-comment endpoint, but callable by IT Staff/Administrator on any ticket.

### `GET /api/staff/tickets/:id/comments`
Same as `GET /api/tickets/:id/comments`, callable by IT Staff/Administrator on any ticket.

### `POST /api/staff/tickets/:id/notes` (Internal Note)
**Body:** `{ "content": "string" }`
**201:** `{ "id","ticketId","authorId","authorName","content","createdAt" }`
**422:** same empty/length validation as Public Comments (BR-17, BR-18).
**403:** if caller role is `REQUESTER` (defense in depth — this route is not reachable by Requester role at all; included for completeness of the authorization matrix, BR-04/AC-04).

### `GET /api/staff/tickets/:id/notes`
**200:** `{ "items": [ InternalNote... ] }`, IT Staff/Administrator only.
**403:** any other role → `FORBIDDEN`, no note content returned (AC-04).

---

## 4. Administrator User Management

Auth for all endpoints in this section: session required, `role = ADMINISTRATOR`.

### `GET /api/admin/users`
**Query params:** `q` (search name/email), `role` (optional filter, one of `Role` enum).
**200:** `{ "items": [ { "id","name","email","role","isActive" } ] }` (no pagination required per scope — full filtered list returned).

### `POST /api/admin/users`
**Body:** `{ "name","email","role","isActive","initialPassword" }`
**201:** created user (without `passwordHash`); server sets `mustChangePassword = true` regardless of caller intent (BR-25).
**422:** `{ "fields": { "email": "This email is already in use." } }` (BR-29) or other field errors (missing name, invalid role enum, weak initial password).

### `PATCH /api/admin/users/:id`
**Body (any subset):** `{ "name","email","role","isActive" }`
**200:** updated user.
**422:** duplicate email (BR-29), invalid role.
**409:** `LAST_ACTIVE_ADMIN` if the request would deactivate or change the role of the last active Administrator (BR-24, BR-31).
**409:** `SELF_DEACTIVATION` if `isActive:false` is requested for the caller's own account (BR-23, BR-30).
**404:** user not found.

### `POST /api/admin/users/:id/reset-password`
**Body:** `{ "newInitialPassword": "string" }`
**200:** `{ "success": true }`; sets `mustChangePassword = true` for the target user (BR-25, FR-28).
**422:** password does not meet minimum complexity.
**404:** user not found.

---

## 5. Authorization Matrix (Cross-Reference)

| Endpoint group | Requester | IT Staff | Administrator |
|---|:---:|:---:|:---:|
| `/api/auth/*` | ✔ (self) | ✔ (self) | ✔ (self) |
| `/api/tickets*` (own) | ✔ | — | — |
| `/api/staff/tickets*` (queue/detail/claim/assign/priority/status/notes) | ✘ | ✔ | ✔ |
| Public comments on any accessible ticket | ✔ (own ticket) | ✔ (any ticket) | ✔ (any ticket) |
| Internal notes | ✘ | ✔ | ✔ |
| `/api/admin/users*` | ✘ | ✘ | ✔ |

Every row above is enforced by backend middleware (role check) plus, where relevant, an ownership check (`ticket.requesterId === session.userId`) — never by frontend route guarding alone (FR-09, FR-10).

## 6. Safe-Error Rules (Cross-Cutting)

- Never distinguish "resource does not exist" from "resource exists but you can't see it" for cross-tenant/cross-owner reads — always `404`.
- Never echo the password, password hash, or raw validation exception/stack trace in any response body.
- Rate-limit `/api/auth/login` is out of scope for Lab 3 automated tests but should be noted as a follow-up in `README` (not required for grading).