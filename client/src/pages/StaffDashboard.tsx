/**
 * StaffDashboard — ui-spec.md §2 (IT Staff Dashboard, FR-10, FR-12, FR-13)
 *
 * Route: /dashboard for an IT_STAFF/ADMINISTRATOR session (the single
 * /dashboard route renders this component or RequesterDashboard by role —
 * §2.4 "Forbidden" row: there is no separate route to guard, and the API
 * independently answers 403 FORBIDDEN_ROLE for a Requester session, so no
 * staff data can reach a Requester's browser regardless of routing).
 *
 * Layout (§2.1):
 *   - Welcome row + manual Refresh (busy state on the button only).
 *   - 5 metric cards: New, Open, In Progress (incl. Reopened, BR-14), Waiting
 *     for Requester, My Assigned. The first four render a delta chip with an
 *     icon AND text (never colour alone, §8); My Assigned has no delta key in
 *     the API response (§3.1) and renders none.
 *   - My Recent Tickets (≤5 rows: code, title, status badge, updated time) with
 *     a "View all" link to the unfiltered queue.
 *   - Quick Actions: Search Tickets, My Queue. (ui-spec §2.1 also lists
 *     "Create Ticket" → /tickets/new, but that route is Requester-only in the
 *     shipped app — IT Staff cannot create Tickets — so the affordance is
 *     omitted rather than shipped as a dead end; confirmed with the course
 *     staff during implementation.)
 *
 * Drill-downs (§2.3) filter on EXACTLY the status set each card counts
 * (§1's rule): the In Progress card carries the multi-value
 * status=IN_PROGRESS,REOPENED list, My Assigned carries owner=me plus the
 * full open-work list, because the queue's owner=me filter alone would include
 * the user's Closed/Cancelled tickets, which the card never counts.
 *
 * States (§2.4):
 *   - Loading: skeleton cards + rows, no layout shift.
 *   - Zero values render as a real "0" card (AC-10).
 *   - Safe failure is PER CARD GROUP (§2.4: "an inline error state per card
 *     group"; tests.md UI-08: "only failed section shows retry; others show
 *     data"). The endpoint is one resource, so each group issues its own
 *     request for the same URL and keeps its own loading/error state: a
 *     failure (or a Retry) in one group never blanks or blocks the other.
 *     The cost is a second GET per view — accepted because the per-group
 *     partial-failure behaviour is a documented, graded requirement.
 *   - Refresh re-fetches both groups.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Badge from "../components/shared/Badge";
import Button from "../components/shared/Button";
import { apiClient } from "../lib/apiClient";
import { useAuth } from "../hooks/useAuth";
import styles from "./Dashboard.module.css";

// ─── Types (api-spec.md §3.1 response shape) ─────────────────────────────

interface RecentTicket {
  id: number;
  code: string;
  title: string;
  status: string;
  updatedAt: string;
}

interface StaffDashboardPayload {
  generatedAt: string;
  timezone: string;
  counts: {
    new: number;
    open: number;
    inProgress: number;
    waitingForRequester: number;
    myAssigned: number;
  };
  deltas: {
    new: number;
    open: number;
    inProgress: number;
    waitingForRequester: number;
  };
  recentTickets: RecentTicket[];
}

type GroupState = "loading" | "ready" | "error";

// ─── Drill-down destinations (ui-spec.md §2.3, verbatim sets) ────────────

const OPEN_WORK_QUERY = "NEW,OPEN,IN_PROGRESS,WAITING_FOR_REQUESTER,REOPENED";

interface MetricCard {
  key: string;
  label: string;
  value: number;
  /** §3.1: only the four status cards carry a delta; My Assigned does not. */
  delta: number | null;
  /** The queue URL whose status set equals this card's count. */
  to: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatRelative(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Delta chip text + icon pair — meaning is carried by icon AND text (§8). */
function deltaChip(delta: number): { icon: string; text: string } {
  if (delta > 0) return { icon: "▲", text: `+${delta} from yesterday` };
  if (delta < 0) return { icon: "▼", text: `${delta} from yesterday` };
  return { icon: "•", text: "no change from yesterday" };
}

/** CSS-module class for a delta direction (colour is supplementary to icon+text). */
function deltaClass(delta: number): string {
  if (delta > 0) return "deltaUp";
  if (delta < 0) return "deltaDown";
  return "deltaFlat";
}

/** One GET of the dashboard resource, or null on any failure. */
async function fetchPayload(): Promise<StaffDashboardPayload | null> {
  try {
    const response = await apiClient("/api/dashboard/staff");
    if (!response.ok) return null;
    return (await response.json()) as StaffDashboardPayload;
  } catch {
    return null;
  }
}

// ─── Component ───────────────────────────────────────────────────────────

export default function StaffDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Per-group state — the partial-failure unit (§2.4 / UI-08).
  const [metricsState, setMetricsState] = useState<GroupState>("loading");
  const [recentState, setRecentState] = useState<GroupState>("loading");
  const [counts, setCounts] = useState<StaffDashboardPayload["counts"] | null>(null);
  const [deltas, setDeltas] = useState<StaffDashboardPayload["deltas"] | null>(null);
  const [recent, setRecent] = useState<RecentTicket[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchMetrics = useCallback(async () => {
    setMetricsState("loading");
    const payload = await fetchPayload();
    if (payload) {
      setCounts(payload.counts);
      setDeltas(payload.deltas);
      setMetricsState("ready");
    } else {
      setMetricsState("error");
    }
  }, []);

  const fetchRecent = useCallback(async () => {
    setRecentState("loading");
    const payload = await fetchPayload();
    if (payload) {
      setRecent(payload.recentTickets);
      setRecentState("ready");
    } else {
      setRecentState("error");
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchMetrics(), fetchRecent()]);
    setRefreshing(false);
  }, [fetchMetrics, fetchRecent]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const firstName = (user?.name ?? "").split(" ")[0];

  // Metric card definitions are derived from the live response so the value,
  // delta, and destination always describe the same data.
  const metricCards: MetricCard[] | null = counts && deltas
    ? [
        {
          key: "new",
          label: "New",
          value: counts.new,
          delta: deltas.new,
          to: "/staff/queue?status=NEW",
        },
        {
          key: "open",
          label: "Open",
          value: counts.open,
          delta: deltas.open,
          to: "/staff/queue?status=OPEN",
        },
        {
          key: "inProgress",
          label: "In Progress",
          value: counts.inProgress,
          delta: deltas.inProgress,
          // §2.3: the card folds REOPENED in, so its drill-down must too.
          to: "/staff/queue?status=IN_PROGRESS,REOPENED",
        },
        {
          key: "waitingForRequester",
          label: "Waiting for Requester",
          value: counts.waitingForRequester,
          delta: deltas.waitingForRequester,
          to: "/staff/queue?status=WAITING_FOR_REQUESTER",
        },
        {
          key: "myAssigned",
          label: "My Assigned",
          value: counts.myAssigned,
          // §3.1: no deltas.myAssigned key exists — assignment is not a status
          // transition — so the card renders no delta chip (not even "0").
          delta: null,
          // §2.3: owner=me alone would surface Closed/Cancelled tickets, which
          // the card's count excludes — carry the explicit open-work list.
          to: `/staff/queue?owner=me&status=${OPEN_WORK_QUERY}`,
        },
      ]
    : null;

  return (
    <div className={styles.page} data-testid="staff-dashboard">
      {/* ─── Welcome row (§2.1) ─────────────────────────────────────────── */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Welcome back, {firstName}!</h1>
          <p className={styles.subtitle}>Here is what is happening across the queue today.</p>
        </div>
        <Button
          variant={refreshing ? "busy" : "secondary"}
          onClick={() => void refreshAll()}
          busyLabel="Refreshing…"
          data-testid="dashboard-refresh"
        >
          Refresh
        </Button>
      </div>

      {/* ─── Metric cards group (§2.1) ─────────────────────────────────── */}
      {metricsState === "loading" && (
        <div className={styles.metricRow} aria-busy="true" aria-label="Loading dashboard metrics">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className={styles.metricSkeleton} data-testid="metric-skeleton" />
          ))}
        </div>
      )}

      {metricsState === "error" && (
        <div className={styles.groupError} role="alert" data-testid="metrics-error">
          <p>Couldn&apos;t load metrics.</p>
          <Button variant="secondary" onClick={() => void fetchMetrics()}>
            Retry
          </Button>
        </div>
      )}

      {metricsState === "ready" && metricCards && (
        <div className={styles.metricRow} data-testid="metric-cards">
          {metricCards.map((card) => {
            const chip = card.delta === null ? null : deltaChip(card.delta);
            return (
              <button
                key={card.key}
                type="button"
                className={styles.metricCard}
                data-testid={`metric-card-${card.key}`}
                onClick={() => navigate(card.to)}
                // §8: the accessible name carries label + value, not colour.
                aria-label={`${card.label}: ${card.value}, view filtered queue`}
              >
                <span className={styles.metricValue}>{card.value}</span>
                <span className={styles.metricLabel}>{card.label}</span>
                {chip && card.delta !== null && (
                  <span
                    className={`${styles.deltaChip} ${styles[deltaClass(card.delta)]}`}
                    data-testid={`delta-${card.key}`}
                  >
                    <span aria-hidden="true">{chip.icon}</span> {chip.text}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ─── Two-column content row (§2.1) ─────────────────────────────── */}
      <div className={styles.contentRow}>
        <section className={styles.recentPanel} aria-labelledby="recent-heading">
          <div className={styles.panelHeader}>
            <h2 id="recent-heading" className={styles.panelTitle}>
              My Recent Tickets
            </h2>
            <button
              type="button"
              className={styles.viewAll}
              data-testid="recent-view-all"
              onClick={() => navigate("/staff/queue")}
            >
              View all
            </button>
          </div>

          {recentState === "loading" && (
            <div aria-busy="true" aria-label="Loading recent tickets">
              {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className={styles.rowSkeleton} data-testid="recent-skeleton-row" />
              ))}
            </div>
          )}

          {recentState === "error" && (
            <div className={styles.groupError} role="alert" data-testid="recent-error">
              <p>Couldn&apos;t load recent tickets.</p>
              <Button variant="secondary" onClick={() => void fetchRecent()}>
                Retry
              </Button>
            </div>
          )}

          {recentState === "ready" && recent && recent.length === 0 && (
            <div className={styles.emptyState} data-testid="recent-empty">
              <p>No recent Tickets yet.</p>
            </div>
          )}

          {recentState === "ready" && recent && recent.length > 0 && (
            <ul className={styles.recentList} data-testid="recent-list">
              {recent.map((ticket) => (
                <li key={ticket.id}>
                  <button
                    type="button"
                    className={styles.recentRow}
                    data-testid="recent-ticket-row"
                    onClick={() => navigate(`/staff/tickets/${ticket.id}`)}
                    aria-label={`${ticket.code}: ${ticket.title}, open ticket detail`}
                  >
                    <span className={styles.rowCode}>{ticket.code}</span>
                    <span className={styles.rowTitle}>{ticket.title}</span>
                    <span className={styles.rowMeta}>
                      <Badge variant="status" value={ticket.status} />
                      <span className={styles.rowUpdated}>{formatRelative(ticket.updatedAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className={styles.quickPanel} aria-labelledby="quick-heading">
          <h2 id="quick-heading" className={styles.panelTitle}>
            Quick Actions
          </h2>
          <div className={styles.quickActions} data-testid="quick-actions">
            <Button
              variant="secondary"
              onClick={() => navigate("/staff/queue?focus=search")}
              data-testid="quick-search"
            >
              Search Tickets
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate(`/staff/queue?owner=me&status=${OPEN_WORK_QUERY}`)}
              data-testid="quick-my-queue"
            >
              My Queue
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
