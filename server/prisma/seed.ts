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
 * RelatedSystem.name, User.email, DevRequester.email, Ticket.ticketNumber),
 * so re-running never duplicates rows.
 *
 * Re-running deliberately restores the documented local-dev credentials for
 * the seeded accounts (specification.md §11.5) so a developer can always get
 * back into a known state. Real deployments must never run this script.
 *
 * §7.3 required volume: 4 active + 1 inactive Requester, 3 active + 1
 * inactive IT Staff, 1 active Administrator, and Tickets distributed across
 * statuses/priorities/owners (including unassigned ones).
 *
 * Public Comments / Internal Notes are NOT seeded here: those models belong to
 * later Lab 3 branches (staff ticketing), not this one.
 */

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

  // ─── Development Requesters (transitional Lab 2 lookup) ──
  // Retained so the Lab 2 endpoints keep working through X-Dev-Requester-Id
  // until a later branch re-scopes them onto the session. Names/emails match
  // the seeded Requester User rows so the transitional middleware can resolve
  // one to the other.
  for (const requester of SEED_REQUESTERS) {
    await prisma.devRequester.upsert({
      where: { email: requester.email },
      update: { fullName: requester.name, isActive: requester.isActive },
      create: { fullName: requester.name, email: requester.email, isActive: requester.isActive },
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
    };

    await prisma.ticket.upsert({
      where: { ticketNumber: ticket.ticketNumber },
      update: data,
      create: { ticketNumber: ticket.ticketNumber, ...data },
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
