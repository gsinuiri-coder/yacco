import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation } from "react-router";
import { SESSION_EXPIRED_MESSAGE } from "../api/errors";
import { useAuth } from "../auth/use-auth";
import { SlowRequestNotice } from "../components/slow-request-notice";
import { useSlowRequest } from "../hooks/use-slow-request";

interface LocationState {
  from?: string;
  /** ProtectedRoute la manda cuando la sesión terminó por vencer, no por un
   * logout manual — ver auth-provider.tsx. */
  sessionExpired?: boolean;
}

export function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSlow = useSlowRequest(isSubmitting);
  const state = location.state as LocationState | null;

  if (user) {
    return <Navigate to={state?.from ?? "/"} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (!username.trim() || !password) {
      setErrorMessage("Ingresa usuario y contraseña.");
      return;
    }

    setIsSubmitting(true);
    try {
      await login({ username: username.trim(), password });
    } catch {
      // El detalle del 401 no se muestra: la API responde siempre "Invalid
      // credentials" para no revelar si el usuario existe.
      setErrorMessage("Usuario o contraseña incorrectos.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="centered-page">
      <form className="card" onSubmit={handleSubmit} noValidate>
        <div className="card__body">
          <div className="page-header">
            <h1>Yacco</h1>
          </div>

          {state?.sessionExpired && (
            <div className="notice notice--info" role="status">
              {SESSION_EXPIRED_MESSAGE}
            </div>
          )}
          {errorMessage && (
            <div className="notice notice--error" role="alert">
              {errorMessage}
            </div>
          )}
          <SlowRequestNotice show={isSlow} />

          <div className="form-grid">
            <div className="field form-grid__full">
              <label className="field__label" htmlFor="username">
                Usuario
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="field form-grid__full">
              <label className="field__label" htmlFor="password">
                Contraseña
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={isSubmitting}>
              {isSubmitting ? "Ingresando…" : "Ingresar"}
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}
