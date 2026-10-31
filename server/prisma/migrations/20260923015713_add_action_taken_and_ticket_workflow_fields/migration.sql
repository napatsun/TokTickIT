-- Lab 4 — Actions Taken + Ticket workflow fields (specification.md §7.1–§7.4, §7.5)
--
-- Adds:
--   * "ActionTaken"          — new table (§7.1), the durable record of work performed.
--   * "TicketStatusHistory"  — new table (§7.3), append-only status-transition audit trail
--                              that also backs the live dashboard delta queries (BR-13).
--   * 4 columns on "Ticket"  — requesterConfirmedResolved, requesterConfirmedResolvedAt,
--                              resolvedAt, version (§7.2).
--
-- DATA-SAFETY REVIEW (additive only — deliberately no destructive statements):
--   * Every new "Ticket" column is nullable (requesterConfirmedResolvedAt, resolvedAt) or
--     has a constant default (requesterConfirmedResolved DEFAULT false,
--     version DEFAULT 0), which is the §7.5(1) requirement. On PostgreSQL 11+ ADD COLUMN
--     with a non-volatile DEFAULT is a catalog-only change: existing rows are not rewritten,
--     no existing value is read or modified, and a Lab 3 row that omits all four columns
--     still inserts successfully.
--   * Both new tables start empty, so the two FOREIGN KEYs that point at "Ticket"("id") and
--     "User"("id") cannot violate anything and re-validate no existing row.
--   * No DROP TABLE, no DROP COLUMN, no ALTER COLUMN ... TYPE, no SET NOT NULL, and no index
--     is dropped, so every Lab 1–3 Ticket / User / PublicComment / InternalNote / Attachment
--     row keeps every value it had before this migration (AC-12, MIGRATION-01).
--   * ON DELETE RESTRICT matches the rest of the schema and keeps the audit trail intact
--     (BR-01, BR-11): a Ticket or User that still has Actions Taken / history rows cannot be
--     hard-deleted.
--
-- ROLLBACK PLAN (specification.md §7.5(3)):
--   This is a single additive migration, so no rollback is expected to be needed; if one is
--   ever required, roll back in this order against a copy of the seeded database first, never
--   against a shared environment directly:
--     1. Mark the migration as rolled back in Prisma's history so later `migrate deploy` runs
--        can re-apply it cleanly:
--            npx prisma migrate resolve --rolled-back 20260923015713_add_action_taken_and_ticket_workflow_fields
--     2. Apply a compensating migration that drops exactly what this one added:
--            DROP TABLE "ActionTaken";
--            DROP TABLE "TicketStatusHistory";
--            ALTER TABLE "Ticket" DROP COLUMN "requesterConfirmedResolved";
--            ALTER TABLE "Ticket" DROP COLUMN "requesterConfirmedResolvedAt";
--            ALTER TABLE "Ticket" DROP COLUMN "resolvedAt";
--            ALTER TABLE "Ticket" DROP COLUMN "version";
--        (dropping the two tables also drops their indexes and foreign keys, so no separate
--        DROP INDEX / DROP CONSTRAINT statements are required)
--     3. Data-loss note: step 2 discards any Actions Taken / status-history rows recorded
--        after this migration was deployed, and resets `version` to 0 — export or archive
--        those two tables before running it. No Lab 1–3 column or row is touched by either step.
--     4. Re-verify the rollback by re-running the Lab 2/3 regression suites against the rolled
--        back database before restoring forward.

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "requesterConfirmedResolved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requesterConfirmedResolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ActionTaken" (
    "id" TEXT NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "actionDateTime" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "performedById" TEXT NOT NULL,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "followUpNote" TEXT,
    "attachmentNotes" TEXT,
    "isVoided" BOOLEAN NOT NULL DEFAULT false,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "editedById" TEXT,

    CONSTRAINT "ActionTaken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketStatusHistory" (
    "id" TEXT NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "fromStatus" "TicketStatus" NOT NULL,
    "toStatus" "TicketStatus" NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "TicketStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionTaken_ticketId_actionDateTime_idx" ON "ActionTaken"("ticketId", "actionDateTime");

-- CreateIndex
CREATE INDEX "ActionTaken_performedById_idx" ON "ActionTaken"("performedById");

-- CreateIndex
CREATE INDEX "TicketStatusHistory_ticketId_changedAt_idx" ON "TicketStatusHistory"("ticketId", "changedAt");

-- CreateIndex
CREATE INDEX "TicketStatusHistory_toStatus_changedAt_idx" ON "TicketStatusHistory"("toStatus", "changedAt");

-- CreateIndex
CREATE INDEX "TicketStatusHistory_fromStatus_changedAt_idx" ON "TicketStatusHistory"("fromStatus", "changedAt");

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStatusHistory" ADD CONSTRAINT "TicketStatusHistory_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStatusHistory" ADD CONSTRAINT "TicketStatusHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
