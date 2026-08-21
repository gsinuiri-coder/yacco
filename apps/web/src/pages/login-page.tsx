import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation } from "react-router";
import { SLOW_REQUEST_MESSAGE } from "../api/timing";
import { useAuth } from "../auth/use-auth";
import { useSlowRequest } from "../hooks/use-slow-request";

interface LocationState {
  from?: string;
}

export function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSlow = useSlowRequest(isSubmitting);

  if (user) {
    const state = location.state as LocationState | null;
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
    <main>
      <h1>Yacco</h1>
      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor="username">Usuario</label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={isSubmitting}
        />

        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isSubmitting}
        />

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Ingresando…" : "Ingresar"}
        </button>
      </form>

      {isSlow && <p role="status">{SLOW_REQUEST_MESSAGE}</p>}
      {errorMessage && <p role="alert">{errorMessage}</p>}
    </main>
  );
}
