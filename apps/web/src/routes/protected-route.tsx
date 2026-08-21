import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../auth/use-auth";

export function ProtectedRoute() {
  const { user, isRestoringSession } = useAuth();
  const location = useLocation();

  // Sin esta espera, un refresh en curso se vería como "no hay sesión" y
  // expulsaría al usuario a /login en cada recarga.
  if (isRestoringSession) {
    return <p role="status">Cargando sesión…</p>;
  }

  if (!user) {
    // `state.from` deja el destino original para volver tras el login.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
