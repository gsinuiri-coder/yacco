import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { CUSTOMERS_PAGE_SIZE, listCustomers } from "../api/customers";
import type { Customer, PaginatedCustomers } from "../api/customers";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { ErrorState } from "../components/error-state";
import { PaginationNav } from "../components/pagination-nav";
import { SlowRequestNotice } from "../components/slow-request-notice";
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
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<PaginatedCustomers | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const isSlow = useSlowRequest(isLoading);

  /**
   * El último término que se llegó a aplicar.
   *
   * `page` tiene tres escritores: este debounce, el `onChange` del select de
   * Estado y la paginación. El del select ya está bien y no necesita nada:
   * resetea sincrónicamente, en el mismo handler que cambia el criterio, así
   * que entre el cambio y el reset no hay hueco donde el usuario pueda haber
   * elegido otra página. El buscador es el único que difiere su reset a un
   * timer, y ese hueco dura 300 ms.
   *
   * Con el término aplicado a mano, pasada la pausa se puede no escribir nada
   * cuando la búsqueda terminó igual que estaba: ni en el mount —donde el
   * timer se programa con el campo vacío y antes pisaba la página que el
   * usuario acabara de elegir— ni cuando alguien tipea una letra y se
   * arrepiente.
   */
  const appliedSearchRef = useRef(search);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const nextSearch = searchInput.trim();
      if (nextSearch === appliedSearchRef.current) return;

      appliedSearchRef.current = nextSearch;
      setSearch(nextSearch);
      // Volver a la primera página corresponde SOLO acá, donde el término
      // cambió de verdad y los resultados son otros. Si terminó igual, la
      // página que el usuario eligió es suya.
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

        <SlowRequestNotice show={isSlow && isLoading} />

        {errorMessage ? (
          <ErrorState message={errorMessage} onRetry={retry} />
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
                    <CustomerRow
                      key={customer.id}
                      customer={customer}
                      onOpen={() => void navigate(`/customers/${customer.id}`)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <PaginationNav
              displayPage={result?.page ?? page}
              page={page}
              totalPages={totalPages}
              onPrevious={() => setPage((current) => Math.max(1, current - 1))}
              onNext={() => setPage((current) => current + 1)}
            />
          </>
        )}
      </section>
    </AppShell>
  );
}

function CustomerRow({ customer, onOpen }: { customer: Customer; onOpen: () => void }) {
  const owes = isPositiveMoney(customer.debtBalance);

  return (
    <tr
      className="table__row--clickable"
      role="link"
      tabIndex={0}
      aria-label={`Ver cliente ${customer.name}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen();
      }}
    >
      <td>
        <div className="cell-primary">{customer.name}</div>
        <div className="cell-secondary">{customer.phone}</div>
      </td>
      <td>
        {customer.zone ? (
          <span className="badge badge--muted">{customer.zone.name}</span>
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
        <Link
          to={`/customers/${customer.id}/edit`}
          className="button button--ghost"
          onClick={(event) => event.stopPropagation()}
        >
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
