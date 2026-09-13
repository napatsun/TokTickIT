/**
 * Authentication API — api-spec.md §1
 *
 *   POST /api/auth/login
 *   POST /api/auth/logout
 *   GET  /api/auth/me
 *   POST /api/auth/change-password
 *
 * Enforced rules:
 *   BR-01  only an active user with valid credentials may authenticate
 *   BR-06  wrong password / unknown email / inactive account all return the
 *          same generic INVALID_CREDENTIALS response shape (no field hint)
 *   BR-07  passwords are only ever compared against / stored as bcrypt hashes
 *   BR-08  logout invalidates the session immediately
 *   BR-11  no response ever contains passwordHash or other credential material
 */

import { Router, Request, Response } from "express";
import { getPrisma } from "../prisma.js";
import { hashPassword, passwordPolicyError, verifyPassword } from "../lib/password.js";
import {
  clearAuthCookies,
  issueCsrfToken,
  requireAuth,
  type SessionUser,
} from "../middleware/auth.js";

// NOTE: CSRF protection is applied globally in app.ts (before this router is
// mounted), so every state-changing request is checked exactly once.

export const authRouter = Router();

// ─── Helpers ────────────────────────────────────────────────────────────

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The only public projection of a User. Never includes passwordHash (BR-11). */
function toSafeUser(user: {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  mustChangePassword: boolean;
}): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as SessionUser["role"],
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
  };
}

/** One envelope for every failed credential case (BR-06, BR-09, FR-03). */
function rejectCredentials(res: Response): void {
  res.status(401).json({
    error: {
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password.",
    },
  });
}

/**
 * A bcrypt comparison against this constant costs roughly the same as a real
 * one, so the response time for "unknown email" does not stand out from
 * "known email, wrong password" (BR-06 side-channel reduction).
 */
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

function loginValidationErrors(body: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as { email?: unknown; password?: unknown };

  const email = typeof b.email === "string" ? b.email.trim() : "";
  if (email.length === 0) {
    fields.email = "Email is required.";
  } else if (!EMAIL_PATTERN.test(email)) {
    fields.email = "Enter a valid email address.";
  }

  const password = typeof b.password === "string" ? b.password : "";
  if (password.length === 0) {
    fields.password = "Password is required.";
  }

  return fields;
}

// ─── POST /api/auth/login ───────────────────────────────────────────────

authRouter.post("/login", async (req: Request, res: Response) => {
  try {
    const fieldErrors = loginValidationErrors(req.body);
    if (Object.keys(fieldErrors).length > 0) {
      res.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Please fix the highlighted fields.",
          fields: fieldErrors,
        },
      });
      return;
    }

    const email = String((req.body as { email: string }).email).trim().toLowerCase();
    const password = String((req.body as { password: string }).password);

    const user = await getPrisma().user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        passwordHash: true,
      },
    });

    // Unknown email and inactive account must be indistinguishable from a
    // wrong password: same status, same code, same message, comparable timing.
    const hash = user?.passwordHash ?? DUMMY_HASH;
    const passwordMatches = await verifyPassword(password, hash);

    if (!user || !user.isActive || !passwordMatches) {
      rejectCredentials(res);
      return;
    }

    const safeUser = toSafeUser(user);

    // Fresh session id on every login (session fixation defence).
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve())),
    );
    req.session.userId = safeUser.id;
    issueCsrfToken(req, res);
    await new Promise<void>((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve())),
    );

    res.status(200).json({ user: safeUser });
  } catch (err) {
    console.error("POST /api/auth/login failed:", err);
    res.status(500).json({
      error: { code: "SERVER_ERROR", message: "Something went wrong. Please try again." },
    });
  }
});

// ─── POST /api/auth/logout ──────────────────────────────────────────────

authRouter.post("/logout", requireAuth, (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("POST /api/auth/logout failed to destroy session:", err);
      res.status(500).json({
        error: { code: "SERVER_ERROR", message: "Something went wrong. Please try again." },
      });
      return;
    }
    clearAuthCookies(res);
    // BR-08: the old credential is rejected with 401 on its next use
    // (there is no session left to resolve).
    res.status(200).json({ success: true });
  });
});

// ─── GET /api/auth/me ───────────────────────────────────────────────────

authRouter.get("/me", requireAuth, (req: Request, res: Response) => {
  // Exempt from the mustChangePassword gate: the SPA needs the flag in order
  // to route the user to /change-password in the first place.
  res.status(200).json(req.currentUser);
});

// ─── POST /api/auth/change-password ─────────────────────────────────────

authRouter.post(
  "/change-password",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as { newPassword?: unknown; confirmPassword?: unknown };
      const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
      const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

      const fields: Record<string, string> = {};
      const policyError = passwordPolicyError(newPassword);
      if (policyError) {
        fields.newPassword = policyError;
      }
      if (newPassword !== confirmPassword) {
        fields.confirmPassword = "Passwords do not match";
      } else if (confirmPassword.length === 0) {
        fields.confirmPassword = "Confirm your new password";
      }

      if (Object.keys(fields).length > 0) {
        res.status(422).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Please fix the highlighted fields.",
            fields,
          },
        });
        return;
      }

      const passwordHash = await hashPassword(newPassword);
      await getPrisma().user.update({
        where: { id: req.currentUser!.id },
        data: { passwordHash, mustChangePassword: false },
      });

      res.status(200).json({ success: true });
    } catch (err) {
      console.error("POST /api/auth/change-password failed:", err);
      res.status(500).json({
        error: { code: "SERVER_ERROR", message: "Something went wrong. Please try again." },
      });
    }
  },
);
