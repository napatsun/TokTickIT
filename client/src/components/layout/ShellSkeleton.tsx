/**
 * ShellSkeleton — ui-spec.md §1
 *
 * Full-shell placeholder rendered while `GET /api/auth/me` resolves on app
 * boot, so an authenticated refresh never flashes the Login screen.
 * Reuses the Zen Green header/surface tokens; no new visual language.
 */

import styles from "./ShellSkeleton.module.css";

export default function ShellSkeleton() {
  return (
    <div data-testid="shell-skeleton">
      <header className={styles.header}>
        <span className={styles.wordmark}>TokTickIT</span>
        <span className={styles.bar} style={{ width: 160 }} />
      </header>

      <div className={styles.content} role="status" aria-label="Loading your session">
        <span className={styles.bar} style={{ width: "40%", height: 20 }} />
        <span className={styles.bar} style={{ width: "100%", height: 120 }} />
        <span className={styles.bar} style={{ width: "70%", height: 14 }} />
      </div>
    </div>
  );
}
