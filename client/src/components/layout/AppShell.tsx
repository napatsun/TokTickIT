/**
 * AppShell — ui-spec.md §1 (Global Application Shell)
 *
 *   Top bar: wordmark, current user's Name + Role badge, Logout
 *   Nav: only the destinations permitted for the current role are rendered —
 *        never rendered-but-disabled (FR-08)
 *     Requester      → My Tickets, Create Ticket
 *     IT Staff       → Ticket Queue
 *     Administrator  → User Management
 *   Mobile (<768px): nav collapses into a hamburger menu; identity + Logout
 *        stay reachable.
 *
 * Lab 2's Development Requester dropdown and "Change Requester" action have
 * been DELETED entirely (FR-11) — this file no longer knows about
 * RequesterContext, localStorage, or /select-requester.
 */

import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ROLE_LABELS, roleHome, type Role } from "../../contexts/AuthContext.js";
import { useAuth } from "../../hooks/useAuth.js";
import styles from "./AppShell.module.css";

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  REQUESTER: [
    { to: "/tickets", label: "My Tickets", end: true },
    { to: "/tickets/new", label: "Create Ticket" },
  ],
  IT_STAFF: [{ to: "/staff/queue", label: "Ticket Queue" }],
  ADMINISTRATOR: [{ to: "/admin/users", label: "User Management" }],
};

export default function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  // RequireAuth guarantees a user before this shell renders; guard anyway so
  // the component is safe in isolation (e.g. component tests).
  if (!user) return null;

  const navItems = NAV_BY_ROLE[user.role];
  const home = roleHome(user.role);

  async function handleLogout() {
    setMenuOpen(false);
    await logout();
    navigate("/login", { replace: true });
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `${styles.navLink} ${isActive ? styles.navLinkActive : ""}`;

  const mobileLinkClass = ({ isActive }: { isActive: boolean }) =>
    `${styles.mobileNavLink} ${isActive ? styles.mobileNavLinkActive : ""}`;

  return (
    <div>
      <header className={`${styles.header} ${menuOpen ? styles.menuOpen : ""}`}>
        <NavLink to={home} className={styles.wordmark}>
          TokTickIT
        </NavLink>

        {/* §1: only role-permitted destinations are rendered */}
        <nav className={styles.nav} aria-label="Main navigation">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className={styles.headerRight}>
          {/* §1: current user's Name + Role badge */}
          <span className={styles.userName} data-testid="shell-user-name">
            {user.name}
          </span>
          <span className={styles.roleBadge} data-testid="shell-role-badge">
            {ROLE_LABELS[user.role]}
          </span>

          <button
            type="button"
            className={styles.logoutButton}
            onClick={handleLogout}
            aria-label="Log out"
          >
            Logout
          </button>

          {/* §11: hamburger — mobile only */}
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

      {/* §11: mobile dropdown nav */}
      <div
        className={`${styles.mobileMenu} ${menuOpen ? styles.mobileMenuOpen : ""}`}
        role="navigation"
        aria-label="Mobile navigation"
      >
        {navItems.map((item) => (
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

        <div className={styles.mobileUser}>
          <span className={styles.mobileUserName}>{user.name}</span>
          <span className={styles.roleBadge}>{ROLE_LABELS[user.role]}</span>
        </div>
        <button
          type="button"
          className={styles.mobileLogoutButton}
          onClick={handleLogout}
          aria-label="Log out (mobile)"
        >
          Logout
        </button>
      </div>

      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
