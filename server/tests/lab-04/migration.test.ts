import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";
import { allowedStatusTransitions, isTransitionAllowed } from "../../src/lib/statusTransitions.js";
import { createTestUser, cleanupTestUsers, type TestUser } from "../helpers/session.js";

/**
 * Migration & seed — tests.md §4 (specification.md §7.5, §7.6)
 *
 *   MIGRATION-01  the Lab 4 migration applied to a Lab 3-shaped database that
 *                 already holds Tickets/Users/PublicComments/InternalNotes/
 *                 Attachments loses no data and alters no existing column
 *   MIGRATION-02  a legacy Ticket with zero Actions Taken still queries,
 *                 renders the documented defaults, and is not blocked from any
 *                 transition that BR-09 does not gate
 *   MIGRATION-03  the seed script run twice in sequence is idempotent
 *
 * MIGRATION-01 is not a mock: it creates a private PostgreSQL schema, deploys
 * ONLY the Lab 1–3 migrations into it with the real Prisma CLI, inserts
 * Lab-3-shaped rows through SQL that names no Lab 4 column, then deploys the
 * Lab 4 migration on top and compares the database before/after. That is the
 * production upgrade path (old migrations already applied → one new migration
 * arrives) executed for real, and it is the only way to catch a destructive
 * statement that a schema-prisma-only review would miss.
 *
 * The scratch schema is dropped in afterAll, so the developer's own database and
 * the database the other suites share are never touched by this file.
 */

const prisma = getPrisma();

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS_DIR = path.join(SERVER_DIR, "prisma", "migrations");
const SCHEMA_FILE = path.join(SERVER_DIR, "prisma", "schema.prisma");
const LAB4_MIGRATION_MARKER = "add_action_taken_and_ticket_workflow_fields";
/** The new Ticket columns and tables this branch introduces (specification.md §7.1–§7.2). */
const LAB4_TICKET_COLUMNS = [
  "requesterConfirmedResolved",
  "requesterConfirmedResolvedAt",
  "resolvedAt",
  "version",
];
const LAB4_TABLES = ["ActionTaken", "TicketStatusHistory"];

// ─── Migration helper plumbing ───────────────────────────────────────────

function readDatabaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv) return fromEnv;

  // Vitest does not load server/.env (only the Prisma CLI does), so read the
  // very same file the CLI would have used rather than inventing a fallback
  // that could point the scratch schema at the wrong database.
  const envPath = path.join(SERVER_DIR, ".env");
  const line = fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith("DATABASE_URL"));
  if (!line) {
    throw new Error(`DATABASE_URL is not set and was not found in ${envPath}`);
  }
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}

/** Point an existing connection string at a different PostgreSQL schema. */
function withSchema(url: string, schema: string): string {
  const [base, query] = url.split("?");
  const params = new URLSearchParams(query ?? "");
  params.set("schema", schema);
  return `${base}?${params.toString()}`;
}

const execFileAsync = promisify(execFile);

const PRISMA_BIN = path.join(
  SERVER_DIR,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "prisma.cmd" : "prisma",
);

/**
 * Run the real Prisma CLI against a given database URL.
 *
 * Deliberately asynchronous: the CLI takes a second or two per call and this
 * suite shares one Vitest worker with every other suite in the project, so
 * blocking the event loop is not worth the risk of perturbing their timing.
 */
