import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router";
import {
  PRODUCTION_BATCHES_PAGE_SIZE,
  createProductionBatch,
  listProductionBatches,
} from "../api/production-batches";
import type {
  CreateProductionBatchBody,
  PaginatedProductionBatches,
  ProductionBatch,
  ProductionBatchWarning,
} from "../api/production-batches";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { ErrorState } from "../components/error-state";
import { PaginationNav } from "../components/pagination-nav";
import {
  ProductionBatchItemsForm,
  emptyProductionBatchItem,
  validateProductionBatchItem,
} from "../components/production-batch-items-form";
import type { ProductionBatchItemDraft } from "../components/production-batch-items-form";
import { SlowRequestNotice } from "../components/slow-request-notice";
import { useSlowRequest } from "../hooks/use-slow-request";
import { formatBusinessDate, todayInLima } from "../lib/business-date";

interface SuccessResult {
  code: string;
  warnings: ProductionBatchWarning[];
}

function toCreateBody(
  code: string,
  date: string,
  notes: string,
  items: ProductionBatchItemDraft[],
): CreateProductionBatchBody {
  return {
    code: code.trim(),
    date,
    ...(notes.trim() ? { notes: notes.trim() } : {}),
    items: items.map((item) => ({
      containerTypeId: item.containerTypeId,
      producedQty: Number(item.producedQty.trim()),
    })),
  };
}

