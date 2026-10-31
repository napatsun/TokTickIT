/**
 * RequesterDashboard — ui-spec.md §3 (Requester Dashboard, FR-11, FR-12, FR-13)
 *
 * Route: /dashboard for a REQUESTER session (§3.4: the single route renders
 * one of the two dashboard components by role; the API is independently scoped
 * to the session's requesterId at the query layer, AC-02/AC-06).
 *
 * Layout (§3.1):
 *   - Welcome row ("Welcome, {firstName}!").
 *   - 4 metric cards: My Open Tickets, In Progress, Resolved, Closed — each
 *     with its own explicit "View all" link beneath the value (screen-reader
 *     labelled; the card body is also clickable).
 *   - Three distinct summary sections (FR-11), each with a total count badge,
 *     up to 5 rows, and a drill-down link to My Tickets with the matching filter:
 *       1. Attention Required (status IN WAITING_FOR_REQUESTER, REOPENED →
 *          /tickets?currentStatus=WAITING_FOR_REQUESTER,REOPENED)
 *       2. Recently Updated (own top 5 by updatedAt DESC → /tickets)
 *       3. Resolved (status IN RESOLVED, CLOSED →
 *          /tickets?currentStatus=RESOLVED,CLOSED)
 *   - Quick Actions (Create Ticket, View My Tickets). No delta chips anywhere:
 *     the requester response carries no `deltas` key (api-spec.md §3.2).
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Badge from "../components/shared/Badge";
import Button from "../components/shared/Button";
import { apiClient } from "../lib/apiClient";
import { formatDate } from "../lib/dateFormat";
import { useAuth } from "../hooks/useAuth";
import styles from "./Dashboard.module.css";

// ─── Types (api-spec.md §3.2 response shape — no `deltas` key) ───────────

interface RecentTicket {
  id: number;
  code: string;
  title: string;
  status: string;
  updatedAt: string;
}

interface RequesterSection {
  count: number;
  items: RecentTicket[];
}

interface RequesterDashboardPayload {
  generatedAt: string;
  timezone: string;
  counts: {
    myOpen: number;
    inProgress: number;
    resolved: number;
    closed: number;
  };
  recentTickets: RecentTicket[];
  attentionRequired?: RequesterSection;
  recentlyUpdated?: RequesterSection;
  resolvedWork?: RequesterSection;
}

type GroupState = "loading" | "ready" | "error";

interface MetricCard {
  key: string;
  label: string;
  value: number;
  /** §3.3: the exact status set this card counts — never the open-work alias. */
  to: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** One GET of the dashboard resource, or null on any failure. */
async function fetchPayload(): Promise<RequesterDashboardPayload | null> {
  try {
    const response = await apiClient("/api/dashboard/requester");
    if (!response.ok) return null;
    return (await response.json()) as RequesterDashboardPayload;
  } catch {
    return null;
  }
}

// ─── Component ───────────────────────────────────────────────────────────

