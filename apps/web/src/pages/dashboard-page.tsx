import { Link } from "react-router";
import { useAuth } from "../auth/use-auth";

export function DashboardPage() {
  const { user, logout } = useAuth();

  return (
    <main className="app-main">
      <div className="page-header">
        <div>
          <h1>Panel</h1>
          <p className="page-header__subtitle">
            Sesión iniciada como <strong>{user?.username}</strong>
          </p>
          <p className="page-header__subtitle">Roles: {user?.roles.join(", ")}</p>
        </div>
        <button type="button" className="button button--secondary" onClick={logout}>
          Cerrar sesión
        </button>
      </div>

      <section className="card">
        <div className="card__body">
          <h2>Clientes</h2>
          <p className="page-header__subtitle">
            Alta, búsqueda y estado de cuenta de los clientes del reparto.
          </p>
          <p>
            <Link to="/customers" className="button button--primary">
              Ver clientes
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
