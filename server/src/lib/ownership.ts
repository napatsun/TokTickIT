/**
 * Ownership Helpers — BR-41 / BR-42 single access point
 *
 * All ownership checks flow through this module so there is exactly one place
 * that enforces "a Requester only sees their own Tickets/Attachments".
 *
 * Lab 3: identity is a real `User` (String id), no longer a `DevRequester`
 * (Int id). The API response still exposes the Lab 2 `requester.fullName`
 * projection so the Lab 2 client contract is unchanged; it is derived from
 * `User.name`.
 *
 * Business rules enforced:
 *   BR-12  Ownership: only the current Requester's tickets/attachments
 *   BR-13  404 for non-existent OR cross-requester (no information leak)
 *   BR-33  Only the owning Requester may add/download/remove attachments
 *   BR-41  Single access point for ownership checks
 */

import { getPrisma } from "../prisma.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface OwnedTicket {
  id: number;
  ticketNumber: string;
  requesterId: string;
  categoryId: number;
  relatedSystemId: number;
  summary: string;
  description: string;
  requestedPriority: string;
  itPriority: string;
  status: string;
  ownerId: string | null;
  requesterMarkedResolved: boolean;
  requesterMarkedResolvedAt: Date | null;
  resolutionSummary: string | null;
  createdAt: Date;
  updatedAt: Date;
  requester: { id: string; fullName: string };
  category: { id: number; name: string };
  relatedSystem: { id: number; name: string };
}

export interface OwnedAttachment {
  id: number;
  ticketId: number;
  originalFileName: string;
  storedFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedByRequesterId: string;
  uploadedAt: Date;
  isRemoved: boolean;
  removedAt: Date | null;
  removedReason: string | null;
  removedByRequesterId: string | null;
  ticket: { requesterId: string };
}

// ─── Ticket ownership ───────────────────────────────────────────────────

/**
 * Find a ticket by ticketNumber that is owned by the given requester.
 * Returns null if the ticket does not exist or belongs to a different
 * Requester (BR-13: both cases produce an identical 404).
 *
 * @param ticketNumber - The ticket number from the URL param
 * @param requesterId - The verified User id from requesterContext
 */
export async function findOwnedTicket(
  ticketNumber: string,
  requesterId: string,
): Promise<OwnedTicket | null> {
  const prisma = getPrisma();
  const ticket = await prisma.ticket.findFirst({
    where: {
      ticketNumber,
      requesterId, // BR-12/BR-13: ownership baked into query
    },
    include: {
      requester: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      relatedSystem: { select: { id: true, name: true } },
    },
  });

  if (!ticket) return null;

  // Re-project User.name back onto the Lab 2 `fullName` response contract.
  const { name, ...requesterRest } = ticket.requester;
  return { ...ticket, requester: { ...requesterRest, fullName: name } } as unknown as OwnedTicket;
}

// ─── Attachment ownership ───────────────────────────────────────────────

/**
 * Find an attachment by ID, verifying that its parent ticket is owned
 * by the given requester. Returns null if the attachment does not exist
 * or its parent ticket belongs to a different Requester.
 */
export async function findOwnedAttachment(
  attachmentId: number,
  requesterId: string,
): Promise<OwnedAttachment | null> {
  const prisma = getPrisma();
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId },
    include: {
      ticket: { select: { requesterId: true } },
    },
  });

  if (!attachment || attachment.ticket.requesterId !== requesterId) {
    return null; // BR-13: same 404 for non-existent and cross-requester
  }

  return attachment as OwnedAttachment;
}
