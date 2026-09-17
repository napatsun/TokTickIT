-- Lab 3 — Users, Roles, Authorization (specification.md §7.1 / §7.2)
--
-- This migration is deliberately hand-written instead of generated: Prisma's
-- generated SQL would DROP and re-create the Ticket/Attachment requester
-- columns, destroying Lab 2 data. Instead every existing row is re-pointed
-- from DevRequester.id to the matching User.id (matched by email), so all
-- pre-existing Tickets/Attachments remain queryable and correctly owned
-- (BR-27 / AC-16).

-- ─── CreateEnum ─────────────────────────────────────────────────────────

CREATE TYPE "Role" AS ENUM ('REQUESTER', 'IT_STAFF', 'ADMINISTRATOR');

CREATE TYPE "TicketStatus" AS ENUM (
  'NEW',
  'OPEN',
  'IN_PROGRESS',
  'WAITING_FOR_REQUESTER',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
  'CANCELLED'
);

-- api-spec.md §3: IT Priority admits URGENT in addition to LOW/MEDIUM/HIGH.
ALTER TYPE "ItPriority" ADD VALUE 'URGENT';

-- ─── CreateTable: User ──────────────────────────────────────────────────

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- §7.2 step 2: one Requester account per distinct Development Requester.
-- The passwordHash sentinel can never match a bcrypt comparison; prisma/seed.ts
-- installs a real bcrypt hash for the documented local-dev accounts.
INSERT INTO "User" ("id", "name", "email", "passwordHash", "role", "isActive", "mustChangePassword", "createdAt", "updatedAt")
SELECT
    md5(random()::text || clock_timestamp()::text || d."id"::text || d."email"),
    d."fullName",
    d."email",
    '!unhashed-migrated-placeholder',
    'REQUESTER',
    d."isActive",
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "DevRequester" d;

-- ─── AlterTable: Ticket ─────────────────────────────────────────────────

-- §7.1 new fields
ALTER TABLE "Ticket" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "requesterMarkedResolved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Ticket" ADD COLUMN "requesterMarkedResolvedAt" TIMESTAMP(3);

-- §7.2 step 3: backfill Ticket.requesterId (Int → String, DevRequester → User)
ALTER TABLE "Ticket" ADD COLUMN "requesterId_new" TEXT;

UPDATE "Ticket" t
SET "requesterId_new" = u."id"
FROM "DevRequester" d
JOIN "User" u ON u."email" = d."email"
WHERE t."requesterId" = d."id";

-- Abort rather than silently orphaning tickets (MIG-05 referential integrity).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "Ticket" WHERE "requesterId_new" IS NULL) THEN
        RAISE EXCEPTION 'Lab 3 migration aborted: % Ticket row(s) could not be matched to a migrated User',
            (SELECT count(*) FROM "Ticket" WHERE "requesterId_new" IS NULL);
    END IF;
END $$;

ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_requesterId_fkey";
ALTER TABLE "Ticket" DROP COLUMN "requesterId";
ALTER TABLE "Ticket" RENAME COLUMN "requesterId_new" TO "requesterId";
ALTER TABLE "Ticket" ALTER COLUMN "requesterId" SET NOT NULL;

-- §7.2 step 4: itPriority backfilled from requestedPriority, then required (BR-14)
UPDATE "Ticket"
SET "itPriority" = "requestedPriority"::text::"ItPriority"
WHERE "itPriority" IS NULL;

ALTER TABLE "Ticket" ALTER COLUMN "itPriority" SET NOT NULL;
ALTER TABLE "Ticket" ALTER COLUMN "itPriority" SET DEFAULT 'MEDIUM';

-- §7.1 status: carry the Lab 2 status value across (Lab 2 only ever wrote NEW)
ALTER TABLE "Ticket" RENAME COLUMN "currentStatus" TO "status";
ALTER TABLE "Ticket" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Ticket" ALTER COLUMN "status" TYPE "TicketStatus" USING ("status"::text::"TicketStatus");
ALTER TABLE "Ticket" ALTER COLUMN "status" SET DEFAULT 'NEW';

-- Lab 2's unused Int ownership column is superseded by ownerId (User)
ALTER TABLE "Ticket" DROP COLUMN "ticketOwnerId";

-- Indexes on the dropped column were removed with it — recreate them plus the
-- new §7.1 indexes used by the Lab 3 Ticket Queue (status / ownerId).
CREATE INDEX "Ticket_requesterId_idx" ON "Ticket"("requesterId");
CREATE INDEX "Ticket_requesterId_createdAt_idx" ON "Ticket"("requesterId", "createdAt");
CREATE INDEX "Ticket_ownerId_idx" ON "Ticket"("ownerId");
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");

ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── AlterTable: Attachment ─────────────────────────────────────────────
-- Same Int → String conversion for the uploader/remover FKs.

ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_uploadedByRequesterId_fkey";
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_removedByRequesterId_fkey";

ALTER TABLE "Attachment" ADD COLUMN "uploadedBy_new" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "removedBy_new" TEXT;

UPDATE "Attachment" a
SET "uploadedBy_new" = u."id"
FROM "DevRequester" d
JOIN "User" u ON u."email" = d."email"
WHERE a."uploadedByRequesterId" = d."id";

UPDATE "Attachment" a
SET "removedBy_new" = u."id"
FROM "DevRequester" d
JOIN "User" u ON u."email" = d."email"
WHERE a."removedByRequesterId" = d."id";

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "Attachment" WHERE "uploadedBy_new" IS NULL) THEN
        RAISE EXCEPTION 'Lab 3 migration aborted: % Attachment row(s) could not be matched to a migrated User',
            (SELECT count(*) FROM "Attachment" WHERE "uploadedBy_new" IS NULL);
    END IF;
END $$;

ALTER TABLE "Attachment" DROP COLUMN "uploadedByRequesterId";
ALTER TABLE "Attachment" DROP COLUMN "removedByRequesterId";
ALTER TABLE "Attachment" RENAME COLUMN "uploadedBy_new" TO "uploadedByRequesterId";
ALTER TABLE "Attachment" RENAME COLUMN "removedBy_new" TO "removedByRequesterId";
ALTER TABLE "Attachment" ALTER COLUMN "uploadedByRequesterId" SET NOT NULL;

ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedByRequesterId_fkey" FOREIGN KEY ("uploadedByRequesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_removedByRequesterId_fkey" FOREIGN KEY ("removedByRequesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── DropEnum ───────────────────────────────────────────────────────────
-- Superseded by TicketStatus.

DROP TYPE "CurrentStatus";
