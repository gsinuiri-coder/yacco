import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { CUSTOMERS_PAGE_SIZE, listCustomers } from "../api/customers";
import type { Customer, PaginatedCustomers } from "../api/customers";
import { SLOW_REQUEST_MESSAGE } from "../api/timing";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { useSlowRequest } from "../hooks/use-slow-request";
import { formatMoney, isPositiveMoney } from "../lib/money";

type ActiveFilter = "all" | "active" | "inactive";

const ACTIVE_FILTERS: Record<ActiveFilter, boolean | undefined> = {
  all: undefined,
  active: true,
  inactive: false,
};

// The search box hits the API, so it waits for a pause in typing rather than
// firing a request per keystroke.
const SEARCH_DEBOUNCE_MS = 300;

export function CustomersPage() {
  const { apiClient } = useAuth();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<PaginatedCustomers | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const isSlow = useSlowRequest(isLoading);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeoutId);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setErrorMessage(null);

    const activeValue = ACTIVE_FILTERS[activeFilter];
    listCustomers(apiClient, {
      page,
      limit: CUSTOMERS_PAGE_SIZE,
      ...(search ? { search } : {}),
      ...(activeValue === undefined ? {} : { active: activeValue }),
    })
      .then((response) => {
        if (!cancelled) setResult(response);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // SessionExpiredError is handled by the api client + ProtectedRoute;
        // anything else is the office's problem to see and retry.
        setErrorMessage(
          error instanceof Error ? error.message : "No se pudo cargar la lista de clientes.",
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, page, search, activeFilter, reloadToken]);

  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  const total = result?.total ?? 0;
  const totalPages = result?.totalPages ?? 0;
  const customers = result?.data ?? [];
  const hasFilters = search !== "" || activeFilter !== "all";

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Clientes</h1>
          <p className="page-header__subtitle">
            {isLoading && result === null
              ? "Cargando…"
              : `${total} ${total === 1 ? "cliente" : "clientes"}${hasFilters ? " con este filtro" : ""}`}
          </p>
        </div>
        <Link to="/customers/new" className="button button--primary">
          Nuevo cliente
        </Link>
      </div>

      <section className="card">
        <div className="toolbar">
          <div className="field toolbar__search">
            <label className="field__label" htmlFor="search">
              Buscar
            </label>
            <input
              id="search"
              type="search"
              placeholder="Nombre o teléfono"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="activeFilter">
              Estado
            </label>
            <select
              id="activeFilter"
              value={activeFilter}
              onChange={(event) => {
                setActiveFilter(event.target.value as ActiveFilter);
                setPage(1);
              }}
            >
              <option value="all">Todos</option>
              <option value="active">Activos</option>
              <option value="inactive">Desactivados</option>
            </select>
          </div>
        </div>

        {isSlow && isLoading && (
          <p className="notice notice--info" role="status">
            {SLOW_REQUEST_MESSAGE}
          </p>
        )}

        {errorMessage ? (
          <div className="state">
            <p className="state__title">No se pudo cargar la lista</p>
            <p role="alert">{errorMessage}</p>
            <div className="state__actions">
              <button type="button" className="button button--secondary" onClick={retry}>
                Reintentar
              </button>
            </div>
          </div>
        ) : isLoading ? (
          <p className="state" role="status">
            Cargando clientes…
          </p>
        ) : customers.length === 0 ? (
          <EmptyState hasFilters={hasFilters} />
        ) : (
          <>
            <div className="table-scroll">
              <table className="table">
                <caption className="visually-hidden">
                  Clientes registrados con su zona y su deuda
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Cliente</th>
                    <th scope="col">Zona</th>
                    <th scope="col">Estado</th>
                    <th scope="col" className="table__numeric">
                      Deuda
                    </th>
                    <th scope="col" className="table__actions">
                      <span className="visually-hidden">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <CustomerRow key={customer.id} customer={customer} />
                  ))}
                </tbody>
              </table>
            </div>

            <nav className="pagination" aria-label="Paginación">
              <span className="pagination__status">
                Página {result?.page ?? page} de {totalPages}
              </span>
              <div className="pagination__controls">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setPage((current) => current + 1)}
                  disabled={page >= totalPages}
                >
                  Siguiente
                </button>
              </div>
            </nav>
          </>
        )}
      </section>
    </AppShell>
  );
}

function CustomerRow({ customer }: { customer: Customer }) {
  const owes = isPositiveMoney(customer.debtBalance);

  return (
    <tr>
      <td>
        <div className="cell-primary">{customer.name}</div>
        <div className="cell-secondary">{customer.phone}</div>
      </td>
      <td>
        {customer.zoneId ? (
          // The API returns only the id — there is no zone name in
          // CustomerResponseDto and no zones endpoint yet.
          <span className="badge badge--muted">{customer.zoneId.slice(0, 8)}</span>
        ) : (
          <span className="cell-secondary">Sin zona</span>
        )}
      </td>
      <td>
        <span className={`badge ${customer.active ? "badge--active" : "badge--inactive"}`}>
          {customer.active ? "Activo" : "Desactivado"}
        </span>
      </td>
      <td className={`table__numeric ${owes ? "money--owed" : "money--clear"}`}>
        {formatMoney(customer.debtBalance)}
      </td>
      <td className="table__actions">
        <Link to={`/customers/${customer.id}`} className="button button--ghost">
          Editar
        </Link>
      </td>
    </tr>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="state">
      <p className="state__title">
        {hasFilters ? "Ningún cliente coincide con la búsqueda" : "Todavía no hay clientes"}
      </p>
      <p>
        {hasFilters
          ? "Prueba con otro nombre o teléfono, o cambia el filtro de estado."
          : "Registra el primero para empezar a organizar el reparto."}
      </p>
      {!hasFilters && (
        <div className="state__actions">
          <Link to="/customers/new" className="button button--primary">
            Nuevo cliente
          </Link>
        </div>
      )}
    </div>
  );
}
