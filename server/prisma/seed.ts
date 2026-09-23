import { fileURLToPath } from "node:url";
import { getPrisma } from "../src/prisma.js";
import {
  hashPassword,
  SEED_ADMIN_PASSWORD,
  SEED_PASSWORD,
} from "../src/lib/password.js";

/**
 * Idempotent seed — safe to run multiple times (MIG-03).
 *
 * Every write is an upsert on a natural unique key (Category.name,
 * RelatedSystem.name, User.email, Ticket.ticketNumber, PublicComment.id,
 * InternalNote.id, ActionTaken.id, TicketStatusHistory.id), so re-running
 * never duplicates rows.
 *
 * Re-running deliberately restores the documented local-dev credentials for
 * the seeded accounts (specification.md §11.5) so a developer can always get
 * back into a known state. Real deployments must never run this script.
 *
 * §7.3 required volume: 4 active + 1 inactive Requester, 3 active + 1
 * inactive IT Staff, 1 active Administrator, Tickets distributed across
 * statuses/priorities/owners (including unassigned ones), and sample Public
 * Comments and Internal Notes with no sensitive data.
 *
 * Lab 4 (specification.md §7.6) adds to that volume:
 *   * "ActionTaken" rows so that Tickets exist with zero, exactly one, and
 *     multiple Actions Taken — including one with followUpRequired = true plus
 *     its followUpNote (BR-05) and one soft-deleted/voided entry (BR-11).
 *     `performedById` is deliberately not always the Ticket's owner, per BR-02.
 *   * "TicketStatusHistory" rows, backdated into the last 24–48 hours, so the
 *     IT Staff dashboard's live delta indicators (BR-13, api-spec.md §3.1) have
 *     real rows to compute against on the first demo instead of all zeros.
 *   * Tickets that make every dashboard metric card non-zero for the seeded
 *     demo Accounts (Jennifer Anderson as the Requester), while Sarah Johnson
 *     stays a legitimate zero-state Requester: her dashboard shows 0 for the
 *     In Progress and Resolved cards, which is what proves the empty state
 *     renders rather than erroring (AC-10).
 *
 * This script creates no Action Taken / history row that the API itself could
 * not have produced: authors and actors are always IT Staff/Administrator for
 * the staff-only transitions, and only the owning Requester cancels their own
 * Ticket.
 */

/**
 * Lab 4 seed dates are relative to the run, unlike the fixed Lab 1–3 ticket
 * timeline above. Both dashboard delta windows (§7.6) and BR-10's 7-day reopen
 * window are measured against "now", so a fixed date would silently decay into
 * a zero delta or an expired window a week after this file was written.
 * Row counts — which is what MIGRATION-03 asserts — stay identical regardless.
 */
const HOURS_AGO = (hours: number): Date => new Date(Date.now() - hours * 60 * 60 * 1000);
const DAYS_AGO = (days: number): Date => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

// ─── Seeded accounts ─────────────────────────────────────────────────────

interface SeedUser {
  name: string;
  email: string;
  role: "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR";
  isActive: boolean;
  mustChangePassword: boolean;
  password: string;
}

export const SEED_REQUESTERS: SeedUser[] = [
  { name: "Jennifer Anderson", email: "jennifer.anderson@example.com", role: "REQUESTER", isActive: true, mustChangePassword: true, password: SEED_PASSWORD },
  { name: "Sarah Johnson", email: "sarah.johnson@example.com", role: "REQUESTER", isActive: true, mustChangePassword: true, password: SEED_PASSWORD },
  { name: "Michael Brown", email: "michael.brown@example.com", role: "REQUESTER", isActive: true, mustChangePassword: true, password: SEED_PASSWORD },
  { name: "David Lee", email: "david.lee@example.com", role: "REQUESTER", isActive: true, mustChangePassword: true, password: SEED_PASSWORD },
  { name: "Robert Wilson", email: "robert.wilson@example.com", role: "REQUESTER", isActive: false, mustChangePassword: true, password: SEED_PASSWORD },
];

export const SEED_IT_STAFF: SeedUser[] = [
  { name: "Alice Chen", email: "alice.chen@toktickit.example.com", role: "IT_STAFF", isActive: true, mustChangePassword: true, password: SEED_PASSWORD },
  { name: "Ben Carter", email: "ben.carter@toktickit.example.com", role: "IT_STAFF", isActive: true, mustChangePassword: true, password: SEED_PASSWORD },
  { name: "Priya Nair", email: "priya.nair@toktickit.example.com", role: "IT_STAFF", isActive: true, mustChangePassword: true, password: SEED_PASSWORD },
  { name: "Ethan Brooks", email: "ethan.brooks@toktickit.example.com", role: "IT_STAFF", isActive: false, mustChangePassword: true, password: SEED_PASSWORD },
];

