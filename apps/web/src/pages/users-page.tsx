import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { listRoutes } from "../api/routes";
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

/**
 * Qué habilita cada rol, en el vocabulario de la planta.
 *
 * Está a la vista al corregir roles porque el caso que más confunde no es
 * agregar sino quitar: sacarle "Chofer" a alguien que además es "Vendedor" NO
 * le achica el acceso a rutas, se lo agranda. `isPrivileged` en
 * `routes.service.ts` hace que un vendedor vea y opere TODAS las rutas,
 * mientras que un chofer solo ve las suyas. Es la definición de vendedor y no
 * un bug, pero desde esta pantalla es un clic y sin este texto no se ve.
 */
const ROLE_EXPLANATIONS: Record<UserRole, string> = {
  ADMIN: "Ve y hace todo: precios, cobranzas, usuarios y el cuadre de envases.",
  SELLER: "Toma pedidos y planifica rutas. Ve y opera las rutas de todos los choferes.",
  DRIVER: "Sale a repartir. Ve y opera solo las rutas que tiene a su nombre.",
};

/**
 * Rutas sin cerrar de quien está por dejar de ser chofer.
 *
 * Su presencia es además el estado de "ya se confirmó": mientras es `null` no
 * hay nada confirmado, y `toggleRoleDraft` la vuelve a `null` porque un cambio
 * de casilla invalida la cuenta que se le mostró al administrador.
 */