export default function RequesterDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Per-group state — the partial-failure unit (§3.4, mirroring §2.4/UI-08).
  const [metricsState, setMetricsState] = useState<GroupState>("loading");
  const [recentState, setRecentState] = useState<GroupState>("loading");
  const [counts, setCounts] = useState<RequesterDashboardPayload["counts"] | null>(null);
  const [recentlyUpdated, setRecentlyUpdated] = useState<RequesterSection | null>(null);
  const [attentionRequired, setAttentionRequired] = useState<RequesterSection | null>(null);
  const [resolvedWork, setResolvedWork] = useState<RequesterSection | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchMetrics = useCallback(async () => {
    setMetricsState("loading");
    const payload = await fetchPayload();
    if (payload) {
      setCounts(payload.counts);
      setMetricsState("ready");
    } else {
      setMetricsState("error");
    }
  }, []);

  const fetchRecent = useCallback(async () => {
    setRecentState("loading");
    const payload = await fetchPayload();
    if (payload) {
      const fallbackRecent = payload.recentTickets ?? [];
      setRecentlyUpdated(
        payload.recentlyUpdated ?? {
          count: fallbackRecent.length,
          items: fallbackRecent,
        },
      );
      setAttentionRequired(
        payload.attentionRequired ?? {
          count: fallbackRecent.filter(
            (t) => t.status === "WAITING_FOR_REQUESTER" || t.status === "REOPENED",
          ).length,
          items: fallbackRecent.filter(
            (t) => t.status === "WAITING_FOR_REQUESTER" || t.status === "REOPENED",
          ),
        },
      );
      setResolvedWork(
        payload.resolvedWork ?? {
          count:
            (payload.counts?.resolved ?? 0) + (payload.counts?.closed ?? 0) ||
            fallbackRecent.filter((t) => t.status === "RESOLVED" || t.status === "CLOSED").length,
          items: fallbackRecent.filter((t) => t.status === "RESOLVED" || t.status === "CLOSED"),
        },
      );
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

  const metricCards: MetricCard[] | null = counts
    ? [
        {
          key: "myOpen",
          label: "My Open Tickets",
          value: counts.myOpen,
          // §3.3: must NOT be the open-work alias — In Progress has its own
          // card, and the alias would show more tickets than the card counts.
          to: "/tickets?currentStatus=NEW,OPEN,WAITING_FOR_REQUESTER,REOPENED",
        },
        {
          key: "inProgress",
          label: "In Progress",
          value: counts.inProgress,
          to: "/tickets?currentStatus=IN_PROGRESS",
        },
        {
          key: "resolved",
          label: "Resolved",
          value: counts.resolved,
          to: "/tickets?currentStatus=RESOLVED",
        },
        {
          key: "closed",
          label: "Closed",
          value: counts.closed,
          to: "/tickets?currentStatus=CLOSED",
        },
      ]
    : null;

  return (
    <div className={styles.page} data-testid="requester-dashboard">
      {/* ─── Welcome row (§3.1) ─────────────────────────────────────────── */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Welcome, {firstName}!</h1>
          <p className={styles.subtitle}>Track your support requests at a glance.</p>
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

      {/* ─── Metric cards group (§3.1) ─────────────────────────────────── */}
      {metricsState === "loading" && (
        <div className={styles.metricRow} aria-busy="true" aria-label="Loading dashboard metrics">
          {Array.from({ length: 4 }, (_, index) => (
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
        <div className={`${styles.metricRow} ${styles.metricRow4}`} data-testid="metric-cards">
          {metricCards.map((card) => (
            <div key={card.key} className={styles.metricCardStatic} data-testid={`metric-card-${card.key}`}>
              <button
                type="button"
                className={styles.metricCard}
                onClick={() => navigate(card.to)}
                aria-label={`${card.value} ${card.label}, view filtered tickets`}
              >
                <span className={styles.metricValue}>{card.value}</span>{" "}
                <span className={styles.metricLabel}>{card.label}</span>
              </button>
              {/* §3.1: the explicit, screen-reader-labelled drill-down link. */}
              <button
                type="button"
                className={styles.cardViewAll}
                data-testid={`card-view-all-${card.key}`}
                onClick={() => navigate(card.to)}
                aria-label={`View all ${card.label}`}
              >
                View all
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ─── First content row: Recently Updated + Quick Actions (§3.1) ─── */}
      <div className={styles.contentRow}>
        <section
          className={styles.recentPanel}
          aria-labelledby="recent-heading"
          data-testid="recently-updated-section"
        >
          <div className={styles.panelHeader}>
            <h2 id="recent-heading" className={styles.panelTitle}>
              Recently Updated
            </h2>
            {recentState === "ready" && recentlyUpdated && (
              <span className={styles.panelCount} data-testid="recently-updated-count">
                Total: {recentlyUpdated.count}
              </span>
            )}
            <button
              type="button"
              className={styles.viewAll}
              data-testid="recent-view-all"
              onClick={() => navigate("/tickets")}
              aria-label="View all recently updated tickets"
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

          {recentState === "ready" && recentlyUpdated && recentlyUpdated.items.length === 0 && (
            <div className={styles.emptyState} data-testid="recent-empty">
              <p>No recent Tickets yet.</p>
              <Button
                variant="primary"
                onClick={() => navigate("/tickets/new")}
                data-testid="recent-empty-cta"
              >
                Create Ticket
              </Button>
            </div>
          )}

          {recentState === "ready" && recentlyUpdated && recentlyUpdated.items.length > 0 && (
            <ul className={styles.recentList} data-testid="recent-list">
              {recentlyUpdated.items.map((ticket) => (
                <li key={ticket.id}>
                  <button
                    type="button"
                    className={styles.recentRow}
                    data-testid="recent-ticket-row"
                    title={ticket.title}
                    onClick={() => navigate(`/tickets/${ticket.code}`)}
                  >
                    <span className={styles.rowCode}>{ticket.code}</span>
                    <span className={styles.rowTitle} title={ticket.title}>
                      {ticket.title}
                    </span>
                    <span className={styles.rowMeta}>
                      <Badge variant="status" value={ticket.status} />
                      <span className={styles.rowUpdated}>{formatDate(ticket.updatedAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* §8 (AC-13): a <section> (not <aside>) keeps the labelled panel
            out of the App Shell's <main> landmark — axe
            `landmark-complementary-is-top-level`. Same class, same box model. */}
        <section className={styles.quickPanel} aria-labelledby="quick-heading">
          <h2 id="quick-heading" className={styles.panelTitle}>
            Quick Actions
          </h2>
          <div className={styles.quickActions} data-testid="quick-actions">
            <Button variant="primary" onClick={() => navigate("/tickets/new")} data-testid="quick-create">
              Create Ticket
            </Button>
            <Button variant="secondary" onClick={() => navigate("/tickets")} data-testid="quick-my-tickets">
              View My Tickets
            </Button>
          </div>
        </section>
      </div>

      {/* ─── Second content row: Attention Required + Resolved (FR-11) ─── */}
      <div className={styles.contentRow2}>
        <section
          className={styles.recentPanel}
          aria-labelledby="attention-required-heading"
          data-testid="attention-required-section"
        >
          <div className={styles.panelHeader}>
            <h2 id="attention-required-heading" className={styles.panelTitle}>
              Attention Required
            </h2>
            {recentState === "ready" && attentionRequired && (
              <span className={styles.panelCount} data-testid="attention-required-count">
                Total: {attentionRequired.count}
              </span>
            )}
            <button
              type="button"
              className={styles.viewAll}
              data-testid="attention-required-view-all"
              onClick={() => navigate("/tickets?currentStatus=WAITING_FOR_REQUESTER,REOPENED")}
              aria-label="View all attention-required tickets"
            >
              View all
            </button>
          </div>

          {recentState === "loading" && (
            <div aria-busy="true" aria-label="Loading attention-required tickets">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className={styles.rowSkeleton} data-testid="attention-required-skeleton" />
              ))}
            </div>
          )}

          {recentState === "error" && (
            <div className={styles.groupError} role="alert" data-testid="attention-required-error">
              <p>Couldn&apos;t load attention-required tickets.</p>
              <Button variant="secondary" onClick={() => void fetchRecent()}>
                Retry
              </Button>
            </div>
          )}

          {recentState === "ready" && attentionRequired && attentionRequired.items.length === 0 && (
            <div className={styles.emptyState} data-testid="attention-required-empty">
              <p>No Tickets require your attention right now.</p>
            </div>
          )}

          {recentState === "ready" && attentionRequired && attentionRequired.items.length > 0 && (
            <ul className={styles.recentList} data-testid="attention-required-list">
              {attentionRequired.items.map((ticket) => (
                <li key={ticket.id}>
                  <button
                    type="button"
                    className={styles.recentRow}
                    data-testid="attention-required-row"
                    title={ticket.title}
                    onClick={() => navigate(`/tickets/${ticket.code}`)}
                  >
                    <span className={styles.rowCode}>{ticket.code}</span>
                    <span className={styles.rowTitle} title={ticket.title}>
                      {ticket.title}
                    </span>
                    <span className={styles.rowMeta}>
                      <Badge variant="status" value={ticket.status} />
                      <span className={styles.rowUpdated}>{formatDate(ticket.updatedAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          className={styles.recentPanel}
          aria-labelledby="resolved-work-heading"
          data-testid="resolved-work-section"
        >
          <div className={styles.panelHeader}>
            <h2 id="resolved-work-heading" className={styles.panelTitle}>
              Resolved
            </h2>
            {recentState === "ready" && resolvedWork && (
              <span className={styles.panelCount} data-testid="resolved-work-count">
                Total: {resolvedWork.count}
              </span>
            )}
            <button
              type="button"
              className={styles.viewAll}
              data-testid="resolved-work-view-all"
              onClick={() => navigate("/tickets?currentStatus=RESOLVED,CLOSED")}
              aria-label="View all resolved and closed tickets"
            >
              View all
            </button>
          </div>

          {recentState === "loading" && (
            <div aria-busy="true" aria-label="Loading resolved tickets">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className={styles.rowSkeleton} data-testid="resolved-work-skeleton" />
              ))}
            </div>
          )}

          {recentState === "error" && (
            <div className={styles.groupError} role="alert" data-testid="resolved-work-error">
              <p>Couldn&apos;t load resolved tickets.</p>
              <Button variant="secondary" onClick={() => void fetchRecent()}>
                Retry
              </Button>
            </div>
          )}

          {recentState === "ready" && resolvedWork && resolvedWork.items.length === 0 && (
            <div className={styles.emptyState} data-testid="resolved-work-empty">
              <p>No resolved Tickets yet.</p>
            </div>
          )}

          {recentState === "ready" && resolvedWork && resolvedWork.items.length > 0 && (
            <ul className={styles.recentList} data-testid="resolved-work-list">
              {resolvedWork.items.map((ticket) => (
                <li key={ticket.id}>
                  <button
                    type="button"
                    className={styles.recentRow}
                    data-testid="resolved-work-row"
                    title={ticket.title}
                    onClick={() => navigate(`/tickets/${ticket.code}`)}
                  >
                    <span className={styles.rowCode}>{ticket.code}</span>
                    <span className={styles.rowTitle} title={ticket.title}>
                      {ticket.title}
                    </span>
                    <span className={styles.rowMeta}>
                      <Badge variant="status" value={ticket.status} />
                      <span className={styles.rowUpdated}>{formatDate(ticket.updatedAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
