/**
 * MyTicketsPage — §8 My Tickets screen (desktop ≥992px).
 *
 * Orchestrates:
 *   - SearchInput (debounced search by ticket number or summary)
 *   - FilterControls (Category, Requested Priority, Current Status, Sort)
 *   - TicketTable (9-column desktop table)
 *   - Pagination ("Showing X to Y of Z tickets" + page buttons)
 *   - "Create Ticket" primary button → navigates to /tickets/new
 *
 * Calls GET /api/tickets on every search/filter/sort/page change.
 * Stores state: search, categoryId, requestedPriority, currentStatus,
 * sortBy, sortDir, page, pageSize.
 *
 * Phase 2 scope: happy path only — no loading/empty/no-results/error UI.
 * Those are deferred to Phase 4.
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import SearchInput from "../components/shared/SearchInput";
import Button from "../components/shared/Button";
import Pagination from "../components/shared/Pagination";
import FilterControls from "../components/my-tickets/FilterControls";
import TicketTable, { type Ticket } from "../components/my-tickets/TicketTable";
import { apiClient } from "../lib/apiClient";
import styles from "./MyTicketsPage.module.css";

// ─── Types ──────────────────────────────────────────────────────────────

interface FilterOptions {
  categories: Array<{ id: number; name: string }>;
  requestedPriorities: string[];
  currentStatuses: string[];
}

interface PaginationInfo {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

interface TicketsResponse {
  tickets: Ticket[];
  pagination: PaginationInfo;
  filterOptions: FilterOptions;
}

// ─── Component ──────────────────────────────────────────────────────────

export default function MyTicketsPage() {
  const navigate = useNavigate();

  // ─── Filter/search/sort state ─────────────────────────────────────
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [requestedPriority, setRequestedPriority] = useState("");
  const [currentStatus, setCurrentStatus] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // ─── API response state ───────────────────────────────────────────
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    pageSize: 10,
    totalItems: 0,
    totalPages: 0,
  });
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    categories: [],
    requestedPriorities: [],
    currentStatuses: [],
  });

  // ─── Fetch tickets ────────────────────────────────────────────────
  const fetchTickets = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (categoryId) params.set("categoryId", categoryId);
      if (requestedPriority) params.set("requestedPriority", requestedPriority);
      if (currentStatus) params.set("currentStatus", currentStatus);
      params.set("sortBy", sortBy);
      params.set("sortDir", sortDir);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));

      const queryString = params.toString();
      const url = `/api/tickets${queryString ? `?${queryString}` : ""}`;

      const response = await apiClient(url);
      const data: TicketsResponse = await response.json();

      setTickets(data.tickets ?? []);
      setPagination(data.pagination ?? { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 });
      setFilterOptions(data.filterOptions ?? { categories: [], requestedPriorities: [], currentStatuses: [] });
    } catch {
      // Phase 4 will handle error states
    }
  }, [search, categoryId, requestedPriority, currentStatus, sortBy, sortDir, page, pageSize]);

  // Fetch on mount and whenever filters change
  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  // ─── Filter change handler ────────────────────────────────────────
  const handleFilterChange = useCallback(
    (filters: {
      categoryId?: string;
      requestedPriority?: string;
      currentStatus?: string;
      sortBy?: string;
      sortDir?: string;
    }) => {
      if (filters.categoryId !== undefined) setCategoryId(filters.categoryId);
      if (filters.requestedPriority !== undefined) setRequestedPriority(filters.requestedPriority);
      if (filters.currentStatus !== undefined) setCurrentStatus(filters.currentStatus);
      if (filters.sortBy !== undefined) setSortBy(filters.sortBy);
      if (filters.sortDir !== undefined) setSortDir(filters.sortDir);
      setPage(1); // Reset to page 1 on filter change
    },
    [],
  );

  // ─── Search handler (debounced from SearchInput) ──────────────────
  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1); // Reset to page 1 on search
  }, []);

  // ─── Clear filters handler ────────────────────────────────────────
  const handleClearFilters = useCallback(() => {
    setSearch("");
    setCategoryId("");
    setRequestedPriority("");
    setCurrentStatus("");
    setSortBy("createdAt");
    setSortDir("desc");
    setPage(1);
  }, []);

  // ─── Determine if any filter/search is active (for Clear Filters visibility) ───
  const hasActiveFilters =
    search !== "" ||
    categoryId !== "" ||
    requestedPriority !== "" ||
    currentStatus !== "" ||
    sortBy !== "createdAt" ||
    sortDir !== "desc";

  return (
    <div className={styles.page}>
      {/* §8: Page header — title + subtitle + Create Ticket button */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>My Tickets</h1>
          <p className={styles.subtitle}>
            View and track all of your support requests.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => navigate("/tickets/new")}
        >
          Create Ticket
        </Button>
      </div>

      {/* §8: Controls row — Search + filters + sort */}
      <div className={styles.controlsSection}>
        <SearchInput
          value={search}
          onSearch={handleSearch}
          id="ticket-search"
        />
        <FilterControls
          categoryId={categoryId}
          requestedPriority={requestedPriority}
          currentStatus={currentStatus}
          sortBy={sortBy}
          sortDir={sortDir}
          categoryOptions={filterOptions.categories}
          requestedPriorities={filterOptions.requestedPriorities}
          currentStatuses={filterOptions.currentStatuses}
          hasActiveFilters={hasActiveFilters}
          onFilterChange={handleFilterChange}
          onClearFilters={handleClearFilters}
        />
      </div>

      {/* §8: Table */}
      <TicketTable tickets={tickets} />

      {/* §8: Pagination footer */}
      <Pagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        totalItems={pagination.totalItems}
        totalPages={pagination.totalPages}
        onPageChange={setPage}
      />
    </div>
  );
}