// The Administrator account is the one "already onboarded" operator account
// (mustChangePassword = false) so the app can be exercised without a forced
// password change. Documented separately in the README.
export const SEED_ADMINISTRATORS: SeedUser[] = [
  { name: "System Administrator", email: "admin@toktickit.example.com", role: "ADMINISTRATOR", isActive: true, mustChangePassword: false, password: SEED_ADMIN_PASSWORD },
];

export const SEED_USERS: SeedUser[] = [
  ...SEED_REQUESTERS,
  ...SEED_IT_STAFF,
  ...SEED_ADMINISTRATORS,
];

// ─── Seed tickets ────────────────────────────────────────────────────────
// Fixed ticket numbers keep the seed idempotent. They are intentionally well
// above the Lab 2 demo numbers (TKT-2026-000001..5) so migrated rows and
// seeded rows never collide.

interface SeedTicket {
  ticketNumber: string;
  requesterEmail: string;
  ownerEmail: string | null;
  categoryName: string;
  relatedSystemName: string;
  summary: string;
  description: string;
  requestedPriority: "LOW" | "MEDIUM" | "HIGH";
  itPriority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  status:
    | "NEW"
    | "OPEN"
    | "IN_PROGRESS"
    | "WAITING_FOR_REQUESTER"
    | "RESOLVED"
    | "CLOSED"
    | "REOPENED"
    | "CANCELLED";
  requesterMarkedResolved?: boolean;
  // ─── Lab 4 §7.2 fields ───────────────────────────────────────────────
  /** BR-08: advisory "looks resolved" flag from the owning Requester. */
  requesterConfirmedResolved?: boolean;
  requesterConfirmedResolvedAt?: Date | null;
  /** §7.2: set when the Ticket entered RESOLVED (drives BR-10's window). */
  resolvedAt?: Date | null;
  /**
   * BR-12: kept equal to the number of seeded `TicketStatusHistory` rows for
   * this Ticket, so a demo client sending the seeded `version` is accepted
   * while a stale one is correctly rejected.
   */
  version?: number;
}