export function ProductionPage() {
  const { apiClient, user } = useAuth();
  const isAdmin = user?.roles.includes("ADMIN") ?? false;

  // --- Alta del lote (ADMIN) ---------------------------------------------
  const [code, setCode] = useState("");
  const [date, setDate] = useState(todayInLima());
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ProductionBatchItemDraft[]>([emptyProductionBatchItem(0)]);

  const [codeError, setCodeError] = useState<string | undefined>(undefined);
  const [dateError, setDateError] = useState<string | undefined>(undefined);
  const [itemErrors, setItemErrors] = useState<(string | undefined)[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<SuccessResult | null>(null);
  const isSlowSubmit = useSlowRequest(isSubmitting);

  // --- Lista de lotes (ADMIN y SELLER) ------------------------------------
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PaginatedProductionBatches | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [listErrorMessage, setListErrorMessage] = useState<string | null>(null);
  const [listReloadToken, setListReloadToken] = useState(0);
  const isSlowList = useSlowRequest(isLoadingList);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingList(true);
    setListErrorMessage(null);

    listProductionBatches(apiClient, {
      page,
      limit: PRODUCTION_BATCHES_PAGE_SIZE,
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    })
      .then((response) => {
        if (!cancelled) setResult(response);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setListErrorMessage(
          error instanceof Error ? error.message : "No se pudo cargar la lista de lotes.",
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoadingList(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, page, dateFrom, dateTo, listReloadToken]);

  const listRetry = useCallback(() => setListReloadToken((token) => token + 1), []);

  function validate(): boolean {
    const nextCodeError = code.trim() === "" ? "El código no puede estar vacío" : undefined;
    const nextDateError = date === "" ? "Elige una fecha" : undefined;
    const nextItemErrors = items.map(validateProductionBatchItem);
    setCodeError(nextCodeError);
    setDateError(nextDateError);
    setItemErrors(nextItemErrors);
    return (
      nextCodeError === undefined &&
      nextDateError === undefined &&
      nextItemErrors.every((error) => error === undefined)
    );
  }

  function handleItemsChange(nextItems: ProductionBatchItemDraft[], changedIndex?: number) {
    setItems(nextItems);
    if (changedIndex !== undefined) {
      setItemErrors((current) =>
        current.map((error, index) => (index === changedIndex ? undefined : error)),
      );
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Guards a stray second submit event arriving before the disabled button
    // re-renders — the click itself is also blocked by `disabled`. With the
    // cold start, a live button is several duplicate batches.
    if (isSubmitting) return;
    if (!validate()) return;

    setIsSubmitting(true);
    setSubmitError(null);
    setSuccessResult(null);
    createProductionBatch(apiClient, toCreateBody(code, date, notes, items))
      .then((response) => {
        setSuccessResult({ code: response.code, warnings: response.warnings });
        setCode("");
        setDate(todayInLima());
        setNotes("");
        setItems([emptyProductionBatchItem(0)]);
        setItemErrors([]);
        setListReloadToken((token) => token + 1);
      })
      .catch((error: unknown) => {
        // The API's 400 names the concrete problem (código duplicado, tipo
        // inactivo); shown verbatim so it never drifts from the backend's own.
        setSubmitError(error instanceof Error ? error.message : "No se pudo registrar el lote.");
      })
      .finally(() => setIsSubmitting(false));
  }

  const total = result?.total ?? 0;
  const totalPages = result?.totalPages ?? 0;
  const batches = result?.data ?? [];
  const hasFilters = dateFrom !== "" || dateTo !== "";

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Producción</h1>
          <p className="page-header__subtitle">
            {isLoadingList && result === null
              ? "Cargando…"
              : `${total} ${total === 1 ? "lote" : "lotes"}${hasFilters ? " con este filtro" : ""}`}
          </p>
        </div>
      </div>

      {isAdmin && (
        <section className="card">
          <div className="card__body">
            <div className="page-header">
              <h2>Registrar lote</h2>
            </div>

            {successResult && (
              <div className="notice notice--info" role="status">
                Lote {successResult.code} registrado.{" "}
                <Link to="/inventory">Ver inventario actualizado</Link>
              </div>
            )}
            {successResult && successResult.warnings.length > 0 && (
              <div className="notice notice--warning" role="alert">
                <div>
                  El lote se guardó igual, pero se llenó más de lo que había vacío en planta: faltan
                  registrar entradas de envases.
                </div>
                <ul>
                  {successResult.warnings.map((warning) => (
                    <li key={warning.containerTypeId}>
                      {warning.containerType.name}: se produjeron {warning.produced}, había{" "}
                      {warning.emptyAvailable} vacíos en planta.
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {submitError && (
              <div className="notice notice--error" role="alert">
                {submitError}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate>
              <div className="form-grid">
                <div className="field">
                  <label className="field__label" htmlFor="batchCode">
                    Código
                  </label>
                  <input
                    id="batchCode"
                    type="text"
                    value={code}
                    disabled={isSubmitting}
                    onChange={(event) => {
                      setCode(event.target.value);
                      setCodeError(undefined);
                    }}
                  />
                  {codeError && <span className="field__error">{codeError}</span>}
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="batchDate">
                    Fecha
                  </label>
                  <input
                    id="batchDate"
                    type="date"
                    value={date}
                    disabled={isSubmitting}
                    onChange={(event) => {
                      setDate(event.target.value);
                      setDateError(undefined);
                    }}
                  />
                  {dateError && <span className="field__error">{dateError}</span>}
                </div>
                <div className="field form-grid__full">
                  <label className="field__label" htmlFor="batchNotes">
                    Notas (opcional)
                  </label>
                  <input
                    id="batchNotes"
                    type="text"
                    value={notes}
                    disabled={isSubmitting}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </div>
              </div>

              <ProductionBatchItemsForm
                items={items}
                errors={itemErrors}
                disabled={isSubmitting}
                onChange={handleItemsChange}
              />

              <SlowRequestNotice show={isSlowSubmit && isSubmitting} />

              <div className="form-actions">
                <button type="submit" className="button button--primary" disabled={isSubmitting}>
                  {isSubmitting ? "Registrando…" : "Registrar lote"}
                </button>
              </div>
            </form>
          </div>
        </section>
      )}

      <section className="card">
        <div className="toolbar">
          <div className="field">
            <label className="field__label" htmlFor="dateFrom">
              Desde
            </label>
            <input
              id="dateFrom"
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="dateTo">
              Hasta
            </label>
            <input
              id="dateTo"
              type="date"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
                setPage(1);
              }}
            />
          </div>
          {hasFilters && (
            <button
              type="button"
              className="button button--secondary"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
                setPage(1);
              }}
            >
              Limpiar filtros
            </button>
          )}
        </div>

        <SlowRequestNotice show={isSlowList && isLoadingList} />

        {listErrorMessage ? (
          <ErrorState message={listErrorMessage} onRetry={listRetry} />
        ) : isLoadingList ? (
          <p className="state" role="status">
            Cargando lotes…
          </p>
        ) : batches.length === 0 ? (
          <ListEmptyState hasFilters={hasFilters} />
        ) : (
          <>
            <div className="table-scroll">
              <table className="table">
                <caption className="visually-hidden">
                  Lotes de producción con código, fecha, responsable y lo producido
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Código</th>
                    <th scope="col">Fecha</th>
                    <th scope="col">Responsable</th>
                    <th scope="col">Producido</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => (
                    <BatchRow key={batch.id} batch={batch} />
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

function BatchRow({ batch }: { batch: ProductionBatch }) {
  const producedSummary = batch.items
    .map((item) => `${item.producedQty}× ${item.containerType.name}`)
    .join(", ");

  return (
    <tr>
      <td className="cell-primary">{batch.code}</td>
      <td>{formatBusinessDate(batch.date)}</td>
      <td>{batch.filledBy.name}</td>
      <td className="cell-secondary">{producedSummary}</td>
    </tr>
  );
}

function ListEmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="state">
      <p className="state__title">
        {hasFilters ? "Ningún lote coincide con el filtro" : "Todavía no hay lotes registrados"}
      </p>
      <p>
        {hasFilters ? "Prueba con otro rango de fechas." : "Los lotes registrados aparecerán aquí."}
      </p>
    </div>
  );
}
