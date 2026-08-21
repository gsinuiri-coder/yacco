import { useAuth } from "../auth/use-auth";

export function DashboardPage() {
  const { user, logout } = useAuth();

  return (
    <main>
      <h1>Panel</h1>
      <p>
        Sesión iniciada como <strong>{user?.username}</strong>
      </p>
      <p>Roles: {user?.roles.join(", ")}</p>
      <button type="button" onClick={logout}>
        Cerrar sesión
      </button>
    </main>
  );
}