async function prismaCli(args: string[], databaseUrl: string): Promise<string> {
  const { stdout } = await execFileAsync(PRISMA_BIN, args, {
    cwd: SERVER_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

function migrationNames(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((entry) => /^\d{14}_/.test(entry))
    .sort();
}

// ─── Lab 1–3 column inventory ────────────────────────────────────────────
// Every column that exists on the shared tables BEFORE this branch. If the Lab 4
// migration dropped, renamed, or retyped any of them, the comparison below
// fails — which is exactly the "zero data loss / additive only" claim that
// §7.5(1) makes and that a reviewer cannot check by eye.

const LAB3_COLUMNS: Record<string, string[]> = {
  Category: ["id", "name", "isActive", "createdAt"],
  RelatedSystem: ["id", "name", "isActive"],
  User: [
    "id",
    "name",
    "email",
    "passwordHash",
    "role",
    "isActive",
    "mustChangePassword",
    "createdAt",
    "updatedAt",
  ],
  Ticket: [
    "id",
    "ticketNumber",
    "requesterId",
    "ownerId",
    "categoryId",
    "relatedSystemId",
    "summary",
    "description",
    "requestedPriority",
    "itPriority",
    "status",
    "requesterMarkedResolved",
    "requesterMarkedResolvedAt",
    "resolutionSummary",
    "createdAt",
    "updatedAt",
  ],
  PublicComment: ["id", "ticketId", "authorId", "content", "createdAt"],
  InternalNote: ["id", "ticketId", "authorId", "content", "createdAt"],
  Attachment: [
    "id",
    "ticketId",
    "originalFileName",
    "storedFileName",
    "mimeType",
    "fileSizeBytes",
    "uploadedByRequesterId",
    "uploadedAt",
    "isRemoved",
    "removedAt",
    "removedReason",
    "removedByRequesterId",
  ],
};

/** `data_type|is_nullable` for "Ticket" — the one table this migration alters. */
const TICKET_LAB3_TYPES: Record<string, string> = {
  id: "integer|NO",
  ticketNumber: "text|NO",
  requesterId: "text|NO",
  ownerId: "text|YES",
  categoryId: "integer|NO",
  relatedSystemId: "integer|NO",
  summary: "text|NO",
  description: "text|NO",
  requestedPriority: "USER-DEFINED|NO",
  itPriority: "USER-DEFINED|NO",
  status: "USER-DEFINED|NO",
  requesterMarkedResolved: "boolean|NO",
  requesterMarkedResolvedAt: "timestamp without time zone|YES",
  resolutionSummary: "text|YES",
  createdAt: "timestamp without time zone|NO",
  updatedAt: "timestamp without time zone|NO",
};

// ─── Lab 3-shaped fixture (no Lab 4 column is named anywhere below) ──────
// The explicit column lists ARE the test: a Lab 3 database could only ever have
// written these columns, so if the Lab 4 migration made any of them mandatory or
// non-defaulted, these INSERTs are what would fail.

const LEGACY_TICKET = "TKT-2026-LAB4MIG01";
const LEGACY_TICKET_2 = "TKT-2026-LAB4MIG02";
const LEGACY_REQUESTER_ID = "lab4-mig01-requester";
const LEGACY_STAFF_ID = "lab4-mig01-staff";

const LAB3_SHAPED_SQL = `
INSERT INTO "Category" ("name", "isActive") VALUES ('Hardware', true);
INSERT INTO "RelatedSystem" ("name", "isActive") VALUES ('Corporate Laptop', true);

INSERT INTO "User" ("id", "name", "email", "passwordHash", "role", "isActive", "mustChangePassword", "createdAt", "updatedAt")
VALUES
  ('${LEGACY_REQUESTER_ID}', 'Migrated Requester', 'lab4.mig01.requester@test.local', '!unhashed-migrated-placeholder', 'REQUESTER', true, true, '2026-08-15T09:00:00.000Z', '2026-08-15T09:00:00.000Z'),
  ('${LEGACY_STAFF_ID}', 'Migrated Staff', 'lab4.mig01.staff@test.local', '!unhashed-migrated-placeholder', 'IT_STAFF', true, true, '2026-08-15T09:05:00.000Z', '2026-08-15T09:05:00.000Z');

INSERT INTO "Ticket" ("ticketNumber", "requesterId", "ownerId", "categoryId", "relatedSystemId", "summary", "description", "requestedPriority", "itPriority", "status", "requesterMarkedResolved", "requesterMarkedResolvedAt", "resolutionSummary", "createdAt", "updatedAt")
SELECT '${LEGACY_TICKET}', '${LEGACY_REQUESTER_ID}', '${LEGACY_STAFF_ID}', c."id", r."id",
       'Pre-Lab-4 ticket summary', 'A ticket that existed before the Lab 4 migration ran.',
       'HIGH', 'HIGH', 'IN_PROGRESS', true, '2026-08-15T10:00:00.000Z', NULL,
       '2026-08-15T09:30:00.000Z', '2026-08-15T09:30:00.000Z'
FROM "Category" c, "RelatedSystem" r
WHERE c."name" = 'Hardware' AND r."name" = 'Corporate Laptop';

INSERT INTO "Ticket" ("ticketNumber", "requesterId", "ownerId", "categoryId", "relatedSystemId", "summary", "description", "requestedPriority", "itPriority", "status", "requesterMarkedResolved", "requesterMarkedResolvedAt", "resolutionSummary", "createdAt", "updatedAt")
SELECT '${LEGACY_TICKET_2}', '${LEGACY_REQUESTER_ID}', NULL, c."id", r."id",
       'Pre-Lab-4 ticket summary (unassigned)', 'A second pre-existing ticket with no Ticket Owner.',
       'LOW', 'LOW', 'NEW', false, NULL, NULL,
       '2026-08-15T09:40:00.000Z', '2026-08-15T09:40:00.000Z'
FROM "Category" c, "RelatedSystem" r
WHERE c."name" = 'Hardware' AND r."name" = 'Corporate Laptop';

INSERT INTO "PublicComment" ("id", "ticketId", "authorId", "content", "createdAt")
SELECT 'lab4-mig01-comment-1', t."id", '${LEGACY_STAFF_ID}', 'Pre-existing public comment.', '2026-08-15T09:45:00.000Z'
FROM "Ticket" t WHERE t."ticketNumber" = '${LEGACY_TICKET}';

INSERT INTO "InternalNote" ("id", "ticketId", "authorId", "content", "createdAt")
SELECT 'lab4-mig01-note-1', t."id", '${LEGACY_STAFF_ID}', 'Pre-existing internal note.', '2026-08-15T09:50:00.000Z'
FROM "Ticket" t WHERE t."ticketNumber" = '${LEGACY_TICKET}';

INSERT INTO "Attachment" ("ticketId", "originalFileName", "storedFileName", "mimeType", "fileSizeBytes", "uploadedByRequesterId", "uploadedAt")
SELECT t."id", 'pre-lab4-note.txt', 'lab4-mig01-pre-lab4-note.txt', 'text/plain', 42, '${LEGACY_REQUESTER_ID}', '2026-08-15T09:55:00.000Z'
FROM "Ticket" t WHERE t."ticketNumber" = '${LEGACY_TICKET}';
`;

const LEGACY_TICKET_SELECT = `
SELECT "id", "ticketNumber", "requesterId", "ownerId", "categoryId", "relatedSystemId",
       "summary", "description", "requestedPriority"::text AS "requestedPriority",
       "itPriority"::text AS "itPriority", "status"::text AS "status",
       "requesterMarkedResolved", "requesterMarkedResolvedAt", "resolutionSummary",
       "createdAt", "updatedAt"
FROM "Ticket" WHERE "ticketNumber" = '${LEGACY_TICKET}'
`;

const PEER_TABLES = [
  "Category",
  "RelatedSystem",
  "User",
  "Ticket",
  "PublicComment",
  "InternalNote",
  "Attachment",
] as const;

async function peerCounts(client: PrismaClient): Promise<Record<string, number>> {
  const entries = await Promise.all(
    PEER_TABLES.map(async (table) => {
      const rows = await client.$queryRawUnsafe<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM "${table}"`,
      );
      return [table, rows[0].count] as const;
    }),
  );
  return Object.fromEntries(entries);
}

// ─── MIGRATION-01 ────────────────────────────────────────────────────────
// specification.md §7.5(1): "Additive migration only ... the migration is
// backward-compatible and requires no destructive column changes to `Ticket`."

describe("MIGRATION-01 — Lab 4 migration applied to a Lab 3-shaped database", () => {
  let scratchDir: string;
  let scratchUrl: string;
  let scratch: PrismaClient;
  let legacyMigrations: string[];
  const scratchSchema = `lab4_mig01_${process.pid}_${Date.now()}`;

  let countsBefore: Record<string, number>;
  let ticketBefore: unknown;
  let peersBefore: Record<string, Record<string, string>>;

  beforeAll(async () => {
    legacyMigrations = migrationNames().filter((name) => !name.includes(LAB4_MIGRATION_MARKER));
    expect(legacyMigrations.length).toBeGreaterThan(0);

    // A private schema plus a copy of the migrations as they stood before this
    // branch: deploying this copy reproduces a Lab 3 production database.
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab4-migration-"));
    const deployMigrations = path.join(scratchDir, "migrations");
    fs.mkdirSync(deployMigrations);
    fs.copyFileSync(
      path.join(MIGRATIONS_DIR, "migration_lock.toml"),
      path.join(deployMigrations, "migration_lock.toml"),
    );
    for (const name of legacyMigrations) {
      fs.cpSync(path.join(MIGRATIONS_DIR, name), path.join(deployMigrations, name), {
        recursive: true,
      });
    }
    fs.copyFileSync(SCHEMA_FILE, path.join(scratchDir, "schema.prisma"));

    // `connection_limit=1`: this client only ever serves a handful of forensic
    // queries, and keeping its pool at one connection avoids stacking a second
    // pool against the developer's Postgres instance during the test run.
    scratchUrl = `${withSchema(readDatabaseUrl(), scratchSchema)}&connection_limit=1`;
    const scratchSchemaFile = path.join(scratchDir, "schema.prisma");

    // 1. Bring the scratch schema up to the Lab 3 revision only.
    await prismaCli(["migrate", "deploy", "--schema", scratchSchemaFile], scratchUrl);

    // 2. Populate it the way a Lab 3 database looks in production.
    const fixtureFile = path.join(scratchDir, "lab3-fixture.sql");
    fs.writeFileSync(fixtureFile, LAB3_SHAPED_SQL);
    await prismaCli(
      ["db", "execute", "--file", fixtureFile, "--schema", scratchSchemaFile],
      scratchUrl,
    );

    scratch = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
    countsBefore = await peerCounts(scratch);
    ticketBefore = await scratch.$queryRawUnsafe(LEGACY_TICKET_SELECT);
    peersBefore = await readColumnTypes(scratch);

    // 3. Now deploy the migration under test on top, exactly as a real upgrade
    //    would: the only thing that changes is that one new migration directory
    //    appears, so Prisma applies the new migration alone.
    const lab4Migration = migrationNames().find((name) => name.includes(LAB4_MIGRATION_MARKER));
    expect(lab4Migration).toBeDefined();
    fs.cpSync(
      path.join(MIGRATIONS_DIR, lab4Migration!),
      path.join(deployMigrations, lab4Migration!),
      { recursive: true },
    );
    await prismaCli(["migrate", "deploy", "--schema", scratchSchemaFile], scratchUrl);
  }, 300_000);

  afterAll(async () => {
    await scratch?.$disconnect();

    // Drop the private schema so nothing is left behind in the developer's DB.
    const dropFile = path.join(scratchDir, "drop.sql");
    fs.writeFileSync(dropFile, `DROP SCHEMA IF EXISTS "${scratchSchema}" CASCADE;\n`);
    await prismaCli(
      ["db", "execute", "--file", dropFile, "--schema", SCHEMA_FILE],
      withSchema(readDatabaseUrl(), "public"),
    );
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }, 120_000);

  it("applies the Lab 4 migration as the newest entry in an otherwise unchanged history", async () => {
    const history = await scratch.$queryRawUnsafe<
      { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
    >(`SELECT "migration_name", "finished_at", "rolled_back_at" FROM "_prisma_migrations" ORDER BY "started_at"`);

    expect(history).toHaveLength(legacyMigrations.length + 1);
    expect(history.map((row) => row.migration_name)).toEqual([
      ...legacyMigrations,
      expect.stringContaining(LAB4_MIGRATION_MARKER),
    ]);

    // Every migration — including the Lab 1–3 ones — finished and none was
    // rolled back: the new migration did not rewrite or "reset" history.
    for (const row of history) {
      expect(row.finished_at).not.toBeNull();
      expect(row.rolled_back_at).toBeNull();
    }
  });

  it("loses no row from any pre-existing table", async () => {
    const countsAfter = await peerCounts(scratch);

    expect(countsAfter).toEqual(countsBefore);
    for (const table of PEER_TABLES) {
      expect(countsAfter[table]).toBeGreaterThan(0);
    }
  });

  it("keeps every pre-existing Ticket value byte-for-byte identical", async () => {
    const ticketAfter = await scratch.$queryRawUnsafe(LEGACY_TICKET_SELECT);

    expect(ticketAfter).toEqual(ticketBefore);
  });

  it("keeps every pre-existing Public Comment, Internal Note and Attachment readable", async () => {
    const [comment] = await scratch.$queryRawUnsafe<{ content: string }[]>(
      `SELECT "content" FROM "PublicComment" WHERE "id" = 'lab4-mig01-comment-1'`,
    );
    const [note] = await scratch.$queryRawUnsafe<{ content: string }[]>(
      `SELECT "content" FROM "InternalNote" WHERE "id" = 'lab4-mig01-note-1'`,
    );
    const [attachment] = await scratch.$queryRawUnsafe<{ storedFileName: string }[]>(
      `SELECT "storedFileName" FROM "Attachment" WHERE "storedFileName" = 'lab4-mig01-pre-lab4-note.txt'`,
    );

    expect(comment.content).toBe("Pre-existing public comment.");
    expect(note.content).toBe("Pre-existing internal note.");
    expect(attachment.storedFileName).toBe("lab4-mig01-pre-lab4-note.txt");
  });

  it("drops or alters no Lab 1–3 column on any shared table", async () => {
    const peersAfter = await readColumnTypes(scratch);

    for (const [table, columns] of Object.entries(LAB3_COLUMNS)) {
      const present = Object.keys(peersAfter[table] ?? {});
      for (const column of columns) {
        expect(present, `${table}.${column} must still exist`).toContain(column);
      }
    }

    // "Ticket" is the only altered table, so its types/nullability are compared
    // exactly: adding a column is allowed, changing an existing one is not.
    const ticketAfter = peersAfter.Ticket;
    for (const [column, expected] of Object.entries(TICKET_LAB3_TYPES)) {
      expect(ticketAfter[column], `Ticket.${column} must be unchanged`).toBe(expected);
    }
    for (const [column, before] of Object.entries(peersBefore.Ticket)) {
      if (!LAB4_TICKET_COLUMNS.includes(column)) {
        expect(ticketAfter[column]).toBe(before);
      }
    }
  });

  it("adds exactly the four §7.2 Ticket columns, each nullable or defaulted", async () => {
    const additions = await scratch.$queryRawUnsafe<
      { column_name: string; is_nullable: string; column_default: string | null }[]
    >(
      `SELECT "column_name", "is_nullable", "column_default" FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'Ticket' AND "column_name" = ANY($1)
       ORDER BY "column_name"`,
      LAB4_TICKET_COLUMNS,
    );

    expect(additions.map((row) => row.column_name).sort()).toEqual([...LAB4_TICKET_COLUMNS].sort());

    const byName = Object.fromEntries(additions.map((row) => [row.column_name, row]));
    // §7.2: BR-08's flag and BR-12's token default; both timestamps are nullable.
    expect(byName.requesterConfirmedResolved).toMatchObject({ is_nullable: "NO" });
    expect(byName.requesterConfirmedResolved.column_default).toBe("false");
    expect(byName.version).toMatchObject({ is_nullable: "NO" });
    expect(byName.version.column_default).toBe("0");
    expect(byName.requesterConfirmedResolvedAt).toMatchObject({ is_nullable: "YES" });
    expect(byName.resolvedAt).toMatchObject({ is_nullable: "YES" });
  });

  it("creates the two §7.1/§7.3 tables empty and still accepts a Lab 3-shaped INSERT", async () => {
    for (const table of LAB4_TABLES) {
      const rows = await scratch.$queryRawUnsafe<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM "${table}"`,
      );
      expect(rows[0].count).toBe(0);
    }

    // A write that names no Lab 4 column — the shape every pre-Lab-4 code path
    // still emits — must keep working after the migration.
    await scratch.$executeRawUnsafe(`
      INSERT INTO "Ticket" ("ticketNumber", "requesterId", "ownerId", "categoryId", "relatedSystemId", "summary", "description", "requestedPriority", "itPriority", "status", "requesterMarkedResolved", "createdAt", "updatedAt")
      SELECT 'TKT-2026-LAB4MIG03', '${LEGACY_REQUESTER_ID}', NULL, c."id", r."id",
             'Post-migration legacy-shaped insert', 'Written with Lab 3 columns only.',
             'LOW', 'LOW', 'NEW', false, now(), now()
      FROM "Category" c, "RelatedSystem" r
      WHERE c."name" = 'Hardware' AND r."name" = 'Corporate Laptop'
    `);

    const [inserted] = await scratch.$queryRawUnsafe<
      {
        requesterConfirmedResolved: boolean;
        requesterConfirmedResolvedAt: Date | null;
        resolvedAt: Date | null;
        version: number;
      }[]
    >(
      `SELECT "requesterConfirmedResolved", "requesterConfirmedResolvedAt", "resolvedAt", "version"
       FROM "Ticket" WHERE "ticketNumber" = 'TKT-2026-LAB4MIG03'`,
    );

    // §7.2 defaults apply to a legacy-shaped write without any help from Prisma.
    expect(inserted).toEqual({
      requesterConfirmedResolved: false,
      requesterConfirmedResolvedAt: null,
      resolvedAt: null,
      version: 0,
    });
  });
});

/** `table → { column: "data_type|is_nullable" }` for the shared schema. */
async function readColumnTypes(
  client: PrismaClient,
): Promise<Record<string, Record<string, string>>> {
  const rows = await client.$queryRawUnsafe<
    { table_name: string; column_name: string; data_type: string; is_nullable: string }[]
  >(
    `SELECT "table_name", "column_name", "data_type", "is_nullable"
     FROM information_schema.columns
     WHERE table_schema = current_schema() AND "table_name" = ANY($1)`,
    [...PEER_TABLES],
  );

  const result: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    result[row.table_name] ??= {};
    result[row.table_name][row.column_name] = `${row.data_type}|${row.is_nullable}`;
  }
  return result;
}

