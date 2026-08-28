import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/errors";
import { listPaymentMethods } from "../api/payment-methods";
import type { PaymentMethod } from "../api/payment-methods";
import { PAYMENTS_PAGE_SIZE, confirmPayment, listPayments } from "../api/payments";
import type {
  PaginatedPayments,
  PaymentActionResult,
  PaymentRow,
  PaymentStatus,
} from "../api/payments";
import type { Customer } from "../api/customers";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { CustomerSelect } from "../components/customer-select";
import { ErrorState } from "../components/error-state";
import { PaginationNav } from "../components/pagination-nav";
import { RejectPaymentForm } from "../components/reject-payment-form";
import { SlowRequestNotice } from "../components/slow-request-notice";
import { StatusFilterSelect } from "../components/status-filter-select";
import { useSlowRequest } from "../hooks/use-slow-request";
import { formatBusinessDateTime } from "../lib/business-date";
import { formatMoney } from "../lib/money";

type StatusFilter = PaymentStatus | "all";

const STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmado",
  REJECTED: "Rechazado",
};

const STATUS_BADGE_CLASS: Record<PaymentStatus, string> = {
  PENDING: "badge--warning",
  CONFIRMED: "badge--active",
  REJECTED: "badge--danger",
};

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "PENDING", label: STATUS_LABELS.PENDING },
  { value: "CONFIRMED", label: STATUS_LABELS.CONFIRMED },
  { value: "REJECTED", label: STATUS_LABELS.REJECTED },
];

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `paidFrom`/`paidTo` are instants, not business dates — but the filter
 * inputs are plain date pickers, so a chosen day still needs to become an
 * instant boundary in Lima the same textual way `startOfLimaDay` does in
 * container-counts-page.tsx: never `new Date(day)`, which reads midnight as
 * UTC and lands a day earlier here (UTC-5, no DST in Peru).
 */
function startOfLimaDay(businessDate: string): string | undefined {
  return BUSINESS_DATE_PATTERN.test(businessDate) ? `${businessDate}T00:00:00-05:00` : undefined;
}

/** The API's `paidTo` filter is inclusive (`lte`), so the whole day needs its last second. */
function endOfLimaDay(businessDate: string): string | undefined {
  return BUSINESS_DATE_PATTERN.test(businessDate) ? `${businessDate}T23:59:59-05:00` : undefined;
}

function describeLoadError(error: unknown): string {
  return error instanceof Error ? error.message : "No se pudo cargar la bandeja de pagos.";
}

function describeConfirmError(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) {
    return "No tienes permiso de administrador para confirmar pagos.";
  }
  return error instanceof Error ? error.message : "No se pudo confirmar el pago.";
}

const BASE_COLUMN_COUNT = 6;

/**
 * Bandeja de confirmación de pagos (HU-19): lo que el dueño viene a hacer es
 * confirmar los Yape/Plin/transferencias que llegaron fuera de ruta, así que
 * arranca filtrada en PENDING — ese es el trabajo real, no un filtro más.
 * Confirmar y Rechazar son ADMIN-only, mismo split que ContainerTypesPage; el
 * rechazo exige motivo (RejectPaymentDto), pedido en una fila expandida antes
 * de disparar la llamada, mismo patrón que ContainerCountForm.
 */
