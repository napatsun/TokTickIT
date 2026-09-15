/**
 * ChangePasswordPage — ui-spec.md §3
 *
 * Mandatory for any user whose account still holds an initial password
 * (BR-02 / FR-06). The route guard in RouteGuard.tsx sends every other
 * authenticated route here while `mustChangePassword = true`, and the backend
 * refuses every non-exempt endpoint with 403 PASSWORD_CHANGE_REQUIRED.
 *
 * No "Current Password" field: Lab 3 scope (ui-spec.md §3) states the user is
 * already authenticated with the initial password.
 */

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import Field from "../components/shared/Field.js";
import Button from "../components/shared/Button.js";
import { roleHome } from "../contexts/AuthContext.js";
import { useAuth } from "../hooks/useAuth.js";
import styles from "./ChangePasswordPage.module.css";

const HINT = "Minimum 8 characters, at least one letter and one number.";

interface FieldErrors {
  newPassword?: string;
  confirmPassword?: string;
}

export function validateNewPassword(value: string): string | undefined {
  if (value.length === 0) return "New password is required.";
  if (value.length < 8 || !/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return "Must be at least 8 characters and include a letter and a number";
  }
  return undefined;
}

export default function ChangePasswordPage() {
  const { user, changePassword } = useAuth();
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const canSubmit = newPassword.length > 0 && confirmPassword.length > 0 && !isBusy;

  function validate(newValue: string, confirmValue: string): FieldErrors {
    const next: FieldErrors = {};
    const policyMessage = validateNewPassword(newValue);
    if (policyMessage) next.newPassword = policyMessage;
    if (newValue !== confirmValue) {
      next.confirmPassword = "Passwords do not match";
    } else if (confirmValue.length === 0) {
      next.confirmPassword = "Confirm your new password";
    }
    return next;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasSubmitted(true);
    setBanner(null);

    const validation = validate(newPassword, confirmPassword);
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      return;
    }

    setIsBusy(true);
    const result = await changePassword(newPassword, confirmPassword);
    setIsBusy(false);

    if (result.ok) {
      // Success: mustChangePassword is cleared, so release the user into the app.
      navigate(user ? roleHome(user.role) : "/", { replace: true });
      return;
    }

    if (result.fields) {
      setErrors({
        newPassword: result.fields.newPassword,
        confirmPassword: result.fields.confirmPassword,
      });
      return;
    }

    setErrors({});
    setBanner("Could not update password. Please try again.");
  }

  return (
    // §9: this screen renders outside the App Shell (the password-change gate
    // precedes it), so it supplies its own <main> landmark.
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Set a new password</h1>
        <p className={styles.subtitle}>
          This account was created with a temporary password. Choose a new password to continue.
        </p>

        {banner && (
          <div className={styles.banner} role="alert" data-testid="change-password-banner">
            {banner}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <Field
            label="New Password"
            required
            inputType="password"
            name="newPassword"
            autoComplete="new-password"
            value={newPassword}
            disabled={isBusy}
            errorMessage={errors.newPassword}
            /* §9: the always-visible hint is announced with the field, and
               stacks with the inline error when validation fails. */
            describedBy="password-hint"
            onChange={(e) => {
              const value = e.target.value;
              setNewPassword(value);
              if (hasSubmitted) {
                setErrors((prev) => ({ ...prev, ...validate(value, confirmPassword) }));
              }
            }}
          />
          {/* §3: the complexity hint is always visible, not only on error */}
          <p className={styles.hint} id="password-hint" data-testid="password-hint">
            {HINT}
          </p>

          <Field
            label="Confirm New Password"
            required
            inputType="password"
            name="confirmPassword"
            autoComplete="new-password"
            value={confirmPassword}
            disabled={isBusy}
            errorMessage={errors.confirmPassword}
            onChange={(e) => {
              const value = e.target.value;
              setConfirmPassword(value);
              if (hasSubmitted) {
                setErrors((prev) => ({ ...prev, ...validate(newPassword, value) }));
              }
            }}
          />

          <div className={styles.actions}>
            <Button
              type="submit"
              variant={isBusy ? "busy" : "primary"}
              busyLabel="Saving…"
              disabled={!canSubmit}
            >
              Save and Continue
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}
