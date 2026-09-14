import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, roleHome } from "./contexts/AuthContext.js";
import { useAuth } from "./hooks/useAuth.js";
import { RequireAuth, RequireRole } from "./components/RouteGuard.js";
import ShellSkeleton from "./components/layout/ShellSkeleton.js";
import AppShell from "./components/layout/AppShell.js";
import LoginPage from "./pages/LoginPage.js";
import ChangePasswordPage from "./pages/ChangePasswordPage.js";
import MyTicketsPage from "./pages/MyTicketsPage.js";
import CreateTicketPage from "./pages/CreateTicketPage.js";
import TicketDetailPage from "./pages/TicketDetailPage.js";
import StaffQueuePage from "./pages/StaffQueuePage.js";
import StaffTicketDetailPage from "./pages/StaffTicketDetailPage.js";
import AdminUsersPage from "./pages/AdminUsersPage.js";

/**
 * Root component — routing + Application Shell (ui-spec.md §1).
 *
 * AuthProvider wraps everything so any component can read the authenticated
 * identity via useAuth(). Identity comes from the HTTP-only session cookie
 * (BR-03); the client never stores a token and never supplies a requesterId.
 *
 * Routes:
 *   /login                  public
 *   /change-password        authenticated (forced while mustChangePassword)
 *   /tickets, /tickets/new, /tickets/:ticketNumber   Requester
 *   /staff/queue            IT Staff, Administrator   Ticket Queue (§5)
 *   /staff/tickets/:id      IT Staff, Administrator   Ticket Detail (§6)
 *   /admin/users            Administrator             (stub until the admin branch)
 *   /*                      role-aware home redirect
 *
 * The Lab 2 Development Requester selector (/select-requester) is gone (FR-11).
 */
function HomeRedirect() {
  const { user, status } = useAuth();

  if (status === "loading") return <ShellSkeleton />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.mustChangePassword ? "/change-password" : roleHome(user.role)} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />

          {/* Authenticated but exempt from the password-change gate */}
          <Route
            path="/change-password"
            element={
              <RequireAuth>
                <ChangePasswordPage />
              </RequireAuth>
            }
          />

          {/* Authenticated application shell */}
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route
              path="/tickets"
              element={
                <RequireRole roles={["REQUESTER"]}>
                  <MyTicketsPage />
                </RequireRole>
              }
            />
            <Route
              path="/tickets/new"
              element={
                <RequireRole roles={["REQUESTER"]}>
                  <CreateTicketPage />
                </RequireRole>
              }
            />
            <Route
              path="/tickets/:ticketNumber"
              element={
                <RequireRole roles={["REQUESTER"]}>
                  <TicketDetailPage />
                </RequireRole>
              }
            />

            {/* IT Staff ticketing (feature/lab3-04-staff-ticketing) */}
            <Route
              path="/staff/queue"
              element={
                <RequireRole roles={["IT_STAFF", "ADMINISTRATOR"]}>
                  <StaffQueuePage />
                </RequireRole>
              }
            />
            {/* Queue rows navigate by the internal numeric Ticket id (§3). */}
            <Route
              path="/staff/tickets/:id"
              element={
                <RequireRole roles={["IT_STAFF", "ADMINISTRATOR"]}>
                  <StaffTicketDetailPage />
                </RequireRole>
              }
            />
            <Route
              path="/admin/users"
              element={
                <RequireRole roles={["ADMINISTRATOR"]}>
                  <AdminUsersPage />
                </RequireRole>
              }
            />
          </Route>

          {/* Catch-all → role-aware home */}
          <Route path="*" element={<HomeRedirect />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