// ─── MIGRATION-02 ────────────────────────────────────────────────────────
// specification.md §7.5(2): "Legacy Tickets with zero Actions Taken are valid
// and expected ... BR-09's resolution gate applies going forward only."

describe("MIGRATION-02 — legacy Ticket with zero Actions Taken", () => {
  let requester: TestUser;
  let legacyTicketId: number;
  let legacyTicketNumber: string;
  let categoryId: number;
  let relatedSystemId: number;

  beforeAll(async () => {
    requester = await createTestUser({ name: "Post-Migration Legacy Requester" });

    const [category] = await prisma.$queryRaw<{ id: number }[]>`
      SELECT "id" FROM "Category" WHERE "isActive" = true ORDER BY "id" LIMIT 1
    `;
    const [relatedSystem] = await prisma.$queryRaw<{ id: number }[]>`
      SELECT "id" FROM "RelatedSystem" WHERE "isActive" = true ORDER BY "id" LIMIT 1
    `;
    categoryId = category.id;
    relatedSystemId = relatedSystem.id;

    // Written with Lab 3 columns only, to model a Ticket that predates this
    // migration (a real one would have been created by the Lab 2/3 API).
    legacyTicketNumber = `TKT-2026-LAB4MIG02-${Date.now()}`;
    const [ticket] = await prisma.$queryRaw<{ id: number }[]>`
      INSERT INTO "Ticket" ("ticketNumber", "requesterId", "categoryId", "relatedSystemId", "summary", "description", "requestedPriority", "itPriority", "status", "requesterMarkedResolved", "createdAt", "updatedAt")
      VALUES (${legacyTicketNumber}, ${requester.id}, ${categoryId}, ${relatedSystemId},
              'Legacy ticket with no Actions Taken',
              'Created before Lab 4 and therefore has no Actions Taken rows at all.',
              ${"MEDIUM"}::"RequestedPriority", ${"HIGH"}::"ItPriority", ${"NEW"}::"TicketStatus",
              false, now(), now())
      RETURNING "id"
    `;
    legacyTicketId = ticket.id;
  });

  afterAll(async () => {
    await cleanupTestUsers([requester.id]);
    await prisma.$disconnect();
  });

  it("queries the legacy Ticket and its empty Actions Taken relation normally", async () => {
    const ticket = await prisma.ticket.findUnique({
      where: { id: legacyTicketId },
      include: { actionsTaken: true, statusHistory: true },
    });

    expect(ticket).not.toBeNull();
    expect(ticket!.ticketNumber).toBe(legacyTicketNumber);
    expect(ticket!.actionsTaken).toEqual([]);
    expect(ticket!.statusHistory).toEqual([]);
  });

  it("exposes the documented defaults for the four new columns", async () => {
    const ticket = await prisma.ticket.findUnique({
      where: { id: legacyTicketId },
      select: {
        requesterConfirmedResolved: true,
        requesterConfirmedResolvedAt: true,
        resolvedAt: true,
        version: true,
      },
    });

    expect(ticket).toEqual({
      requesterConfirmedResolved: false,
      requesterConfirmedResolvedAt: null,
      resolvedAt: null,
      version: 0,
    });
  });

  it("still counts the legacy Ticket in the open-work dashboard queries", async () => {
    // The dashboard aggregates read Ticket + ActionTaken live (BR-13); a Ticket
    // with no Actions Taken must neither be skipped nor break the join.
    const [counted] = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "Ticket" t
      LEFT JOIN "ActionTaken" a ON a."ticketId" = t."id"
      WHERE t."id" = ${legacyTicketId}
        AND t."status"::text IN ('NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_REQUESTER', 'REOPENED')
    `;
    expect(counted.count).toBe(1);

    const [gate] = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "ActionTaken"
      WHERE "ticketId" = ${legacyTicketId}
        AND "isVoided" = false
        AND length("result") > 0
    `;
    // BR-09's precondition is genuinely unmet for this Ticket — which is a valid
    // state, not an error: the gate only blocks RESOLVED, nothing else.
    expect(gate.count).toBe(0);
  });

  it("is not blocked from any transition that BR-09 does not gate", () => {
    expect(allowedStatusTransitions("NEW")).toEqual(["OPEN", "IN_PROGRESS", "CANCELLED"]);
    for (const target of allowedStatusTransitions("NEW")) {
      expect(isTransitionAllowed("NEW", target)).toBe(true);
    }
    // RESOLVED is reachable from NEW in §5.1 only via IN_PROGRESS; the BR-09
    // gate adds the Actions Taken precondition on top, exactly as documented.
    expect(isTransitionAllowed("NEW", "RESOLVED")).toBe(false);
  });
});

