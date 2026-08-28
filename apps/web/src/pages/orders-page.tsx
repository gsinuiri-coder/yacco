import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ORDERS_PAGE_SIZE, listOrders } from "../api/orders";
import type { Order, OrderStatus, PaginatedOrders } from "../api/orders";
import type { Customer } from "../api/customers";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { CustomerSelect } from "../components/customer-select";
import { ErrorState } from "../components/error-state";
import { ORDER_STATUS_LABELS, OrderStatusBadge } from "../components/order-status-badge";
import { PaginationNav } from "../components/pagination-nav";
import { SlowRequestNotice } from "../components/slow-request-notice";
import { StatusFilterSelect } from "../components/status-filter-select";
import { useSlowRequest } from "../hooks/use-slow-request";
import { formatBusinessDate } from "../lib/business-date";
import { formatMoney } from "../lib/money";

type StatusFilter = OrderStatus | "all";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  ...(Object.entries(ORDER_STATUS_LABELS) as [OrderStatus, string][]).map(([value, label]) => ({
    value,
    label,
  })),
];

export function OrdersPage() {
  const { apiClient } = useAuth();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [deliveryDateFrom, setDeliveryDateFrom] = useState("");
  const [deliveryDateTo, setDeliveryDateTo] = useState("");
  const [customerFilter, setCustomerFilter] = useState<Customer | null>(null);
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<PaginatedOrders | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const isSlow = useSlowRequest(isLoading);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setErrorMessage(null);

    listOrders(apiClient, {
      page,
      limit: ORDERS_PAGE_SIZE,
      ...(statusFilter === "all" ? {} : { status: statusFilter }),
      ...(deliveryDateFrom ? { deliveryDateFrom } : {}),
      ...(deliveryDateTo ? { deliveryDateTo } : {}),
      ...(customerFilter ? { customerId: customerFilter.id } : {}),
    })
      .then((response) => {
        if (!cancelled) setResult(response);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // SessionExpiredError is handled by the api client + ProtectedRoute;
        // anything else is the office's problem to see and retry.
        setErrorMessage(
          error instanceof Error ? error.message : "No se pudo cargar la lista de pedidos.",
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    apiClient,
    page,
    statusFilter,
    deliveryDateFrom,
    deliveryDateTo,
    customerFilter,
    reloadToken,
  ]);

  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  const clearFilters = useCallback(() => {
    setStatusFilter("all");
    setDeliveryDateFrom("");
    setDeliveryDateTo("");
    setCustomerFilter(null);
    setPage(1);
  }, []);

  const total = result?.total ?? 0;
  const totalPages = result?.totalPages ?? 0;
  const orders = result?.data ?? [];
  const hasFilters =
    statusFilter !== "all" ||
    deliveryDateFrom !== "" ||
    deliveryDateTo !== "" ||
    customerFilter !== null;

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Pedidos</h1>
          <p className="page-header__subtitle">
            {isLoading && result === null
              ? "Cargando…"
              : `${total} ${total === 1 ? "pedido" : "pedidos"}${hasFilters ? " con este filtro" : ""}`}
          </p>
        </div>
        <Link to="/orders/new" className="button button--primary">
          Nuevo pedido
        </Link>
      </div>

      <section className="card">
        <div className="toolbar">
          <StatusFilterSelect
            id="statusFilter"
            value={statusFilter}
            options={STATUS_OPTIONS}
            onChange={(status) => {
              setStatusFilter(status);
              setPage(1);
            }}
          />
          <div className="field">
            <label className="field__label" htmlFor="deliveryDateFrom">
              Entrega desde
            </label>
            <input
              id="deliveryDateFrom"
              type="date"
              value={deliveryDateFrom}
              onChange={(event) => {
                setDeliveryDateFrom(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="deliveryDateTo">
              Entrega hasta
            </label>
            <input
              id="deliveryDateTo"
              type="date"
              value={deliveryDateTo}
              onChange={(event) => {
                setDeliveryDateTo(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="toolbar__search">
            <CustomerSelect
              id="customerFilter"
              label="Cliente"
              value={customerFilter}
              onChange={(customer) => {
                setCustomerFilter(customer);
                setPage(1);
              }}
            />
          </div>
          {hasFilters && (
            <button type="button" className="button button--secondary" onClick={clearFilters}>
              Limpiar filtros
            </button>
          )}
        </div>

        <SlowRequestNotice show={isSlow && isLoading} />

        {errorMessage ? (
          <ErrorState message={errorMessage} onRetry={retry} />
        ) : isLoading ? (
          <p className="state" role="status">
            Cargando pedidos…
          </p>
        ) : orders.length === 0 ? (
          <EmptyState hasFilters={hasFilters} />
        ) : (
          <>
            <div className="table-scroll">
              <table className="table">
                <caption className="visually-hidden">
                  Pedidos con cliente, fecha de entrega, estado y productos
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Cliente</th>
                    <th scope="col">Entrega</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Productos</th>
                    <th scope="col" className="table__numeric">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <OrderRow
                      key={order.id}
                      order={order}
                      onOpen={() => void navigate(`/orders/${order.id}`)}
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

function OrderRow({ order, onOpen }: { order: Order; onOpen: () => void }) {
  const itemsSummary = order.items
    .map((item) => `${item.quantity}× ${item.product.name}`)
    .join(", ");

  return (
    <tr
      className="table__row--clickable"
      role="link"
      tabIndex={0}
      aria-label={`Ver pedido de ${order.customer.name}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen();
      }}
    >
      <td>
        <div className="cell-primary">{order.customer.name}</div>
        <div className="cell-secondary">{order.customer.phone}</div>
      </td>
      <td>{formatBusinessDate(order.deliveryDate)}</td>
      <td>
        <OrderStatusBadge status={order.status} />
      </td>
      <td className="cell-secondary">{itemsSummary}</td>
      <td className="table__numeric">{formatMoney(order.total)}</td>
    </tr>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="state">
      <p className="state__title">
        {hasFilters ? "Ningún pedido coincide con el filtro" : "Todavía no hay pedidos"}
      </p>
      <p>
        {hasFilters
          ? "Prueba con otro estado, fecha o cliente."
          : "Los pedidos capturados aparecerán aquí."}
      </p>
    </div>
  );
}
