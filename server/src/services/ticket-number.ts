/**
 * Ticket Number Generator — BR-06
 *
 * Format: TKT-{YYYY}-{6-digit sequence}
 * Example: TKT-2026-000001
 *
 * The sequence is scoped per year, starting at 000001.
 * Uses DB-level unique constraint as safety net against race conditions.
 * The caller (POST /api/tickets handler) retries on P2002 unique constraint
 * violation — this generator is stateless and returns a candidate each time.
 *
 * Design decision (from analysis):
 * - Not using DB sequences because year-scoped reset adds complexity
 * - Query MAX(sequence) for current year, then return candidate
 * - Retry logic lives in the POST handler, not here
 */

import { PrismaClient } from "@prisma/client";

/**
 * Generate the next ticket number for the current year.
 *
 * @param prisma - PrismaClient instance (injected for testability)
 * @returns The generated ticket number string, e.g. "TKT-2026-000001"
 */
export async function generateTicketNumber(
  prisma: PrismaClient,
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `TKT-${year}-`;

  // Find the current max sequence for this year
  // ticketNumber format: "TKT-2026-000001" → extract the numeric part after the prefix
  const lastTicket = await prisma.ticket.findFirst({
      where: {
        ticketNumber: { startsWith: prefix },
      },
      orderBy: { ticketNumber: "desc" },
      select: { ticketNumber: true },
    });

    let nextSequence = 1;
    if (lastTicket) {
      // Extract the 6-digit sequence from "TKT-2026-000001" → "000001" → 1
      const sequenceStr = lastTicket.ticketNumber.slice(prefix.length);
      const currentMax = parseInt(sequenceStr, 10);
      if (!isNaN(currentMax) && currentMax > 0) {
        nextSequence = currentMax + 1;
      } else {
        // ─── FALLBACK: non-standard ticket number detected ─────────
        //
        // This path handles corrupted or non-standard ticket numbers
        // where the suffix after the prefix is not purely numeric
        // (e.g., UUID-based test tickets like "TKT-2026-aa0489").
        //
        // PRODUCTION NOTE: In normal production use, ALL ticket numbers
        // follow the standard TKT-{YYYY}-{6-digit} format, so parseInt()
        // will ALWAYS succeed and this fallback will NEVER be reached.
        // This path exists purely as a safety net for development/test
        // environments where manual DB inserts or test data may have
        // created non-standard ticket numbers.
        //
        // PERFORMANCE NOTE: If this fallback IS triggered frequently
        // in production (which should never happen), it queries ALL
        // tickets for the current year to find the max numeric sequence
        // in JavaScript. This is O(n) where n = number of tickets this
        // year, acceptable for a fallback path but not for the hot path.
        const allTickets = await prisma.ticket.findMany({
          where: { ticketNumber: { startsWith: prefix } },
          select: { ticketNumber: true },
        });
        let maxSeq = 0;
        for (const t of allTickets) {
          const seq = parseInt(t.ticketNumber.slice(prefix.length), 10);
          if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
        }
        nextSequence = maxSeq + 1;
      }
    }

    // Format as 6-digit zero-padded string
    const sequenceFormatted = String(nextSequence).padStart(6, "0");
    const ticketNumber = `${prefix}${sequenceFormatted}`;

    return ticketNumber;
}

/**
 * Validate that a ticket number has the correct format.
 * Useful for tests and defensive checks.
 *
 * @param ticketNumber - The ticket number to validate
 * @returns true if format matches TKT-{YYYY}-{6-digit}
 */
export function isValidTicketNumber(ticketNumber: string): boolean {
  return /^TKT-\d{4}-\d{6}$/.test(ticketNumber);
}
