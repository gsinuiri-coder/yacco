import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { MIN_PASSWORD_LENGTH, createUser, listUsers, updateUser } from "../api/users";
import type { User, UserListParams, UserRole } from "../api/users";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { ErrorState } from "../components/error-state";
import { SlowRequestNotice } from "../components/slow-request-notice";
import { useSlowRequest } from "../hooks/use-slow-request";

/** Vocabulario de la planta: nadie dice "SELLER". */
const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Administrador",
  SELLER: "Vendedor",
  DRIVER: "Chofer",
};

const ROLE_ORDER: UserRole[] = ["ADMIN", "SELLER", "DRIVER"];

type RoleFilter = UserRole | "all";
type StatusFilter = "active" | "inactive";

const NAME_REQUIRED = "Escribe el nombre de la persona";
const USERNAME_REQUIRED = "Escribe el usuario con el que va a entrar";
const PASSWORD_TOO_SHORT = `La contraseña debe tener al menos ${String(MIN_PASSWORD_LENGTH)} caracteres`;
const ROLES_REQUIRED = "Elige al menos un rol";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function sortByName(users: User[]): User[] {
  return [...users].sort((a, b) => a.name.localeCompare(b.name));
}

function describeRoles(roles: UserRole[]): string {
  return ROLE_ORDER.filter((role) => roles.includes(role))
    .map((role) => ROLE_LABELS[role])
    .join(", ");
}

/**
 * Gestión de usuarios: alta, renombrar, desactivar y reactivar.
 *
 * Roles asimétricos, el mismo patrón que ContainerTypesPage y ZonesPage: leer
 * es ADMIN y SELLER —un vendedor planifica rutas y necesita saber quién es
 * chofer—, escribir es solo ADMIN.
 *
 * Lo que esta pantalla deliberadamente NO hace: cambiar la contraseña de
 * alguien ni sus roles. `PATCH /users/:id` acepta las dos cosas, pero cada una
 * es una decisión con su propia forma (¿quién puede resetearle la contraseña a
 * quién?, ¿qué pasa con la sesión abierta?) y ninguna de las dos es lo que
 * bloqueaba el trabajo — dar de alta a un chofer nuevo sí lo bloqueaba. Queda
 * anotado en docs/backlog-tecnico.md.
 */
