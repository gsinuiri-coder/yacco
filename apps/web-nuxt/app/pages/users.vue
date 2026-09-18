<script setup lang="ts">
import { MIN_PASSWORD_LENGTH } from "@yacco/shared";
import type { Page, Route, User, UserRole } from "@yacco/shared";

/**
 * Gestión de usuarios: alta, renombrar, cambiar la contraseña, corregir
 * roles, desactivar y reactivar. Roles asimétricos, el mismo patrón que
 * Tipos de envase y Zonas: leer es ADMIN y SELLER, escribir es sólo ADMIN.
 *
 * Cuatro modos —alta, renombrar, contraseña, roles— se excluyen entre sí;
 * `closeAllModes` es el único lugar que los cierra a todos, para no repetir
 * la exclusión en cada `start*` y olvidarla en alguno nuevo.
 *
 * Cambiar la contraseña NO cierra la sesión abierta de esa persona (el
 * refresh sólo valida la firma y que siga activa, nunca compara contra el
 * hash); lo que sí corta es desactivar, en el próximo refresco. El bloque
 * lo dice con esas palabras para que nadie confunda las dos operaciones.
 *
 * Quitarle "Chofer" a alguien con rutas sin cerrar AVISA, no bloquea, y las
 * rutas no se tocan: `route.driverId` es un hecho histórico y ninguna queda
 * sin quien la opere (ADMIN y SELLER siempre pueden acceder).
 *
 * El administrador no puede quitarse a sí mismo la administración ni
 * desactivarse: la pantalla no lo ofrece en vez de dejar que pase y avisar
 * después (la API lo rechaza igual).
 */
const NAME_REQUIRED = "Escribe el nombre de la persona";
const USERNAME_REQUIRED = "Escribe el usuario con el que va a entrar";
const PASSWORD_TOO_SHORT = `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`;
const ROLES_REQUIRED = "Elige al menos un rol";
const ALL = "all";

useHead({ title: "Usuarios · Yacco" });

const session = useSession();
const api = useApi();
const isAdmin = computed(() => session.hasRole("ADMIN"));

const roleFilter = ref<UserRole | typeof ALL>(ALL);
const statusFilter = ref<"active" | "inactive">("active");

