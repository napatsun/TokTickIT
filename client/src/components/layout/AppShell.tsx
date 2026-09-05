import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useRequester } from "../../hooks/useRequester.js";
import styles from "./AppShell.module.css";

/**
 * §6 — Application Shell:
 *   Header bar (primary-green bg, white wordmark)
 *   Primary nav: "My Tickets" | "Create Ticket"
 *   Right: current-Requester pill badge + "Change Requester" button
 *   Mobile: hamburger nav, requester badge always visible
 *
 * §11 — Responsive:
 *   Desktop ≥992px: full nav visible, normal spacing
 *   Tablet 768–991px: full nav visible, reduced spacing
 *   Mobile <768px: hamburger replaces nav, requester badge in dropdown
 */

const NAV_ITEMS: { to: string; label: string; end?: boolean }[] = [
  { to: "/tickets", label: "My Tickets", end: true },
  { to: "/tickets/new", label: "Create Ticket" },
];

export default function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { requester, clearRequester } = useRequester();

  const requesterName = requester?.fullName ?? "\u2014"; // em-dash fallback if null

  function handleChangeRequester() {
    clearRequester();
    navigate("/select-requester", { replace: true });
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `${styles.navLink} ${isActive ? styles.navLinkActive : ""}`;

  const mobileLinkClass = ({ isActive }: { isActive: boolean }) =>
    `${styles.mobileNavLink} ${isActive ? styles.mobileNavLinkActive : ""}`;

  return (
    <div>
      <header className={`${styles.header} ${menuOpen ? styles.menuOpen : ""}`}>
        {/* §6: wordmark — white TokTickIT on the left */}
        <NavLink to="/tickets" className={styles.wordmark}>
          TokTickIT
        </NavLink>

        {/* §6: primary nav — desktop only */}
        <nav className={styles.nav} aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* §6: right side — requester badge + change button */}
        <div className={styles.headerRight}>
          {/* §6: rounded pill badge — desktop */}
          <span className={styles.requesterBadge}>
            {requesterName}
          </span>

          {/* §6: Change Requester — clears selection, returns to selection screen */}
          <button
            type="button"
            className={`${styles.changeButton} btn btn-outline-secondary btn-sm`}
            style={{
              color: "#FFFFFF",
              borderColor: "rgba(255,255,255,0.5)",
              fontSize: "12px",
            }}
            onClick={handleChangeRequester}
            aria-label="Change Requester"
          >
            Change Requester
          </button>

          {/* §11: hamburger button — mobile */}
          <button
            type="button"
            className={`${styles.hamburgerButton} ${menuOpen ? styles.menuOpen : ""}`}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            <span className={styles.hamburgerIcon}>
              <span />
              <span />
              <span />
            </span>
          </button>
        </div>
      </header>

      {/* §6: mobile dropdown menu */}
      <div
        className={`${styles.mobileMenu} ${menuOpen ? styles.mobileMenuOpen : ""}`}
        role="navigation"
        aria-label="Mobile navigation"
      >
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={mobileLinkClass}
            onClick={() => setMenuOpen(false)}
          >
            {item.label}
          </NavLink>
        ))}

        {/* §6: requester badge always visible — shown in mobile menu */}
        <div className={styles.mobileRequester}>
          <span className={styles.mobileRequesterBadge}>
            {requesterName}
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            style={{
              color: "rgba(255,255,255,0.8)",
              borderColor: "rgba(255,255,255,0.4)",
              fontSize: "11px",
            }}
            onClick={handleChangeRequester}
            aria-label="Change Requester (mobile)"
          >
            Change
          </button>
        </div>
      </div>

      {/* Content area — child routes render here */}
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
