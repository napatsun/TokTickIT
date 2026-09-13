import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Re-seed the local database before the end-to-end run.
 *
 * E2E-02/E2E-03 deliberately complete the mandatory first-login password
 * change, which mutates the seeded accounts. Re-seeding guarantees the
 * documented credentials (README → "Seed Credentials (local dev only)") are
 * back in place for every run.
 */
export default async function globalSetup(): Promise<void> {
  execSync("npx tsx prisma/seed.ts", {
    cwd: path.resolve(repoRoot, "server"),
    stdio: "inherit",
  });
}
