/**
 * AdminUsersPage — Administrator User Management (ui-spec.md §7)
 * Route: /admin/users — Administrator only
 *
 * Replaces the branch-02 placeholder at the SAME route (no second route, no
 * second page) with the real screen:
 *
 *   List      Name · Email · Role badge · Status badge · Edit — no pagination,
 *             no multi-sort, no multi-filter (explicitly excluded by scope).
 *   Search    "Search by name or email…" (debounced, sent as `q`).
 *   Filter    single-select role (All / Requester / IT Staff / Administrator).
 *   Create    modal — Name, Email, Role, Active, Initial Password + helper text.
 *   Edit      modal — Name, Email, Role, Active + a separate
 *             "Set New Initial Password" sub-action with its own confirmation.
 *
 * Data source: GET /api/admin/users?q=&role= (api-spec.md §4). The screen ALSO
 * requests the unfiltered administrator roster, because the "last active
 * Administrator" guard cannot be computed from a filtered view — a search that
 * happens to exclude every Administrator would otherwise make every row look
 * like the last one. If that roster request fails the controls stay enabled and
 * the guards fall back to server-side enforcement only (never a false lockout).
 *
 * Guard rules are surfaced in the UI *in addition to* the server: a disabled
 * control is guidance, not authorization — the API returns 409 SELF_DEACTIVATION
 * / 409 LAST_ACTIVE_ADMIN regardless of what the client does.
 *
 * Forbidden (non-Administrator) is handled by <RequireRole> in the router,
 * which redirects to the caller's own landing page. Nothing on this page runs
 * for a non-Administrator.
 *
 * Feedback states (§7): Loading (skeleton rows) · Empty ("No users found.") ·
 * No results (search/filter yields nothing + "Clear filters") · Failure (retry
 * banner) · plus per-modal Idle/Validating/Busy/Failure.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Badge from "../components/shared/Badge";
import Button from "../components/shared/Button";
import ConfirmDialog from "../components/shared/ConfirmDialog";
import Dialog from "../components/shared/Dialog";
import Field from "../components/shared/Field";
import SearchInput from "../components/shared/SearchInput";
import { ROLE_LABELS, type Role } from "../contexts/AuthContext.js";
import { useAuth } from "../hooks/useAuth.js";
import { apiClient } from "../lib/apiClient";
import styles from "./AdminUsersPage.module.css";

// ─── Types ──────────────────────────────────────────────────────────────

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
}

type ListStatus = "loading" | "ready" | "error";

/** §7 modal lifecycle: Idle → Validating → Busy → Success (close+toast) | Failure. */
type FormPhase = "idle" | "validating" | "busy" | "failure";

interface FormErrors {
  name?: string;
  email?: string;
  role?: string;
  initialPassword?: string;
  newInitialPassword?: string;
  _form?: string;
}

const ROLES: Role[] = ["REQUESTER", "IT_STAFF", "ADMINISTRATOR"];

const ROLE_FILTER_OPTIONS: Array<{ value: "" | Role; label: string }> = [
  { value: "", label: "All roles" },
  { value: "REQUESTER", label: "Requester" },
  { value: "IT_STAFF", label: "IT Staff" },
  { value: "ADMINISTRATOR", label: "Administrator" },
];

const INITIAL_PASSWORD_HELPER = "User must change this password at first login";
const GENERIC_FAILURE = "Something went wrong. Please try again.";
const DUPLICATE_EMAIL_MESSAGE = "This email is already in use.";

/** The last active Administrator rule, phrased exactly as ui-spec.md §7 words it. */
const LAST_ADMIN_TOOLTIP = "At least one active Administrator is required.";
const SELF_DEACTIVATION_TOOLTIP = "You cannot deactivate your own account.";

// ─── Helpers ────────────────────────────────────────────────────────────

/** Mirrors the server's shared password policy (server/src/lib/password.ts). */
function passwordError(value: string): string | undefined {
  if (value.length === 0) return "Password is required";
  if (value.length < 8 || !/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return "Must be at least 8 characters and include a letter and a number";
  }
  return undefined;
}

function emailError(value: string): string | undefined {
  const email = value.trim();
  if (email.length === 0) return "Email is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  return undefined;
}

