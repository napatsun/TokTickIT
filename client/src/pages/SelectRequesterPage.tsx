/**
 * SelectRequesterPage — ui-spec.md §5 (Development Requester Selection)
 *
 * Centered single-column card with:
 *   TokTickIT wordmark → heading → warning banner → dropdown → helper →
 *   info callout → action row (Cancel + Continue)
 *
 * States: loading / empty / error / success (with selection)
 *
 * Not inside AppShell layout — this is a standalone pre-auth screen.
 * In Lab 3, this page is removed entirely (BR-42).
 *
 * Uses apiClient for all API calls (consistency + automatic BR-03 enforcement).
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Field from "../components/shared/Field.js";
import Button from "../components/shared/Button.js";
import { useRequester } from "../hooks/useRequester.js";
import { apiClient } from "../lib/apiClient.js";

// ─── Types ──────────────────────────────────────────────────────────────

interface DevRequester {
  id: number;
  fullName: string;
  email: string;
}

type PageState = "loading" | "empty" | "error" | "success";

// ─── API helper ─────────────────────────────────────────────────────────

async function fetchRequesters(): Promise<DevRequester[]> {
  const res = await apiClient("/api/dev-requesters");
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.requesters ?? [];
}

// ─── Component ──────────────────────────────────────────────────────────

export default function SelectRequesterPage() {
  const navigate = useNavigate();
  const { setRequester } = useRequester();

  const [pageState, setPageState] = useState<PageState>("loading");
  const [requesters, setRequesters] = useState<DevRequester[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  // ─── Fetch on mount + retry ──────────────────────────────────────

  const load = useCallback(async () => {
    setPageState("loading");
    setErrorMessage("");
    setSelectedId(null);

    try {
      const list = await fetchRequesters();
      setRequesters(list);
      setPageState(list.length === 0 ? "empty" : "success");
    } catch {
      setPageState("error");
      setErrorMessage("Could not load Development Requesters.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ─── Continue handler ────────────────────────────────────────────

  function handleContinue() {
    const chosen = requesters.find((r) => r.id === selectedId);
    if (!chosen) return;
    setRequester(chosen);
    navigate("/tickets", { replace: true });
  }

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {/* §5: TokTickIT wordmark */}
        <div style={styles.wordmark}>TokTickIT</div>

        {/* §5: Heading */}
        <h1 style={styles.heading}>Select Development Requester</h1>

        {/* §5: Amber warning banner — "testing only" */}
        <div style={styles.warningBanner} role="status">
          This is for testing only and is not a login screen.
        </div>

        {/* ─── Loading state ─── */}
        {pageState === "loading" && (
          <div style={styles.loadingArea}>
            <div style={styles.spinner} role="status" aria-label="Loading" />
            <span style={styles.loadingText}>Loading requesters…</span>
          </div>
        )}

        {/* ─── Error state ─── */}
        {pageState === "error" && (
          <div style={styles.errorBanner} role="alert">
            <span>{errorMessage}</span>
            <Button
              variant="tertiary"
              onClick={load}
              style={{ marginLeft: 8, color: "var(--color-error)" }}
            >
              Retry
            </Button>
          </div>
        )}

        {/* ─── Empty state ─── */}
        {pageState === "empty" && (
          <div style={styles.emptyMessage}>
            No active Development Requesters are available. Please contact the
            administrator.
          </div>
        )}

        {/* ─── Dropdown — shown on success ─── */}
        {pageState === "success" && (
          <>
            {/* §5: Label + dropdown — uses shared Field component */}
            <Field
              type="select"
              label="Development Requester"
              required
              value={selectedId ?? ""}
              onChange={(e) => {
                const val = Number((e.target as HTMLSelectElement).value);
                setSelectedId(val || null);
              }}
            >
              <option value="" disabled>
                — Select a requester —
              </option>
              {requesters.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.fullName} ({r.email})
                </option>
              ))}
            </Field>

            {/* §5: Helper text */}
            <p style={styles.helperText}>
              Only active development requesters are shown.
            </p>
          </>
        )}

        {/* §5: Info callout — pale green */}
        <div style={styles.infoCallout}>
          Authentication coming in Lab 3 — this selection will be replaced with
          secure authentication.
        </div>

        {/* §5: Action row */}
        <div style={styles.actions}>
          <Button variant="secondary" disabled>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!selectedId}
            onClick={handleContinue}
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Inline styles (page-level layout, not reusable — component styles in CSS modules) ───

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "var(--color-bg-page)",
    padding: "24px 16px",
  },
  card: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: "var(--color-surface)",
    border: "1px solid #DDE7E1",
    borderRadius: 8,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    padding: "32px 28px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  wordmark: {
    fontSize: 18,
    fontWeight: 700,
    color: "var(--color-primary-green)",
    textAlign: "center",
    letterSpacing: "-0.3px",
  },
  heading: {
    fontSize: 20,
    fontWeight: 600,
    color: "var(--color-text)",
    textAlign: "center",
    margin: 0,
  },
  // §5: amber warning banner
  warningBanner: {
    backgroundColor: "var(--color-warning-bg)",
    color: "var(--color-warning)",
    fontSize: 13,
    fontWeight: 500,
    padding: "10px 14px",
    borderRadius: 6,
    textAlign: "center",
  },
  // Loading
  loadingArea: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: "24px 0",
  },
  spinner: {
    width: 20,
    height: 20,
    border: "3px solid var(--color-field-editable-border)",
    borderTopColor: "var(--color-secondary-green)",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  loadingText: {
    fontSize: 14,
    color: "var(--color-text-muted)",
  },
  // Error
  errorBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "var(--color-error-bg)",
    border: "1px solid var(--color-error)",
    color: "var(--color-error)",
    fontSize: 14,
    padding: "10px 14px",
    borderRadius: 6,
    textAlign: "center",
  },
  // Empty
  emptyMessage: {
    fontSize: 14,
    color: "var(--color-text-muted)",
    textAlign: "center",
    padding: "16px 0",
  },
  // Field styles removed — using shared Field component
  helperText: {
    fontSize: 12,
    color: "var(--color-text-muted)",
    margin: 0,
  },
  // §5: pale-green info callout
  infoCallout: {
    backgroundColor: "var(--color-pale-green)",
    fontSize: 13,
    color: "var(--color-text)",
    padding: "10px 14px",
    borderRadius: 6,
  },
  // Actions
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 8,
  },
};
