# Lab 2 API Contract — TokTickIT Requester Ticketing MVP

All endpoints are prefixed `/api`. All responses are JSON. All ticket/attachment-scoped endpoints require the header:

```
X-Dev-Requester-Id: <integer id of the currently selected Development Requester>
```

If this header is missing, non-numeric, or refers to a Requester that does not exist or is inactive, the backend returns **401** with:
```json
{ "error": { "code": "INVALID_REQUESTER_CONTEXT", "message": "No active Development Requester selected." } }
```
This re-validation happens on the backend for every request — the frontend must never assume a locally cached selection is still valid (BR-05).

## Common Error Shape

```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "Human-readable, safe message.",
    "fieldErrors": { "summary": "Summary must be between 5 and 120 characters." }
  }
}
```
`fieldErrors` is present only for 400 validation responses on form submissions.

---

## 1. `GET /api/dev-requesters`

**Purpose:** List active Development Requesters for the Selection screen.
**Auth header required:** No (this is the one endpoint reachable before a Requester is selected).

**Response 200**
```json
{
  "requesters": [
    { "id": 1, "fullName": "Jennifer Anderson", "email": "jennifer.anderson@example.com" },
    { "id": 2, "fullName": "Sarah Johnson", "email": "sarah.johnson@example.com" }
  ]
}
```
Only `isActive = true` rows are returned (BR-02). Empty array (`"requesters": []`) is a valid 200 response, not an error — the frontend renders the empty state (FR-01/BR-27).

**Response 500:** generic safe error shape.

---

## 2. `GET /api/categories`

**Purpose:** Active Categories for Create Ticket / My Tickets filter dropdowns.
**Auth header required:** Yes.

**Response 200**
```json
{ "categories": [
  { "id": 1, "name": "Account and Access" },
  { "id": 2, "name": "Hardware" },
  { "id": 3, "name": "Software" },
  { "id": 4, "name": "Network" }
]}
```

---

## 3. `GET /api/related-systems`

**Purpose:** Active Related Systems for Create Ticket dropdown.
**Auth header required:** Yes.

**Response 200**
```json
{ "relatedSystems": [
  { "id": 1, "name": "Email" },
  { "id": 2, "name": "Campus Wi-Fi" },
  { "id": 3, "name": "VPN" },
  { "id": 4, "name": "Corporate Laptop" },
  { "id": 5, "name": "Printer" },
  { "id": 6, "name": "Grade Submission App" }
]}
```

---

## 4. `POST /api/tickets`

**Purpose:** Create a Ticket for the current Requester, optionally with attachments in the same request (multipart).
**Auth header required:** Yes.
**Content-Type:** `multipart/form-data` (fields below plus 0–5 files under field name `attachments`).

**Request fields**
| Field | Type | Required | Validation |
|---|---|---|---|
| categoryId | integer | yes | must reference an active Category |
| relatedSystemId | integer | yes | must reference an active RelatedSystem |
| summary | string | yes | trimmed, 5–120 chars |
| description | string | yes | trimmed, 20–2000 chars |
| requestedPriority | string | yes | one of `LOW`, `MEDIUM`, `HIGH` |
| attachments | file[] | no | 0–5 files, each ≤5MB, type in {jpg,jpeg,png,webp,pdf} |

**Response 201 (fully successful, including all attachments)**
```json
{
  "ticket": {
    "id": 501,
    "ticketNumber": "TKT-2026-000501",
    "ticketDate": "2026-08-22T09:14:00.000Z",
    "requester": { "id": 1, "fullName": "Jennifer Anderson" },
    "category": { "id": 2, "name": "Hardware" },
    "relatedSystem": { "id": 4, "name": "Corporate Laptop" },
    "summary": "Laptop battery drains quickly",
    "description": "My laptop battery is draining much faster than usual...",
    "requestedPriority": "MEDIUM",
    "itPriority": null,
    "currentStatus": "NEW",
    "ticketOwner": null,
    "resolutionSummary": null
  },
  "attachments": [
    { "id": 9001, "originalFileName": "battery_report.pdf", "fileSizeBytes": 204800, "mimeType": "application/pdf", "uploadedAt": "2026-08-22T09:14:00.500Z" }
  ],
  "attachmentFailures": []
}
```

**Response 201 (ticket created, one or more attachments failed — BR-31)**
```json
{
  "ticket": { "...": "as above" },
  "attachments": [ "...successfully uploaded ones..." ],
  "attachmentFailures": [
    { "originalFileName": "screenshot2.png", "reason": "UPLOAD_INTERRUPTED" }
  ]
}
```
The HTTP status remains 201 because the Ticket itself was created; the client surfaces `attachmentFailures` as a partial-success message and lets the Requester retry adding just that file from Ticket Detail.

