import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../auth/use-auth";

export function ProtectedRoute() {
  const { user, isRestoringSession, sessionExpired } = useAuth();
  const location = useLocation();

  // Sin esta espera, un refresh en curso se vería como "no hay sesión" y
  // expulsaría al usuario a /login en cada recarga.
  if (isRestoringSession) {
    return <p role="status">Cargando sesión…</p>;
  }

  if (!user) {
    // `state.from` deja el destino original para volver tras el login;
    // `sessionExpired` le dice a LoginPage si corresponde avisar que la
    // sesión venció (nunca aparece si fue un logout manual).
    return <Navigate to="/login" replace state={{ from: location.pathname, sessionExpired }} />;
  }

  return <Outlet />;
}
