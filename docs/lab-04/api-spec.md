# TokTickIT — Sprint 4 REST API Contract (`api-spec.md`)

All endpoints are versioned under `/api` (consistent with Labs 2–3), require a valid authenticated
session (existing auth middleware), and return the existing Lab 2/3 error envelope:

```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "Human readable message",
    "details": { }
  }
}
```

Standard status codes used throughout: `200 OK`, `201 Created`, `400 Bad Request`,
`401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `409 Conflict`, `422 Unprocessable Entity`,
`500 Internal Server Error` (never leaks stack traces to the client — safe failure).

---

## 1. Actions Taken

### 1.1 `POST /api/tickets/:ticketId/actions`
Create a new Actions Taken entry under a Ticket.

**Authorization:** IT Staff or Administrator with access to the Ticket. Requester → `403 Forbidden` (`FORBIDDEN_ROLE`).

**Request body**
```json
{
  "actionDateTime": "2026-09-20T10:15:00.000Z",
  "description": "Replaced failing battery cell and re-seated connector.",
  "result": "Laptop now holds charge for 6+ hours in testing.",
  "followUpRequired": true,
  "followUpNote": "Monitor battery health for 2 weeks; revisit if drain returns.",
  "attachmentNotes": "See battery-test-photo.jpg in ticket attachments."
}
```

**Validation (422 on failure, `details` maps field → message)**
- `actionDateTime`: required, valid ISO-8601, must be ≤ server current time (BR-04).
- `description`: required, string, 5–2000 chars.
- `result`: required, string, 3–2000 chars.
- `followUpRequired`: required boolean.
- `followUpNote`: required non-empty (≥3 chars) **iff** `followUpRequired === true`; must be empty/omitted otherwise (BR-05).
- `attachmentNotes`: optional, ≤500 chars.

**Server-set fields (never accepted from client):** `id`, `ticketId` (from path), `performedById` (from session), `createdAt`, `isVoided`, `editedAt`, `editedById`.

**Responses**
- `201 Created` → full Actions Taken resource including `performedBy: { id, name }`.
- `403 Forbidden` (`FORBIDDEN_ROLE` | `FORBIDDEN_TICKET_ACCESS`) if role or Ticket-access check fails.
- `404 Not Found` (`TICKET_NOT_FOUND`) if `ticketId` does not exist or is soft-deleted.
- `422 Unprocessable Entity` (`VALIDATION_ERROR`) for the rules above.
- Idempotency (FR-15, AC-11): server accepts an optional `Idempotency-Key` header; a duplicate key replayed within a **5-second** window returns the original `201` response body without creating a second row. (5 seconds is chosen to comfortably cover double-click/slow-network-retry scenarios without masking a genuine second, intentional submission made moments later.)

---

### 1.2 `GET /api/tickets/:ticketId/actions`
List Actions Taken for a Ticket, oldest first.

**Authorization:** Requester (own Ticket, read-only), IT Staff/Administrator (any accessible Ticket).

**Query params:** `includeVoided=true|false` (default `false`). If a Requester passes `includeVoided=true`, the API returns `403 Forbidden` (`FORBIDDEN_QUERY_PARAM`) rather than silently ignoring the parameter — an explicit rejection makes the access-control decision testable and auditable, and never lets a client mistakenly assume it is seeing an unfiltered view when it isn't.

**Response `200 OK`**
```json
{
  "ticketId": "tkt_123",
  "count": 2,
  "items": [
    {
      "id": "act_001",
      "actionDateTime": "2026-09-18T09:00:00.000Z",
      "description": "Initial diagnosis run.",
      "result": "Confirmed swollen battery cell.",
      "performedBy": { "id": "usr_42", "name": "Michael Suwan" },
      "followUpRequired": false,
      "followUpNote": null,
      "attachmentNotes": null,
      "createdAt": "2026-09-18T09:01:12.000Z",
      "editedAt": null,
      "editedById": null,
      "isVoided": false
    },
    {
      "id": "act_002",
      "actionDateTime": "2026-09-20T10:15:00.000Z",
      "description": "Replaced failing battery cell and re-seated connector.",
      "result": "Laptop now holds charge for 6+ hours in testing.",
      "performedBy": { "id": "usr_42", "name": "Michael Suwan" },
      "followUpRequired": true,
      "followUpNote": "Monitor battery health for 2 weeks; revisit if drain returns.",
      "attachmentNotes": "See battery-test-photo.jpg in ticket attachments.",
      "createdAt": "2026-09-20T10:16:03.000Z",
      "editedAt": null,
      "editedById": null,
      "isVoided": false
    }
  ]
}
```

---

### 1.3 `PATCH /api/tickets/:ticketId/actions/:actionId`
Edit (within window) or void an Actions Taken entry.

**Authorization and editable fields:**
- Requester: never permitted to call this endpoint under any circumstance, regardless of whether they own the parent Ticket → `403 Forbidden` (`FORBIDDEN_ROLE`), the same code and semantics used by `POST` §1.1. Read access to Actions Taken for a Requester's own Ticket (§1.2) does not extend to this endpoint.
- Author, within `EDIT_WINDOW_MINUTES` (15) of `createdAt`: may edit any of `actionDateTime`, `description`, `result`, `followUpRequired`, `followUpNote`, `attachmentNotes`. `actionDateTime` **is** editable within the window (the UI's edit form is pre-filled from the create form, `ui-spec.md` §4.4) — an edited value is re-validated against the same BR-04 rule as creation (must not be a future timestamp). `performedById` is never editable by anyone, at any time.
- Administrator: may edit any entry (same field list as above) at any time, regardless of the 15-minute window, and may additionally set `{ "isVoided": true, "voidReason": "..." }` (BR-11).
- IT Staff who is not the author, or an author attempting to edit after the window has expired: `403 Forbidden` (`EDIT_WINDOW_EXPIRED` | `NOT_AUTHOR`).

**Request body (edit)**
```json
{ "actionDateTime": "2026-09-20T10:20:00.000Z", "description": "Corrected typo in description.", "result": "..." }
```

**Request body (void, Administrator only)**
```json
{ "isVoided": true, "voidReason": "Duplicate entry created by double submission." }
```

**Additional validation**
- `voidReason`: required, non-empty (≥3 chars) **iff** `isVoided === true` in the request body; omitted/empty in that case → `422 Unprocessable Entity` (`VALIDATION_ERROR`, field `voidReason`). `voidReason` is ignored if `isVoided` is not being set to `true` in the same request.
- `actionDateTime` (if present in the edit body): same rule as §1.1 — must not be a future timestamp → else `422` (`VALIDATION_ERROR`).
- `followUpRequired`/`followUpNote` pair: same conditional rule as §1.1 (BR-05) applies on edit as well.
- **Voiding is one-way.** Once an entry has `isVoided = true`, it is permanently frozen: (a) a request that sets `isVoided: false` on it (an "un-void") is rejected, and (b) any request that edits its other fields (`description`, `result`, `actionDateTime`, etc.) is also rejected — even from an Administrator. Both cases return `409 Conflict` (`ENTRY_VOIDED`), not `422`, because the request body itself may be perfectly well-formed; the entry's own state (already voided) is what makes the operation invalid. This means an Administrator's only legal action against an already-voided entry is `GET` (view) — no `PATCH` on a voided entry ever succeeds, including a `PATCH` that only touches `voidReason` itself. `ui-spec.md` §4.4 must not render an Edit or Void affordance on a row where `isVoided = true`.

**Responses**
- `200 OK` → updated resource, `editedAt`/`editedById` populated.
- `403 Forbidden` (`FORBIDDEN_ROLE` | `EDIT_WINDOW_EXPIRED` | `NOT_AUTHOR`) as above.
- `404 Not Found` (`TICKET_NOT_FOUND`) if `ticketId` in the path does not exist or is soft-deleted, checked **before** looking up `actionId` (mirrors §1.1's ticket-existence check ordering).
- `404 Not Found` (`ACTION_NOT_FOUND`) if `ticketId` exists but `actionId` does not exist under that Ticket.
- `409 Conflict` (`ENTRY_VOIDED`) per the voiding rule above.
- `422 Unprocessable Entity` (`VALIDATION_ERROR`) as above.

---

## 2. Ticket Status & Resolution

### 2.1 `PATCH /api/tickets/:ticketId/status`
Transition a Ticket's status. Replaces the Lab 3 status-update endpoint (same path and method; Lab 3 clients must be updated to send the new required `version` field).

**Authorization:** Per the transition matrix in `specification.md` §5.1 (role × current status × target status).

**Request body**
```json
{
  "targetStatus": "Resolved",
  "version": 4,
  "note": "optional short note stored on the status-change audit log"
}
```

`note` (optional, ≤500 chars) is persisted as the `note` column of the new `TicketStatusHistory`
row created for this transition (`specification.md` §7.3) — it is *not* stored on the `Ticket`
row itself. This row is also the authoritative source the dashboard "delta vs. yesterday"
calculations in §3.1/§3.2 query live against.

Idempotency (FR-15, AC-14): the client may send an `Idempotency-Key` header; a duplicate key
replayed within the same **5-second** window as §1.1 returns the original `200` response without
re-applying the transition or incrementing `version` a second time.

**Validation / business rules enforced server-side**
- `targetStatus` must be a permitted transition from the Ticket's *current* stored status for the caller's role (BR-07) → else `409 Conflict` (`INVALID_STATUS_TRANSITION`).
- `version` must match the Ticket's current `version` (BR-12, FR-16) → else `409 Conflict` (`STALE_VERSION`) and the response includes the current authoritative Ticket state so the client can refresh.
- Transition to `Resolved` requires ≥1 non-voided Actions Taken with non-empty `result` (BR-09) → else `409 Conflict` (`ACTIONS_REQUIRED`).
- Transition to `Reopened` from `Resolved`/`Closed` by the owning Requester is only permitted within `REOPEN_WINDOW_DAYS` (7) of `resolvedAt` (BR-10) → else `403 Forbidden` (`REOPEN_WINDOW_EXPIRED`).

**Responses**
- `200 OK` → `{ "ticket": { ...updated Ticket incl. new "status", "version", "resolvedAt" } }`
- `404 Not Found` (`TICKET_NOT_FOUND`) if `ticketId` does not exist or is soft-deleted.
- `409 Conflict` with `code` in `{INVALID_STATUS_TRANSITION, STALE_VERSION, ACTIONS_REQUIRED}` plus `currentState` for client reconciliation.
- `403 Forbidden` with `code` in `{FORBIDDEN_ROLE, REOPEN_WINDOW_EXPIRED}`.

### 2.2 `POST /api/tickets/:ticketId/requester-confirmation`
Requester's advisory "looks resolved" acknowledgement (BR-08, FR-08).

**Authorization:** Requester who owns the Ticket only.

**Request body:** `{}` (no payload needed beyond the authenticated session + path param).

**Behavior:** Sets `requesterConfirmedResolved = true`, `requesterConfirmedResolvedAt = now()` only.
Per `specification.md` §7.2/Decision B, `version` is incremented **only** by successful status
transitions (§2.1); this endpoint never reads or writes `version` and therefore can never conflict
with, or be blocked by, a concurrent `PATCH /status` call — the two are independent writes to
different columns by design, not merely "not visible" to each other's checks.

**Responses**
- `200 OK` → `{ "ticketId": "...", "requesterConfirmedResolved": true, "requesterConfirmedResolvedAt": "..." }`
- `403 Forbidden` (`NOT_TICKET_OWNER`) if caller does not own the Ticket.
- `404 Not Found` if Ticket doesn't exist.

---

## 3. Dashboards

Dashboard endpoints return **aggregated counts and a bounded recent list only** — never a full
Ticket collection (§6.2 of handout, BR-13/FR-13).

### 3.1 `GET /api/dashboard/staff`
**Authorization:** IT Staff or Administrator.

**Response `200 OK`**
```json
{
  "generatedAt": "2026-09-22T08:00:00.000Z",
  "timezone": "Asia/Bangkok",
  "counts": {
    "new": 14,
    "open": 23,
    "inProgress": 18,
    "waitingForRequester": 7,
    "myAssigned": 16
  },
  "deltas": {
    "new": 3,
    "open": -2,
    "inProgress": 1,
    "waitingForRequester": -1
  },
  "recentTickets": [
    {
      "id": "tkt_1234",
      "code": "TKT-2026-01234",
      "title": "Laptop battery drains quickly",
      "status": "InProgress",
      "updatedAt": "2026-09-20T09:14:00.000Z"
    }
  ]
}
```

**Calculation rules:**
- `counts.new` = count of Tickets where `status = 'New'`.
- `counts.open` = count of Tickets where `status = 'Open'`.
- `counts.inProgress` = count of Tickets where `status IN ('InProgress', 'Reopened')` — `Reopened` Tickets are folded into this card (BR-14) rather than given a separate card, since both represent active work in progress.
- `counts.waitingForRequester` = count of Tickets where `status = 'WaitingForRequester'`.
- All four counts above are across the whole queue visible to IT Staff (not scoped to one assignee); `Cancelled` and `Closed` Tickets are never included in any of them (BR-14).
- `counts.myAssigned` = count of Tickets where `ownerId = current user` and `status` is in the open-work set `{New, Open, InProgress, WaitingForRequester, Reopened}` (BR-14) — i.e., `Closed` and `Cancelled` Tickets assigned to the user do not count toward "My Assigned".
- `deltas.*` applies only to the first four status keys — `new`, `open`, `inProgress`, `waitingForRequester`. There is no `deltas.myAssigned` key at all (omitted from the response entirely, not present as `0` or `null`), since reassignment is not a status transition and is out of scope for Lab 4's delta indicator; the UI simply renders no delta chip on the "My Assigned" card.
- For each of those four keys: `deltas.<key> = (# TicketStatusHistory rows where toStatus IN <that status/group> AND changedAt >= now − 24h) − (# TicketStatusHistory rows where fromStatus IN <that status/group> AND changedAt >= now − 24h)`, **plus**, for `new` only, `+ (# Tickets where createdAt >= now − 24h)`. The extra term for `new` exists because Ticket *creation* does not write a `TicketStatusHistory` row (there is no `fromStatus` to record) — without it, newly submitted Tickets would silently vanish from the "New" delta even though they visibly raise `counts.new`. (In practice `toStatus = 'New'` never appears in `TicketStatusHistory` at all, since no transition in §5.1's matrix targets `New`; the formula is written generally so it still holds if that ever changes.) All terms are computed **live** against `Ticket`/`TicketStatusHistory` at request time (`specification.md` §7.1–§7.3) — never a cached/pre-aggregated counter, satisfying BR-13. Because every term is a live event-count query rather than a snapshot comparison, `deltas.<key>` is always a well-defined integer (including `0` when nothing happened in the last 24 hours) — there is no `null` case.
- `recentTickets` = the 5 most recently `updatedAt` Tickets where `ownerId = current user` **or** `ownerId IS NULL`, excluding `Cancelled`, newest first. (`ownerId` is the Lab 1–3 column name for the Ticket Owner relationship — see `specification.md` §7.2's Implementation Note.)
- **Empty behavior:** any zero count or zero delta is returned as `0` (not omitted, not `null`); `recentTickets` may be an empty array `[]`.

### 3.2 `GET /api/dashboard/requester`
**Authorization:** Requester (any authenticated Requester; scope is always "me").

**Response `200 OK`**
```json
{
  "generatedAt": "2026-09-22T08:00:00.000Z",
  "timezone": "Asia/Bangkok",
  "counts": {
    "myOpen": 3,
    "inProgress": 2,
    "resolved": 5,
    "closed": 12
  },
  "recentTickets": [
    {
      "id": "tkt_5678",
      "code": "TKT-2026-05678",
      "title": "Need new monitor",
      "status": "InProgress",
      "updatedAt": "2026-09-09T11:05:00.000Z"
    }
  ]
}
```

**Calculation rules:**
- `counts.myOpen` = Tickets owned (`requesterId = current user`) with `status IN ('New', 'Open', 'WaitingForRequester', 'Reopened')` — `Reopened` is included here (BR-14) so a Requester's reopened Ticket is not invisible on their own dashboard. Note this set deliberately **excludes `InProgress`**, which has its own separate card immediately below; `ui-spec.md` §3.3's drill-down for this card must filter on exactly this four-status list, not the broader `open-work` alias (see `ui-spec.md` §1).
- `counts.inProgress` = Tickets owned by current user with `status = 'InProgress'`.
- `counts.resolved`, `counts.closed` = Tickets owned by current user in exactly that status.
- `recentTickets` = 5 most recently `updatedAt` Tickets where `requesterId = current user`, any non-`Cancelled` status, newest first.
- Scope is enforced at the database query layer (`WHERE requesterId = :sessionUserId`), never filtered after fetching all Tickets (AC-02, AC-06).
- **Empty behavior:** identical to §3.1 — zero counts render as `0`; empty `recentTickets` renders `[]` and the UI shows its empty state. The Requester Dashboard does not show delta indicators (only the IT Staff Dashboard does, per `ui-spec.md` §3.1), so there is no `deltas` key in this response.

---

## 4. Regression: Endpoints Carried Over From Labs 2–3

All previously approved endpoints (authentication, Ticket CRUD, Public Comments, Internal Notes,
Attachments, Administrator user management) remain unchanged in contract and continue to be covered
by the Lab 2/3 test suites, re-run as part of Lab 4 regression (see `tests.md` §Regression).

---

## 5. Cross-Cutting Rules

- **Authorization:** every endpoint above re-validates role and Ticket/record ownership server-side on each request, independent of any UI state (handout §4.3, BR-15).
- **Concurrency:** any endpoint that mutates Ticket `status` must use the `version` optimistic-concurrency check (§2.1, BR-12) — `version` is the sole concurrency token; `updatedAt` is never used for this purpose (see `specification.md` BR-12). Actions Taken creation does not require `version` since it is append-only and non-conflicting by nature. Both Actions Taken creation (§1.1) and status transitions (§2.1) support `Idempotency-Key`-based duplicate-submission protection (FR-15, AC-11, AC-14).
- **Audit trail:** every successful status transition additionally writes one row to `TicketStatusHistory` (`specification.md` §7.3), which is the live source for dashboard delta calculations (§3.1/§3.2) — no dashboard value is ever read from a cache.
- **Safe errors:** `500` responses never include stack traces or internal identifiers beyond a correlation `requestId` used for server-side log lookup.
- **Timezone:** all "last 24 hours" delta window calculations (§3.1/§3.2) are computed against UTC timestamps but any "day boundary" style calculation added in the future must use `Asia/Bangkok`; all stored timestamps remain UTC ISO-8601.