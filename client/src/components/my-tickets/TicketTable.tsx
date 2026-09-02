/**
 * TicketTable — §8 My Tickets screen, responsive across all viewports.
 *
 * Desktop ≥992px: 9-column table (original layout).
 * Tablet 768–991px: Condensed table — only Ticket No., Summary,
 *   Current Status, Last Updated visible; other columns hidden via CSS.
 * Mobile <768px: Table replaced by stacked card list per ui-spec §8.
 *
 * §10: rows are keyboard-focusable.
 * §11: no horizontal scroll under any circumstance.
 */

import { useNavigate } from "react-router-dom";
import Badge from "../shared/Badge";
import styles from "./TicketTable.module.css";

export interface Ticket {
  id: number;
  ticketNumber: string;
  createdAt: string;
  summary: string;
  category: string;
  requestedPriority: string;
  itPriority: string | null;
  currentStatus: string;
  ticketOwner: string | null;
  updatedAt: string;
}

interface TicketTableProps {
  tickets: Ticket[];
}

/** Format ISO date string to a readable format (e.g. "22 Aug 2026") */
function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function TicketTable({ tickets }: TicketTableProps) {
  const navigate = useNavigate();

  function handleRowClick(ticketNumber: string) {
    // TODO: lab2/07 will implement the ticket detail page
    navigate(`/tickets/${ticketNumber}`);
  }

  function handleKeyDown(
    e: React.KeyboardEvent,
    ticketNumber: string,
  ) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleRowClick(ticketNumber);
    }
  }

  return (
    <>
      {/* ─── Desktop + Tablet: Table (hidden on mobile via CSS) ─── */}
      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Ticket No.</th>
              {/* §11 tablet: hidden via .hideOnTablet */}
              <th className={`${styles.th} ${styles.hideOnTablet}`}>Created Date</th>
              <th className={styles.th}>Summary</th>
              {/* §11 tablet: hidden via .hideOnTablet */}
              <th className={`${styles.th} ${styles.hideOnTablet}`}>Category</th>
              {/* §11 tablet: hidden via .hideOnTablet */}
              <th className={`${styles.th} ${styles.hideOnTablet}`}>Requested Priority</th>
              {/* §11 tablet: hidden via .hideOnTablet */}
              <th className={`${styles.th} ${styles.hideOnTablet}`}>IT Priority</th>
              <th className={styles.th}>Current Status</th>
              {/* §11 tablet: hidden via .hideOnTablet */}
              <th className={`${styles.th} ${styles.hideOnTablet}`}>Ticket Owner</th>
              <th className={styles.th}>Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr
                key={ticket.id}
                className={styles.row}
                onClick={() => handleRowClick(ticket.ticketNumber)}
                onKeyDown={(e) => handleKeyDown(e, ticket.ticketNumber)}
                tabIndex={0}
                aria-label={`Ticket ${ticket.ticketNumber}: ${ticket.summary}`}
              >
                <td className={styles.cell}>
                  <span className={styles.ticketNumber}>
                    {ticket.ticketNumber}
                  </span>
                </td>
                <td className={`${styles.cell} ${styles.hideOnTablet}`}>
                  {formatDate(ticket.createdAt)}
                </td>
                <td className={`${styles.cell} ${styles.summaryCell}`}>
                  {ticket.summary}
                </td>
                <td className={`${styles.cell} ${styles.hideOnTablet}`}>
                  {ticket.category}
                </td>
                <td className={`${styles.cell} ${styles.hideOnTablet}`}>
                  <Badge variant="priority" value={ticket.requestedPriority} />
                </td>
                <td className={`${styles.cell} ${styles.hideOnTablet}`}>
                  {ticket.itPriority ? (
                    <Badge variant="priority" value={ticket.itPriority} />
                  ) : (
                    <span className={styles.noValue}>—</span>
                  )}
                </td>
                <td className={styles.cell}>
                  <Badge variant="status" value={ticket.currentStatus} />
                </td>
                <td className={`${styles.cell} ${styles.hideOnTablet}`}>
                  {ticket.ticketOwner ?? (
                    <span className={styles.noValue}>Unassigned</span>
                  )}
                </td>
                <td className={styles.cell}>{formatDate(ticket.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ─── Mobile: Stacked card list (visible only on mobile via CSS) ─── */}
      <div className={styles.cardList} aria-label="Ticket list">
        {tickets.map((ticket) => (
          <div
            key={ticket.id}
            className={styles.card}
            onClick={() => handleRowClick(ticket.ticketNumber)}
            onKeyDown={(e) => handleKeyDown(e, ticket.ticketNumber)}
            tabIndex={0}
            role="article"
            aria-label={`Ticket ${ticket.ticketNumber}: ${ticket.summary}`}
          >
            {/* Top line: Ticket No. + Status badge */}
            <div className={styles.cardTop}>
              <span className={styles.ticketNumber}>
                {ticket.ticketNumber}
              </span>
              <Badge variant="status" value={ticket.currentStatus} />
            </div>

            {/* Summary */}
            <div className={styles.cardSummary}>{ticket.summary}</div>

            {/* Meta row: Category · Requested Priority · Last Updated */}
            <div className={styles.cardMeta}>
              {ticket.category} ·{" "}
              {ticket.requestedPriority.charAt(0) +
                ticket.requestedPriority.slice(1).toLowerCase()}{" "}
              · {formatDate(ticket.updatedAt)}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
