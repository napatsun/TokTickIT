-- Lab 3 — IT Staff ticketing (FR-22, BR-04, BR-16/17/18)
--
-- Adds "InternalNote": the IT-Staff/Administrator-only counterpart to
-- "PublicComment". Internal Notes are append-only and must never be visible to
-- a Requester, so they live in their own table rather than being tagged rows in
-- "PublicComment" — that way no Requester-facing query can include one by
-- accident, and BR-04 is provable at the schema level.
--
-- DATA-SAFETY REVIEW (deliberately no destructive statements):
--   * CREATE TABLE "InternalNote" only — a brand-new table that no prior
--     branch ever created, so there is nothing to migrate or backfill.
--   * The two ADD CONSTRAINT statements add new FOREIGN KEYs from the NEW
--     table to "Ticket"("id") and "User"("id"). They do not alter, rewrite, or
--     re-validate any existing Ticket / Attachment / User / PublicComment row,
--     and because the new table starts empty there is no possible violation.
--   * No ALTER TABLE ... DROP, no column type change, no NOT NULL added to an
--     existing column. Existing Tickets, Attachments, Users, and Public
--     Comments keep every value they had before this migration.
--   * ON DELETE RESTRICT matches the rest of the schema: a Ticket or User that
--     still has notes cannot be hard-deleted (BR-22 keeps authorship intact).

-- ─── 1. InternalNote ────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "InternalNote" (
    "id" TEXT NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InternalNote_ticketId_createdAt_idx" ON "InternalNote"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