const users = ref<User[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const slow = useSlowRequest(loading);
const reloads = ref(0);
let listRun = 0;

async function loadUsers(): Promise<void> {
  listRun++;
  loading.value = true;
  loadError.value = null;
  // El aviso de "contraseña cambiada" nombra una fila; si la lista que se
  // mira cambia debajo, se va con ella.
  resetDone.value = null;
  try {
    users.value = sortUsersByName(
      await api.request<User[]>("/users", {
        query: {
          active: statusFilter.value === "active",
          ...(roleFilter.value === ALL ? {} : { role: roleFilter.value }),
        },
      }),
    );
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}
function reload(): void {
  reloads.value++;
}

function replaceUser(updated: User): void {
  users.value = sortUsersByName(users.value.map((row) => (row.id === updated.id ? updated : row)));
}

function closeAllModes(): void {
  adding.value = false;
  createError.value = null;
  editingId.value = null;
  deactivatingId.value = null;
  actionError.value = null;
  resetTarget.value = null;
  resetPassword.value = "";
  resetError.value = null;
  resetDone.value = null;
  rolesTarget.value = null;
  rolesDraft.value = [];
  rolesError.value = null;
  routesAtRisk.value = null;
}

// --- Alta ---
const adding = ref(false);
const newName = ref("");
const newUsername = ref("");
const newPassword = ref("");
const newRoles = ref<UserRole[]>([]);
const createError = ref<string | null>(null);
const creating = ref(false);

function startAdd(): void {
  closeAllModes();
  adding.value = true;
  newName.value = "";
  newUsername.value = "";
  newPassword.value = "";
  newRoles.value = [];
}

async function submitCreate(): Promise<void> {
  if (creating.value) return;
  const name = newName.value.trim();
  const username = newUsername.value.trim();
  if (name === "") {
    createError.value = NAME_REQUIRED;
    return;
  }
  if (username === "") {
    createError.value = USERNAME_REQUIRED;
    return;
  }
  if (newPassword.value.length < MIN_PASSWORD_LENGTH) {
    createError.value = PASSWORD_TOO_SHORT;
    return;
  }
  if (newRoles.value.length === 0) {
    createError.value = ROLES_REQUIRED;
    return;
  }
  creating.value = true;
  createError.value = null;
  try {
    await api.request("/users", {
      method: "POST",
      body: { name, username, password: newPassword.value, roles: newRoles.value },
    });
    adding.value = false;
    newPassword.value = "";
    // Recarga en vez de insertar: nace activa y el filtro puede estar en
    // "Desactivados", donde no corresponde mostrarla.
    reload();
  } catch (error) {
    // El 409 de la API nombra el usuario repetido: tal cual.
    createError.value = describeApiFailure(error);
  } finally {
    creating.value = false;
  }
}

// --- Renombrar y desactivar/reactivar, por fila ---
const editingId = ref<string | null>(null);
const editName = ref("");
const deactivatingId = ref<string | null>(null);
const actionError = ref<string | null>(null);
const savingAction = ref(false);

function startEdit(target: User): void {
  closeAllModes();
  editingId.value = target.id;
  editName.value = target.name;
}

async function submitEdit(id: string): Promise<void> {
  if (savingAction.value) return;
  const name = editName.value.trim();
  if (name === "") {
    actionError.value = NAME_REQUIRED;
    return;
  }
  savingAction.value = true;
  actionError.value = null;
  try {
    const updated = await api.request<User>(`/users/${id}`, { method: "PATCH", body: { name } });
    replaceUser(updated);
    editingId.value = null;
  } catch (error) {
    actionError.value = describeApiFailure(error);
  } finally {
    savingAction.value = false;
  }
}

function startDeactivate(target: User): void {
  closeAllModes();
  deactivatingId.value = target.id;
}

async function setActive(id: string, active: boolean): Promise<void> {
  if (savingAction.value) return;
  savingAction.value = true;
  actionError.value = null;
  try {
    await api.request(`/users/${id}`, { method: "PATCH", body: { active } });
    deactivatingId.value = null;
    // La fila cambia de mitad: con el filtro en "En uso", uno desactivado deja de pertenecer.
    reload();
  } catch (error) {
    actionError.value = describeApiFailure(error);
  } finally {
    savingAction.value = false;
  }
}

// --- Cambiar contraseña ---
const resetTarget = ref<User | null>(null);
const resetPassword = ref("");
const resetError = ref<string | null>(null);
const resetting = ref(false);
const resetDone = ref<string | null>(null);
watch([roleFilter, statusFilter, reloads], loadUsers, { immediate: true });

function startReset(target: User): void {
  closeAllModes();
  resetTarget.value = target;
}

async function submitReset(): Promise<void> {
  if (resetting.value || resetTarget.value === null) return;
  if (resetPassword.value.length < MIN_PASSWORD_LENGTH) {
    resetError.value = PASSWORD_TOO_SHORT;
    return;
  }
  const target = resetTarget.value;
  const listRunAtSubmit = listRun;
  resetting.value = true;
  resetError.value = null;
  try {
    // Sólo `password`: renombrar y activar/desactivar son otras operaciones.
    await api.request(`/users/${target.id}`, {
      method: "PATCH",
      body: { password: resetPassword.value },
    });
    resetTarget.value = null;
    resetPassword.value = "";
    // El aviso nombra una fila; sólo se pone si la tabla sigue siendo aquella.
    if (listRun === listRunAtSubmit) resetDone.value = target.name;
  } catch (error) {
    resetError.value = describeApiFailure(error);
  } finally {
    resetting.value = false;
  }
}

// --- Corregir roles ---
const rolesTarget = ref<User | null>(null);
const rolesDraft = ref<UserRole[]>([]);
const rolesError = ref<string | null>(null);
const savingRoles = ref(false);
const routesAtRisk = ref<{ name: string; count: number | null } | null>(null);
const checkingRoutes = ref(false);

function startRoles(target: User): void {
  closeAllModes();
  rolesTarget.value = target;
  rolesDraft.value = target.roles;
}

function toggleRoleDraft(role: UserRole): void {
  rolesDraft.value = toggleRole(rolesDraft.value, role);
  rolesError.value = null;
  // El aviso de rutas se calculó para un borrador que ya no es este.
  routesAtRisk.value = null;
}

async function saveRoles(target: User): Promise<void> {
  savingRoles.value = true;
  rolesError.value = null;
  try {
    // Sólo `roles`, y la lista completa: la API reemplaza el conjunto.
    const updated = await api.request<User>(`/users/${target.id}`, {
      method: "PATCH",
      body: { roles: rolesDraft.value },
    });
    rolesTarget.value = null;
    routesAtRisk.value = null;
    if (roleFilter.value !== ALL && !updated.roles.includes(roleFilter.value)) {
      reload();
      return;
    }
    replaceUser(updated);
  } catch (error) {
    rolesError.value = describeApiFailure(error);
  } finally {
    savingRoles.value = false;
  }
}

async function submitRoles(): Promise<void> {
  if (savingRoles.value || checkingRoutes.value || rolesTarget.value === null) return;
  if (rolesDraft.value.length === 0) {
    rolesError.value = ROLES_REQUIRED;
    return;
  }
  const target = rolesTarget.value;
  const losesDriver = target.roles.includes("DRIVER") && !rolesDraft.value.includes("DRIVER");
  if (!losesDriver || routesAtRisk.value !== null) {
    await saveRoles(target);
    return;
  }

  checkingRoutes.value = true;
  rolesError.value = null;
  try {
    const [planned, inProgress] = await Promise.all([
      api.request<Page<Route>>("/routes", {
        query: { driverId: target.id, status: "PLANNED", limit: 1 },
      }),
      api.request<Page<Route>>("/routes", {
        query: { driverId: target.id, status: "IN_PROGRESS", limit: 1 },
      }),
    ]);
    routesAtRisk.value = { name: target.name, count: planned.total + inProgress.total };
  } catch {
    // No poder verificar no bloquea: se confirma igual, diciendo que no se pudo.
    routesAtRisk.value = { name: target.name, count: null };
  } finally {
    checkingRoutes.value = false;
  }
}

const rolesSubmitLabel = computed(() => {
  if (checkingRoutes.value) return "Revisando sus rutas…";
  if (savingRoles.value) return "Guardando…";
  return routesAtRisk.value ? "Sí, guardar los roles" : "Guardar roles";
});
</script>

<template>
  <AppPage
    title="Usuarios"
    description="Quién entra al sistema y con qué rol. Un chofer necesita estar acá antes de que se le pueda planificar una ruta."
  >
    <template #actions>
      <UButton
        v-if="isAdmin && !adding"
        icon="i-lucide-user-plus"
        label="Nuevo usuario"
        @click="startAdd"
      />
    </template>

    <div class="space-y-6">
      <UCard v-if="adding">
        <div class="space-y-4">
          <UAlert
            v-if="createError"
            role="alert"
            color="error"
            variant="subtle"
            :title="createError"
          />
          <form
            class="space-y-4"
            novalidate
            aria-label="Nuevo usuario"
            @submit.prevent="submitCreate"
          >
            <div class="grid gap-4 sm:grid-cols-3">
              <UFormField label="Nombre">
                <UInput
                  v-model="newName"
                  placeholder="Juana Pérez"
                  :disabled="creating"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Usuario" help="Con esto escribe al entrar; no se puede cambiar.">
                <UInput
                  v-model="newUsername"
                  placeholder="jperez"
                  autocomplete="off"
                  :disabled="creating"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="Contraseña"
                :help="`Mínimo ${MIN_PASSWORD_LENGTH} caracteres. Entrégasela a la persona por un medio seguro; el sistema no vuelve a mostrarla.`"
              >
                <UInput
                  v-model="newPassword"
                  type="password"
                  autocomplete="new-password"
                  :disabled="creating"
                  class="w-full"
                />
              </UFormField>
            </div>
            <div>
              <span class="text-sm font-medium text-default">Roles</span>
              <div class="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
                <UCheckbox
                  v-for="role in ROLE_ORDER"
                  :key="role"
                  :model-value="newRoles.includes(role)"
                  :label="ROLE_LABEL[role]"
                  :disabled="creating"
                  @update:model-value="
                    () => {
                      newRoles = toggleRole(newRoles, role);
                      createError = null;
                    }
                  "
                />
              </div>
              <p class="mt-1 text-xs text-muted">
                Puede tener más de uno: alguien que vende y además reparte.
              </p>
            </div>
            <div class="flex justify-end gap-2 border-t border-default pt-4">
              <UButton
                color="neutral"
                variant="outline"
                label="Cancelar"
                :disabled="creating"
                @click="adding = false"
              />
              <UButton
                type="submit"
                :label="creating ? 'Creando…' : 'Crear usuario'"
                :disabled="creating"
              />
            </div>
          </form>
        </div>
      </UCard>

      <UCard v-if="resetTarget">
        <form
          class="space-y-4"
          novalidate
          :aria-label="`Cambiar la contraseña de ${resetTarget.name}`"
          @submit.prevent="submitReset"
        >
          <h2 class="text-lg font-semibold text-highlighted">
            Cambiar la contraseña de {{ resetTarget.name }}
          </h2>
          <UAlert
            role="status"
            color="neutral"
            variant="subtle"
            title="Cambiar la contraseña no cierra la sesión abierta de esa persona: si tiene el sistema abierto, sigue adentro. Esto es para cuando alguien olvidó su contraseña. Para que alguien deje de entrar, desactívalo: eso sí lo saca la próxima vez que el sistema le renueve la sesión."
          />
          <UFormField
            label="Contraseña nueva"
            :help="`Mínimo ${MIN_PASSWORD_LENGTH} caracteres. La eliges tú y se la dictas a la persona; el sistema no vuelve a mostrarla.`"
          >
            <UInput
              v-model="resetPassword"
              type="password"
              autocomplete="new-password"
              :disabled="resetting"
              class="w-full sm:w-80"
              @update:model-value="resetError = null"
            />
          </UFormField>
          <UAlert
            v-if="resetError"
            role="alert"
            color="error"
            variant="subtle"
            :title="resetError"
          />
          <div class="flex justify-end gap-2 border-t border-default pt-4">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="resetting"
              @click="closeAllModes"
            />
            <UButton
              type="submit"
              :label="resetting ? 'Guardando…' : 'Guardar contraseña nueva'"
              :disabled="resetting"
            />
          </div>
        </form>
      </UCard>

      <UCard v-if="rolesTarget">
        <form
          class="space-y-4"
          novalidate
          :aria-label="`Corregir los roles de ${rolesTarget.name}`"
          @submit.prevent="submitRoles"
        >
          <h2 class="text-lg font-semibold text-highlighted">
            Corregir los roles de {{ rolesTarget.name }}
          </h2>
          <div class="space-y-3">
            <span class="text-sm font-medium text-default">Roles</span>
            <div v-for="role in ROLE_ORDER" :key="role" class="flex items-start gap-2">
              <UCheckbox
                :model-value="rolesDraft.includes(role)"
                :disabled="
                  savingRoles ||
                  checkingRoutes ||
                  (rolesTarget.id === session.user.value?.id && role === 'ADMIN')
                "
                @update:model-value="toggleRoleDraft(role)"
              >
                <template #label>
                  <span>
                    {{ ROLE_LABEL[role] }}
                    <span class="text-muted"> — {{ ROLE_EXPLANATION[role] }}</span>
                    <span
                      v-if="rolesTarget.id === session.user.value?.id && role === 'ADMIN'"
                      class="text-muted"
                    >
                      No puedes quitarte a ti mismo la administración.
                    </span>
                  </span>
                </template>
              </UCheckbox>
            </div>
          </div>

          <UAlert
            v-if="routesAtRisk"
            role="alert"
            color="warning"
            variant="subtle"
            :title="
              routesAtRisk.count === null
                ? `No se pudo consultar las rutas de ${routesAtRisk.name}. Si tiene alguna sin cerrar, sigue a su nombre y se puede terminar desde la oficina.`
                : routesAtRisk.count === 0
                  ? `${routesAtRisk.name} no tiene rutas sin cerrar. Al dejar de ser chofer no podrá salir a repartir.`
                  : `${routesAtRisk.name} tiene ${routesAtRisk.count} ${routesAtRisk.count === 1 ? 'ruta sin cerrar' : 'rutas sin cerrar'}. Siguen a su nombre y se pueden terminar desde la oficina, pero ya no va a poder abrirlas desde su teléfono. Puedes esperar a que las cierre.`
            "
          />
          <UAlert
            v-if="rolesError"
            role="alert"
            color="error"
            variant="subtle"
            :title="rolesError"
          />

          <div class="flex justify-end gap-2 border-t border-default pt-4">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="savingRoles || checkingRoutes"
              @click="closeAllModes"
            />
            <UButton
              type="submit"
              :label="rolesSubmitLabel"
              :disabled="savingRoles || checkingRoutes"
            />
          </div>
        </form>
      </UCard>

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <div class="flex flex-wrap items-end gap-4 border-b border-default p-4">
          <UFormField label="Rol" class="w-44">
            <USelect
              v-model="roleFilter"
              :items="[
                { label: 'Todos', value: ALL },
                ...ROLE_ORDER.map((role) => ({ label: ROLE_LABEL[role], value: role })),
              ]"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Estado" class="w-40">
            <USelect
              v-model="statusFilter"
              :items="[
                { label: 'En uso', value: 'active' },
                { label: 'Desactivados', value: 'inactive' },
              ]"
              class="w-full"
            />
          </UFormField>
        </div>

        <div v-if="resetDone || actionError" class="space-y-2 p-4 pb-0">
          <UAlert
            v-if="resetDone"
            role="status"
            color="success"
            variant="subtle"
            :title="`Contraseña cambiada. Díctasela a ${resetDone}; el sistema no vuelve a mostrarla.`"
          />
          <UAlert
            v-if="actionError"
            role="alert"
            color="error"
            variant="subtle"
            :title="actionError"
          />
        </div>

        <UAlert
          v-if="slow && loading"
          role="status"
          color="neutral"
          variant="subtle"
          class="rounded-none"
          :title="SLOW_REQUEST_MESSAGE"
        />

        <ListStatus
          v-if="loadError || loading || users.length === 0"
          :error-message="loadError"
          :loading="loading"
          :empty="users.length === 0"
          loading-label="Cargando usuarios…"
          empty-icon="i-lucide-users"
          :empty-title="
            statusFilter === 'active'
              ? 'No hay usuarios con ese rol'
              : 'No hay usuarios desactivados'
          "
          :empty-description="
            statusFilter === 'active'
              ? 'Prueba con otro rol, o da de alta a la persona.'
              : 'Todos los usuarios de ese rol están en uso.'
          "
          @retry="loadUsers"
        />

        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <caption class="sr-only">
              Usuarios con su nombre, usuario de entrada, roles y estado
            </caption>
            <thead class="bg-elevated text-left text-xs tracking-wide text-muted uppercase">
              <tr>
                <th scope="col" class="px-4 py-2 font-medium">Nombre</th>
                <th scope="col" class="px-4 py-2 font-medium">Usuario</th>
                <th scope="col" class="px-4 py-2 font-medium">Roles</th>
                <th scope="col" class="px-4 py-2 font-medium">Estado</th>
                <th v-if="isAdmin" scope="col" class="px-4 py-2">
                  <span class="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr v-for="row in users" :key="row.id">
                <td class="px-4 py-3">
                  <UInput
                    v-if="editingId === row.id"
                    :model-value="editName"
                    :aria-label="`Nuevo nombre de ${row.name}`"
                    :disabled="savingAction"
                    class="w-full"
                    @update:model-value="(value: string | number) => (editName = String(value))"
                  />
                  <span v-else class="font-medium text-highlighted">{{ row.name }}</span>
                </td>
                <td class="px-4 py-3 text-muted">{{ row.username }}</td>
                <td class="px-4 py-3">{{ describeRoles(row.roles) }}</td>
                <td class="px-4 py-3">
                  <UBadge
                    :color="row.active ? 'success' : 'neutral'"
                    variant="subtle"
                    :label="row.active ? 'En uso' : 'Desactivado'"
                  />
                </td>
                <td v-if="isAdmin" class="px-4 py-3">
                  <div v-if="editingId === row.id" class="flex justify-end gap-2">
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      label="Cancelar"
                      :disabled="savingAction"
                      @click="editingId = null"
                    />
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      label="Guardar"
                      :disabled="savingAction"
                      @click="submitEdit(row.id)"
                    />
                  </div>
                  <div
                    v-else-if="deactivatingId === row.id"
                    role="group"
                    :aria-label="`Confirmar desactivar a ${row.name}`"
                    class="flex flex-wrap items-center justify-end gap-2"
                  >
                    <span class="text-muted">¿Desactivar? No podrá entrar.</span>
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      label="No"
                      :disabled="savingAction"
                      @click="deactivatingId = null"
                    />
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      label="Sí, desactivar"
                      :disabled="savingAction"
                      @click="setActive(row.id, false)"
                    />
                  </div>
                  <div v-else class="flex flex-wrap justify-end gap-1">
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      label="Editar"
                      :disabled="savingAction || resetting"
                      @click="startEdit(row)"
                    />
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      label="Cambiar contraseña"
                      :disabled="savingAction || resetting"
                      @click="startReset(row)"
                    />
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      label="Roles"
                      :disabled="savingAction || resetting"
                      @click="startRoles(row)"
                    />
                    <template v-if="row.active">
                      <!-- Desactivarse a uno mismo es cerrarse la puerta desde adentro. -->
                      <span v-if="row.id === session.user.value?.id" class="text-muted"
                        >Tu propio usuario</span
                      >
                      <UButton
                        v-else
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        label="Desactivar"
                        :disabled="savingAction || resetting"
                        @click="startDeactivate(row)"
                      />
                    </template>
                    <UButton
                      v-else
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      label="Reactivar"
                      :disabled="savingAction || resetting"
                      @click="setActive(row.id, true)"
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </div>
  </AppPage>
</template>