export function PaymentsPage() {
  const { apiClient, user } = useAuth();
  const isAdmin = user?.roles.includes("ADMIN") ?? false;

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("PENDING");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [customerFilter, setCustomerFilter] = useState<Customer | null>(null);
  const [paidFromDay, setPaidFromDay] = useState("");
  const [paidToDay, setPaidToDay] = useState("");
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<PaginatedPayments | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const isSlow = useSlowRequest(isLoading);

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  const [actingId, setActingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const paidFrom = startOfLimaDay(paidFromDay);
  const paidTo = endOfLimaDay(paidToDay);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setErrorMessage(null);

    listPayments(apiClient, {
      page,
      limit: PAYMENTS_PAGE_SIZE,
      ...(statusFilter === "all" ? {} : { status: statusFilter }),
      ...(paymentMethodId ? { paymentMethodId } : {}),
      ...(customerFilter ? { customerId: customerFilter.id } : {}),
      ...(paidFrom ? { paidFrom } : {}),
      ...(paidTo ? { paidTo } : {}),
    })
      .then((response) => {
        if (!cancelled) setResult(response);
      })
      .catch((error: unknown) => {
        if (!cancelled) setErrorMessage(describeLoadError(error));
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
    paymentMethodId,
    customerFilter,
    paidFrom,
    paidTo,
    reloadToken,
  ]);

  // Catálogo de métodos de pago para el filtro; nunca a mano ni derivado de
  // otro recurso. Un fallo aquí solo deja el filtro sin opciones, no rompe
  // la bandeja: la lista de pagos ya cargó (o está cargando) por su cuenta.
  useEffect(() => {
    let cancelled = false;
    listPaymentMethods(apiClient)
      .then((methods) => {
        if (!cancelled) setPaymentMethods(methods);
      })
      .catch(() => {
        if (!cancelled) setPaymentMethods([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  // Vuelve al punto de partida de la bandeja (PENDING), no a "Todos": lo que
  // el dueño viene a hacer siempre es confirmar lo pendiente.
  const clearFilters = useCallback(() => {
    setStatusFilter("PENDING");
    setPaymentMethodId("");
    setCustomerFilter(null);
    setPaidFromDay("");
    setPaidToDay("");
    setPage(1);
  }, []);

  function handleConfirm(payment: PaymentRow) {
    if (actingId !== null) return;
    setActingId(payment.id);
    setActionNotice(null);
    setActionError(null);

    confirmPayment(apiClient, payment.id)
      .then((confirmResult) => {
        setActionNotice(
          `Pago de ${payment.customer.name} confirmado. Deuda actual: ${formatMoney(confirmResult.debtBalance)}.`,
        );
        reload();
      })
      .catch((error: unknown) => {
        // Otro administrador ya lo resolvió entre que se cargó la lista y
        // este clic: la lista entera se recarga, no solo esta fila.
        if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
          setActionError(
            error.status === 409
              ? "Este pago ya no está pendiente: alguien más lo confirmó o rechazó primero."
              : "Este pago ya no existe.",
          );
          reload();
          return;
        }
        setActionError(describeConfirmError(error));
      })
      .finally(() => setActingId(null));
  }

  function handleStartReject(paymentId: string) {
    setRejectingId(paymentId);
    setActionNotice(null);
    setActionError(null);
  }

  function handleRejected(payment: PaymentRow, rejectResult: PaymentActionResult) {
    setRejectingId(null);
    setActionNotice(
      `Pago de ${payment.customer.name} rechazado. Deuda actual: ${formatMoney(rejectResult.debtBalance)}.`,
    );
    reload();
  }

  function handleRejectStale(message: string) {
    setRejectingId(null);
    setActionError(message);
    reload();
  }

  const rows = result?.data ?? [];
  const totalPages = result?.totalPages ?? 0;
  const totals = result?.totals ?? null;
  const hasFilters =
    statusFilter !== "PENDING" ||
    paymentMethodId !== "" ||
    customerFilter !== null ||
    paidFromDay !== "" ||
    paidToDay !== "";
  const columnCount = isAdmin ? BASE_COLUMN_COUNT + 1 : BASE_COLUMN_COUNT;

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Pagos</h1>
          <p className="page-header__subtitle">
            {isLoading && totals === null
              ? "Cargando…"
              : totals === null
                ? ""
                : `${totals.count} ${totals.count === 1 ? "pago" : "pagos"} con este filtro · ${formatMoney(totals.amount)}`}
          </p>
        </div>
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
            <label className="field__label" htmlFor="paymentMethodFilter">
              Método de pago
            </label>
            <select
              id="paymentMethodFilter"
              value={paymentMethodId}
              onChange={(event) => {
                setPaymentMethodId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {paymentMethods.map((method) => (
                <option key={method.id} value={method.id}>
                  {method.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="paidFrom">
              Cobrado desde
            </label>
            <input
              id="paidFrom"
              type="date"
              value={paidFromDay}
              onChange={(event) => {
                setPaidFromDay(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="paidTo">
              Cobrado hasta
            </label>
            <input
              id="paidTo"
              type="date"
              value={paidToDay}
              onChange={(event) => {
                setPaidToDay(event.target.value);
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

        {actionNotice && (
          <div className="notice notice--info" role="status">
            {actionNotice}
          </div>
        )}
        {actionError && (
          <div className="notice notice--error" role="alert">
            {actionError}
          </div>
        )}

        <SlowRequestNotice show={isSlow && isLoading} />

        {errorMessage ? (
          <ErrorState message={errorMessage} onRetry={reload} />
        ) : isLoading && result === null ? (
          <p className="state" role="status">
            Cargando pagos…
          </p>
        ) : rows.length === 0 ? (
          <EmptyState hasFilters={hasFilters} />
        ) : (
          <>
            <div className="table-scroll">
              <table className="table">
                <caption className="visually-hidden">
                  Pagos con cliente, método, monto, estado y quién los registró
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Cliente</th>
                    <th scope="col">Método</th>
                    <th scope="col" className="table__numeric">
                      Monto
                    </th>
                    <th scope="col">Estado</th>
                    <th scope="col">Cobrado</th>
                    <th scope="col">Registrado por</th>
                    {isAdmin && (
                      <th scope="col" className="table__actions">
                        <span className="visually-hidden">Acciones</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((payment) => (
                    <PaymentRowView
                      key={payment.id}
                      payment={payment}
                      isAdmin={isAdmin}
                      isActing={actingId === payment.id}
                      isActingElsewhere={actingId !== null && actingId !== payment.id}
                      isRejecting={rejectingId === payment.id}
                      columnCount={columnCount}
                      onConfirm={() => handleConfirm(payment)}
                      onStartReject={() => handleStartReject(payment.id)}
                      onCancelReject={() => setRejectingId(null)}
                      onRejected={(rejectResult) => handleRejected(payment, rejectResult)}
                      onRejectStale={handleRejectStale}
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

interface PaymentRowViewProps {
  payment: PaymentRow;
  isAdmin: boolean;
  isActing: boolean;
  isActingElsewhere: boolean;
  isRejecting: boolean;
  columnCount: number;
  onConfirm: () => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  onRejected: (result: PaymentActionResult) => void;
  onRejectStale: (message: string) => void;
}

function PaymentRowView({
  payment,
  isAdmin,
  isActing,
  isActingElsewhere,
  isRejecting,
  columnCount,
  onConfirm,
  onStartReject,
  onCancelReject,
  onRejected,
  onRejectStale,
}: PaymentRowViewProps) {
  const isPending = payment.status === "PENDING";

  return (
    <>
      <tr>
        <td>
          <div className="cell-primary">{payment.customer.name}</div>
          {payment.location && <div className="cell-secondary">{payment.location.name}</div>}
        </td>
        <td>{payment.paymentMethod.name}</td>
        <td className="table__numeric">{formatMoney(payment.amount)}</td>
        <td>
          <span className={`badge ${STATUS_BADGE_CLASS[payment.status]}`}>
            {STATUS_LABELS[payment.status]}
          </span>
          {payment.status === "REJECTED" && payment.rejectionReason && (
            <div className="cell-secondary">Motivo: {payment.rejectionReason}</div>
          )}
        </td>
        <td>{formatBusinessDateTime(payment.paidAt)}</td>
        <td className="cell-secondary">{payment.recordedBy.username}</td>
        {isAdmin && (
          <td className="table__actions">
            {isPending && !isRejecting && (
              <>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={onConfirm}
                  disabled={isActing || isActingElsewhere}
                >
                  {isActing ? "Confirmando…" : "Confirmar"}
                </button>{" "}
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={onStartReject}
                  disabled={isActing || isActingElsewhere}
                >
                  Rechazar
                </button>
              </>
            )}
          </td>
        )}
      </tr>
      {isRejecting && (
        <tr>
          <td colSpan={columnCount}>
            <RejectPaymentForm
              payment={payment}
              onCancel={onCancelReject}
              onRejected={onRejected}
              onStale={onRejectStale}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="state">
      <p className="state__title">
        {hasFilters ? "Ningún pago coincide con el filtro" : "Todavía no hay pagos"}
      </p>
      <p>
        {hasFilters
          ? "Prueba con otro estado, método de pago, cliente o rango de fechas."
          : "Los cobros de oficina y los de ruta aparecerán aquí."}
      </p>
    </div>
  );
}
