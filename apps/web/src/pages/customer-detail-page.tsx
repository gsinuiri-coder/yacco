import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { getCustomer } from "../api/customers";
import type { Customer } from "../api/customers";
import { ApiError } from "../api/errors";
import { SLOW_REQUEST_MESSAGE } from "../api/timing";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { CustomerAccountStatementSection } from "../components/customer-account-statement-section";
import { CustomerPaymentSection } from "../components/customer-payment-section";
import { CustomerPricesSection } from "../components/customer-prices-section";
import { useSlowRequest } from "../hooks/use-slow-request";
import { formatMoney, formatOptionalMoney, isPositiveMoney } from "../lib/money";

export function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const { apiClient, user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.roles.includes("ADMIN") ?? false;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const isSlowLoad = useSlowRequest(isLoading);
  // Sube cada vez que se registra un cobro, para que
  // CustomerAccountStatementSection recargue: un pago nuevo puede agregar
  // una fila y mover closingBalance, y esa sección no tiene otra forma de
  // enterarse (ver la nota en su propio archivo).
  const [accountStatementRefreshSignal, setAccountStatementRefreshSignal] = useState(0);

  useEffect(() => {
    if (!customerId) return;
    let ignore = false;
    setIsLoading(true);
    setLoadError(null);

    getCustomer(apiClient, customerId)
      .then((response) => {
        if (!ignore) setCustomer(response);
      })
      .catch((error: unknown) => {
        if (ignore) return;
        setLoadError(error instanceof Error ? error : new Error("No se pudo cargar el cliente."));
      })
      .finally(() => {
        if (!ignore) setIsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [apiClient, customerId, reloadToken]);

  const notFound = loadError instanceof ApiError && loadError.status === 404;

  function handlePaymentRegistered(debtBalance: string) {
    setCustomer((current) => (current ? { ...current, debtBalance } : current));
    setAccountStatementRefreshSignal((token) => token + 1);
  }

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>{customer ? customer.name : "Cliente"}</h1>
          {!customer && <p className="page-header__subtitle">Cargando…</p>}
        </div>
        <div className="page-header__actions">
          {customer && (
            <Link to={`/customers/${customer.id}/edit`} className="button button--secondary">
              Editar
            </Link>
          )}
          <Link to="/customers" className="button button--secondary">
            Volver a clientes
          </Link>
        </div>
      </div>

      {isSlowLoad && isLoading && (
        <p className="notice notice--info" role="status">
          {SLOW_REQUEST_MESSAGE}
        </p>
      )}

      {isLoading ? (
        <p className="state card" role="status">
          Cargando cliente…
        </p>
      ) : notFound ? (
        <div className="state card">
          <p className="state__title">Ese cliente no existe</p>
          <div className="state__actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void navigate("/customers")}
            >
              Volver a clientes
            </button>
          </div>
        </div>
      ) : loadError ? (
        <div className="state card">
          <p className="state__title">No se pudo cargar el cliente</p>
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
      ) : customer ? (
        <>
          <section className="card">
            <div className="card__body">
              <div className="form-grid">
                <div className="stat">
                  <span className="stat__label">Teléfono</span>
                  <span className="stat__value">{customer.phone}</span>
                </div>
                <div className="stat">
                  <span className="stat__label">Estado</span>
                  <span className="stat__value">
                    <span
                      className={`badge ${customer.active ? "badge--active" : "badge--inactive"}`}
                    >
                      {customer.active ? "Activo" : "Desactivado"}
                    </span>
                  </span>
                </div>
                <div className="stat form-grid__full">
                  <span className="stat__label">Dirección</span>
                  <span className="stat__value">{customer.address}</span>
                  <span className="stat__note">{customer.addressReference}</span>
                </div>
                <div className="stat">
                  <span className="stat__label">Zona</span>
                  <span className="stat__value">
                    {customer.zone ? (
                      <span className="badge badge--muted">{customer.zone.name}</span>
                    ) : (
                      <span className="cell-secondary">Sin zona</span>
                    )}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat__label">Límite de crédito</span>
                  <span className="stat__value">{formatOptionalMoney(customer.creditLimit)}</span>
                </div>
                <div className="stat">
                  <span className="stat__label">Deuda actual</span>
                  <span
                    className={`stat__value ${isPositiveMoney(customer.debtBalance) ? "money--owed" : "money--clear"}`}
                  >
                    {formatMoney(customer.debtBalance)}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <CustomerPaymentSection
            customerId={customer.id}
            onPaymentRegistered={handlePaymentRegistered}
          />

          <CustomerPricesSection customerId={customer.id} isAdmin={isAdmin} />

          <CustomerAccountStatementSection
            customerId={customer.id}
            refreshSignal={accountStatementRefreshSignal}
          />
        </>
      ) : null}
    </AppShell>
  );
}