const SEED_TICKETS: SeedTicket[] = [
  {
    ticketNumber: "TKT-2026-000006",
    requesterEmail: "jennifer.anderson@example.com",
    ownerEmail: "alice.chen@toktickit.example.com",
    categoryName: "Hardware",
    relatedSystemName: "Corporate Laptop",
    summary: "Laptop battery drains within an hour",
    description: "The corporate laptop battery drains within an hour of a full charge and the fan runs constantly.",
    requestedPriority: "HIGH",
    itPriority: "HIGH",
    status: "OPEN",
    // BR-08 / FR-08 demo state: the Requester says it looks resolved while the
    // Ticket deliberately stays OPEN — the advisory flag never moves status.
    requesterConfirmedResolved: true,
    requesterConfirmedResolvedAt: DAYS_AGO(1),
    version: 1,
  },
  {
    ticketNumber: "TKT-2026-000007",
    requesterEmail: "jennifer.anderson@example.com",
    ownerEmail: "alice.chen@toktickit.example.com",
    categoryName: "Network",
    relatedSystemName: "Campus Wi-Fi",
    summary: "Cannot connect to campus Wi-Fi in the library",
    description: "Campus Wi-Fi authentication fails on the third floor of the library every morning.",
    requestedPriority: "MEDIUM",
    itPriority: "URGENT",
    status: "IN_PROGRESS",
    version: 2,
  },
  {
    ticketNumber: "TKT-2026-000008",
    requesterEmail: "sarah.johnson@example.com",
    ownerEmail: "ben.carter@toktickit.example.com",
    categoryName: "Software",
    relatedSystemName: "Grade Submission App",
    summary: "Grade submission app crashes on export",
    description: "Exporting the gradebook to CSV crashes the grade submission app every time.",
    requestedPriority: "HIGH",
    itPriority: "MEDIUM",
    status: "WAITING_FOR_REQUESTER",
    version: 2,
  },
  {
    ticketNumber: "TKT-2026-000009",
    requesterEmail: "michael.brown@example.com",
    ownerEmail: null,
    categoryName: "Software",
    relatedSystemName: "Printer",
    summary: "Print driver missing after update",
    description: "The printer driver disappeared after the latest operating system update.",
    requestedPriority: "LOW",
    itPriority: "LOW",
    status: "NEW",
  },
  {
    ticketNumber: "TKT-2026-000010",
    requesterEmail: "david.lee@example.com",
    ownerEmail: null,
    categoryName: "Account and Access",
    relatedSystemName: "VPN",
    summary: "VPN token not accepted",
    description: "The VPN token is rejected even immediately after being generated.",
    requestedPriority: "MEDIUM",
    itPriority: "MEDIUM",
    status: "NEW",
  },
  {
    ticketNumber: "TKT-2026-000011",
    requesterEmail: "jennifer.anderson@example.com",
    ownerEmail: "priya.nair@toktickit.example.com",
    categoryName: "Software",
    relatedSystemName: "Email",
    summary: "Shared mailbox not syncing",
    description: "The shared mailbox stopped syncing new messages on desktop and webmail alike.",
    requestedPriority: "MEDIUM",
    itPriority: "MEDIUM",
    status: "RESOLVED",
    requesterMarkedResolved: true,
    resolvedAt: DAYS_AGO(4),
    version: 1,
  },
  {
    ticketNumber: "TKT-2026-000012",
    requesterEmail: "sarah.johnson@example.com",
    ownerEmail: "ben.carter@toktickit.example.com",
    categoryName: "Hardware",
    relatedSystemName: "Printer",
    summary: "Printer jams on duplex jobs",
    description: "The department printer jams every time a duplex job is sent to it.",
    requestedPriority: "LOW",
    itPriority: "LOW",
    status: "CLOSED",
    resolvedAt: DAYS_AGO(20),
    version: 1,
  },
  {
    ticketNumber: "TKT-2026-000013",
    requesterEmail: "robert.wilson@example.com",
    ownerEmail: "admin@toktickit.example.com",
    categoryName: "Account and Access",
    relatedSystemName: "Email",
    summary: "Account locked after repeated sign-ins",
    description: "The account was locked after several failed sign-in attempts from a new device.",
    requestedPriority: "HIGH",
    itPriority: "HIGH",
    status: "REOPENED",
    // Resolved long enough ago that a Requester-initiated reopen would now be
    // rejected by BR-10 (AC-09), while IT Staff/Administrator still may reopen.
    resolvedAt: DAYS_AGO(9),
    version: 2,
  },
  {
    ticketNumber: "TKT-2026-000014",
    requesterEmail: "michael.brown@example.com",
    ownerEmail: null,
    categoryName: "Network",
    relatedSystemName: "VPN",
    summary: "VPN through dorm network is unusable",
    description: "The VPN connection is unusable from the dormitory network during evening hours.",
    requestedPriority: "LOW",
    itPriority: "LOW",
    status: "CANCELLED",
    version: 1,
  },
  {
    ticketNumber: "TKT-2026-000015",
    requesterEmail: "david.lee@example.com",
    ownerEmail: "priya.nair@toktickit.example.com",
    categoryName: "Hardware",
    relatedSystemName: "Corporate Laptop",
    summary: "Laptop will not wake from sleep",
    description: "The laptop will not wake from sleep and requires a hard reset each morning.",
    requestedPriority: "HIGH",
    itPriority: "URGENT",
    status: "OPEN",
    requesterMarkedResolved: false,
    version: 1,
  },
  // ─── Lab 4 (§7.6) — completes the dashboard-visible demo volume ────────
  // Gives Jennifer Anderson a Closed Ticket, so all four Requester Dashboard
  // cards (My Open / In Progress / Resolved / Closed) are non-zero for her.
  {
    ticketNumber: "TKT-2026-000016",
    requesterEmail: "jennifer.anderson@example.com",
    ownerEmail: "priya.nair@toktickit.example.com",
    categoryName: "Hardware",
    relatedSystemName: "Corporate Laptop",
    summary: "Docking station does not detect external monitors",
    description: "The docking station no longer detects either external monitor after a firmware update.",
    requestedPriority: "MEDIUM",
    itPriority: "HIGH",
    status: "CLOSED",
    requesterMarkedResolved: true,
    requesterConfirmedResolved: true,
    requesterConfirmedResolvedAt: DAYS_AGO(6),
    resolvedAt: DAYS_AGO(5),
    version: 2,
  },
  // Gives Jennifer a Reopened Ticket: BR-14 counts it in her "My Open" card and
  // in the staff "In Progress" card rather than in a separate bucket.
  {
    ticketNumber: "TKT-2026-000017",
    requesterEmail: "jennifer.anderson@example.com",
    ownerEmail: "alice.chen@toktickit.example.com",
    categoryName: "Network",
    relatedSystemName: "Campus Wi-Fi",
    summary: "Wi-Fi drops again in the library after a fix",
    description: "Campus Wi-Fi started dropping again on the third floor two days after the earlier fix.",
    requestedPriority: "HIGH",
    itPriority: "URGENT",
    status: "REOPENED",
    resolvedAt: DAYS_AGO(3),
    version: 3,
  },
];

