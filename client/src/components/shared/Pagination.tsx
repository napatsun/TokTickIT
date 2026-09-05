/**
 * Pagination — §8 My Tickets pagination footer.
 *
 * Shows "Showing X to Y of Z tickets" + Previous/Next + numbered page buttons.
 * Follows Q7 decision and handout example.
 *
 * Reuses Button component for Previous/Next buttons.
 */

import Button from "./Button";
import styles from "./Pagination.module.css";

interface PaginationProps {
  /** Current 1-indexed page number. */
  page: number;
  /** Items per page. */
  pageSize: number;
  /** Total number of items across all pages. */
  totalItems: number;
  /** Total number of pages. */
  totalPages: number;
  /** Called when the user clicks a page button. */
  onPageChange: (page: number) => void;
}

export default function Pagination({
  page,
  pageSize,
  totalItems,
  totalPages,
  onPageChange,
}: PaginationProps) {
  if (totalItems === 0) return null;

  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, totalItems);

  // Generate page numbers to display
  // Show up to 5 page buttons with ellipsis
  const getPageNumbers = (): (number | "ellipsis")[] => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const pages: (number | "ellipsis")[] = [];
    pages.push(1);

    if (page > 3) {
      pages.push("ellipsis");
    }

    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (page < totalPages - 2) {
      pages.push("ellipsis");
    }

    if (totalPages > 1) {
      pages.push(totalPages);
    }

    return pages;
  };

  const pageNumbers = getPageNumbers();

  return (
    <nav className={styles.pagination} aria-label="Pagination">
      {/* §8: "Showing X to Y of Z tickets" */}
      <span className={styles.summary}>
        Showing {startItem} to {endItem} of {totalItems} tickets
      </span>

      <div className={styles.controls}>
        {/* Previous button */}
        <Button
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          Previous
        </Button>

        {/* Page number buttons */}
        <div className={styles.pageNumbers}>
          {pageNumbers.map((p, i) =>
            p === "ellipsis" ? (
              <span key={`ellipsis-${i}`} className={styles.ellipsis}>
                …
              </span>
            ) : (
              <Button
                key={p}
                variant={p === page ? "primary" : "secondary"}
                onClick={() => onPageChange(p)}
                aria-label={`Page ${p}`}
                aria-current={p === page ? "page" : undefined}
                className={p === page ? styles.activePage : ""}
              >
                {p}
              </Button>
            ),
          )}
        </div>

        {/* Next button */}
        <Button
          variant="secondary"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
