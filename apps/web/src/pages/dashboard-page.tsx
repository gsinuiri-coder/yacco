import { AppShell } from "../components/app-shell";
import { CustomerQuickSearch } from "../components/customer-quick-search";

export function DashboardPage() {
  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Panel</h1>
          <p className="page-header__subtitle">Busca un cliente por nombre o teléfono</p>
        </div>
      </div>
      <CustomerQuickSearch />
    </AppShell>
  );
}