// ─── Seed public comments ────────────────────────────────────────────────
// Deterministic ids keep the seed idempotent without deleting comments a
// developer (or a test) added to the same ticket in the meantime.

interface SeedComment {
  id: string;
  ticketNumber: string;
  authorEmail: string;
  content: string;
  createdAt: Date;
}

const SEED_PUBLIC_COMMENTS: SeedComment[] = [
  {
    id: "seed-pc-000006-1",
    ticketNumber: "TKT-2026-000006",
    authorEmail: "jennifer.anderson@example.com",
    content: "The battery diagnostic finished and shows 61% wear. Happy to bring the laptop in for a replacement.",
    createdAt: new Date("2026-09-01T09:05:00.000Z"),
  },
  {
    id: "seed-pc-000006-2",
    ticketNumber: "TKT-2026-000006",
    authorEmail: "alice.chen@toktickit.example.com",
    content: "Thanks — a replacement battery is on order and should arrive this week.",
    createdAt: new Date("2026-09-01T09:20:00.000Z"),
  },
  {
    id: "seed-pc-000007-1",
    ticketNumber: "TKT-2026-000007",
    authorEmail: "jennifer.anderson@example.com",
    content: "Wi-Fi is still failing on the third floor this morning.",
    createdAt: new Date("2026-09-02T08:10:00.000Z"),
  },
  {
    id: "seed-pc-000008-1",
    ticketNumber: "TKT-2026-000008",
    authorEmail: "sarah.johnson@example.com",
    content: "The workaround works, but exports are still slow for large gradebooks.",
    createdAt: new Date("2026-09-03T13:45:00.000Z"),
  },
];

// ─── Seed internal notes ─────────────────────────────────────────────────
// IT-Staff/Administrator-only content (BR-04). Same deterministic-id pattern as
// the public comments so re-running the seed is idempotent. Authors are always
// IT Staff or Administrator: a note authored by a Requester is not a state the
// API can produce.

const SEED_INTERNAL_NOTES: SeedComment[] = [
  {
    id: "seed-in-000006-1",
    ticketNumber: "TKT-2026-000006",
    authorEmail: "alice.chen@toktickit.example.com",
    content: "Battery wear confirmed at 61%. Replacement part ordered under PO-4471 — internal only.",
    createdAt: new Date("2026-09-01T09:30:00.000Z"),
  },
  {
    id: "seed-in-000007-1",
    ticketNumber: "TKT-2026-000007",
    authorEmail: "alice.chen@toktickit.example.com",
    content: "Third-floor AP-12 is dropping associations; escalate to Network if it recurs after the firmware push.",
    createdAt: new Date("2026-09-02T08:40:00.000Z"),
  },
  {
    id: "seed-in-000008-1",
    ticketNumber: "TKT-2026-000008",
    authorEmail: "ben.carter@toktickit.example.com",
    content: "Waiting on the requester to try the cached-CSV workaround before we patch the export job.",
    createdAt: new Date("2026-09-03T14:00:00.000Z"),
  },
  {
    id: "seed-in-000015-1",
    ticketNumber: "TKT-2026-000015",
    authorEmail: "priya.nair@toktickit.example.com",
    content: "Suspect a firmware/C-state incompatibility on the DVT batch — RMA approval pending.",
    createdAt: new Date("2026-09-04T10:15:00.000Z"),
  },
];

// ─── Seed actions taken (Lab 4 §7.1 / §7.6) ──────────────────────────────
// Deterministic ids keep the seed idempotent. The set deliberately covers the
// §7.6 volume rules: TKT-2026-000009 has zero entries, TKT-2026-000006 exactly
// one, and TKT-2026-000007 several — one of them carrying followUpRequired =
// true + followUpNote (BR-05) and one already voided with a voidReason (BR-11).
// TKT-2026-000007's entries also show BR-02: `performedBy` is not always the
// Ticket's owner (Ben Carter logs work on Alice Chen's Ticket), which is exactly
// the case the Ticket-Owner/staff-author split in the specification calls out.

interface SeedActionTaken {
  id: string;
  ticketNumber: string;
  performedByEmail: string;
  actionDateTime: Date;
  description: string;
  result: string;
  followUpRequired?: boolean;
  followUpNote?: string | null;
  attachmentNotes?: string | null;
  isVoided?: boolean;
  voidReason?: string | null;
  editedAt?: Date | null;
  editedByEmail?: string | null;
}

