/**
 * AdminUsersPage — Administrator User Management (ui-spec.md §7).
 *
 * STUB for this branch: user management (list/search/create/edit/reset) is
 * implemented in `feature/lab3-admin-users`. The route exists now so the
 * Administrator's role-based navigation renders a real destination instead of
 * a 404.
 */

import styles from "./PlaceholderPage.module.css";

export default function AdminUsersPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>User Management</h1>
      <div className={styles.card}>
        <p className={styles.message}>
          User administration arrives in the Administrator users branch. Only Administrators can
          reach this route, and the API enforces that independently.
        </p>
      </div>
    </div>
  );
}
