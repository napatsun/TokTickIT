/**
 * FilterControls — §8 My Tickets controls row.
 *
 * Contains: Category dropdown, Requested Priority dropdown, Current Status
 * dropdown, Sort dropdown (4 options per D4), and a "Clear Filters" tertiary
 * button (visible only when ≥1 filter/search is active — Q6 decision).
 *
 * Uses Field component for dropdowns and Button component for Clear Filters.
 * Filter options come from filterOptions in the GET /api/tickets response (BR-15).
 */

import Field from "../shared/Field";
import Button from "../shared/Button";
import styles from "./FilterControls.module.css";

interface CategoryOption {
  id: number;
  name: string;
}

interface FilterControlsProps {
  /** Category filter value. Empty string = no filter. */
  categoryId: string;
  /** Requested Priority filter value. Empty string = no filter. */
  requestedPriority: string;
  /** Current Status filter value. Empty string = no filter. */
  currentStatus: string;
  /** Sort field: "createdAt" or "updatedAt". */
  sortBy: string;
  /** Sort direction: "asc" or "desc". */
  sortDir: string;
  /** Category options from filterOptions.categories in API response. */
  categoryOptions: CategoryOption[];
  /** Priority options from filterOptions.requestedPriorities in API response. */
  requestedPriorities: string[];
  /** Status options from filterOptions.currentStatuses in API response. */
  currentStatuses: string[];
  /** Whether any filter or search is active (controls Clear Filters visibility). */
  hasActiveFilters: boolean;
  /** Called when any filter value changes. */
  onFilterChange: (filters: {
    categoryId?: string;
    requestedPriority?: string;
    currentStatus?: string;
    sortBy?: string;
    sortDir?: string;
  }) => void;
  /** Called when Clear Filters is clicked. */
  onClearFilters: () => void;
}

/** Sort option definitions per D4: Created Date newest/oldest, Last Updated newest/oldest */
const SORT_OPTIONS = [
  { value: "createdAt:desc", label: "Created Date (newest)" },
  { value: "createdAt:asc", label: "Created Date (oldest)" },
  { value: "updatedAt:desc", label: "Last Updated (newest)" },
  { value: "updatedAt:asc", label: "Last Updated (oldest)" },
];

export default function FilterControls({
  categoryId,
  requestedPriority,
  currentStatus,
  sortBy,
  sortDir,
  categoryOptions,
  requestedPriorities,
  currentStatuses,
  hasActiveFilters,
  onFilterChange,
  onClearFilters,
}: FilterControlsProps) {
  return (
    <div className={styles.controlsRow}>
      {/* Category filter */}
      <div className={styles.filterGroup}>
        <Field
          type="select"
          label="Category"
          id="filter-category"
          value={categoryId}
          onChange={(e) =>
            onFilterChange({ categoryId: e.target.value })
          }
        >
          <option value="">All Categories</option>
          {categoryOptions.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </Field>
      </div>

      {/* Requested Priority filter */}
      <div className={styles.filterGroup}>
        <Field
          type="select"
          label="Requested Priority"
          id="filter-priority"
          value={requestedPriority}
          onChange={(e) =>
            onFilterChange({ requestedPriority: e.target.value })
          }
        >
          <option value="">All Priorities</option>
          {requestedPriorities.map((p) => (
            <option key={p} value={p}>
              {p.charAt(0) + p.slice(1).toLowerCase()}
            </option>
          ))}
        </Field>
      </div>

      {/* Current Status filter */}
      <div className={styles.filterGroup}>
        <Field
          type="select"
          label="Current Status"
          id="filter-status"
          value={currentStatus}
          onChange={(e) =>
            onFilterChange({ currentStatus: e.target.value })
          }
        >
          <option value="">All Statuses</option>
          {currentStatuses.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </Field>
      </div>

      {/* Sort dropdown */}
      <div className={styles.filterGroup}>
        <Field
          type="select"
          label="Sort by"
          id="filter-sort"
          value={`${sortBy}:${sortDir}`}
          onChange={(e) => {
            const [newSortBy, newSortDir] = e.target.value.split(":");
            onFilterChange({ sortBy: newSortBy, sortDir: newSortDir });
          }}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Field>
      </div>

      {/* §8: Clear Filters — tertiary, visible only when ≥1 filter/search active (Q6) */}
      <div className={styles.clearGroup}>
        {hasActiveFilters && (
          <Button variant="tertiary" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
