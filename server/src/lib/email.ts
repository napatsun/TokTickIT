/**
 * Email primitives — BR-10 (unique across all users), BR-26 (safe validation)
 *
 * One module owns how an email address is normalised and validated so that the
 * auth endpoints (branch 02) and the Administrator user-management endpoints
 * (branch 05) cannot drift apart. In particular, login already looks a user up
 * by lower-cased email; if user creation/editing did not normalise the same
 * way, two accounts differing only by case would exist while only one of them
 * could ever log in.
 *
 * BR-26 note: nothing in here reveals whether a conflicting email belongs to an
 * active or an inactive account. The duplicate check is a single generic
 * "This email is already in use." message in both cases.
 */

/**
 * Pragmatic format check (not RFC 5322). Deliberately permissive about the
 * local part and domain shape, strict about the presence of `@` and a dotted
 * domain, matching the rule the Login screen already used.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Canonical form of an email address: trimmed and lower-cased.
 * Returns "" for a non-string so callers can treat it as "missing".
 */
export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** True when `email` is already in canonical form and passes EMAIL_PATTERN. */
export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}
