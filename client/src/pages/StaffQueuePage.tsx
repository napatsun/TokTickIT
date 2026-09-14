/**
 * StaffQueuePage — IT Staff Ticket Queue (ui-spec.md §5)
 * Route: /staff/queue — IT Staff, Administrator
 *
 * Data source: GET /api/staff/tickets (api-spec.md §3) with
 *   q (min 2 chars) · status · priority · owner · sortBy · sortDir · page · pageSize
 *
 * Desktop: table matching the handout mock — Ticket No., Created Date, Summary,
 * Category, Req. Priority, IT Priority, Status, Owner + an "Open" row action.
 * Mobile/tablet (<992px via CSS): the same rows render as stacked cards and the
 * filter controls collapse into a "Filters" drawer.
 *
 * States (§5): Loading (skeleton rows / skeleton cards), Populated, Empty
 * ("No tickets yet."), No results ("No tickets match your search/filters." +
 * Clear filters), Failure ("Couldn't load the queue. Retry.").
 *
 * Route param convention: rows navigate by the internal numeric Ticket `id`
 * (`/staff/tickets/:id`), never the Requester-facing ticket number (§3).
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Badge from "../components/shared/Badge";
import Button from "../components/shared/Button";
import Pagination from "../components/shared/Pagination";
import SearchInput from "../components/shared/SearchInput";
import { apiClient } from "../lib/apiClient";
import styles from "./StaffQueuePage.module.css";

// ─── Types ──────────────────────────────────────────────────────────────

interface QueueItem {
  id: number;
  ticketNumber: string;
  createdAt: string;
  summary: string;
  category: string;
  requestedPriority: string;
  itPriority: string;
  status: string;
  owner: { id: string; name: string } | null;
}

interface QueueResponse {
  items: QueueItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

type QueueStatus = "loading" | "ready" | "error";

type SortableField = "createdAt" | "itPriority" | "status";

/** Pages of 10 match the handout mock ("Showing 1 to 10 of 67", §5). */
const PAGE_SIZE = 10;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "NEW", label: "New" },
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "WAITING_FOR_REQUESTER", label: "Waiting for Requester" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
  { value: "REOPENED", label: "Reopened" },
  { value: "CANCELLED", label: "Cancelled" },
];

const PRIORITY_OPTIONS = [
  { value: "", label: "All priorities" },
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
];

const OWNER_OPTIONS = [
  { value: "", label: "All owners" },
  { value: "unassigned", label: "Unassigned" },
  { value: "me", label: "Mine" },
];

// ─── Helpers ────────────────────────────────────────────────────────────

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ─── Component ──────────────────────────────────────────────────────────

