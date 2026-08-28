import { Fragment, useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  createContainerType,
  listContainerTypes,
  updateContainerType,
} from "../api/container-types";
import type { ContainerType } from "../api/container-types";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { ErrorState } from "../components/error-state";
import { SlowRequestNotice } from "../components/slow-request-notice";
import { WithdrawConfirm } from "../components/withdraw-confirm";
import { useSlowRequest } from "../hooks/use-slow-request";

const NAME_REQUIRED_MESSAGE = "Escribe el nombre del tipo de envase";

/**
 * What withdrawing means, in the owner's words, shown BEFORE they confirm.
 * It mirrors the API guard: no new deliveries of a withdrawn type, but the
 * ones already with customers keep counting and can still come back.
 */
const WITHDRAW_EXPLANATION =
  "Ya no se podrán entregar envases nuevos de este tipo. Los que ya están en poder de los " +
  "clientes siguen contando y pueden devolverse. Se puede reactivar después.";

function sortByName(types: ContainerType[]): ContainerType[] {
  return [...types].sort((a, b) => a.name.localeCompare(b.name));
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * The catalog the whole container audit depends on: a type that appears
 * halfway through counting 500 customers means recounting, so the owner
 * settles the list here first. The API lists active types by default and
 * withdrawn ones only on request; this screen asks for both, because a
 * withdrawn type is still real stock out in the street and must stay
 * visible, marked, never hidden.
 */
export function ContainerTypesPage() {
  const { apiClient, user } = useAuth();
  const isAdmin = user?.roles.includes("ADMIN") ?? false;

  const [types, setTypes] = useState<ContainerType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const isSlow = useSlowRequest(isLoading);

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  /**
   * El error de una acción de fila lleva el id de la fila, no solo el texto:
   * se muestra pegado a la que se estaba editando en vez de una sola vez
   * arriba de la card. Con dos tipos de envase daba igual; con veinte, un
   * mensaje arriba no dice cuál falló.
   */
  const [actionError, setActionError] = useState<{ typeId: string; message: string } | null>(null);
  const [isSavingAction, setIsSavingAction] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    Promise.all([
      listContainerTypes(apiClient, { active: true }),
      listContainerTypes(apiClient, { active: false }),
    ])
      .then(([activeTypes, withdrawnTypes]) => {
        if (!cancelled) setTypes(sortByName([...activeTypes, ...withdrawnTypes]));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(errorMessage(error, "No se pudieron cargar los tipos de envase."));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, reloadToken]);

  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  function replaceType(updated: ContainerType) {
    setTypes((current) =>
      sortByName(current.map((type) => (type.id === updated.id ? updated : type))),
    );
  }

  function handleStartAdd() {
    setIsAdding(true);
    setNewName("");
    setCreateError(null);
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreating) return;
    const name = newName.trim();
    if (name === "") {
      setCreateError(NAME_REQUIRED_MESSAGE);
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    createContainerType(apiClient, { name })
      .then((created) => {
        setTypes((current) => sortByName([...current, created]));
        setIsAdding(false);
      })
      .catch((error: unknown) => {
        // The API's message names the duplicate ("Ya existe un tipo de envase
        // con el nombre ..."); shown verbatim, it is the mistake the owner
        // will make most often.
        setCreateError(errorMessage(error, "No se pudo crear el tipo de envase."));
      })
      .finally(() => setIsCreating(false));
  }

  function handleStartRename(type: ContainerType) {
    setRenamingId(type.id);
    setRenameValue(type.name);
    setWithdrawingId(null);
    setActionError(null);
  }

  function handleSaveRename(id: string) {
    if (isSavingAction) return;
    const name = renameValue.trim();
    if (name === "") {
      setActionError({ typeId: id, message: NAME_REQUIRED_MESSAGE });
      return;
    }

    setIsSavingAction(true);
    setActionError(null);
    updateContainerType(apiClient, id, { name })
      .then((updated) => {
        replaceType(updated);
        setRenamingId(null);
      })
      .catch((error: unknown) => {
        setActionError({
          typeId: id,
          message: errorMessage(error, "No se pudo renombrar el tipo de envase."),
        });
      })
      .finally(() => setIsSavingAction(false));
  }

  function handleStartWithdraw(id: string) {
    setWithdrawingId(id);
    setRenamingId(null);
    setActionError(null);
  }

  function handleSetActive(id: string, active: boolean) {
    if (isSavingAction) return;
    setIsSavingAction(true);
    setActionError(null);
    updateContainerType(apiClient, id, { active })
      .then((updated) => {
        replaceType(updated);
        setWithdrawingId(null);
      })
      .catch((error: unknown) => {
        setActionError({
          typeId: id,
          message: errorMessage(
            error,
            active
              ? "No se pudo reactivar el tipo de envase."
              : "No se pudo retirar el tipo de envase.",
          ),
        });
      })
      .finally(() => setIsSavingAction(false));
  }

  const activeCount = types.filter((type) => type.active).length;
  const withdrawnCount = types.length - activeCount;

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Tipos de envase</h1>
          <p className="page-header__subtitle">
            {isLoading
              ? "Cargando…"
              : `${activeCount} en uso${withdrawnCount > 0 ? `, ${withdrawnCount} ${withdrawnCount === 1 ? "retirado" : "retirados"}` : ""}`}
          </p>
        </div>
        {isAdmin && !isAdding && (
          <button
            type="button"
            className="button button--primary"
            onClick={handleStartAdd}
            disabled={isLoading}
          >
            Nuevo tipo de envase
          </button>
        )}
      </div>

      <section className="card">
        <div className="card__body">
          <SlowRequestNotice show={isSlow && isLoading} />

          {createError && (
            <div className="notice notice--error" role="alert">
              {createError}
            </div>
          )}

          {isAdding && (
            <form className="form-grid" onSubmit={handleCreate} noValidate>
              <div className="field">
                <label className="field__label" htmlFor="newContainerTypeName">
                  Nombre
                </label>
                <input
                  id="newContainerTypeName"
                  type="text"
                  placeholder="Bidón 20L (V)"
                  maxLength={80}
                  value={newName}
                  disabled={isCreating}
                  onChange={(event) => setNewName(event.target.value)}
                />
                <span className="field__hint">
                  Si la planta distingue el mismo bidón por etiqueta, cada etiqueta es un tipo
                  aparte.
                </span>
              </div>
              <div className="form-actions form-grid__full">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setIsAdding(false)}
                  disabled={isCreating}
                >
                  Cancelar
                </button>
                <button type="submit" className="button button--primary" disabled={isCreating}>
                  {isCreating ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </form>
          )}

          {loadError ? (
            <ErrorState message={loadError} onRetry={retry} />
          ) : isLoading ? (
            <p className="state" role="status">
              Cargando tipos de envase…
            </p>
          ) : types.length === 0 ? (
            <div className="state">
              <p className="state__title">Todavía no hay tipos de envase</p>
              <p>Registra los bidones con los que trabaja la planta antes de empezar a contar.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <caption className="visually-hidden">Tipos de envase de la planta</caption>
                <thead>
                  <tr>
                    <th scope="col">Tipo de envase</th>
                    <th scope="col">Estado</th>
                    {isAdmin && (
                      <th scope="col" className="table__actions">
                        <span className="visually-hidden">Acciones</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {types.map((type) => (
                    <Fragment key={type.id}>
                      <tr>
                        <td>
                          {renamingId === type.id ? (
                            <input
                              aria-label={`Nuevo nombre de ${type.name}`}
                              type="text"
                              maxLength={80}
                              value={renameValue}
                              disabled={isSavingAction}
                              onChange={(event) => setRenameValue(event.target.value)}
                            />
                          ) : (
                            <span className="cell-primary">{type.name}</span>
                          )}
                        </td>
                        <td>
                          <span
                            className={`badge ${type.active ? "badge--active" : "badge--inactive"}`}
                          >
                            {type.active ? "En uso" : "Retirado"}
                          </span>
                        </td>
                        {isAdmin && (
                          <td className="table__actions">
                            {withdrawingId === type.id ? (
                              <WithdrawConfirm
                                itemLabel={type.name}
                                explanation={WITHDRAW_EXPLANATION}
                                isSaving={isSavingAction}
                                onCancel={() => setWithdrawingId(null)}
                                onConfirm={() => handleSetActive(type.id, false)}
                              />
                            ) : renamingId === type.id ? (
                              <>
                                <button
                                  type="button"
                                  className="button button--secondary"
                                  onClick={() => setRenamingId(null)}
                                  disabled={isSavingAction}
                                >
                                  Cancelar
                                </button>{" "}
                                <button
                                  type="button"
                                  className="button button--primary"
                                  onClick={() => handleSaveRename(type.id)}
                                  disabled={isSavingAction}
                                >
                                  {isSavingAction ? "Guardando…" : "Guardar"}
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="button button--ghost"
                                  onClick={() => handleStartRename(type)}
                                  disabled={isSavingAction}
                                >
                                  Renombrar
                                </button>{" "}
                                {type.active ? (
                                  <button
                                    type="button"
                                    className="button button--ghost"
                                    onClick={() => handleStartWithdraw(type.id)}
                                    disabled={isSavingAction}
                                  >
                                    Retirar
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="button button--ghost"
                                    onClick={() => handleSetActive(type.id, true)}
                                    disabled={isSavingAction}
                                  >
                                    {isSavingAction ? "Reactivando…" : "Reactivar"}
                                  </button>
                                )}
                              </>
                            )}
                          </td>
                        )}
                      </tr>
                      {/* Fila aparte y no dentro de la celda de acciones: esa
                        columna es angosta y un mensaje ahí desborda la tabla.
                        Acá el error queda pegado a su fila y con ancho para
                        leerse entero. */}
                      {actionError?.typeId === type.id && (
                        <tr>
                          <td colSpan={isAdmin ? 3 : 2}>
                            <p className="notice notice--error" role="alert">
                              {actionError.message}
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </AppShell>
  );
}
