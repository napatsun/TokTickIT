import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(repoRoot, "server");

function run(command: string): void {
  execSync(command, { cwd: serverDir, stdio: "inherit" });
}

/**
 * Reset the local database and re-seed it before every end-to-end run.
 *
 * Two kinds of cross-run residue make a plain idempotent re-seed insufficient
 * for repeatability:
 *
 *  1. MUTATION of seeded rows. E2E-02/E2E-03 complete the mandatory first-login
 *     password change (BR-02) and status transitions rewrite Ticket rows, so the
 *     documented seed credentials/state must be restored.
 *  2. INSERTION of new durable rows. `e2e/lab-04/actions-taken-flow.spec.ts`
 *     creates an Actions Taken entry (E2E-01 — by design; there is no delete
 *     endpoint) and `user-administration.spec.ts` creates a user. `seed()` only
 *     upserts by business key, so it restores mutated rows but never removes the
 *     extra ones; a second run of the suite then fails assertions such as
 *     "exactly one seeded Actions Taken entry".
 *
 * `prisma migrate reset --force --skip-seed` drops and re-creates the schema,
 * replays every migration, and leaves seeding to the explicit `seed.ts` run
 * below — the same pristine-database state the Lab 3/4 release-verification
 * instructions describe, produced without any manual step. It only ever touches
 * the local development database named by `DATABASE_URL` in `server/.env`.
 */
export default async function globalSetup(): Promise<void> {
  run("npx prisma migrate reset --force --skip-seed");
  run("npx tsx prisma/seed.ts");
}
