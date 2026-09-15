/**
 * Administrator User Management API — api-spec.md §4
 * (FR-24 … FR-31, BR-10, BR-21, BR-23, BR-24, BR-25, BR-26, BR-29, BR-30, BR-31)
 *
 * Mounted at `/api/admin` behind requireAuth + enforcePasswordChange +
 * requireRole(["ADMINISTRATOR"]) (see app.ts), so every route here is
 * Administrator-only: Requester and IT Staff both get 403 FORBIDDEN without
 * ever reaching a handler (SEC-01, SEC-02, SEC-09).
 *
 * Routes:
 *   GET   /api/admin/users                    list + search + optional role filter
 *   POST  /api/admin/users                    create (always mustChangePassword = true)
 *   PATCH /api/admin/users/:id                edit name/email/role/isActive
 *   POST  /api/admin/users/:id/reset-password set a new initial password
 *
 * Explicitly out of scope for Lab 3 (specification.md §3.2): user deletion,
 * multiple roles per user, bulk operations, department/org fields, email
 * delivery of initial passwords, and pagination on the list.
 *
 * Safe-error discipline (BR-26, api-spec.md §6): a duplicate email returns one
 * generic message and never reveals whether the conflicting account is active or
 * inactive, and no response ever contains `passwordHash` or a stack trace.
 */

import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { getPrisma } from "../prisma.js";
import { hashPassword, passwordPolicyError } from "../lib/password.js";
import { isValidEmail, normalizeEmail } from "../lib/email.js";

export const adminRouter = Router();

// ─── Constants ──────────────────────────────────────────────────────────

const ROLES = ["REQUESTER", "IT_STAFF", "ADMINISTRATOR"] as const;
type RoleValue = (typeof ROLES)[number];

/** Name length bounds. Not fixed by the spec; documented as an assumption. */
const NAME_MIN = 1;
const NAME_MAX = 120;

/** Single generic duplicate-email message — never differentiates account state. */
const EMAIL_IN_USE_MESSAGE = "This email is already in use.";

/**
 * How many times a Serializable transaction may be retried after a
 * serialization failure (P2034) before we give up and let the generic 500
 * handler answer. Two retries is enough for the two-writer races this guards.
 */
const SERIALIZABLE_RETRIES = 3;

// ─── Helpers ────────────────────────────────────────────────────────────

function serverError(res: Response): void {
  // api-spec.md §6: generic message only; detail is logged server-side.
  res.status(500).json({
    error: { code: "SERVER_ERROR", message: "Something went wrong. Please try again." },
  });
}

function validationError(
  res: Response,
  code: string,
  message: string,
  fields: Record<string, string>,
): void {
  // api-spec.md §0/§4 name this key `fields`; the Lab 2 client helper also
  // understands `fieldErrors`, so both are emitted with identical content and
  // no client has to guess which generation of the envelope it is reading.
  res.status(422).json({ error: { code, message, fields, fieldErrors: fields } });
}

/** The only public projection of a User. Never includes passwordHash (BR-11). */
interface AdminUserDto {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}

function toAdminUserDto(user: AdminUserDto): AdminUserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
  };
}

function isRoleValue(value: unknown): value is RoleValue {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Sentinel thrown inside the PATCH transaction so a guard failure rolls the
 * transaction back (nothing is persisted) and is then mapped to a 409 outside.
 */
class GuardConflict extends Error {
  constructor(
    readonly code: "SELF_DEACTIVATION" | "LAST_ACTIVE_ADMIN",
    message: string,
  ) {
    super(message);
    this.name = "GuardConflict";
  }
}

/**
 * Field-level conflict (duplicate email) raised inside the transaction so it
 * rolls back and is mapped to the same 422 envelope the non-transactional
 * validation path uses.
 */
class ValidationConflict extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly fields: Record<string, string>,
  ) {
    super(message);
    this.name = "ValidationConflict";
  }
}