const SEED_ACTIONS_TAKEN: SeedActionTaken[] = [
  {
    id: "seed-act-000006-1",
    ticketNumber: "TKT-2026-000006",
    performedByEmail: "alice.chen@toktickit.example.com",
    actionDateTime: new Date("2026-09-01T08:45:00.000Z"),
    description: "Ran a battery wear diagnostic and captured the report.",
    result: "Wear confirmed at 61%; replacement authorised by the hardware pool.",
    attachmentNotes: "See battery-diagnostic.txt in this ticket's attachments.",
  },
  {
    id: "seed-act-000007-1",
    ticketNumber: "TKT-2026-000007",
    performedByEmail: "alice.chen@toktickit.example.com",
    actionDateTime: new Date("2026-09-02T08:20:00.000Z"),
    description: "Captured the failing authentication attempts from the third-floor AP.",
    result: "Collected association logs showing repeated handshake timeouts.",
    // BR-11: shows the editedAt/editedById audit pair on a corrected entry.
    editedAt: new Date("2026-09-02T08:35:00.000Z"),
    editedByEmail: "alice.chen@toktickit.example.com",
  },
  {
    id: "seed-act-000007-2",
    ticketNumber: "TKT-2026-000007",
    performedByEmail: "ben.carter@toktickit.example.com",
    actionDateTime: new Date("2026-09-02T09:00:00.000Z"),
    description: "Pushed the AP firmware update and re-tested authentication.",
    result: "Authentication succeeded in 12 of 15 attempts after the update.",
    followUpRequired: true,
    followUpNote: "Watch the third-floor AP for 48 hours and reopen if drops return.",
  },
  {
    id: "seed-act-000007-3",
    ticketNumber: "TKT-2026-000007",
    performedByEmail: "alice.chen@toktickit.example.com",
    actionDateTime: new Date("2026-09-02T10:30:00.000Z"),
    description: "Swapped the uplink cable on the affected access point.",
    result: "Link is stable at 1 Gbps with no errors logged for two hours.",
    attachmentNotes: "See ap12-uplink-photo.jpg in this ticket's attachments.",
  },
  {
    id: "seed-act-000007-4",
    ticketNumber: "TKT-2026-000007",
    performedByEmail: "ben.carter@toktickit.example.com",
    actionDateTime: new Date("2026-09-02T11:00:00.000Z"),
    description: "Re-entered the firmware update note by mistake.",
    result: "No change to the Ticket; recorded in error by a double submission.",
    // BR-11: append-only soft delete. Voided entries are excluded from the
    // default Actions Taken list (api-spec.md §1.2) and can never be edited.
    isVoided: true,
    voidReason: "Duplicate entry created by a double submission.",
  },
  {
    id: "seed-act-000008-1",
    ticketNumber: "TKT-2026-000008",
    performedByEmail: "ben.carter@toktickit.example.com",
    actionDateTime: new Date("2026-09-03T13:20:00.000Z"),
    description: "Reproduced the CSV export crash against the production gradebook.",
    result: "Reproduced on export; failure traced to a streaming buffer limit.",
    followUpRequired: true,
    followUpNote: "Confirm the requester's cached-CSV workaround before patching the export job.",
  },
  {
    id: "seed-act-000011-1",
    ticketNumber: "TKT-2026-000011",
    performedByEmail: "priya.nair@toktickit.example.com",
    actionDateTime: new Date("2026-09-04T09:10:00.000Z"),
    description: "Recreated the shared mailbox sync relationship and forced a full resync.",
    // Non-empty `result` on a RESOLVED Ticket: BR-09's resolution gate.
    result: "Sync completed and desktop plus webmail now show the same mailbox state.",
  },
  {
    id: "seed-act-000013-1",
    ticketNumber: "TKT-2026-000013",
    performedByEmail: "admin@toktickit.example.com",
    actionDateTime: new Date("2026-09-05T10:40:00.000Z"),
    description: "Unlocked the account and forced a password reset at next sign-in.",
    result: "Account unlocked; the lockout repeated two days later.",
  },
  {
    id: "seed-act-000016-1",
    ticketNumber: "TKT-2026-000016",
    performedByEmail: "priya.nair@toktickit.example.com",
    actionDateTime: DAYS_AGO(6),
    description: "Re-flashed the docking station firmware and retested both monitors.",
    result: "Both external monitors detected and stable after the firmware re-flash.",
  },
  {
    id: "seed-act-000017-1",
    ticketNumber: "TKT-2026-000017",
    performedByEmail: "alice.chen@toktickit.example.com",
    actionDateTime: DAYS_AGO(4),
    description: "Replaced the failed power injector feeding the library access point.",
    result: "Wi-Fi held a stable association for a full day of testing.",
  },
  {
    id: "seed-act-000017-2",
    ticketNumber: "TKT-2026-000017",
    performedByEmail: "alice.chen@toktickit.example.com",
    actionDateTime: HOURS_AGO(16),
    description: "Re-tested the third floor after the requester reported drops again.",
    result: "Drops reproduced under load; the Ticket is back in active work.",
    followUpRequired: true,
    followUpNote: "Track the recurring drops on AP-12 and escalate to Network if it recurs.",
  },
];