interface RoutesAtRisk {
  /** Nombre de la persona, para no depender de que su fila siga en la tabla. */
  name: string;
  /** `null` cuando la consulta falló: hay que confirmar sin saber. */
  count: number | null;
}

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
 * Gestión de usuarios: alta, renombrar, cambiar la contraseña, corregir roles,
 * desactivar y reactivar.
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
 * Corregir roles es el cuarto modo, y también un bloque propio: tres casillas
 * más el texto de qué habilita cada rol no entran en la fila sin repetir el
 * desborde de la columna de acciones, y cada PATCH de esta pantalla manda una
 * sola operación.
 *
 * Quitarle "Chofer" a alguien con rutas sin cerrar AVISA, no bloquea, y las
 * rutas no se tocan: `route.driverId` es un hecho histórico. Ninguna queda sin
 * quien la opere, porque ADMIN y SELLER pasan `assertCanAccessRoute` siempre.
 *
 * La guarda de no cerrarse la puerta desde adentro vive ahora en la API
 * (`UsersService.update` mira el actor del token) además de en la pantalla, que
 * no ofrece ni desactivarse ni quitarse ADMIN a uno mismo. Antes vivía solo
 * acá, y Swagger la salteaba.
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
  /**
   * Cuántas veces se cargó la lista. No se muestra: sirve para preguntar
   * "¿la lista de abajo sigue siendo la misma que cuando mandé esto?" desde
   * una respuesta que llega tarde. Un `useRef` y no un estado, porque leerlo
   * no tiene que redibujar nada.
   */
  const listRunRef = useRef(0);

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

  const [rolesTarget, setRolesTarget] = useState<User | null>(null);
  const [rolesDraft, setRolesDraft] = useState<UserRole[]>([]);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [isSavingRoles, setIsSavingRoles] = useState(false);
  /**
   * Cuántas rutas sin cerrar quedan a nombre de quien está por dejar de ser
   * chofer, y si se pudo averiguar. `null` mientras no haya nada que confirmar.
   */
  const [routesAtRisk, setRoutesAtRisk] = useState<RoutesAtRisk | null>(null);
  const [isCheckingRoutes, setIsCheckingRoutes] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listRunRef.current += 1;
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

  /**
   * Deja la pantalla sin ningún modo abierto, y se lleva lo que cada uno
   * hubiera dejado en pantalla: la contraseña tipeada —una credencial en
   * claro—, los borradores, los errores de la operación anterior y el aviso
   * del último cambio, que nombra a una persona y envejece mal.
   *
   * Los cuatro modos —alta, renombrar, contraseña, roles— se excluyen entre
   * sí: dos bloques hermanos arriba de la tabla, cada uno con su "Cancelar",
   * abiertos a la vez no dejan saber cuál cancela cuál; y una fila en modo
   * edición debajo de un bloque de otra persona se lee como si fueran la
   * misma operación.
   *
   * Vive en una sola función a propósito. La exclusión estaba repartida en
   * cada `handleStart*`, escribiendo a mano el estado de los otros tres, y así
   * se olvidó dos veces: al agregar el bloque de contraseña, «Editar» y
   * «Desactivar» no lo cerraban. Con cuatro modos, el que agregue el quinto
   * solo tiene que llamar a esto primero.
   */
  function closeAllModes() {
    setIsAdding(false);
    setCreateError(null);
    setEditingId(null);
    setDeactivatingId(null);
    setActionError(null);
    setResetTarget(null);
    setResetPassword("");
    setResetError(null);
    setResetDone(null);
    setRolesTarget(null);
    setRolesDraft([]);
    setRolesError(null);
    setRoutesAtRisk(null);
  }

  function handleStartAdd() {
    closeAllModes();
    setIsAdding(true);
    setNewName("");
    setNewUsername("");
    setNewPassword("");
    setNewRoles([]);
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
    closeAllModes();
    setEditingId(target.id);
    setEditName(target.name);
  }

  function handleStartDeactivate(target: User) {
    closeAllModes();
    setDeactivatingId(target.id);
  }

  function handleStartReset(target: User) {
    closeAllModes();
    setResetTarget(target);
  }

  function handleStartRoles(target: User) {
    closeAllModes();
    setRolesTarget(target);
    setRolesDraft(target.roles);
  }

  function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isResetting || resetTarget === null) return;
    if (resetPassword.length < MIN_PASSWORD_LENGTH) return setResetError(PASSWORD_TOO_SHORT);

    // Mientras el PATCH viaja, la fila no deja abrir otra operación (sus
    // botones se deshabilitan con `isResetting`), así que al volver la
    // respuesta `target` sigue siendo de quien se está viendo en el bloque.
    // Lo que eso NO garantiza es que esa persona siga en la lista de abajo:
    // los filtros quedan vivos a propósito —mirar otra lista no es motivo
    // para congelar la pantalla durante una escritura ajena— y cambiarlos
    // recarga la tabla. De ahí el número de carga, que se compara al volver.
    const target = resetTarget;
    const listRunAtSubmit = listRunRef.current;
    setIsResetting(true);
    setResetError(null);
    // Solo `password`: renombrar y activar/desactivar son otras operaciones y
    // mandarlas juntas escribiría lo que el administrador no tocó.
    updateUser(apiClient, target.id, { password: resetPassword })
      .then(() => {
        setResetTarget(null);
        setResetPassword("");
        // El aviso nombra una fila de la tabla, así que solo se pone si la
        // tabla sigue siendo aquella. Si el administrador se fue a mirar otra
        // lista mientras esto viajaba, se pierde el aviso —la misma regla que
        // ya aplica el efecto de carga, que lo borra en cada recarga— y no se
        // deja uno huérfano nombrando a alguien que ahí no está.
        if (listRunRef.current === listRunAtSubmit) setResetDone(target.name);
        // Sin recargar: nada de lo que muestra la tabla cambió. `password`
        // tampoco vuelve en la respuesta — `UserResponseDto` no lo tiene.
      })
      .catch((error: unknown) => {
        setResetError(errorMessage(error, "No se pudo cambiar la contraseña."));
      })
      .finally(() => setIsResetting(false));
  }

  function toggleRoleDraft(role: UserRole) {
    setRolesDraft((current) =>
      current.includes(role) ? current.filter((value) => value !== role) : [...current, role],
    );
    setRolesError(null);
    // El aviso de rutas se calculó para un borrador que ya no es este.
    setRoutesAtRisk(null);
  }

  /**
   * Antes de quitarle DRIVER a alguien que lo tenía, cuenta cuántas rutas sin
   * cerrar quedan a su nombre y pide confirmación diciendo el número.
   *
   * Avisa, no bloquea, y las rutas NO se tocan: `route.driverId` es un hecho
   * histórico —quién hizo ese reparto— y reasignarlas o cancelarlas sería
   * reescribirlo. Ninguna queda huérfana: `RoutesService.create` valida el rol
   * solo al crear, y `assertCanAccessRoute` deja pasar siempre a ADMIN y
   * SELLER, así que la ruta sigue teniendo quien la opere desde la oficina.
   *
   * Esto acopla la pantalla de usuarios al cliente de rutas a propósito. Un
   * aviso genérico —"puede tener rutas asignadas"— no responde la pregunta que
   * el dueño se va a hacer, que es si le puede quitar el rol ahora o conviene
   * esperar a que cierre la ruta de hoy. Para eso hace falta el número.
   */
  function handleSaveRoles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingRoles || isCheckingRoutes || rolesTarget === null) return;
    if (rolesDraft.length === 0) return setRolesError(ROLES_REQUIRED);

    const target = rolesTarget;
    const losesDriver = target.roles.includes("DRIVER") && !rolesDraft.includes("DRIVER");
    if (!losesDriver || routesAtRisk !== null) return saveRoles(target);

    setIsCheckingRoutes(true);
    setRolesError(null);
    // `limit: 1` porque solo interesa `total`; y dos llamadas porque
    // `GET /routes` acepta un `status` por vez. No se toca ese contrato para
    // esto: dos consultas de una fila, una sola vez y solo cuando se quita
    // DRIVER, no justifican un parámetro nuevo en la API.
    Promise.all([
      listRoutes(apiClient, { driverId: target.id, status: "PLANNED", limit: 1 }),
      listRoutes(apiClient, { driverId: target.id, status: "IN_PROGRESS", limit: 1 }),
    ])
      .then(([planned, inProgress]) => {
        setRoutesAtRisk({
          name: target.name,
          count: planned.total + inProgress.total,
        });
      })
      .catch(() => {
        // No poder verificar no bloquea el cambio: se confirma igual, pero la
        // pantalla dice que no pudo mirar en vez de callarlo o inventar un
        // cero, que sería peor que no avisar.
        setRoutesAtRisk({ name: target.name, count: null });
      })
      .finally(() => setIsCheckingRoutes(false));
  }

  /**
   * No muestra aviso: la fila misma es la confirmación, porque su columna
   * Roles cambia a la vista. Eso además evita heredar la carrera que arregló
   * el #107 — un aviso que nombra a una persona tiene que morir cuando la
   * lista cambia debajo, y acá el propio guardado puede cambiarla.
   *
   * Se recarga SOLO si la fila deja de pertenecer al filtro de rol que se está
   * mirando; en ese caso desaparece, igual que al desactivar con el filtro en
   * "En uso". Si el filtro es "Todos" o la persona lo sigue cumpliendo, se
   * actualiza en el lugar y no se gasta una consulta.
   */
  function saveRoles(target: User) {
    setIsSavingRoles(true);
    setRolesError(null);
    // Solo `roles`, y la lista completa: la API reemplaza el conjunto.
    updateUser(apiClient, target.id, { roles: rolesDraft })
      .then((updated) => {
        setRolesTarget(null);
        setRoutesAtRisk(null);
        if (roleFilter !== "all" && !updated.roles.includes(roleFilter)) {
          reload();
          return;
        }
        setUsers((current) =>
          sortByName(current.map((row) => (row.id === updated.id ? updated : row))),
        );
      })
      .catch((error: unknown) => {
        setRolesError(errorMessage(error, "No se pudieron cambiar los roles."));
      })
      .finally(() => setIsSavingRoles(false));
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
                onClick={closeAllModes}
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

      {rolesTarget && (
        <section className="card">
          <form
            className="card__body"
            onSubmit={handleSaveRoles}
            noValidate
            aria-label={`Corregir los roles de ${rolesTarget.name}`}
          >
            <div className="page-header">
              <h2>Corregir los roles de {rolesTarget.name}</h2>
            </div>

            <div className="field">
              <span className="field__label">Roles</span>
              <div className="checkbox-group checkbox-group--stacked">
                {ROLE_ORDER.map((role) => {
                  // Un administrador no puede quitarse a sí mismo la
                  // administración: se cerraría la puerta desde adentro. La
                  // pantalla no lo ofrece, y la API lo rechaza igual.
                  const isOwnAdmin = rolesTarget.id === user?.id && role === "ADMIN";
                  return (
                    <label className="checkbox-field" key={role}>
                      <input
                        type="checkbox"
                        checked={rolesDraft.includes(role)}
                        disabled={isSavingRoles || isCheckingRoutes || isOwnAdmin}
                        onChange={() => toggleRoleDraft(role)}
                      />
                      <span>
                        {ROLE_LABELS[role]}
                        <span className="field__hint"> — {ROLE_EXPLANATIONS[role]}</span>
                        {isOwnAdmin && (
                          <span className="field__hint">
                            {" "}
                            No puedes quitarte a ti mismo la administración.
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {routesAtRisk && (
              <div className="notice notice--warning" role="alert">
                <span>
                  {routesAtRisk.count === null
                    ? `No se pudo consultar las rutas de ${routesAtRisk.name}. Si tiene alguna sin cerrar, sigue a su nombre y se puede terminar desde la oficina.`
                    : routesAtRisk.count === 0
                      ? `${routesAtRisk.name} no tiene rutas sin cerrar. Al dejar de ser chofer no podrá salir a repartir.`
                      : `${routesAtRisk.name} tiene ${String(routesAtRisk.count)} ${routesAtRisk.count === 1 ? "ruta sin cerrar" : "rutas sin cerrar"}. Siguen a su nombre y se pueden terminar desde la oficina, pero ya no va a poder abrirlas desde su teléfono. Puedes esperar a que las cierre.`}
                </span>
              </div>
            )}

            {rolesError && (
              <div className="notice notice--error" role="alert">
                {rolesError}
              </div>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="button button--secondary"
                disabled={isSavingRoles || isCheckingRoutes}
                onClick={closeAllModes}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="button button--primary"
                disabled={isSavingRoles || isCheckingRoutes}
              >
                {isCheckingRoutes
                  ? "Revisando sus rutas…"
                  : isSavingRoles
                    ? "Guardando…"
                    : routesAtRisk
                      ? "Sí, guardar los roles"
                      : "Guardar roles"}
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
                              <button
                                type="button"
                                className="button button--ghost"
                                disabled={isSavingAction || isResetting}
                                onClick={() => handleStartRoles(row)}
                              >
                                Roles
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