export default function StaffQueuePage() {
  const navigate = useNavigate();

  const [items, setItems] = useState<QueueItem[]>([]);
  const [status, setStatus] = useState<QueueStatus>("loading");
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);

  // Filters / sort
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortableField>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const hasActiveFilters =
    search.trim() !== "" ||
    statusFilter !== "" ||
    priorityFilter !== "" ||
    ownerFilter !== "";

  // ─── Load the queue ───────────────────────────────────────────────────
  const fetchQueue = useCallback(async () => {
    setStatus("loading");

    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (statusFilter) params.set("status", statusFilter);
    if (priorityFilter) params.set("priority", priorityFilter);
    if (ownerFilter) params.set("owner", ownerFilter);
    params.set("sortBy", sortBy);
    params.set("sortDir", sortDir);
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));

    try {
      const response = await apiClient(`/api/staff/tickets?${params.toString()}`);

      if (!response.ok) {
        setStatus("error");
        return;
      }

      const data = (await response.json()) as QueueResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [search, statusFilter, priorityFilter, ownerFilter, sortBy, sortDir, page]);

  useEffect(() => {
    void fetchQueue();
  }, [fetchQueue]);

  // ─── Handlers ─────────────────────────────────────────────────────────

  /** Any filter change returns to page 1 so the user never lands on an empty page. */
  function handleSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function handleFilterChange(setter: (value: string) => void) {
    return (event: React.ChangeEvent<HTMLSelectElement>) => {
      setter(event.target.value);
      setPage(1);
    };
  }

  function clearFilters() {
    setSearch("");
    setStatusFilter("");
    setPriorityFilter("");
    setOwnerFilter("");
    setPage(1);
  }

  /** Clicking an active sortable header flips the direction; a new header starts ascending. */
  function toggleSort(field: SortableField) {
    if (sortBy === field) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("asc");
    }
    setPage(1);
  }

  function ariaSort(field: SortableField): "ascending" | "descending" | "none" | undefined {
    if (sortBy !== field) return undefined;
    return sortDir === "asc" ? "ascending" : "descending";
  }

  function sortIndicator(field: SortableField): string {
    if (sortBy !== field) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  function openTicket(id: number) {
    navigate(`/staff/tickets/${id}`);
  }

  // ─── Render: failure ──────────────────────────────────────────────────
  if (status === "error") {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>Ticket Queue</h1>
        <div className={styles.errorBanner} role="alert" data-testid="queue-error">
          <p>Couldn&apos;t load the queue. Retry.</p>
          <Button variant="tertiary" onClick={() => void fetchQueue()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const isLoading = status === "loading";
  const isEmpty = !isLoading && total === 0;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Ticket Queue</h1>

      {/* ─── Controls ─────────────────────────────────────────────────── */}
      <div className={styles.controls}>
        <SearchInput
          value={search}
          onSearch={handleSearch}
          placeholder="Search by ticket number or summary…"
          id="queue-search"
        />

        <button
          type="button"
          className={styles.filtersToggle}
          aria-expanded={filtersOpen}
          aria-controls="queue-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          Filters
          {hasActiveFilters && <span className={styles.filterDot} aria-hidden="true" />}
        </button>
      </div>

      <div
        id="queue-filters"
        className={`${styles.filtersPanel} ${filtersOpen ? styles.filtersOpen : ""}`}
        data-testid="queue-filters"
      >
        <label className={styles.filterLabel} htmlFor="queue-status-filter">
          Status
          <select
            id="queue-status-filter"
            className={styles.select}
            value={statusFilter}
            onChange={handleFilterChange(setStatusFilter)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.filterLabel} htmlFor="queue-priority-filter">
          IT Priority
          <select
            id="queue-priority-filter"
            className={styles.select}
            value={priorityFilter}
            onChange={handleFilterChange(setPriorityFilter)}
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.filterLabel} htmlFor="queue-owner-filter">
          Ownership
          <select
            id="queue-owner-filter"
            className={styles.select}
            value={ownerFilter}
            onChange={handleFilterChange(setOwnerFilter)}
          >
            {OWNER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <Button variant="tertiary" onClick={clearFilters} disabled={!hasActiveFilters}>
          Clear filters
        </Button>
      </div>

      {/* ─── Loading skeleton ─────────────────────────────────────────── */}
      {isLoading && (
        <div className={styles.skeleton} aria-busy="true" aria-label="Loading the queue">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className={styles.skeletonRow} data-testid="queue-skeleton-row" />
          ))}
        </div>
      )}

      {/* ─── Empty / no-results ───────────────────────────────────────── */}
      {isEmpty && (
        <div className={styles.emptyState} data-testid="queue-empty">
          {hasActiveFilters ? (
            <>
              <p className={styles.emptyMessage}>No tickets match your search/filters.</p>
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            </>
          ) : (
            <p className={styles.emptyMessage}>No tickets yet.</p>
          )}
        </div>
      )}

      {!isLoading && !isEmpty && (
        <>
          {/* ─── Desktop + tablet: table ─────────────────────────────── */}
          <div className={styles.tableContainer} data-testid="queue-table">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Ticket No.</th>
                  <th className={styles.th} aria-sort={ariaSort("createdAt")}>
                    <button
                      type="button"
                      className={styles.sortButton}
                      onClick={() => toggleSort("createdAt")}
                    >
                      Created Date{sortIndicator("createdAt")}
                    </button>
                  </th>
                  <th className={styles.th}>Summary</th>
                  <th className={styles.th}>Category</th>
                  <th className={styles.th}>Req. Priority</th>
                  <th className={styles.th} aria-sort={ariaSort("itPriority")}>
                    <button
                      type="button"
                      className={styles.sortButton}
                      onClick={() => toggleSort("itPriority")}
                    >
                      IT Priority{sortIndicator("itPriority")}
                    </button>
                  </th>
                  <th className={styles.th} aria-sort={ariaSort("status")}>
                    <button
                      type="button"
                      className={styles.sortButton}
                      onClick={() => toggleSort("status")}
                    >
                      Status{sortIndicator("status")}
                    </button>
                  </th>
                  <th className={styles.th}>Owner</th>
                  <th className={styles.th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={styles.row} data-testid="queue-row">
                    <td className={styles.cell}>
                      <span className={styles.ticketNumber}>{item.ticketNumber}</span>
                    </td>
                    <td className={styles.cell}>{formatDate(item.createdAt)}</td>
                    <td className={`${styles.cell} ${styles.summaryCell}`}>{item.summary}</td>
                    <td className={styles.cell}>{item.category}</td>
                    <td className={styles.cell}>
                      <Badge variant="priority" value={item.requestedPriority} />
                    </td>
                    <td className={styles.cell}>
                      <Badge variant="priority" value={item.itPriority} />
                    </td>
                    <td className={styles.cell}>
                      <Badge variant="status" value={item.status} />
                    </td>
                    <td className={styles.cell}>
                      {item.owner ? (
                        item.owner.name
                      ) : (
                        <span className={styles.unassigned}>Unassigned</span>
                      )}
                    </td>
                    <td className={styles.cell}>
                      <Button
                        variant="secondary"
                        onClick={() => openTicket(item.id)}
                        aria-label={`Open ticket ${item.ticketNumber}`}
                      >
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ─── Mobile: stacked cards ───────────────────────────────── */}
          <div className={styles.cardList} data-testid="queue-cards">
            {items.map((item) => (
              <article key={item.id} className={styles.card} data-testid="queue-card">
                <div className={styles.cardTop}>
                  <span className={styles.ticketNumber}>{item.ticketNumber}</span>
                  <Badge variant="status" value={item.status} />
                </div>

                <p className={styles.cardSummary}>{item.summary}</p>

                <div className={styles.cardMeta}>
                  <span className={styles.cardMetaLabel}>Category</span>
                  <span>{item.category}</span>
                </div>
                <div className={styles.cardMeta}>
                  <span className={styles.cardMetaLabel}>Req. Priority</span>
                  <Badge variant="priority" value={item.requestedPriority} />
                </div>
                <div className={styles.cardMeta}>
                  <span className={styles.cardMetaLabel}>IT Priority</span>
                  <Badge variant="priority" value={item.itPriority} />
                </div>
                <div className={styles.cardMeta}>
                  <span className={styles.cardMetaLabel}>Owner</span>
                  <span>
                    {item.owner ? item.owner.name : <span className={styles.unassigned}>Unassigned</span>}
                  </span>
                </div>
                <div className={styles.cardMeta}>
                  <span className={styles.cardMetaLabel}>Created</span>
                  <span>{formatDate(item.createdAt)}</span>
                </div>

                <Button
                  variant="secondary"
                  onClick={() => openTicket(item.id)}
                  aria-label={`Open ticket ${item.ticketNumber}`}
                >
                  Open
                </Button>
              </article>
            ))}
          </div>

          {/* ─── Pagination footer ───────────────────────────────────── */}
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            totalItems={total}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
