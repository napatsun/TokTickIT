/**
 * StaffQueuePage — IT Staff Ticket Queue (ui-spec.md §5).
 *
 * STUB for this branch: `feature/lab3-02-auth-and-authorization` delivers
 * authentication, authorization, and the application shell only. The queue
 * itself (search/filter/sort/pagination) is implemented in
 * `feature/lab3-staff-ticketing`. The route exists now so the role-based
 * navigation renders a real destination instead of a 404.
 */

import styles from "./PlaceholderPage.module.css";

export default function StaffQueuePage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Ticket Queue</h1>
      <div className={styles.card}>
        <p className={styles.message}>
          The shared ticket queue arrives in the IT Staff ticketing branch. Authorization for this
          route is already enforced server-side.
        </p>
      </div>
    </div>
  );
}
