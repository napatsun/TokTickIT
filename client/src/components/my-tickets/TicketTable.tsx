/**
 * TicketTable — §8 My Tickets desktop table (≥992px).
 *
 * 9 columns: Ticket No., Created Date, Summary, Category, Requested Priority,
 * IT Priority, Current Status, Ticket Owner, Last Updated.
 *
 * Uses Badge component for Requested Priority, IT Priority, and Current Status.
 * Rows are clickable (whole row) and navigate to Ticket Detail.
 * Ticket Detail route may not exist yet in Lab 2 — uses placeholder navigate.
 *
 * §10: rows are keyboard-focusable.
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
    // §8: "route may still not exist in Lab 2 — insert placeholder navigate or TODO"
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
    <div className={styles.tableContainer}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>Ticket No.</th>
            <th className={styles.th}>Created Date</th>
            <th className={styles.th}>Summary</th>
            <th className={styles.th}>Category</th>
            <th className={styles.th}>Requested Priority</th>
            <th className={styles.th}>IT Priority</th>
            <th className={styles.th}>Current Status</th>
            <th className={styles.th}>Ticket Owner</th>
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
              <td className={styles.cell}>{formatDate(ticket.createdAt)}</td>
              <td className={`${styles.cell} ${styles.summaryCell}`}>
                {ticket.summary}
              </td>
              <td className={styles.cell}>{ticket.category}</td>
              <td className={styles.cell}>
                <Badge variant="priority" value={ticket.requestedPriority} />
              </td>
              <td className={styles.cell}>
                {ticket.itPriority ? (
                  <Badge variant="priority" value={ticket.itPriority} />
                ) : (
                  <span className={styles.noValue}>—</span>
                )}
              </td>
              <td className={styles.cell}>
                <Badge variant="status" value={ticket.currentStatus} />
              </td>
              <td className={styles.cell}>
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
  );
}
