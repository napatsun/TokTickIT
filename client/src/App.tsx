import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { RequesterProvider } from "./contexts/RequesterContext.js";
import RequireRequester from "./components/RouteGuard.js";
import AppShell from "./components/layout/AppShell.js";
import SelectRequesterPage from "./pages/SelectRequesterPage.js";
import MyTicketsPage from "./pages/MyTicketsPage.js";
import CreateTicketPage from "./pages/CreateTicketPage.js";

/**
 * Root component — sets up routing and Application Shell (§6).
 *
 * RequesterProvider wraps the entire app so any component can access
 * the current requester via useRequester().
 *
 * Routes:
 *   /select-requester     → Selection screen (standalone, no AppShell)
 *   /tickets              → My Tickets (protected by RequireRequester)
 *   /tickets/new          → Create Ticket (protected)
 *   /tickets/:ticketNumber → Ticket Detail (protected, placeholder lab2/07)
 *   /*                    → redirect to /tickets (→ RequireRequester → /select-requester if no selection)
 */
export default function App() {
  return (
    <BrowserRouter>
      <RequesterProvider>
        <Routes>
          {/* Selection screen — standalone, outside AppShell (§5) */}
          <Route path="/select-requester" element={<SelectRequesterPage />} />

          {/* Protected routes — wrapped in RequireRequester (AC-02) */}
          <Route element={<RequireRequester><AppShell /></RequireRequester>}>
            <Route path="/tickets" element={<MyTicketsPage />} />
            <Route path="/tickets/new" element={<CreateTicketPage />} />
            <Route path="/tickets/:ticketNumber" element={<div className="container py-4"><h1>Ticket Detail</h1><p className="text-muted">Coming in lab2/07</p></div>} />
          </Route>

          {/* Catch-all → /tickets → RequireRequester → /select-requester if no selection */}
          <Route path="*" element={<Navigate to="/tickets" replace />} />
        </Routes>
      </RequesterProvider>
    </BrowserRouter>
  );
}
