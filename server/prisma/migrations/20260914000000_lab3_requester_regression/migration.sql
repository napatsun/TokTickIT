-- Lab 3 — Requester regression (BR-03, FR-14, BR-16/17/18)
--
-- 1. Add "PublicComment" (Requester-facing, append-only comments on a Ticket).
-- 2. Drop "DevRequester" — the X-Dev-Requester-Id identity bridge is removed,
--    so every Ticket/Attachment endpoint now derives identity exclusively from
--    the authenticated session (BR-03). The table no longer owns any rows:
--    all Ticket/Attachment FKs were re-pointed to "User" by
--    20260913000000_lab3_auth_and_authorization, so dropping it is safe and
--    loses no Ticket or Attachment data.

-- ─── 1. PublicComment ───────────────────────────────────────────────────

CREATE TABLE "PublicComment" (
    "id" TEXT NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PublicComment_ticketId_createdAt_idx" ON "PublicComment"("ticketId", "createdAt");

ALTER TABLE "PublicComment" ADD CONSTRAINT "PublicComment_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PublicComment" ADD CONSTRAINT "PublicComment_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── 2. Retire the Development Requester bridge ─────────────────────────

DROP TABLE "DevRequester";
