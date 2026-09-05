/**
 * Ownership Helpers — BR-41 / BR-42 single access point
 *
 * All ownership checks in Lab 2 flow through this module.
 * In Lab 3, only this file changes when real session-based
 * authentication replaces the X-Dev-Requester-Id header.
 *
 * Business rules enforced:
 *   BR-12  Ownership: only current Requester's tickets/attachments
 *   BR-13  404 for non-existent OR cross-requester (no information leak)
 *   BR-33  Only owning Requester may add/download/remove attachments
 *   BR-41  Single access point for ownership checks
 */

import { getPrisma } from "../prisma.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface OwnedTicket {
  id: number;
  ticketNumber: string;
  requesterId: number;
  categoryId: number;
  relatedSystemId: number;
  summary: string;
  description: string;
  requestedPriority: string;
  itPriority: string | null;
  currentStatus: string;
  ticketOwnerId: number | null;
  resolutionSummary: string | null;
  createdAt: Date;
  updatedAt: Date;
  requester: { id: number; fullName: string };
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
  uploadedByRequesterId: number;
  uploadedAt: Date;
  isRemoved: boolean;
  removedAt: Date | null;
  removedReason: string | null;
  removedByRequesterId: number | null;
  ticket: { requesterId: number };
}

// ─── Ticket ownership ───────────────────────────────────────────────────

/**
 * Find a ticket by ticketNumber that is owned by the given requester.
 * Returns null if the ticket does not exist or belongs to a different
 * Requester (BR-13: both cases produce identical 404).
 *
 * @param ticketNumber - The ticket number from the URL param
 * @param requesterId - The verified requester ID from requesterContext
 * @returns The ticket with related data, or null
 */
export async function findOwnedTicket(
  ticketNumber: string,
  requesterId: number,
): Promise<OwnedTicket | null> {
  const prisma = getPrisma();
  const ticket = await prisma.ticket.findFirst({
    where: {
      ticketNumber,
      requesterId, // BR-12/BR-13: ownership baked into query
    },
    include: {
      requester: { select: { id: true, fullName: true } },
      category: { select: { id: true, name: true } },
      relatedSystem: { select: { id: true, name: true } },
    },
  });
  return ticket as OwnedTicket | null;
}

// ─── Attachment ownership ───────────────────────────────────────────────

/**
 * Find an attachment by ID, verifying that its parent ticket is owned
 * by the given requester. Returns null if the attachment does not exist
 * or its parent ticket belongs to a different Requester.
 *
 * @param attachmentId - The attachment ID from the URL param
 * @param requesterId - The verified requester ID from requesterContext
 * @returns The attachment with ticket ownership info, or null
 */
export async function findOwnedAttachment(
  attachmentId: number,
  requesterId: number,
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