export function UsersPage() {
  const { apiClient, user } = useAuth();
  const isAdmin = user?.roles.includes("ADMIN") ?? false;

  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");

  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const isSlow = useSlowRequest(isLoading);

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRoles, setNewRoles] = useState<UserRole[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSavingAction, setIsSavingAction] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    const params: UserListParams = {
      active: statusFilter === "active",
      ...(roleFilter === "all" ? {} : { role: roleFilter }),
    };
    listUsers(apiClient, params)
      .then((response) => {
        if (!cancelled) setUsers(sortByName(response));
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(errorMessage(error, "No se pudieron cargar los usuarios."));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, roleFilter, statusFilter, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  function toggleNewRole(role: UserRole) {
    setNewRoles((current) =>
      current.includes(role) ? current.filter((value) => value !== role) : [...current, role],
    );
    setCreateError(null);
  }

  function handleStartAdd() {
    setIsAdding(true);
    setNewName("");
    setNewUsername("");
    setNewPassword("");
    setNewRoles([]);
    setCreateError(null);
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreating) return;

    const name = newName.trim();
    const username = newUsername.trim();
    if (name === "") return setCreateError(NAME_REQUIRED);
    if (username === "") return setCreateError(USERNAME_REQUIRED);
    if (newPassword.length < MIN_PASSWORD_LENGTH) return setCreateError(PASSWORD_TOO_SHORT);
    if (newRoles.length === 0) return setCreateError(ROLES_REQUIRED);

    setIsCreating(true);
    setCreateError(null);
    createUser(apiClient, { name, username, password: newPassword, roles: newRoles })
      .then(() => {
        setIsAdding(false);
        setNewPassword("");
        // Se recarga en vez de insertar la fila devuelta: el alta nace activa
        // y el filtro puede estar en "Desactivados", donde no corresponde
        // mostrarla.
        reload();
      })
      .catch((error: unknown) => {
        // El 409 de la API nombra el usuario repetido; se muestra tal cual.
        setCreateError(errorMessage(error, "No se pudo crear el usuario."));
      })
      .finally(() => setIsCreating(false));
  }

  function handleStartEdit(target: User) {
    setEditingId(target.id);
    setEditName(target.name);
    setDeactivatingId(null);
    setActionError(null);
  }

  function handleSaveEdit(id: string) {
    if (isSavingAction) return;
    const name = editName.trim();
    if (name === "") {
      setActionError(NAME_REQUIRED);
      return;
    }

    setIsSavingAction(true);
    setActionError(null);
    updateUser(apiClient, id, { name })
      .then((updated) => {
        setUsers((current) =>
          sortByName(current.map((row) => (row.id === updated.id ? updated : row))),
        );
        setEditingId(null);
      })
      .catch((error: unknown) => {
        setActionError(errorMessage(error, "No se pudo guardar el usuario."));
      })
      .finally(() => setIsSavingAction(false));
  }

  function handleSetActive(id: string, active: boolean) {
    if (isSavingAction) return;
    setIsSavingAction(true);
    setActionError(null);
    updateUser(apiClient, id, { active })
      .then(() => {
        setDeactivatingId(null);
        // La fila cambia de mitad: con el filtro en "En uso", un usuario
        // desactivado deja de pertenecer a la lista que se está mirando.
        reload();
      })
      .catch((error: unknown) => {
        setActionError(
          errorMessage(error, active ? "No se pudo reactivar." : "No se pudo desactivar."),
        );
      })
      .finally(() => setIsSavingAction(false));
  }

  const showingActive = statusFilter === "active";

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Usuarios</h1>
          <p className="page-header__subtitle">
            Quién entra al sistema y con qué rol. Un chofer necesita estar acá antes de que se le
            pueda planificar una ruta.
          </p>
        </div>
        {isAdmin && !isAdding && (
          <button type="button" className="button button--primary" onClick={handleStartAdd}>
            Nuevo usuario
          </button>
        )}
      </div>

      {isAdding && (
        <section className="card">
          <form
            className="card__body"
            onSubmit={handleCreate}
            noValidate
            aria-label="Nuevo usuario"
          >
            <div className="form-grid">
              <div className="field">
                <label className="field__label" htmlFor="newUserName">
                  Nombre
                </label>
                <input
                  id="newUserName"
                  type="text"
                  value={newName}
                  disabled={isCreating}
                  placeholder="Juana Pérez"
                  onChange={(event) => {
                    setNewName(event.target.value);
                    setCreateError(null);
                  }}
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="newUserUsername">
                  Usuario
                </label>
                <input
                  id="newUserUsername"
                  type="text"
                  value={newUsername}
                  disabled={isCreating}
                  placeholder="jperez"
                  autoComplete="off"
                  onChange={(event) => {
                    setNewUsername(event.target.value);
                    setCreateError(null);
                  }}
                />
                <span className="field__hint">
                  Con esto escribe al entrar; no se puede cambiar.
                </span>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="newUserPassword">
                  Contraseña
                </label>
                <input
                  id="newUserPassword"
                  type="password"
                  value={newPassword}
                  disabled={isCreating}
                  autoComplete="new-password"
                  onChange={(event) => {
                    setNewPassword(event.target.value);
                    setCreateError(null);
                  }}
                />
                <span className="field__hint">
                  Mínimo {MIN_PASSWORD_LENGTH} caracteres. Entrégasela a la persona por un medio
                  seguro; el sistema no vuelve a mostrarla.
                </span>
              </div>
              <div className="field form-grid__full">
                <span className="field__label">Roles</span>
                <div className="checkbox-group">
                  {ROLE_ORDER.map((role) => (
                    <label className="checkbox-field" key={role}>
                      <input
                        type="checkbox"
                        checked={newRoles.includes(role)}
                        disabled={isCreating}
                        onChange={() => toggleNewRole(role)}
                      />
                      {ROLE_LABELS[role]}
                    </label>
                  ))}
                </div>
                <span className="field__hint">
                  Puede tener más de uno: alguien que vende y además reparte.
                </span>
              </div>
            </div>

            {createError && (
              <div className="notice notice--error" role="alert">
                {createError}
              </div>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="button button--secondary"
                disabled={isCreating}
                onClick={() => setIsAdding(false)}
              >
                Cancelar
              </button>
              <button type="submit" className="button button--primary" disabled={isCreating}>
                {isCreating ? "Creando…" : "Crear usuario"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <div className="toolbar">
          <div className="field">
            <label className="field__label" htmlFor="userRoleFilter">
              Rol
            </label>
            <select
              id="userRoleFilter"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
            >
              <option value="all">Todos</option>
              {ROLE_ORDER.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="userStatusFilter">
              Estado
            </label>
            <select
              id="userStatusFilter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            >
              <option value="active">En uso</option>
              <option value="inactive">Desactivados</option>
            </select>
          </div>
        </div>

        <SlowRequestNotice show={isSlow && isLoading} />

        {actionError && (
          <div className="card__body">
            <p className="notice notice--error" role="alert">
              {actionError}
            </p>
          </div>
        )}

        {loadError ? (
          <ErrorState message={loadError} onRetry={reload} />
        ) : isLoading ? (
          <p className="state" role="status">
            Cargando usuarios…
          </p>
        ) : users.length === 0 ? (
          <div className="state">
            <p className="state__title">
              {showingActive ? "No hay usuarios con ese rol" : "No hay usuarios desactivados"}
            </p>
            <p>
              {showingActive
                ? "Prueba con otro rol, o da de alta a la persona."
                : "Todos los usuarios de ese rol están en uso."}
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <caption className="visually-hidden">
                Usuarios con su nombre, usuario de entrada, roles y estado
              </caption>
              <thead>
                <tr>
                  <th scope="col">Nombre</th>
                  <th scope="col">Usuario</th>
                  <th scope="col">Roles</th>
                  <th scope="col">Estado</th>
                  {isAdmin && (
                    <th scope="col" className="table__actions">
                      <span className="visually-hidden">Acciones</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {users.map((row) => {
                  const isSelf = row.id === user?.id;
                  return (
                    <tr key={row.id}>
                      <td>
                        {editingId === row.id ? (
                          <input
                            type="text"
                            aria-label={`Nuevo nombre de ${row.name}`}
                            value={editName}
                            disabled={isSavingAction}
                            onChange={(event) => setEditName(event.target.value)}
                          />
                        ) : (
                          <div className="cell-primary">{row.name}</div>
                        )}
                      </td>
                      <td className="cell-secondary">{row.username}</td>
                      <td>{describeRoles(row.roles)}</td>
                      <td>
                        <span
                          className={`badge ${row.active ? "badge--active" : "badge--inactive"}`}
                        >
                          {row.active ? "En uso" : "Desactivado"}
                        </span>
                      </td>
                      {isAdmin && (
                        <td className="table__actions">
                          {editingId === row.id ? (
                            <>
                              <button
                                type="button"
                                className="button button--ghost"
                                disabled={isSavingAction}
                                onClick={() => setEditingId(null)}
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                className="button button--ghost"
                                disabled={isSavingAction}
                                onClick={() => handleSaveEdit(row.id)}
                              >
                                Guardar
                              </button>
                            </>
                          ) : deactivatingId === row.id ? (
                            // El nombre va en el aria-label y no en el texto:
                            // repetirlo acá desbordaba la columna de acciones
                            // y empujaba los botones fuera de la vista. La
                            // fila que se está confirmando es esta misma, con
                            // el nombre en su primera celda.
                            <span role="group" aria-label={`Confirmar desactivar a ${row.name}`}>
                              ¿Desactivar? No podrá entrar.{" "}
                              <button
                                type="button"
                                className="button button--ghost"
                                disabled={isSavingAction}
                                onClick={() => setDeactivatingId(null)}
                              >
                                No
                              </button>
                              <button
                                type="button"
                                className="button button--ghost"
                                disabled={isSavingAction}
                                onClick={() => handleSetActive(row.id, false)}
                              >
                                Sí, desactivar
                              </button>
                            </span>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="button button--ghost"
                                disabled={isSavingAction}
                                onClick={() => handleStartEdit(row)}
                              >
                                Editar
                              </button>
                              {row.active ? (
                                // Desactivarse a uno mismo es cerrarse la
                                // puerta desde adentro: la pantalla no lo
                                // ofrece en vez de dejar que pase y avisar
                                // después.
                                isSelf ? (
                                  <span className="cell-secondary">Tu propio usuario</span>
                                ) : (
                                  <button
                                    type="button"
                                    className="button button--ghost"
                                    disabled={isSavingAction}
                                    onClick={() => {
                                      setDeactivatingId(row.id);
                                      setEditingId(null);
                                      setActionError(null);
                                    }}
                                  >
                                    Desactivar
                                  </button>
                                )
                              ) : (
                                <button
                                  type="button"
                                  className="button button--ghost"
                                  disabled={isSavingAction}
                                  onClick={() => handleSetActive(row.id, true)}
                                >
                                  Reactivar
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
