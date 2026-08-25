import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { useAuth } from "../auth/use-auth";

/** Top bar plus the centred content column shared by the signed-in pages. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-bar">
        <NavLink to="/" className="app-bar__brand">
          Yacco
        </NavLink>
        <nav className="app-bar__nav" aria-label="Principal">
          <NavLink to="/" end className="app-bar__link">
            Panel
          </NavLink>
          <NavLink to="/customers" className="app-bar__link">
            Clientes
          </NavLink>
          <NavLink to="/orders" className="app-bar__link">
            Pedidos
          </NavLink>
          <NavLink to="/inventory" className="app-bar__link">
            Inventario
          </NavLink>
          <NavLink to="/production" className="app-bar__link">
            Producción
          </NavLink>
          <NavLink to="/container-movements" className="app-bar__link">
            Movimientos
          </NavLink>
          <NavLink to="/container-types" className="app-bar__link">
            Tipos de envase
          </NavLink>
        </nav>
        <div className="app-bar__user">
          <span>{user?.username}</span>
          <button type="button" className="button button--secondary" onClick={logout}>
            Cerrar sesión
          </button>
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