function nameError(value: string): string | undefined {
  if (value.trim().length === 0) return "Name is required.";
  return undefined;
}

/** Pull `error.fields` / `error.fieldErrors` out of an api-spec §0 envelope. */
function readFieldErrors(body: unknown): FormErrors | undefined {
  const envelope = body as { error?: { fields?: FormErrors; fieldErrors?: FormErrors } } | undefined;
  return envelope?.error?.fields ?? envelope?.error?.fieldErrors;
}

function readErrorMessage(body: unknown, fallback = GENERIC_FAILURE): string {
  const envelope = body as { error?: { message?: string } } | undefined;
  return envelope?.error?.message ?? fallback;
}

// ─── Component ──────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();

  // ─── List state ───────────────────────────────────────────────────────
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [status, setStatus] = useState<ListStatus>("loading");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | Role>("");

  /**
   * UNFILTERED administrator roster. Only used to answer "is this the last
   * active Administrator?" — never rendered.
   */
  const [adminRoster, setAdminRoster] = useState<AdminUser[]>([]);

  const [toast, setToast] = useState<string | null>(null);

  // ─── Create modal state ───────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [createPhase, setCreatePhase] = useState<FormPhase>("idle");
  const [createValues, setCreateValues] = useState({
    name: "",
    email: "",
    role: "REQUESTER" as Role,
    isActive: true,
    initialPassword: "",
  });
  const [createErrors, setCreateErrors] = useState<FormErrors>({});
  const [createBanner, setCreateBanner] = useState<string | null>(null);

  // ─── Edit modal state ─────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [editPhase, setEditPhase] = useState<FormPhase>("idle");
  const [editValues, setEditValues] = useState({
    name: "",
    email: "",
    role: "REQUESTER" as Role,
    isActive: true,
  });
  const [editErrors, setEditErrors] = useState<FormErrors>({});
  const [editBanner, setEditBanner] = useState<string | null>(null);

  // Reset-password sub-action (separate form + its own confirmation).
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetError, setResetError] = useState<string | undefined>(undefined);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetPhase, setResetPhase] = useState<FormPhase>("idle");
  const [resetBanner, setResetBanner] = useState<string | null>(null);

  const hasActiveFilters = search.trim() !== "" || roleFilter !== "";

  // ─── Load the list ────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setStatus("loading");

    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (roleFilter) params.set("role", roleFilter);
    const query = params.toString();

    try {
      const [listResponse, rosterResponse] = await Promise.all([
        apiClient(`/api/admin/users${query ? `?${query}` : ""}`),
        apiClient("/api/admin/users?role=ADMINISTRATOR"),
      ]);

      if (!listResponse.ok) {
        setStatus("error");
        return;
      }

      const listData = (await listResponse.json()) as { items?: AdminUser[] };
      setUsers(Array.isArray(listData.items) ? listData.items : []);

      if (rosterResponse.ok) {
        const rosterData = (await rosterResponse.json()) as { items?: AdminUser[] };
        setAdminRoster(Array.isArray(rosterData.items) ? rosterData.items : []);
      } else {
        // Unknown roster → do not guess; the API still enforces both guards.
        setAdminRoster([]);
      }

      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [search, roleFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Toasts are transient confirmations (§7 "toast 'User created.'").
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // ─── Guard rules (§7) ─────────────────────────────────────────────────

  const activeAdmins = useMemo(
    () => adminRoster.filter((row) => row.role === "ADMINISTRATOR" && row.isActive),
    [adminRoster],
  );

  /** The id of the only active Administrator, or null when there are 0 or 2+. */
  const lastActiveAdminId = activeAdmins.length === 1 ? activeAdmins[0].id : null;

  /**
   * Which controls are disabled for `target`, and why.
   *
   * The last-administrator rule is evaluated FIRST so its message wins when
   * both apply (the same precedence the server uses), and it only applies while
   * the target is currently an active Administrator — deactivating an already
   * inactive account cannot reduce the active count.
   */
  function guardFor(target: AdminUser) {
    const isSelf = currentUser?.id === target.id;
    const isLastActiveAdmin = target.role === "ADMINISTRATOR" && target.isActive && lastActiveAdminId === target.id;

    return {
      isSelf,
      isLastActiveAdmin,
      roleDisabled: isLastActiveAdmin,
      roleTooltip: isLastActiveAdmin ? LAST_ADMIN_TOOLTIP : null,
      activeDisabled: isLastActiveAdmin || isSelf,
      activeTooltip: isLastActiveAdmin
        ? LAST_ADMIN_TOOLTIP
        : isSelf
          ? SELF_DEACTIVATION_TOOLTIP
          : null,
    };
  }

  // ─── Create: submit ───────────────────────────────────────────────────
  function openCreate() {
    setCreateValues({ name: "", email: "", role: "REQUESTER", isActive: true, initialPassword: "" });
    setCreateErrors({});
    setCreateBanner(null);
    setCreatePhase("idle");
    setCreateOpen(true);
  }

  async function submitCreate() {
    setCreatePhase("validating");
    setCreateBanner(null);

    const errors: FormErrors = {};
    const name = nameError(createValues.name);
    const email = emailError(createValues.email);
    const password = passwordError(createValues.initialPassword);
    if (name) errors.name = name;
    if (email) errors.email = email;
    if (password) errors.initialPassword = password;

    setCreateErrors(errors);
    if (Object.keys(errors).length > 0) {
      setCreatePhase("idle");
      return;
    }

    setCreatePhase("busy");
    try {
      const response = await apiClient("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createValues.name.trim(),
          email: createValues.email.trim(),
          role: createValues.role,
          isActive: createValues.isActive,
          initialPassword: createValues.initialPassword,
        }),
      });

      if (response.status === 201) {
        // Success: toast + list refresh + modal closes (§7).
        setCreateOpen(false);
        setCreatePhase("idle");
        setToast("User created.");
        await load();
        return;
      }

      const body = await response.json().catch(() => undefined);
      const fieldErrors = readFieldErrors(body);
      if (fieldErrors && Object.keys(fieldErrors).length > 0) {
        setCreateErrors(fieldErrors);
        setCreatePhase("failure");
      } else {
        // Generic failure keeps the form values so nothing typed is lost.
        setCreateBanner(readErrorMessage(body));
        setCreatePhase("failure");
      }
    } catch {
      setCreateBanner(GENERIC_FAILURE);
      setCreatePhase("failure");
    }
  }

  // ─── Edit: open + submit ──────────────────────────────────────────────
  function openEdit(target: AdminUser) {
    setEditTarget(target);
    setEditValues({
      name: target.name,
      email: target.email,
      role: target.role,
      isActive: target.isActive,
    });
    setEditErrors({});
    setEditBanner(null);
    setEditPhase("idle");
    setResetPasswordValue("");
    setResetError(undefined);
    setResetBanner(null);
    setResetPhase("idle");
    setResetConfirmOpen(false);
  }

  function closeEdit() {
    if (editPhase === "busy" || resetPhase === "busy") return;
    setEditTarget(null);
    setResetConfirmOpen(false);
  }

  const editDirty =
    editTarget != null &&
    (editValues.name.trim() !== editTarget.name ||
      editValues.email.trim() !== editTarget.email ||
      editValues.role !== editTarget.role ||
      editValues.isActive !== editTarget.isActive);

  async function submitEdit() {
    if (!editTarget) return;

    setEditPhase("validating");
    setEditBanner(null);

    const errors: FormErrors = {};
    const name = nameError(editValues.name);
    const email = emailError(editValues.email);
    if (name) errors.name = name;
    if (email) errors.email = email;

    setEditErrors(errors);
    if (Object.keys(errors).length > 0) {
      setEditPhase("idle");
      return;
    }

    // Send only what actually changed, so an unrelated field can never be
    // rewritten by a stale form value.
    const patch: Record<string, unknown> = {};
    if (editValues.name.trim() !== editTarget.name) patch.name = editValues.name.trim();
    if (editValues.email.trim() !== editTarget.email) patch.email = editValues.email.trim();
    if (editValues.role !== editTarget.role) patch.role = editValues.role;
    if (editValues.isActive !== editTarget.isActive) patch.isActive = editValues.isActive;

    setEditPhase("busy");
    try {
      const response = await apiClient(`/api/admin/users/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => undefined);
        const fieldErrors = readFieldErrors(body);
        if (fieldErrors && Object.keys(fieldErrors).length > 0) {
          setEditErrors(fieldErrors);
        } else {
          // Covers 409 SELF_DEACTIVATION / LAST_ACTIVE_ADMIN, which have no
          // field to attach to — the banner carries the server's own wording.
          setEditBanner(readErrorMessage(body));
        }
        setEditPhase("failure");
        return;
      }

      const updated = (await response.json()) as AdminUser;
      setEditTarget(null);
      setEditPhase("idle");
      setToast("User updated.");
      setUsers((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      await load();
    } catch {
      setEditBanner(GENERIC_FAILURE);
      setEditPhase("failure");
    }
  }

  // ─── Edit: reset password sub-action ──────────────────────────────────
  function requestPasswordReset() {
    const error = passwordError(resetPasswordValue);
    setResetError(error);
    if (error) return;
    setResetBanner(null);
    setResetConfirmOpen(true);
  }

  async function confirmPasswordReset() {
    if (!editTarget) return;

    setResetPhase("busy");
    try {
      const response = await apiClient(`/api/admin/users/${editTarget.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newInitialPassword: resetPasswordValue }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => undefined);
        const fieldErrors = readFieldErrors(body);
        const message = fieldErrors?.newInitialPassword ?? readErrorMessage(body);
        setResetBanner(message);
        setResetPhase("failure");
        // The confirmation stays open inside the edit dialog so the message is
        // visible next to the field the user has to fix.
        setResetConfirmOpen(false);
        return;
      }

      setResetConfirmOpen(false);
      setResetPasswordValue("");
      setResetPhase("idle");
      setToast(`Password reset for ${editTarget.name}.`);
    } catch {
      setResetConfirmOpen(false);
      setResetBanner(GENERIC_FAILURE);
      setResetPhase("failure");
    }
  }

  // ─── Render: failure ──────────────────────────────────────────────────
  if (status === "error") {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>User Management</h1>
        <div className={styles.errorBanner} role="alert" data-testid="users-error">
          <p>Couldn&apos;t load users. Retry.</p>
          <Button variant="tertiary" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const isLoading = status === "loading";
  const isEmpty = !isLoading && users.length === 0;
  const editGuard = editTarget ? guardFor(editTarget) : null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>User Management</h1>
        <Button variant="primary" onClick={openCreate} data-testid="create-user-button">
          Create User
        </Button>
      </div>

      {/* ─── Controls ─────────────────────────────────────────────────── */}
      <div className={styles.controls}>
        <SearchInput
          value={search}
          onSearch={setSearch}
          placeholder="Search by name or email…"
          id="admin-user-search"
        />

        <label className={styles.filterLabel} htmlFor="admin-user-role-filter">
          Role
          <select
            id="admin-user-role-filter"
            className={styles.select}
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value as "" | Role)}
            aria-label="Filter by role"
          >
            {ROLE_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <Button
          variant="tertiary"
          onClick={() => {
            setSearch("");
            setRoleFilter("");
          }}
          disabled={!hasActiveFilters}
        >
          Clear filters
        </Button>
      </div>

      {/* Toast region — success feedback for create/edit/reset (§7). */}
      <div className={styles.toastRegion} role="status" aria-live="polite">
        {toast && (
          <div className={styles.toast} data-testid="users-toast">
            {toast}
          </div>
        )}
      </div>

      {/* ─── Loading skeleton ─────────────────────────────────────────── */}
      {isLoading && (
        <div className={styles.skeleton} aria-busy="true" aria-label="Loading users">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className={styles.skeletonRow} data-testid="users-skeleton-row" />
          ))}
        </div>
      )}

      {/* ─── Empty / no results ───────────────────────────────────────── */}
      {isEmpty && (
        <div className={styles.emptyState} data-testid="users-empty">
          {hasActiveFilters ? (
            <>
              <p className={styles.emptyMessage}>No users match your search/filters.</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  setRoleFilter("");
                }}
              >
                Clear filters
              </Button>
            </>
          ) : (
            <p className={styles.emptyMessage}>No users found.</p>
          )}
        </div>
      )}

      {!isLoading && !isEmpty && (
        <>
          {/* Desktop: table. Below 768px CSS switches to the card list. */}
          <div className={styles.tableContainer} data-testid="users-table">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Name</th>
                  <th className={styles.th}>Email</th>
                  <th className={styles.th}>Role</th>
                  <th className={styles.th}>Status</th>
                  <th className={styles.th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((row) => (
                  <tr key={row.id} className={styles.row} data-testid="user-row">
                    <td className={styles.cell}>
                      <span className={styles.userName}>{row.name}</span>
                    </td>
                    <td className={styles.cell}>{row.email}</td>
                    <td className={styles.cell}>
                      <Badge variant="role" value={row.role} />
                    </td>
                    <td className={styles.cell}>
                      <Badge variant="status" value={row.isActive ? "ACTIVE" : "INACTIVE"} />
                    </td>
                    <td className={styles.cell}>
                      <Button
                        variant="secondary"
                        onClick={() => openEdit(row)}
                        aria-label={`Edit ${row.name}`}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: stacked cards. */}
          <div className={styles.cardList} data-testid="users-cards">
            {users.map((row) => (
              <article key={row.id} className={styles.card} data-testid="user-card">
                <div className={styles.cardTop}>
                  <span className={styles.userName}>{row.name}</span>
                  <Badge variant="status" value={row.isActive ? "ACTIVE" : "INACTIVE"} />
                </div>
                <p className={styles.cardEmail}>{row.email}</p>
                <div className={styles.cardMeta}>
                  <span className={styles.cardMetaLabel}>Role</span>
                  <Badge variant="role" value={row.role} />
                </div>
                <Button
                  variant="secondary"
                  onClick={() => openEdit(row)}
                  aria-label={`Edit ${row.name}`}
                >
                  Edit
                </Button>
              </article>
            ))}
          </div>
        </>
      )}

      {/* ─── Create User modal ────────────────────────────────────────── */}
      {createOpen && (
        <Dialog
          title="Create User"
          onClose={() => setCreateOpen(false)}
          error={createBanner}
          busy={createPhase === "busy"}
          wide
          testId="create-user-dialog"
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => setCreateOpen(false)}
                disabled={createPhase === "busy"}
              >
                Cancel
              </Button>
              <Button
                variant={createPhase === "busy" ? "busy" : "primary"}
                busyLabel="Creating…"
                onClick={() => void submitCreate()}
                disabled={createPhase === "busy"}
              >
                Create User
              </Button>
            </>
          }
        >
          <div className={styles.formFields} data-phase={createPhase}>
            <Field
              label="Name"
              required
              value={createValues.name}
              errorMessage={createErrors.name}
              onChange={(event) => setCreateValues((v) => ({ ...v, name: event.target.value }))}
            />
            <Field
              label="Email"
              required
              inputType="email"
              value={createValues.email}
              errorMessage={createErrors.email}
              onChange={(event) => setCreateValues((v) => ({ ...v, email: event.target.value }))}
            />
            <Field
              label="Role"
              required
              type="select"
              value={createValues.role}
              errorMessage={createErrors.role}
              onChange={(event) => setCreateValues((v) => ({ ...v, role: event.target.value as Role }))}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Field>

            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={createValues.isActive}
                onChange={(event) => setCreateValues((v) => ({ ...v, isActive: event.target.checked }))}
              />
              Active
            </label>

            <div>
              <Field
                label="Initial Password"
                required
                inputType="password"
                value={createValues.initialPassword}
                errorMessage={createErrors.initialPassword}
                /* §9: the helper text is announced with the field it explains. */
                describedBy="create-password-helper"
                onChange={(event) =>
                  setCreateValues((v) => ({ ...v, initialPassword: event.target.value }))
                }
              />
              <p className={styles.helperText} id="create-password-helper">
                {INITIAL_PASSWORD_HELPER}
              </p>
            </div>
          </div>
        </Dialog>
      )}

      {/* ─── Edit User modal ──────────────────────────────────────────── */}
      {editTarget && editGuard && (
        <Dialog
          title={`Edit ${editTarget.name}`}
          onClose={closeEdit}
          error={editBanner}
          busy={editPhase === "busy"}
          wide
          testId="edit-user-dialog"
          actions={
            <>
              <Button variant="secondary" onClick={closeEdit} disabled={editPhase === "busy"}>
                Cancel
              </Button>
              <Button
                variant={editPhase === "busy" ? "busy" : "primary"}
                busyLabel="Saving…"
                onClick={() => void submitEdit()}
                disabled={editPhase === "busy" || !editDirty}
                title={editDirty ? undefined : "Change a field to enable Save."}
              >
                Save changes
              </Button>
            </>
          }
        >
          <div className={styles.formFields} data-phase={editPhase}>
            <Field
              label="Name"
              required
              value={editValues.name}
              errorMessage={editErrors.name}
              onChange={(event) => setEditValues((v) => ({ ...v, name: event.target.value }))}
            />
            <Field
              label="Email"
              required
              inputType="email"
              value={editValues.email}
              errorMessage={editErrors.email}
              onChange={(event) => setEditValues((v) => ({ ...v, email: event.target.value }))}
            />

            {/* Role select — disabled with a tooltip for the last active Admin. */}
            <div title={editGuard.roleTooltip ?? undefined} data-testid="role-guard">
              <Field
                label="Role"
                required
                type="select"
                state={editGuard.roleDisabled ? "disabled" : "default"}
                value={editValues.role}
                errorMessage={editErrors.role}
                disabled={editGuard.roleDisabled}
                aria-describedby={editGuard.roleDisabled ? "edit-role-guard-note" : undefined}
                onChange={(event) => setEditValues((v) => ({ ...v, role: event.target.value as Role }))}
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </Field>
              {editGuard.roleDisabled && (
                <p className={styles.guardNote} id="edit-role-guard-note">
                  {editGuard.roleTooltip}
                </p>
              )}
            </div>

            {/* Active toggle — disabled for self and for the last active Admin. */}
            <div title={editGuard.activeTooltip ?? undefined} data-testid="active-guard">
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={editValues.isActive}
                  disabled={editGuard.activeDisabled}
                  aria-describedby={editGuard.activeDisabled ? "edit-active-guard-note" : undefined}
                  onChange={(event) => setEditValues((v) => ({ ...v, isActive: event.target.checked }))}
                />
                Active
              </label>
              {editGuard.activeDisabled && (
                <p className={styles.guardNote} id="edit-active-guard-note">
                  {editGuard.activeTooltip}
                </p>
              )}
            </div>

            {/* ─── Set New Initial Password (separate sub-action, §7) ──── */}
            <section className={styles.subAction} aria-labelledby="reset-password-heading">
              {/* h3: one level below the dialog's h2 title (ui-spec §9 heading
                  order). */}
              <h3 className={styles.subActionTitle} id="reset-password-heading">
                Set New Initial Password
              </h3>
              <p className={styles.subActionCopy} id="reset-password-copy">
                Sets a new password for {editTarget.name} and forces a change at their next login.
              </p>

              {resetBanner && (
                <div className={styles.inlineError} role="alert" data-testid="reset-password-error">
                  {resetBanner}
                </div>
              )}

              <Field
                label="New initial password"
                inputType="password"
                value={resetPasswordValue}
                errorMessage={resetError}
                describedBy="reset-password-copy"
                onChange={(event) => setResetPasswordValue(event.target.value)}
              />

              <div className={styles.subActionButtons}>
                <Button
                  variant="tertiary"
                  onClick={requestPasswordReset}
                  disabled={resetPhase === "busy"}
                  data-testid="reset-password-button"
                >
                  Set New Initial Password
                </Button>
              </div>
            </section>
          </div>
        </Dialog>
      )}

      {/* Mandated confirmation copy for the password reset (§7). */}
      {resetConfirmOpen && editTarget && (
        <ConfirmDialog
          title="Reset password"
          copy={`This resets ${editTarget.name}'s password. They will need to set a new one at next login. Continue?`}
          confirmLabel="Reset password"
          busyLabel="Resetting…"
          busy={resetPhase === "busy"}
          error={resetBanner}
          onConfirm={() => void confirmPasswordReset()}
          onCancel={() => setResetConfirmOpen(false)}
          testId="reset-password-confirm"
        />
      )}
    </div>
  );
}
