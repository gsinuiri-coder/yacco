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
 * Gestión de usuarios: alta, renombrar, cambiar la contraseña, desactivar y
 * reactivar.
 *
 * Roles asimétricos, el mismo patrón que ContainerTypesPage y ZonesPage: leer
 * es ADMIN y SELLER —un vendedor planifica rutas y necesita saber quién es
 * chofer—, escribir es solo ADMIN.
 *
 * El verbo es "cambiar" y no "reponer" en toda la pantalla: reponer es
 * devolver algo a como estaba, y acá la contraseña vieja se muere. Una
 * pantalla cuyo objetivo es no insinuar cosas que no pasan no puede abrir con
 * un verbo que insinúa recuperación. El botón de la fila ("Cambiar
 * contraseña") y el de enviar ("Guardar contraseña nueva") siguen sin
 * compartir nombre accesible.
 *
 * Es un bloque aparte y no una tercera fase de la fila: la columna de acciones
 * ya desbordó una vez por meter texto adentro (ver el comentario de la
 * confirmación de desactivar), y acá el texto que hay que decir —qué hace y
 * qué no hace— es varias veces más largo que aquel.
 *
 * Cambiar la contraseña NO cierra la sesión abierta de esa persona, y el
 * bloque lo dice con esas palabras. Es verificable: `AuthService.refreshAccessToken`
 * solo chequea la firma del refresh token y que el usuario siga `active`;
 * nunca compara nada contra `passwordHash`, y el esquema no guarda
 * `tokenVersion` ni `jti`. Un refresh token emitido antes del cambio vive sus
 * 30 días. Lo que sí corta es desactivar, en el próximo refresco — de ahí que
 * el mismo bloque separe las dos operaciones, que es donde la gente las
 * confunde.
 *
 * El administrador sí puede cambiarse la contraseña a sí mismo: es la forma de
 * rotar `admin123` el día que se decida, así que la guarda de `isSelf` que
 * tiene "Desactivar" no aplica acá.
 *
 * Lo que esta pantalla deliberadamente NO hace: cambiar los roles de alguien.
 * `PATCH /users/:id` los acepta, pero quitarle DRIVER a quien tiene rutas
 * planificadas es una decisión con su propia forma, no un campo más. Queda
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

  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  /** Nombre de la última persona a la que se le cambió, para el aviso de "listo". */
  const [resetDone, setResetDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    // El aviso de "contraseña cambiada" nombra a una persona y vive en la card
    // de la tabla, no adentro del bloque que lo produjo: si la lista que se
    // está mirando cambia debajo, el aviso queda hablando de una fila que ya no
    // está. Se va con ella.
    setResetDone(null);

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
    // Los dos bloques son hermanos arriba de la tabla y los dos tienen un
    // "Cancelar": abiertos a la vez, no se sabe cuál cancela cuál.
    closeReset();
  }

  /**
   * Cierra el bloque de cambiar contraseña y se lleva lo que dejó en pantalla:
   * la contraseña tipeada —que es una credencial en claro— y el aviso del
   * cambio anterior, que nombra a una persona y envejece mal.
   */
  function closeReset() {
    setResetTarget(null);
    setResetPassword("");
    setResetError(null);
    setResetDone(null);
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
    closeReset();
  }

  function handleStartDeactivate(target: User) {
    setDeactivatingId(target.id);
    setEditingId(null);
    setActionError(null);
    closeReset();
  }

  function handleStartReset(target: User) {
    setResetTarget(target);
    setResetPassword("");
    setResetError(null);
    setResetDone(null);
    setIsAdding(false);
    setEditingId(null);
    setDeactivatingId(null);
    // Un "No se pudo desactivar" de hace un rato, colgado arriba de la tabla
    // mientras se repone una contraseña, se lee como si fuera de esto.
    setActionError(null);
  }

  function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isResetting || resetTarget === null) return;
    if (resetPassword.length < MIN_PASSWORD_LENGTH) return setResetError(PASSWORD_TOO_SHORT);

    // Mientras el PATCH viaja, la fila no deja abrir otra reposición (los
    // botones se deshabilitan con `isResetting`), así que al volver la
    // respuesta `target` sigue siendo de quien se está viendo en el bloque.
    const target = resetTarget;
    setIsResetting(true);
    setResetError(null);
    // Solo `password`: renombrar y activar/desactivar son otras operaciones y
    // mandarlas juntas escribiría lo que el administrador no tocó.
    updateUser(apiClient, target.id, { password: resetPassword })
      .then(() => {
        setResetTarget(null);
        setResetPassword("");
        setResetDone(target.name);
        // Sin recargar: nada de lo que muestra la tabla cambió. `password`
        // tampoco vuelve en la respuesta — `UserResponseDto` no lo tiene.
      })
      .catch((error: unknown) => {
        setResetError(errorMessage(error, "No se pudo cambiar la contraseña."));
      })
      .finally(() => setIsResetting(false));
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

      {resetTarget && (
        <section className="card">
          <form
            className="card__body"
            onSubmit={handleReset}
            noValidate
            aria-label={`Cambiar la contraseña de ${resetTarget.name}`}
          >
            <div className="page-header">
              <h2>Cambiar la contraseña de {resetTarget.name}</h2>
            </div>

            <div className="notice notice--info">
              <span>
                Cambiar la contraseña no cierra la sesión abierta de esa persona: si tiene el
                sistema abierto, sigue adentro. Esto es para cuando alguien olvidó su contraseña.
                Para que alguien deje de entrar, desactívalo: eso sí lo saca la próxima vez que el
                sistema le renueve la sesión.
              </span>
            </div>

            <div className="form-grid">
              <div className="field">
                <label className="field__label" htmlFor="resetPassword">
                  Contraseña nueva
                </label>
                <input
                  id="resetPassword"
                  type="password"
                  value={resetPassword}
                  disabled={isResetting}
                  autoComplete="new-password"
                  // El bloque abre arriba de la tabla; disparado desde una
                  // fila de más abajo, el clic parecería no haber hecho nada.
                  // El foco es lo que trae al administrador hasta acá.
                  autoFocus
                  onChange={(event) => {
                    setResetPassword(event.target.value);
                    setResetError(null);
                  }}
                />
                {/* Una sola casilla, igual que el alta: la eliges tú, y si te
                    equivocas al escribirla se repone otra vez desde acá. */}
                <span className="field__hint">
                  Mínimo {MIN_PASSWORD_LENGTH} caracteres. La eliges tú y se la dictas a la persona;
                  el sistema no vuelve a mostrarla.
                </span>
              </div>
            </div>

            {resetError && (
              <div className="notice notice--error" role="alert">
                {resetError}
              </div>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="button button--secondary"
                disabled={isResetting}
                onClick={closeReset}
              >
                Cancelar
              </button>
              {/* No se llama igual que el botón de la fila que abre este
                  bloque, por lo mismo que "Nuevo usuario" abre y "Crear
                  usuario" envía: con el bloque abierto habría un botón por
                  fila con ese nombre, más este. */}
              <button type="submit" className="button button--primary" disabled={isResetting}>
                {isResetting ? "Guardando…" : "Guardar contraseña nueva"}
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

        {resetDone && (
          <div className="card__body">
            <p className="notice notice--info" role="status">
              Contraseña cambiada. Díctasela a {resetDone}; el sistema no vuelve a mostrarla.
            </p>
          </div>
        )}

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
                              {/* Estos tres van deshabilitados también con
                                  `isResetting`: abrir otra cosa mientras el
                                  PATCH de la reposición viaja haría que la
                                  respuesta aterrice sobre un bloque que ya es
                                  de otra persona. */}
                              <button
                                type="button"
                                className="button button--ghost"
                                disabled={isSavingAction || isResetting}
                                onClick={() => handleStartEdit(row)}
                              >
                                Editar
                              </button>
                              {/* Sin guarda de `isSelf`: cambiarse la propia
                                  contraseña es la forma de rotar la del
                                  administrador. */}
                              <button
                                type="button"
                                className="button button--ghost"
                                disabled={isSavingAction || isResetting}
                                onClick={() => handleStartReset(row)}
                              >
                                Cambiar contraseña
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
                                    disabled={isSavingAction || isResetting}
                                    onClick={() => handleStartDeactivate(row)}
                                  >
                                    Desactivar
                                  </button>
                                )
                              ) : (
                                <button
                                  type="button"
                                  className="button button--ghost"
                                  disabled={isSavingAction || isResetting}
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
