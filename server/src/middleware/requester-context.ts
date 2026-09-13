/**
 * Requester Context Middleware — BR-03 / BR-41 single access point
 *
 * Lab 3 derives Requester identity exclusively from the authenticated session
 * (`req.session.userId`, resolved to `req.currentUser` by `requireAuth`). The
 * Lab 2 `X-Dev-Requester-Id` development header is removed: a request without
 * a session never reaches a Requester endpoint (api-spec.md §2, BR-03).
 *
 * This middleware runs *after* `requireAuth` + `enforcePasswordChange` +
 * `requireRole(["REQUESTER"])` and only re-projects the session identity into
 * the Lab 2 `currentRequester` shape (`{ id, fullName, email }`) so the
 * existing handler code and response contract stay unchanged. `User.name` is
 * exposed as `fullName` for the Lab 2 response contract.
 */

import { Request, Response, NextFunction } from "express";

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

// ─── Middleware ──────────────────────────────────────────────────────────

export function requesterContext(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = req.currentUser;

  if (!user) {
    // Defensive: the route should have run requireAuth first.
    res.status(401).json({
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication required.",
      },
    });
    return;
  }

  req.currentRequester = { id: user.id, fullName: user.name, email: user.email };
  next();
}
