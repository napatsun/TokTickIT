/**
 * Authentication & authorization middleware — api-spec.md §0/§1, §6
 *
 * Pieces:
 *   sessionMiddleware      — HTTP-only Secure SameSite=Lax `sid` cookie, server-side store
 *   csrfProtection         — double-submit token for state-changing cookie-authenticated requests
 *   requireAuth            — 401 when there is no valid, active session
 *   enforcePasswordChange  — 403 PASSWORD_CHANGE_REQUIRED while mustChangePassword = true (BR-02)
 *   requireRole([...])     — reusable role guard: 403 when authenticated but the wrong role (FR-09)
 *
 * Safe-error rules (§6): responses never include a stack trace, ORM error, or
 * password material. Internal detail is logged server-side only.
 */

import { randomBytes } from "node:crypto";
import { Request, Response, NextFunction } from "express";
import session from "express-session";
import { getPrisma } from "../prisma.js";

// ─── Types ──────────────────────────────────────────────────────────────

export type Role = "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR";

/** The authenticated identity attached to every session-authenticated request. */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
}

declare global {
  namespace Express {
    interface Request {
      currentUser?: SessionUser;
    }
  }
}

/** Extra fields stored on the session beyond `userId`. */
declare module "express-session" {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
  }
}

// ─── Session ────────────────────────────────────────────────────────────

export const SESSION_COOKIE_NAME = "sid";
export const CSRF_COOKIE_NAME = "csrf";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

// NOTE: `secure` is enabled in production only. Local development and the
// automated suites talk to the API over plain HTTP, where a Secure cookie
// would never be stored — see README "Assumptions".
export const sessionMiddleware = session({
  name: SESSION_COOKIE_NAME,
  secret: process.env.SESSION_SECRET ?? "toktickit-dev-session-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8, // 8 hours
  },
});

/** Issue a fresh CSRF token, store it on the session, and expose it to the client. */
export function issueCsrfToken(req: Request, res: Response): string {
  const token = randomBytes(32).toString("hex");
  req.session.csrfToken = token;
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // must be readable by the SPA to echo it back in a header
    secure: IS_PRODUCTION,
    sameSite: "lax",
  });
  return token;
}

/** Clear both session cookies. */
export function clearAuthCookies(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME);
  res.clearCookie(CSRF_COOKIE_NAME);
}

// ─── Error helpers (uniform safe envelopes) ─────────────────────────────

function rejectUnauthenticated(res: Response): void {
  res.status(401).json({
    error: { code: "UNAUTHENTICATED", message: "Authentication required." },
  });
}

export function rejectForbidden(res: Response): void {
  res.status(403).json({
    error: {
      code: "FORBIDDEN",
      message: "You don't have access to this resource.",
    },
  });
}

// ─── CSRF (double-submit cookie) ────────────────────────────────────────

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF is only meaningful for cookie-authenticated requests, because only
 * cookies are attached automatically by the browser. Requests authenticated
 * through the transitional X-Dev-Requester-Id header (Lab 2 endpoints) carry
 * no ambient credentials and are therefore not subject to this check.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  if (!req.session?.userId) {
    next();
    return;
  }

  const headerToken = req.header("X-CSRF-Token");
  const cookieToken = (req.cookies ?? {})[CSRF_COOKIE_NAME];
  const sessionToken = req.session.csrfToken;

  if (!sessionToken || !headerToken || !cookieToken || headerToken !== sessionToken || cookieToken !== sessionToken) {
    res.status(403).json({
      error: { code: "CSRF_INVALID", message: "Invalid or missing CSRF token." },
    });
    return;
  }

  next();
}

// ─── requireAuth ────────────────────────────────────────────────────────

/**
 * Resolve the session identity against the database on every request (never
 * trust the cookie alone), and reject inactive/deleted users. A session whose
 * user was deactivated is destroyed so it cannot be replayed.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    rejectUnauthenticated(res);
    return;
  }

  try {
    const user = await getPrisma().user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
      },
    });

    if (!user || !user.isActive) {
      req.session.destroy(() => {
        rejectUnauthenticated(res);
      });
      return;
    }

    req.currentUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role as Role,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
    };
    next();
  } catch (err) {
    // Safe error (api-spec §6): generic message, detail logged server-side only.
    console.error("requireAuth failed:", err);
    res.status(500).json({
      error: { code: "SERVER_ERROR", message: "Something went wrong. Please try again." },
    });
  }
}

// ─── mustChangePassword gate (BR-02 / FR-06) ────────────────────────────

/**
 * Blocks every authenticated route while the user still holds an initial
 * password. Deliberately NOT applied to /api/auth/logout, /api/auth/me, and
 * /api/auth/change-password (api-spec.md §1 middleware rule).
 */
export function enforcePasswordChange(req: Request, res: Response, next: NextFunction): void {
  if (req.currentUser?.mustChangePassword) {
    res.status(403).json({
      error: {
        code: "PASSWORD_CHANGE_REQUIRED",
        message: "You must change your password before continuing.",
      },
    });
    return;
  }
  next();
}

// ─── requireRole ────────────────────────────────────────────────────────

/**
 * Reusable role guard for later branches (staff queue, admin users):
 *
 *   router.get("/staff/tickets", requireAuth, requireRole(["IT_STAFF", "ADMINISTRATOR"]), handler)
 *
 * 403 (not 404) once the caller is authenticated but lacks the role, per
 * api-spec.md §0 status-code usage. Unauthenticated callers get 401.
 */
export function requireRole(allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.currentUser) {
      rejectUnauthenticated(res);
      return;
    }
    if (!allowed.includes(req.currentUser.role)) {
      rejectForbidden(res);
      return;
    }
    next();
  };
}
