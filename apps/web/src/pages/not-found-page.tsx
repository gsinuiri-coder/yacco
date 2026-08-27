import { Link } from "react-router";
import { AppShell } from "../components/app-shell";

/** Catch-all para una URL desconocida — vive dentro de ProtectedRoute (ver
 * app.tsx) para que quien no tiene sesión termine en /login como cualquier
 * otra ruta protegida, en vez de ver una 404 sin forma de entrar. */
export function NotFoundPage() {
  return (
    <AppShell>
      <div className="state card">
        <p className="state__title">Esta página no existe</p>
        <p>Revisa la dirección o vuelve al Panel.</p>
        <div className="state__actions">
          <Link to="/" className="button button--primary">
            Volver al Panel
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