// ─── Seed status history (Lab 4 §7.3 / §7.6) ─────────────────────────────
// One row per transition, and each Ticket's LAST seeded row must land on the
// status the Ticket is seeded with above. Most rows are backdated into the last
// 24–48 hours on purpose: the staff dashboard's `deltas.*` are computed live
// from this table (BR-13, api-spec.md §3.1) and must not be all zero on a fresh
// demo database. `note` mirrors api-spec.md §2.1's optional transition note.

interface SeedStatusHistory {
  id: string;
  ticketNumber: string;
  fromStatus: SeedTicket["status"];
  toStatus: SeedTicket["status"];
  changedByEmail: string;
  changedAt: Date;
  note?: string;
}

const SEED_STATUS_HISTORY: SeedStatusHistory[] = [
  {
    id: "seed-tsh-000006-1",
    ticketNumber: "TKT-2026-000006",
    fromStatus: "NEW",
    toStatus: "OPEN",
    changedByEmail: "alice.chen@toktickit.example.com",
    changedAt: HOURS_AGO(20),
    note: "Claimed and triaged; battery diagnostics scheduled.",
  },
  {
    id: "seed-tsh-000007-1",
    ticketNumber: "TKT-2026-000007",
    fromStatus: "NEW",
    toStatus: "OPEN",
    changedByEmail: "alice.chen@toktickit.example.com",
    changedAt: HOURS_AGO(32),
  },
  {
    id: "seed-tsh-000007-2",
    ticketNumber: "TKT-2026-000007",
    fromStatus: "OPEN",
    toStatus: "IN_PROGRESS",
    changedByEmail: "alice.chen@toktickit.example.com",
    changedAt: HOURS_AGO(30),
    note: "Investigating the third-floor access point.",
  },
  {
    id: "seed-tsh-000008-1",
    ticketNumber: "TKT-2026-000008",
    fromStatus: "NEW",
    toStatus: "OPEN",
    changedByEmail: "ben.carter@toktickit.example.com",
    changedAt: HOURS_AGO(34),
  },
  {
    id: "seed-tsh-000008-2",
    ticketNumber: "TKT-2026-000008",
    fromStatus: "OPEN",
    toStatus: "WAITING_FOR_REQUESTER",
    changedByEmail: "ben.carter@toktickit.example.com",
    changedAt: HOURS_AGO(6),
    note: "Waiting on the requester to try the cached-CSV workaround.",
  },
  {
    id: "seed-tsh-000011-1",
    ticketNumber: "TKT-2026-000011",
    fromStatus: "IN_PROGRESS",
    toStatus: "RESOLVED",
    changedByEmail: "priya.nair@toktickit.example.com",
    changedAt: HOURS_AGO(40),
    note: "Shared mailbox resynced and verified with the requester.",
  },
  {
    id: "seed-tsh-000012-1",
    ticketNumber: "TKT-2026-000012",
    fromStatus: "RESOLVED",
    toStatus: "CLOSED",
    changedByEmail: "ben.carter@toktickit.example.com",
    changedAt: DAYS_AGO(20),
  },
  {
    id: "seed-tsh-000013-1",
    ticketNumber: "TKT-2026-000013",
    fromStatus: "RESOLVED",
    toStatus: "CLOSED",
    changedByEmail: "admin@toktickit.example.com",
    changedAt: HOURS_AGO(30),
  },
  {
    id: "seed-tsh-000013-2",
    ticketNumber: "TKT-2026-000013",
    fromStatus: "CLOSED",
    toStatus: "REOPENED",
    changedByEmail: "admin@toktickit.example.com",
    changedAt: HOURS_AGO(12),
    note: "Account re-locked the next day; reopening for a deeper audit.",
  },
  {
    id: "seed-tsh-000014-1",
    ticketNumber: "TKT-2026-000014",
    fromStatus: "NEW",
    toStatus: "CANCELLED",
    // §5.1: a Requester may cancel their own Ticket from NEW.
    changedByEmail: "michael.brown@example.com",
    changedAt: HOURS_AGO(26),
    note: "Requester no longer needs the VPN investigated.",
  },
  {
    id: "seed-tsh-000016-1",
    ticketNumber: "TKT-2026-000016",
    fromStatus: "IN_PROGRESS",
    toStatus: "RESOLVED",
    changedByEmail: "priya.nair@toktickit.example.com",
    changedAt: DAYS_AGO(5),
  },
  {
    id: "seed-tsh-000016-2",
    ticketNumber: "TKT-2026-000016",
    fromStatus: "RESOLVED",
    toStatus: "CLOSED",
    changedByEmail: "priya.nair@toktickit.example.com",
    changedAt: HOURS_AGO(5),
    note: "Requester confirmed the docking station works; closing.",
  },
  {
    id: "seed-tsh-000017-1",
    ticketNumber: "TKT-2026-000017",
    fromStatus: "IN_PROGRESS",
    toStatus: "RESOLVED",
    changedByEmail: "alice.chen@toktickit.example.com",
    changedAt: DAYS_AGO(3),
    note: "Power injector replaced; Wi-Fi stable in testing.",
  },
  {
    id: "seed-tsh-000017-2",
    ticketNumber: "TKT-2026-000017",
    fromStatus: "RESOLVED",
    toStatus: "CLOSED",
    changedByEmail: "alice.chen@toktickit.example.com",
    changedAt: DAYS_AGO(2),
  },
  {
    id: "seed-tsh-000017-3",
    ticketNumber: "TKT-2026-000017",
    fromStatus: "CLOSED",
    toStatus: "REOPENED",
    changedByEmail: "alice.chen@toktickit.example.com",
    changedAt: HOURS_AGO(16),
    note: "Drops returned two days after the fix; reopening.",
  },
];

