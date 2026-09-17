/**
 * Password primitives — BR-07 / FR-07
 *
 * One module owns password hashing and the password policy so every caller
 * (seed, auth API, admin reset) applies identical rules. Plaintext passwords
 * must never be persisted, returned, or logged; only the salted bcrypt hash
 * leaves this module.
 */

import bcrypt from "bcryptjs";

/** bcrypt cost factor. 10 is the standard local/CI balance. */
const SALT_ROUNDS = 10;

/** Deterministic local-dev password documented in README "Seed Credentials". */
export const SEED_PASSWORD = "Password123!";
export const SEED_ADMIN_PASSWORD = "Admin123!";

/** Sentinel written by the Lab 3 migration for rows the seed must (re)hash. */
export const UNHASHED_PLACEHOLDER = "!unhashed-migrated-placeholder";

/**
 * Hash a plaintext password with a fresh random salt.
 * Never log or return the input.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/**
 * Verify a plaintext password against a stored bcrypt hash.
 * Always returns false for empty/placeholder hashes rather than throwing,
 * so an unknown or un-migrated account cannot be logged into.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!plain || !hash || hash === UNHASHED_PLACEHOLDER) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    // Malformed hash in the DB — treat as a failed comparison, never throw.
    return false;
  }
}

/** Minimum password policy (specification.md §11.6): ≥8 chars, ≥1 letter, ≥1 number. */
export const PASSWORD_RULE_MESSAGE =
  "Must be at least 8 characters and include a letter and a number";

/** Returns an error message when the password is unacceptable, else null. */
export function passwordPolicyError(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) {
    return "Password is required";
  }
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return PASSWORD_RULE_MESSAGE;
  }
  return null;
}
