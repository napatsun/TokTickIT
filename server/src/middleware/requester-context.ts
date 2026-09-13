/**
 * Requester Context Middleware — BR-41 single access point (transitional)
 *
 * Lab 3 moves Requester identity onto the authenticated session (BR-03). The
 * Lab 2 ticket/attachment endpoints are re-scoped to the session, but a later
 * branch finishes that migration; until then this middleware keeps them
 * working for two identity sources, in priority order:
 *
 *   1. Session (`req.session.userId`) — the Lab 3 identity source. Also
 *      populates `req.currentUser` so the mustChangePassword gate and role
 *      guards apply.
 *   2. `X-Dev-Requester-Id` — the Lab 2 development header. The numeric
 *      Development Requester is resolved to the matching migrated `User` by
 *      email, so downstream queries use real User ids. `req.currentUser` is
 *      deliberately NOT populated on this path: the dev header carries no
 *      ambient browser credentials, so the password-change gate (which exists
 *      to stop a half-onboarded user) must not apply to it.
 *
 * Failure responses keep the Lab 2 shape:
 *   401 { error: { code: "INVALID_REQUESTER_CONTEXT", message: "..." } }
 */

import { Request, Response, NextFunction } from "express";
import { getPrisma } from "../prisma.js";
import type { Role } from "./auth.js";

// ─── TypeScript augmentation ────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      currentRequester?: {
        id: string;
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
      message: "No active Requester session or Development Requester selected.",
    },
  });
}

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
} as const;

// ─── Middleware ──────────────────────────────────────────────────────────

export async function requesterContext(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const prisma = getPrisma();

    // ─── 1. Session identity (Lab 3) ────────────────────────────────
    const sessionUserId = req.session?.userId;
    if (sessionUserId) {
      const user = await prisma.user.findUnique({
        where: { id: sessionUserId },
        select: USER_SELECT,
      });

      if (!user || !user.isActive) {
        rejectUnauthorized(res);
        return;
      }

      req.currentRequester = { id: user.id, fullName: user.name, email: user.email };
      req.currentUser = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role as Role,
        isActive: user.isActive,
        mustChangePassword: user.mustChangePassword,
      };
      next();
      return;
    }

    // ─── 2. Transitional Development Requester header (Lab 2) ───────
    const headerValue = req.header("X-Dev-Requester-Id");
    if (headerValue === undefined || headerValue === null || headerValue === "") {
      rejectUnauthorized(res);
      return;
    }

    let user;
    const devId = Number(headerValue);
    if (Number.isInteger(devId) && devId > 0) {
      // Numeric header = Development Requester id → resolve to the migrated User
      const devRequester = await prisma.devRequester.findUnique({
        where: { id: devId },
        select: { email: true, isActive: true },
      });
      if (!devRequester || !devRequester.isActive) {
        rejectUnauthorized(res);
        return;
      }
      user = await prisma.user.findFirst({
        where: { email: devRequester.email, role: "REQUESTER" },
        select: USER_SELECT,
      });
    } else {
      // Non-numeric header = a User id directly (used by newer fixtures)
      user = await prisma.user.findUnique({
        where: { id: headerValue },
        select: USER_SELECT,
      });
    }

    if (!user || !user.isActive) {
      rejectUnauthorized(res);
      return;
    }

    req.currentRequester = { id: user.id, fullName: user.name, email: user.email };
    next();
  } catch (err) {
    // Database errors — safe generic error, never leak internals (BR-26)
    console.error("requesterContext failed:", err);
    res.status(500).json({
      error: {
        code: "SERVER_ERROR",
        message: "Something went wrong. Please try again.",
      },
    });
  }
}