// ─── MIGRATION-03 ────────────────────────────────────────────────────────
// specification.md §7.6: "Idempotent seed script (upsert keyed by stable
// business keys, safe to re-run)."

describe("MIGRATION-03 — seed script run twice", () => {
  it("re-runs with no error and identical row counts in every table", async () => {
    await seed();

    const afterFirst = await allTableCounts();
    await seed();
    const afterSecond = await allTableCounts();

    expect(afterSecond).toEqual(afterFirst);
    expect(afterSecond.tickets).toBeGreaterThan(0);
    expect(afterSecond.actionsTaken).toBeGreaterThan(0);
    expect(afterSecond.statusHistory).toBeGreaterThan(0);
  }, 120_000);

  it("leaves no duplicate business key or duplicated work-log entry behind", async () => {
    const duplicateEmails = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM (
        SELECT "email" FROM "User" GROUP BY "email" HAVING count(*) > 1
      ) dupes
    `;
    const duplicateTicketNumbers = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM (
        SELECT "ticketNumber" FROM "Ticket" GROUP BY "ticketNumber" HAVING count(*) > 1
      ) dupes
    `;
    // The two new tables must be keyed on something stable too — a re-run that
    // appended fresh cuid rows instead of upserting would show up here.
    const duplicateActions = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM (
        SELECT "ticketId", "actionDateTime", "description" FROM "ActionTaken"
        GROUP BY "ticketId", "actionDateTime", "description" HAVING count(*) > 1
      ) dupes
    `;
    const duplicateHistory = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM (
        SELECT "ticketId", "fromStatus", "toStatus", "changedById" FROM "TicketStatusHistory"
        GROUP BY "ticketId", "fromStatus", "toStatus", "changedById" HAVING count(*) > 1
      ) dupes
    `;

    expect(duplicateEmails[0].count).toBe(0);
    expect(duplicateTicketNumbers[0].count).toBe(0);
    expect(duplicateActions[0].count).toBe(0);
    expect(duplicateHistory[0].count).toBe(0);
  });
});