**Response 400 — validation failure**
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Please fix the highlighted fields.",
  "fieldErrors": {
    "summary": "Summary must be between 5 and 120 characters.",
    "requestedPriority": "Requested priority must be one of LOW, MEDIUM, HIGH."
  } } }
```

**Response 400 — invalid reference**
```json
{ "error": { "code": "INVALID_REFERENCE", "message": "Selected category is no longer available." } }
```

**Response 401** — invalid/missing Requester context (see Common Error Shape section).

**Response 413 — an attachment exceeds 5 MB** (checked before any DB write)
```json
{ "error": { "code": "ATTACHMENT_TOO_LARGE", "message": "One or more files exceed the 5 MB limit.",
  "fieldErrors": { "attachments": "screenshot2.png is 7.2 MB, which exceeds the 5 MB limit." } } }
```

**Response 415 — unsupported attachment type**
```json
{ "error": { "code": "UNSUPPORTED_ATTACHMENT_TYPE", "message": "Only JPG, PNG, WEBP, and PDF files are allowed.",
  "fieldErrors": { "attachments": "notes.docx is not an allowed file type." } } }
```

**Response 500** — safe generic error; no partial ticket is left committed if the failure occurs before the Ticket insert completes (BR-25).

---

## 5. `GET /api/tickets`

**Purpose:** Paginated, searchable, filterable, sortable list of the current Requester's own Tickets (FR-07, FR-08).
**Auth header required:** Yes.

**Query parameters**
| Param | Type | Default | Notes |
|---|---|---|---|
| search | string | none | matches Ticket Number or Summary, case-insensitive, partial (BR-14) |
| categoryId | integer | none | filter |
| requestedPriority | string | none | filter, one of LOW/MEDIUM/HIGH |
| currentStatus | string | none | filter (Lab 2: only `NEW` exists, but param accepted for forward compatibility) |
| sortBy | string | `createdAt` | one of `createdAt`, `updatedAt` |
| sortDir | string | `desc` | one of `asc`, `desc` |
| page | integer | 1 | clamped to ≥1 (BR-17) |
| pageSize | integer | 10 | clamped to one of {10, 20, 50}; invalid values fall back to 10 |

Example: `GET /api/tickets?search=laptop&categoryId=2&sortBy=createdAt&sortDir=desc&page=1&pageSize=10`

**Response 200**
```json
{
  "tickets": [
    {
      "id": 501, "ticketNumber": "TKT-2026-000501", "createdAt": "2026-08-22T09:14:00.000Z",
      "summary": "Laptop battery drains quickly", "category": "Hardware",
      "requestedPriority": "MEDIUM", "itPriority": null, "currentStatus": "NEW",
      "ticketOwner": null, "updatedAt": "2026-08-22T09:14:00.000Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 10, "totalItems": 42, "totalPages": 5 },
  "filterOptions": {
    "categories": [
      { "id": 2, "name": "Hardware" },
      { "id": 3, "name": "Software" }
    ],
    "requestedPriorities": [ "MEDIUM", "HIGH" ],
    "currentStatuses": [ "NEW" ]
  }
}
```

`filterOptions` contains the distinct values that exist across **all** of the current Requester's tickets (BR-15), computed **independently of any active search/filter/sort parameters** — it must always reflect the full set of available filter values for this Requester, not a subset narrowed by the current query. The frontend uses these to populate filter dropdowns, showing only options that have at least one matching ticket. The API validates any supplied filter value against the full reference set (all active Categories from the `Category` table, all valid enum values), not against `filterOptions`.

An empty `tickets` array with `totalItems: 0` is a valid 200 — the frontend distinguishes "no tickets ever" (empty state) from "no matches for current filter" (no-results state) by checking whether any filter/search parameter is active (BR-39). When `totalItems` is 0, `filterOptions` arrays are all empty (no tickets exist for this Requester).

**Response 400** — invalid `sortBy`/`sortDir`/`requestedPriority`/`currentStatus` enum value:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid query parameter.", "fieldErrors": { "sortBy": "sortBy must be one of createdAt, updatedAt." } } }
```
`page`/`pageSize` are clamped rather than rejected (BR-17), so they never produce a 400.

**Response 401** — invalid Requester context.

---

## 6. `GET /api/tickets/:ticketNumber`

**Purpose:** Retrieve one Ticket owned by the current Requester, with its Attachments (FR-09, FR-10).
**Auth header required:** Yes.

**Response 200**
```json
{
  "ticket": { "...same shape as POST /api/tickets response.ticket, plus...":
    { "ticketOwner": null } },
  "attachments": {
    "active": [
      { "id": 9001, "originalFileName": "battery_report.pdf", "fileSizeBytes": 204800, "mimeType": "application/pdf", "uploadedAt": "2026-08-22T09:14:00.500Z" }
    ],
    "removed": [
      { "id": 9002, "originalFileName": "old_log.png", "fileSizeBytes": 51200, "removedAt": "2026-08-22T10:00:00.000Z", "removedReason": "Uploaded wrong file" }
    ]
  }
}
```

**Response 404** — Ticket does not exist **or** belongs to a different Requester (BR-13, AC-03). The response body is identical in both cases:
```json
{ "error": { "code": "TICKET_NOT_FOUND", "message": "Ticket not found." } }
```

**Response 401** — invalid Requester context.

---

## 7. `POST /api/tickets/:ticketNumber/attachments`

**Purpose:** Add one or more Attachments to an existing, owned Ticket (FR-11).
**Auth header required:** Yes.
**Content-Type:** `multipart/form-data`, field name `attachments` (1–however many bring the ticket's active count to ≤5).

**Response 201**
```json
{ "attachments": [
  { "id": 9003, "originalFileName": "new_screenshot.png", "fileSizeBytes": 102400, "mimeType": "image/png", "uploadedAt": "2026-08-22T11:00:00.000Z" }
] }
```

**Response 400 — over the active-attachment cap (AC-08)**
```json
{ "error": { "code": "ATTACHMENT_LIMIT_REACHED", "message": "This ticket already has 5 active attachments. Remove one before adding another." } }
```

**Response 404** — Ticket not found or not owned by current Requester (same as Section 6).
**Response 413 / 415** — same shapes as Section 4.
**Response 401** — invalid Requester context.

---

## 8. `GET /api/attachments/:id`

**Purpose:** Retrieve Attachment metadata only (used to render the Attachments list without re-fetching the whole ticket, and by tests).
**Auth header required:** Yes.

**Response 200**
```json
{ "attachment": {
  "id": 9001, "ticketId": 501, "originalFileName": "battery_report.pdf",
  "mimeType": "application/pdf", "fileSizeBytes": 204800,
  "uploadedAt": "2026-08-22T09:14:00.500Z",
  "isRemoved": false, "removedAt": null, "removedReason": null
} }
```

**Response 404** — Attachment does not exist, or its parent Ticket is not owned by the current Requester (ownership is always checked via the parent Ticket, never the Attachment id alone).

---

## 9. `GET /api/attachments/:id/download`

**Purpose:** Download the binary content of an **active** Attachment on an owned Ticket (FR-12).
**Auth header required:** Yes.

**Response 200** — binary stream, `Content-Type` set to the stored `mimeType`, `Content-Disposition: attachment; filename="<originalFileName>"`.

**Response 404** — any of: Attachment does not exist; parent Ticket not owned by current Requester; **or Attachment `isRemoved = true`** (BR-35 — removed attachments are indistinguishable from nonexistent ones at this endpoint):
```json
{ "error": { "code": "ATTACHMENT_NOT_FOUND", "message": "Attachment not found." } }
```

---

## 10. `DELETE /api/attachments/:id`

**Purpose:** Soft-remove an active Attachment on an owned Ticket (FR-13).
**Auth header required:** Yes.
**Request body**
```json
{ "removalReason": "Uploaded the wrong file by mistake" }
```

**Response 200**
```json
{ "attachment": {
  "id": 9002, "isRemoved": true,
  "removedAt": "2026-08-22T12:00:00.000Z",
  "removedReason": "Uploaded the wrong file by mistake"
} }
```

**Response 400 — missing/too-short reason (AC-20, BR-34)**
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "A removal reason is required.", "fieldErrors": { "removalReason": "Removal reason must be between 3 and 200 characters." } } }
```

**Response 404** — Attachment not found, not owned (via parent Ticket), or **already removed** (idempotent removal is rejected rather than silently succeeding, so the UI can distinguish "already gone" from a real transition):
```json
{ "error": { "code": "ATTACHMENT_NOT_FOUND", "message": "Attachment not found or already removed." } }
```

**Response 401** — invalid Requester context.

---

## 11. HTTP Status Code Summary

| Status | Meaning in this API |
|---|---|
| 200 | Successful retrieval or successful soft-removal |
| 201 | Ticket created, or attachment(s) created |
| 400 | Validation error (bad field values, bad query params, missing removal reason) |
| 401 | Missing/invalid/inactive Requester context (`X-Dev-Requester-Id`) |
| 404 | Resource does not exist, is not owned by the current Requester, or (for downloads) is soft-removed |
| 413 | Attachment exceeds the 5 MB size limit |
| 415 | Attachment is not an allowed MIME type/extension |
| 500 | Unexpected server error; body never includes internal details (BR-26) |

## 12. Cross-Cutting Rules Applied to Every Endpoint
- Ownership is always re-checked server-side on every request, never inferred from client-supplied data alone (BR-12, BR-41).
- All list/detail responses only ever include data belonging to the current Requester context.
- All error responses use the Common Error Shape so the frontend has one parsing path.
- No endpoint accepts a client-supplied `id`, `ticketNumber`, `createdAt`, `currentStatus` at creation, or `isRemoved` directly — these are always backend-derived.