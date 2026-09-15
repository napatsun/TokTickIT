/**
 * LoginPage — ui-spec.md §2
 *
 * States implemented:
 *   Idle        fields empty/focused; submit enabled once both are non-empty
 *   Validating  inline field errors below each input
 *   Busy        button spinner + "Logging in…", inputs disabled
 *   Failure     single generic banner (credentials / account unavailable / server)
 *   Success     redirect to /change-password (mustChangePassword) or role home
 *
 * Security note (§2 + BR-06/BR-09): the API returns one generic
 * INVALID_CREDENTIALS error for wrong password, unknown email, and inactive
 * accounts, so the banner never blames a field or confirms that an email
 * exists. The "account unavailable" banner is still supported for any future
 * distinct ACCOUNT_UNAVAILABLE code, and is covered by unit tests.
 */

import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import Field from "../components/shared/Field.js";
import Button from "../components/shared/Button.js";
import { roleHome } from "../contexts/AuthContext.js";
import { useAuth } from "../hooks/useAuth.js";
import styles from "./LoginPage.module.css";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  email?: string;
  password?: string;
}

/** Message shown for each server error code (generic, never field-specific). */
export function bannerForCode(code: string, fallback: string): string {
  switch (code) {
    case "INVALID_CREDENTIALS":
      return "Invalid email or password.";
    case "ACCOUNT_UNAVAILABLE":
      return "This account is unavailable. Contact your administrator.";
    case "VALIDATION_ERROR":
      return fallback;
    default:
      return "Something went wrong. Please try again.";
  }
}

export default function LoginPage() {
  const { user, status, login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  // Already signed in → straight to the right landing screen.
  if (status === "authenticated" && user) {
    return <Navigate to={user.mustChangePassword ? "/change-password" : roleHome(user.role)} replace />;
  }

  function validate(emailValue: string, passwordValue: string): FieldErrors {
    const next: FieldErrors = {};
    if (emailValue.trim().length === 0) {
      next.email = "Email is required.";
    } else if (!EMAIL_PATTERN.test(emailValue.trim())) {
      next.email = "Enter a valid email address.";
    }
    if (passwordValue.length === 0) {
      next.password = "Password is required.";
    }
    return next;
  }

  const canSubmit = email.trim().length > 0 && password.length > 0 && !isBusy;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasSubmitted(true);
    setBanner(null);

    const validation = validate(email, password);
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      return;
    }

    setIsBusy(true);
    const result = await login(email.trim(), password);
    setIsBusy(false);

    if (result.ok) {
      // Success: the provider now holds the user; the re-render above redirects
      // to /change-password or the role home (both cases handled in one place).
      return;
    }

    if (result.fields) {
      setErrors({ email: result.fields.email, password: result.fields.password });
      // Field errors are not account-existence leaks (they only describe shape).
      setBanner(result.code === "VALIDATION_ERROR" ? result.message : bannerForCode(result.code, result.message));
      return;
    }

    setErrors({});
    setBanner(bannerForCode(result.code, result.message));
  }

  return (
    // §9: the public Login screen is the page's main content, so it carries the
    // <main> landmark (every authenticated screen gets one from the App Shell).
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.wordmark}>TokTickIT</span>
          <p className={styles.tagline}>IT Service Desk</p>
        </div>

        <h1 className={styles.title}>Log in</h1>
        <p className={styles.subtitle}>Sign in to manage and track support requests.</p>

        {/* §2 Failure: one generic banner, role="alert" for screen readers */}
        {banner && (
          <div className={styles.banner} role="alert" data-testid="login-banner">
            {banner}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <Field
            label="Email"
            required
            inputType="email"
            name="email"
            autoComplete="username"
            value={email}
            disabled={isBusy}
            errorMessage={errors.email}
            onChange={(e) => {
              const value = e.target.value;
              setEmail(value);
              if (hasSubmitted) setErrors((prev) => ({ ...prev, email: validate(value, password).email }));
            }}
          />

          <Field
            label="Password"
            required
            inputType="password"
            name="password"
            autoComplete="current-password"
            value={password}
            disabled={isBusy}
            errorMessage={errors.password}
            onChange={(e) => {
              const value = e.target.value;
              setPassword(value);
              if (hasSubmitted) setErrors((prev) => ({ ...prev, password: validate(email, value).password }));
            }}
          />

          <div className={styles.actions}>
            <Button
              type="submit"
              variant={isBusy ? "busy" : "primary"}
              busyLabel="Logging in…"
              disabled={!canSubmit}
            >
              Log in
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}
