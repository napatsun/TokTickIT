import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./components/layout/AppShell.js";
import MyTicketsPage from "./pages/MyTicketsPage.js";
import CreateTicketPage from "./pages/CreateTicketPage.js";

/**
 * Root component — sets up routing and Application Shell (§6).
 *
 * Routes:
 *   /tickets              → My Tickets screen
 *   /tickets/new          → Create Ticket screen
 *   /tickets/:ticketNumber → Ticket Detail (placeholder, lab2/07)
 *   /select-requester     → Development Requester Selection (placeholder, lab2/04)
 *   /*                    → redirect to /tickets
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/tickets" element={<MyTicketsPage />} />
          <Route path="/tickets/new" element={<CreateTicketPage />} />
          <Route path="/tickets/:ticketNumber" element={<div className="container py-4"><h1>Ticket Detail</h1><p className="text-muted">Coming in lab2/07</p></div>} />
          <Route path="/select-requester" element={<div className="container py-4"><h1>Select Development Requester</h1><p className="text-muted">Coming in lab2/04</p></div>} />
          <Route path="*" element={<Navigate to="/tickets" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