// ─── Seed ────────────────────────────────────────────────────────────────

export async function seed(): Promise<void> {
  const prisma = getPrisma();

  // ─── Categories ──────────────────────────────────────────
  const categoryNames = [
    "Account and Access",
    "Hardware",
    "Software",
    "Network",
  ];
  for (const name of categoryNames) {
    await prisma.category.upsert({
      where: { name },
      update: { isActive: true },
      create: { name, isActive: true },
    });
  }

  // ─── Related Systems ─────────────────────────────────────
  const relatedSystemNames = [
    "Email",
    "Campus Wi-Fi",
    "VPN",
    "Corporate Laptop",
    "Printer",
    "Grade Submission App",
  ];
  for (const name of relatedSystemNames) {
    await prisma.relatedSystem.upsert({
      where: { name },
      update: { isActive: true },
      create: { name, isActive: true },
    });
  }

  // ─── Users ───────────────────────────────────────────────
  for (const user of SEED_USERS) {
    const passwordHash = await hashPassword(user.password);
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        mustChangePassword: user.mustChangePassword,
        passwordHash,
      },
      create: {
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        mustChangePassword: user.mustChangePassword,
        passwordHash,
      },
    });
  }

  // ─── Tickets ─────────────────────────────────────────────
  const [categories, relatedSystems, users] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true } }),
    prisma.relatedSystem.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ select: { id: true, email: true } }),
  ]);

  const categoryIdByName = new Map(categories.map((c) => [c.name, c.id]));
  const relatedSystemIdByName = new Map(relatedSystems.map((r) => [r.name, r.id]));
  const userIdByEmail = new Map(users.map((u) => [u.email, u.id]));

  for (const ticket of SEED_TICKETS) {
    const requesterId = userIdByEmail.get(ticket.requesterEmail);
    const categoryId = categoryIdByName.get(ticket.categoryName);
    const relatedSystemId = relatedSystemIdByName.get(ticket.relatedSystemName);

    if (!requesterId || categoryId === undefined || relatedSystemId === undefined) {
      throw new Error(
        `Seed misconfiguration for ${ticket.ticketNumber}: missing requester, category, or related system.`,
      );
    }

    const ownerId = ticket.ownerEmail ? userIdByEmail.get(ticket.ownerEmail) ?? null : null;

    const data = {
      requesterId,
      ownerId,
      categoryId,
      relatedSystemId,
      summary: ticket.summary,
      description: ticket.description,
      requestedPriority: ticket.requestedPriority,
      itPriority: ticket.itPriority,
      status: ticket.status,
      requesterMarkedResolved: ticket.requesterMarkedResolved ?? false,
      requesterMarkedResolvedAt: ticket.requesterMarkedResolved ? new Date("2026-09-01T09:00:00.000Z") : null,
      // Lab 4 §7.2 — re-seeding an existing Ticket only ever (re)writes these
      // four additive columns; no Lab 1–3 column is reset behind a developer's
      // back by a seed re-run.
      requesterConfirmedResolved: ticket.requesterConfirmedResolved ?? false,
      requesterConfirmedResolvedAt: ticket.requesterConfirmedResolvedAt ?? null,
      resolvedAt: ticket.resolvedAt ?? null,
      version: ticket.version ?? 0,
    };

    await prisma.ticket.upsert({
      where: { ticketNumber: ticket.ticketNumber },
      update: data,
      create: { ticketNumber: ticket.ticketNumber, ...data },
    });
  }

  // ─── Public Comments ─────────────────────────────────────
  const tickets = await prisma.ticket.findMany({
    select: { id: true, ticketNumber: true },
  });
  const ticketIdByNumber = new Map(tickets.map((t) => [t.ticketNumber, t.id]));

  for (const comment of SEED_PUBLIC_COMMENTS) {
    const ticketId = ticketIdByNumber.get(comment.ticketNumber);
    const authorId = userIdByEmail.get(comment.authorEmail);

    if (ticketId === undefined || !authorId) {
      throw new Error(
        `Seed misconfiguration for ${comment.id}: missing ticket or author.`,
      );
    }

    await prisma.publicComment.upsert({
      where: { id: comment.id },
      update: { ticketId, authorId, content: comment.content, createdAt: comment.createdAt },
      create: {
        id: comment.id,
        ticketId,
        authorId,
        content: comment.content,
        createdAt: comment.createdAt,
      },
    });
  }

  // ─── Internal Notes ───────────────────────────────────────
  for (const note of SEED_INTERNAL_NOTES) {
    const ticketId = ticketIdByNumber.get(note.ticketNumber);
    const authorId = userIdByEmail.get(note.authorEmail);

    if (ticketId === undefined || !authorId) {
      throw new Error(`Seed misconfiguration for ${note.id}: missing ticket or author.`);
    }

    await prisma.internalNote.upsert({
      where: { id: note.id },
      update: { ticketId, authorId, content: note.content, createdAt: note.createdAt },
      create: {
        id: note.id,
        ticketId,
        authorId,
        content: note.content,
        createdAt: note.createdAt,
      },
    });
  }

  // ─── Actions Taken (Lab 4 §7.1) ──────────────────────────
  for (const action of SEED_ACTIONS_TAKEN) {
    const ticketId = ticketIdByNumber.get(action.ticketNumber);
    const performedById = userIdByEmail.get(action.performedByEmail);
    const editedById = action.editedByEmail
      ? userIdByEmail.get(action.editedByEmail) ?? null
      : null;

    if (ticketId === undefined || !performedById) {
      throw new Error(`Seed misconfiguration for ${action.id}: missing ticket or performer.`);
    }
    if (action.editedByEmail && !editedById) {
      throw new Error(`Seed misconfiguration for ${action.id}: missing editor.`);
    }

    const data = {
      ticketId,
      actionDateTime: action.actionDateTime,
      description: action.description,
      result: action.result,
      performedById,
      followUpRequired: action.followUpRequired ?? false,
      followUpNote: action.followUpRequired ? action.followUpNote ?? null : null,
      attachmentNotes: action.attachmentNotes ?? null,
      isVoided: action.isVoided ?? false,
      voidReason: action.isVoided ? action.voidReason ?? null : null,
      // `createdAt` is set from `actionDateTime` rather than left to default
      // `now()`: FR-03's ordering is actionDateTime-first with createdAt/id as
      // tie-breakers, so a stable createdAt keeps the seeded list order identical
      // on every run (a re-seed must not reshuffle the demo list).
      createdAt: action.actionDateTime,
      editedAt: action.editedAt ?? null,
      editedById,
    };

    await prisma.actionTaken.upsert({
      where: { id: action.id },
      update: data,
      create: { id: action.id, ...data },
    });
  }

  // ─── Ticket status history (Lab 4 §7.3) ──────────────────
  for (const entry of SEED_STATUS_HISTORY) {
    const ticketId = ticketIdByNumber.get(entry.ticketNumber);
    const changedById = userIdByEmail.get(entry.changedByEmail);

    if (ticketId === undefined || !changedById) {
      throw new Error(`Seed misconfiguration for ${entry.id}: missing ticket or actor.`);
    }

    const data = {
      ticketId,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      changedById,
      changedAt: entry.changedAt,
      note: entry.note ?? null,
    };

    await prisma.ticketStatusHistory.upsert({
      where: { id: entry.id },
      update: data,
      create: { id: entry.id, ...data },
    });
  }

  console.log("Seed completed.");
}

// Run automatically only when invoked as a script (`npm run prisma:seed` or
// `prisma migrate dev`'s seed hook) — never as a side effect of a test import,
// which would race the explicit `await seed()` in each suite's beforeAll.
const isDirectRun =
  typeof process.argv[1] === "string" &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  seed()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await getPrisma().$disconnect();
    });
}