/**
 * Run `fn` in a SERIALIZABLE transaction, retrying on serialization failure.
 *
 * Why Serializable: the "last active Administrator" invariant spans rows, so a
 * plain read-then-write under READ COMMITTED lets two concurrent requests each
 * observe "another admin still exists" and both deactivate — leaving zero
 * Administrators. Under SERIALIZABLE, Postgres aborts one of the two, the retry
 * re-reads the count, and the loser correctly gets 409 LAST_ACTIVE_ADMIN.
 */
async function runSerializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await getPrisma().$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "P2034" && attempt < SERIALIZABLE_RETRIES) continue;
      throw err;
    }
  }
}

/**
 * Count the active Administrators OTHER than `excludeId`.
 * 0 means deactivating / demoting `excludeId` would leave the system with no
 * usable Administrator (BR-24, BR-31).
 */
async function otherActiveAdminCount(
  tx: Prisma.TransactionClient,
  excludeId: string,
): Promise<number> {
  return tx.user.count({
    where: { role: "ADMINISTRATOR", isActive: true, id: { not: excludeId } },
  });
}

/** Case-insensitive duplicate lookup that can exclude the row being edited. */
async function findEmailOwner(
  tx: Prisma.TransactionClient,
  email: string,
  excludeId?: string,
): Promise<{ id: string } | null> {
  return tx.user.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
}

