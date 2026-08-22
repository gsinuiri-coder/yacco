import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { cancelOrder, getOrder } from "../api/orders";
import type { Order } from "../api/orders";
import { ApiError } from "../api/errors";
import { SLOW_REQUEST_MESSAGE } from "../api/timing";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { OrderStatusBadge } from "../components/order-status-badge";
import { useSlowRequest } from "../hooks/use-slow-request";
import { formatBusinessDate, formatBusinessDateTime } from "../lib/business-date";
import { formatMoney, multiplyMoney } from "../lib/money";

export function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { apiClient } = useAuth();
  const navigate = useNavigate();

  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const isSlowLoad = useSlowRequest(isLoading);

  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);
  const isSlowCancel = useSlowRequest(isCancelling);

  useEffect(() => {
    if (!orderId) return;
    let ignore = false;
    setIsLoading(true);
    setLoadError(null);

    getOrder(apiClient, orderId)
      .then((response) => {
        if (!ignore) setOrder(response);
      })
      .catch((error: unknown) => {
        if (ignore) return;
        setLoadError(error instanceof Error ? error : new Error("No se pudo cargar el pedido."));
      })
      .finally(() => {
        if (!ignore) setIsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [apiClient, orderId, reloadToken]);

  function handleCancelConfirm() {
    if (!orderId || isCancelling) return;
    setIsCancelling(true);
    setCancelError(null);
    setCancelNotice(null);

    cancelOrder(apiClient, orderId)
      .then((updated) => {
        setOrder(updated);
        setIsConfirmingCancel(false);
      })
      .catch((error: unknown) => {
        // 409: a driver moved it off PENDING from another screen between the
        // load and the click — not a mistake by whoever is looking at this
        // one. 404: it stopped existing. Neither is "your fault, retry" — both
        // refresh so the screen shows what actually happened, not stale data.
        if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
          if (error.status === 409) setCancelNotice(error.message);
          setIsConfirmingCancel(false);
          setReloadToken((token) => token + 1);
          return;
        }
        setCancelError(error instanceof Error ? error.message : "No se pudo cancelar el pedido.");
      })
      .finally(() => setIsCancelling(false));
  }

  const notFound = loadError instanceof ApiError && loadError.status === 404;

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>{order ? `Pedido de ${order.customer.name}` : "Pedido"}</h1>
          {!order && <p className="page-header__subtitle">Cargando…</p>}
        </div>
        <Link to="/orders" className="button button--secondary">
          Volver a pedidos
        </Link>
      </div>

      {cancelNotice && (
        <p className="notice notice--info" role="status">
          {cancelNotice}
        </p>
      )}
      {cancelError && (
        <p className="notice notice--error" role="alert">
          {cancelError}
        </p>
      )}

      {isSlowLoad && isLoading && (
        <p className="notice notice--info" role="status">
          {SLOW_REQUEST_MESSAGE}
        </p>
      )}

      {isLoading ? (
        <p className="state card" role="status">
          Cargando pedido…
        </p>
      ) : notFound ? (
        <div className="state card">
          <p className="state__title">Ese pedido no existe</p>
          <div className="state__actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void navigate("/orders")}
            >
              Volver a pedidos
            </button>
          </div>
        </div>
      ) : loadError ? (
        <div className="state card">
          <p className="state__title">No se pudo cargar el pedido</p>
          <p role="alert">{loadError.message}</p>
          <div className="state__actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setReloadToken((token) => token + 1)}
            >
              Reintentar
            </button>
          </div>
        </div>
      ) : order ? (
        <section className="card">
          <div className="card__body">
            <div className="form-grid">
              <div className="stat">
                <span className="stat__label">Cliente</span>
                <span className="stat__value">{order.customer.name}</span>
                <span className="stat__note">{order.customer.phone}</span>
              </div>
              <div className="stat">
                <span className="stat__label">Estado</span>
                <span className="stat__value">
                  <OrderStatusBadge status={order.status} />
                </span>
              </div>
              <div className="stat">
                <span className="stat__label">Fecha de entrega</span>
                <span className="stat__value">{formatBusinessDate(order.deliveryDate)}</span>
              </div>
              <div className="stat">
                <span className="stat__label">Fecha de creación</span>
                <span className="stat__value">{formatBusinessDateTime(order.createdAt)}</span>
              </div>
              <div className="stat">
                <span className="stat__label">Total</span>
                <span className="stat__value">{formatMoney(order.total)}</span>
              </div>
            </div>
          </div>

          <div className="table-scroll">
            <table className="table">
              <caption className="visually-hidden">Ítems del pedido</caption>
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col">Cantidad</th>
                  <th scope="col" className="table__numeric">
                    Precio unitario
                  </th>
                  <th scope="col" className="table__numeric">
                    Subtotal
                  </th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.product.name}</td>
                    <td>{item.quantity}</td>
                    <td className="table__numeric">{formatMoney(item.unitPrice)}</td>
                    <td className="table__numeric">
                      {formatMoney(multiplyMoney(item.unitPrice, item.quantity))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {order.status === "PENDING" && (
            <div className="card__body">
              {isConfirmingCancel ? (
                <div>
                  <p>¿Confirmas cancelar este pedido? No se puede deshacer.</p>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="button button--secondary"
                      disabled={isCancelling}
                      onClick={() => setIsConfirmingCancel(false)}
                    >
                      No
                    </button>
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={isCancelling}
                      onClick={handleCancelConfirm}
                    >
                      {isCancelling ? "Cancelando…" : "Sí, cancelar"}
                    </button>
                  </div>
                  {isSlowCancel && isCancelling && (
                    <p className="notice notice--info" role="status">
                      {SLOW_REQUEST_MESSAGE}
                    </p>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setIsConfirmingCancel(true)}
                >
                  Cancelar pedido
                </button>
              )}
            </div>
          )}
        </section>
      ) : null}
    </AppShell>
  );
}
