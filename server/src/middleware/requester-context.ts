/**
 * Requester Context Middleware — BR-41 single access point
 *
 * Extracts the `X-Dev-Requester-Id` header, re-verifies against the database
 * on every request (BR-05), and attaches `req.currentRequester` for
 * downstream route handlers.
 *
 * In Lab 3, this middleware is the ONLY file that changes when real
 * session-based authentication replaces the dev-requester header.
 *
 * Response shape on failure matches api-spec.md Common Error Shape:
 *   401 { error: { code: "INVALID_REQUESTER_CONTEXT", message: "..." } }
 */

import { Request, Response, NextFunction } from "express";
import { getPrisma } from "../prisma.js";

// ─── TypeScript augmentation ────────────────────────────────────────────
// Extend Express Request so downstream handlers can read
// `req.currentRequester` with full type safety.

declare global {
  namespace Express {
    interface Request {
      currentRequester?: {
        id: number;
        fullName: string;
        email: string;
      };
    }
  }
}

// ─── Error response helper ──────────────────────────────────────────────

function rejectUnauthorized(res: Response): void {
  res.status(401).json({
    error: {
      code: "INVALID_REQUESTER_CONTEXT",
      message: "No active Development Requester selected.",
    },
  });
}

// ─── Middleware ──────────────────────────────────────────────────────────

export async function requesterContext(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const headerValue = req.header("X-Dev-Requester-Id");

  // Missing header
  if (headerValue === undefined || headerValue === null || headerValue === "") {
    rejectUnauthorized(res);
    return;
  }

  // Non-numeric header
  const id = Number(headerValue);
  if (!Number.isInteger(id) || id <= 0) {
    rejectUnauthorized(res);
    return;
  }

  // BR-05: independently re-verify that this Requester exists and is active
  // on every request. No caching — the spec requires the backend to never
  // trust a client-supplied selection as still valid.
  try {
    const prisma = getPrisma();
    const requester = await prisma.devRequester.findUnique({
      where: { id },
      select: { id: true, fullName: true, email: true, isActive: true },
    });

    if (!requester || !requester.isActive) {
      rejectUnauthorized(res);
      return;
    }

    // Attach verified requester for downstream route handlers
    req.currentRequester = {
      id: requester.id,
      fullName: requester.fullName,
      email: requester.email,
    };

    next();
  } catch (err) {
    // Database errors — return safe generic error, never leak internals (BR-26)
    res.status(500).json({
      error: {
        code: "SERVER_ERROR",
        message: "Something went wrong. Please try again.",
      },
    });
  }
}