// ─── Seeded volume for §7.6 / dashboard metrics ───────────────────────────
// Not a new test ID: this is MIGRATION-03's data set, asserted against the
// §7.6 requirements (and §7.6 alone) so a seed regression cannot silently empty
// out a dashboard card the Lab 4 dashboards depend on.

describe("MIGRATION-03 — seeded volume satisfies specification.md §7.6", () => {
  it("covers every status in §5.1's canonical set", async () => {
    const grouped = await prisma.ticket.groupBy({ by: ["status"] });
    const statuses = grouped.map((row) => row.status);

    expect(new Set(statuses)).toEqual(
      new Set([
        "NEW",
        "OPEN",
        "IN_PROGRESS",
        "WAITING_FOR_REQUESTER",
        "RESOLVED",
        "CLOSED",
        "REOPENED",
        "CANCELLED",
      ]),
    );
  });

  it("covers assigned and unassigned Tickets and every IT priority value", async () => {
    const assigned = await prisma.ticket.count({ where: { ownerId: { not: null } } });
    const unassigned = await prisma.ticket.count({ where: { ownerId: null } });
    const priorities = (await prisma.ticket.groupBy({ by: ["itPriority"] })).map(
      (row) => row.itPriority,
    );

    expect(assigned).toBeGreaterThan(0);
    expect(unassigned).toBeGreaterThan(0);
    expect(new Set(priorities)).toEqual(new Set(["LOW", "MEDIUM", "HIGH", "URGENT"]));
  });

  it("provides Tickets with zero, exactly one, and multiple Actions Taken", async () => {
    const tickets = await prisma.ticket.findMany({
      select: { _count: { select: { actionsTaken: true } } },
    });
    const counts = tickets.map((ticket) => ticket._count.actionsTaken);

    expect(counts).toContain(0);
    expect(counts).toContain(1);
    expect(counts.some((count) => count > 1)).toBe(true);
  });

  it("includes a follow-up entry with its note and a voided entry with its reason", async () => {
    const followUp = await prisma.actionTaken.findMany({
      where: { followUpRequired: true },
      select: { followUpNote: true },
    });
    expect(followUp.length).toBeGreaterThan(0);
    for (const entry of followUp) {
      // BR-05: followUpRequired = true requires a non-empty followUpNote.
      expect(entry.followUpNote?.trim().length ?? 0).toBeGreaterThanOrEqual(3);
    }

    const voided = await prisma.actionTaken.findMany({
      where: { isVoided: true },
      select: { voidReason: true },
    });
    expect(voided.length).toBeGreaterThan(0);
    for (const entry of voided) {
      // §7.1: voidReason is required iff isVoided = true.
      expect(entry.voidReason?.trim().length ?? 0).toBeGreaterThanOrEqual(3);
    }
  });

  it("backdates TicketStatusHistory rows so the live 24h deltas are not all zero", async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await prisma.ticketStatusHistory.count({ where: { changedAt: { gte: since } } });

    expect(recent).toBeGreaterThan(0);
  });

  it("gives every Requester Dashboard card a non-zero value for the demo Requester", async () => {
    const jennifer = await prisma.user.findUniqueOrThrow({
      where: { email: "jennifer.anderson@example.com" },
      select: { id: true },
    });

    const own = { requesterId: jennifer.id };
    const [myOpen, inProgress, resolved, closed] = await Promise.all([
      // api-spec.md §3.2: myOpen excludes InProgress, which has its own card.
      prisma.ticket.count({
        where: {
          ...own,
          status: { in: ["NEW", "OPEN", "WAITING_FOR_REQUESTER", "REOPENED"] },
        },
      }),
      prisma.ticket.count({ where: { ...own, status: "IN_PROGRESS" } }),
      prisma.ticket.count({ where: { ...own, status: "RESOLVED" } }),
      prisma.ticket.count({ where: { ...own, status: "CLOSED" } }),
    ]);

    expect(myOpen).toBeGreaterThan(0);
    expect(inProgress).toBeGreaterThan(0);
    expect(resolved).toBeGreaterThan(0);
    expect(closed).toBeGreaterThan(0);
    // BR-14: Reopened Tickets count toward My Open, Cancelled ones never do.
    const reopened = await prisma.ticket.count({
      where: { ...own, status: "REOPENED" },
    });
    expect(reopened).toBeGreaterThan(0);
  });

  it("gives every IT Staff Dashboard card a non-zero whole-queue value", async () => {
    const [newCount, open, inProgress, waiting] = await Promise.all([
      prisma.ticket.count({ where: { status: "NEW" } }),
      prisma.ticket.count({ where: { status: "OPEN" } }),
      // §3.1: Reopened is folded into the In Progress card (BR-14).
      prisma.ticket.count({ where: { status: { in: ["IN_PROGRESS", "REOPENED"] } } }),
      prisma.ticket.count({ where: { status: "WAITING_FOR_REQUESTER" } }),
    ]);

    expect(newCount).toBeGreaterThan(0);
    expect(open).toBeGreaterThan(0);
    expect(inProgress).toBeGreaterThan(0);
    expect(waiting).toBeGreaterThan(0);

    // "My Assigned" is asserted for a real IT Staff demo account so the seeded
    // data cannot cover the whole-queue cards while leaving a staff member with
    // an empty personal card.
    const alice = await prisma.user.findUniqueOrThrow({
      where: { email: "alice.chen@toktickit.example.com" },
      select: { id: true },
    });
    const myAssigned = await prisma.ticket.count({
      where: {
        ownerId: alice.id,
        status: { in: ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"] },
      },
    });
    expect(myAssigned).toBeGreaterThan(0);
  });

  it("leaves at least one seeded Requester with a legitimate zero-state card", async () => {
    const sarah = await prisma.user.findUniqueOrThrow({
      where: { email: "sarah.johnson@example.com" },
      select: { id: true },
    });

    const own = { requesterId: sarah.id };
    const [myOpen, inProgress, resolved] = await Promise.all([
      prisma.ticket.count({
        where: { ...own, status: { in: ["NEW", "OPEN", "WAITING_FOR_REQUESTER", "REOPENED"] } },
      }),
      prisma.ticket.count({ where: { ...own, status: "IN_PROGRESS" } }),
      prisma.ticket.count({ where: { ...own, status: "RESOLVED" } }),
    ]);

    // My Open and Closed are non-zero; the other two cards are a real zero
    // (AC-10's empty state), not missing data.
    expect(myOpen).toBeGreaterThan(0);
    expect(inProgress).toBe(0);
    expect(resolved).toBe(0);
  });
});

async function allTableCounts() {
  const [
    users,
    tickets,
    publicComments,
    internalNotes,
    attachments,
    categories,
    relatedSystems,
    actionsTaken,
    statusHistory,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.ticket.count(),
    prisma.publicComment.count(),
    prisma.internalNote.count(),
    prisma.attachment.count(),
    prisma.category.count(),
    prisma.relatedSystem.count(),
    prisma.actionTaken.count(),
    prisma.ticketStatusHistory.count(),
  ]);

  return {
    users,
    tickets,
    publicComments,
    internalNotes,
    attachments,
    categories,
    relatedSystems,
    actionsTaken,
    statusHistory,
  };
}