/** Map a Prisma unique-constraint violation to the generic duplicate message. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === "P2002";
}

// ─── GET /api/admin/users ───────────────────────────────────────────────

adminRouter.get("/users", async (req: Request, res: Response) => {
  try {
    const fieldErrors: Record<string, string> = {};

    // `q` — free-text search across name and email (no minimum length here;
    // the spec only mandates one for the ticket queue).
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    // `role` — optional single-select filter, must be a Role enum value.
    let role: RoleValue | null = null;
    if (req.query.role != null && req.query.role !== "") {
      const raw = String(req.query.role).trim().toUpperCase();
      if (!isRoleValue(raw)) {
        fieldErrors.role = "role must be one of REQUESTER, IT_STAFF, ADMINISTRATOR.";
      } else {
        role = raw;
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Invalid query parameter.", fieldErrors },
      });
      return;
    }

    const where: Prisma.UserWhereInput = {};
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ];
    }
    if (role) where.role = role;

    // No pagination by scope (specification.md §3.2 / §4 "no pagination
    // required"). Ordered by name so the list is stable and human-scannable.
    const users = await getPrisma().user.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });

    res.status(200).json({ items: users.map(toAdminUserDto) });
  } catch {
    serverError(res);
  }
});

// ─── POST /api/admin/users ──────────────────────────────────────────────

interface CreateUserBody {
  name?: unknown;
  email?: unknown;
  role?: unknown;
  isActive?: unknown;
  initialPassword?: unknown;
}

adminRouter.post("/users", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as CreateUserBody;
    const fields: Record<string, string> = {};

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length === 0) {
      fields.name = "Name is required.";
    } else if (name.length > NAME_MAX) {
      fields.name = `Name must be ${NAME_MAX} characters or fewer.`;
    }

    const email = normalizeEmail(body.email);
    if (email.length === 0) {
      fields.email = "Email is required.";
    } else if (!isValidEmail(email)) {
      fields.email = "Enter a valid email address.";
    }

    // BR-21: a new user always has exactly one role.
    const role = typeof body.role === "string" ? body.role.trim().toUpperCase() : "";
    if (!isRoleValue(role)) {
      fields.role = "Role must be one of REQUESTER, IT_STAFF, ADMINISTRATOR.";
    }

    // `isActive` is optional and defaults to true (api-spec.md §4).
    let isActive = true;
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") {
        fields.isActive = "Active must be true or false.";
      } else {
        isActive = body.isActive;
      }
    }

    // The initial password is admin-set and must satisfy the same policy the
    // Change Password screen enforces (specification.md §11.6).
    const policyError = passwordPolicyError(body.initialPassword);
    if (policyError) {
      fields.initialPassword = policyError;
    }

    if (Object.keys(fields).length > 0) {
      validationError(res, "VALIDATION_ERROR", "Please fix the highlighted fields.", fields);
      return;
    }

    // Duplicate-email check happens BEFORE hashing so an obviously invalid
    // request never pays the bcrypt cost.
    if (await findEmailOwner(getPrisma(), email)) {
      validationError(res, "EMAIL_ALREADY_IN_USE", EMAIL_IN_USE_MESSAGE, {
        email: EMAIL_IN_USE_MESSAGE,
      });
      return;
    }

    const passwordHash = await hashPassword(String(body.initialPassword));

    try {
      const created = await getPrisma().user.create({
        data: {
          name,
          email,
          role: role as RoleValue,
          isActive,
          passwordHash,
          // BR-25: forced regardless of caller intent — the request body has no
          // way to opt out, since this literal is written last.
          mustChangePassword: true,
        },
        select: { id: true, name: true, email: true, role: true, isActive: true },
      });

      res.status(201).json(toAdminUserDto(created));
    } catch (err) {
      // A concurrent create slipped past the check above → same generic answer.
      if (isUniqueViolation(err)) {
        validationError(res, "EMAIL_ALREADY_IN_USE", EMAIL_IN_USE_MESSAGE, {
          email: EMAIL_IN_USE_MESSAGE,
        });
        return;
      }
      throw err;
    }
  } catch {
    serverError(res);
  }
});

// ─── PATCH /api/admin/users/:id ─────────────────────────────────────────

interface PatchUserBody {
  name?: unknown;
  email?: unknown;
  role?: unknown;
  isActive?: unknown;
}

interface PatchValues {
  name?: string;
  email?: string;
  role?: RoleValue;
  isActive?: boolean;
}

adminRouter.patch("/users/:id", async (req: Request, res: Response) => {
  try {
    const targetId = req.params.id;
    const body = (req.body ?? {}) as PatchUserBody;
    const fields: Record<string, string> = {};
    const values: PatchValues = {};

    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name.length === 0) {
        fields.name = "Name is required.";
      } else if (name.length > NAME_MAX) {
        fields.name = `Name must be ${NAME_MAX} characters or fewer.`;
      } else {
        values.name = name;
      }
    }

    if (body.email !== undefined) {
      const email = normalizeEmail(body.email);
      if (email.length === 0) {
        fields.email = "Email is required.";
      } else if (!isValidEmail(email)) {
        fields.email = "Enter a valid email address.";
      } else {
        values.email = email;
      }
    }

    if (body.role !== undefined) {
      if (typeof body.role !== "string" || !isRoleValue(body.role.trim().toUpperCase())) {
        fields.role = "Role must be one of REQUESTER, IT_STAFF, ADMINISTRATOR.";
      } else {
        values.role = body.role.trim().toUpperCase() as RoleValue;
      }
    }

    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") {
        fields.isActive = "Active must be true or false.";
      } else {
        values.isActive = body.isActive;
      }
    }

    if (Object.keys(fields).length > 0) {
      validationError(res, "VALIDATION_ERROR", "Please fix the highlighted fields.", fields);
      return;
    }

    // api-spec.md §4: "Body (any subset)". An empty subset is almost certainly a
    // client bug, so it is reported rather than silently answered with a no-op.
    if (Object.keys(values).length === 0) {
      validationError(
        res,
        "VALIDATION_ERROR",
        "Provide at least one field to update.",
        { _form: "Nothing to update." },
      );
      return;
    }

    const updated = await runSerializable(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: targetId },
        select: { id: true, role: true, isActive: true },
      });

      if (!target) {
        return null;
      }

      // ─── Duplicate email (BR-29, BR-10) ──────────────────────────────
      if (values.email !== undefined) {
        const owner = await findEmailOwner(tx, values.email, targetId);
        if (owner) {
          throw new ValidationConflict("EMAIL_ALREADY_IN_USE", EMAIL_IN_USE_MESSAGE, {
            email: EMAIL_IN_USE_MESSAGE,
          });
        }
      }

      // ─── Which guards apply? ─────────────────────────────────────────
      // Only relevant while the target is currently an active Administrator:
      // otherwise deactivating/demoting them cannot reduce the admin count.
      const targetIsActiveAdmin = target.role === "ADMINISTRATOR" && target.isActive;

      const wantsDeactivate = values.isActive === false;
      const wantsRoleAway =
        values.role !== undefined && values.role !== "ADMINISTRATOR";

      if (targetIsActiveAdmin && (wantsDeactivate || wantsRoleAway)) {
        if ((await otherActiveAdminCount(tx, targetId)) === 0) {
          // BR-24 / BR-31 / AC-13 — includes the Administrator acting on their
          // own account, which is exactly why this guard is evaluated BEFORE the
          // self-deactivation guard: a sole Administrator deactivating
          // themselves would otherwise be told only about their own account.
          throw new GuardConflict(
            "LAST_ACTIVE_ADMIN",
            "At least one active Administrator is required.",
          );
        }
      }

      // ─── Self-deactivation (BR-23, BR-30, AC-13) ─────────────────────
      if (wantsDeactivate && targetId === req.currentUser!.id) {
        throw new GuardConflict(
          "SELF_DEACTIVATION",
          "You cannot deactivate your own account.",
        );
      }

      const data: Prisma.UserUpdateInput = {};
      if (values.name !== undefined) data.name = values.name;
      if (values.email !== undefined) data.email = values.email;
      if (values.role !== undefined) data.role = values.role;
      if (values.isActive !== undefined) data.isActive = values.isActive;

      return tx.user.update({
        where: { id: targetId },
        data,
        select: { id: true, name: true, email: true, role: true, isActive: true },
      });
    });

    if (!updated) {
      res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found." } });
      return;
    }

    res.status(200).json(toAdminUserDto(updated));
  } catch (err) {
    if (err instanceof GuardConflict) {
      res.status(409).json({
        error: { code: err.code, message: err.message },
      });
      return;
    }
    if (err instanceof ValidationConflict) {
      validationError(res, err.code, err.message, err.fields);
      return;
    }
    if (isUniqueViolation(err)) {
      validationError(res, "EMAIL_ALREADY_IN_USE", EMAIL_IN_USE_MESSAGE, {
        email: EMAIL_IN_USE_MESSAGE,
      });
      return;
    }
    serverError(res);
  }
});

// ─── POST /api/admin/users/:id/reset-password ───────────────────────────

adminRouter.post("/users/:id/reset-password", async (req: Request, res: Response) => {
  try {
    const targetId = req.params.id;
    const body = (req.body ?? {}) as { newInitialPassword?: unknown };

    const policyError = passwordPolicyError(body.newInitialPassword);
    if (policyError) {
      validationError(res, "VALIDATION_ERROR", "Please fix the highlighted fields.", {
        newInitialPassword: policyError,
      });
      return;
    }

    const target = await getPrisma().user.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    if (!target) {
      res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found." } });
      return;
    }

    // Same hashing helper the seed and the auth endpoints use (BR-07/BR-25) —
    // never a second implementation.
    const passwordHash = await hashPassword(String(body.newInitialPassword));

    await getPrisma().user.update({
      where: { id: targetId },
      // BR-25 / FR-28: a reset password is always an *initial* password, so the
      // user is forced through Change Password at their next login.
      data: { passwordHash, mustChangePassword: true },
    });

    res.status(200).json({ success: true });
  } catch {
    serverError(res);
  }
});

export default adminRouter;
