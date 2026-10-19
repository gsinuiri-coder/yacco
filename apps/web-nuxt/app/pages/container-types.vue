<script setup lang="ts">
import type { ContainerType } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";

/**
 * El catálogo del que depende todo el cuadre de envases: un tipo que aparece
 * a mitad de contar 500 clientes obliga a recontar, así que acá se asienta
 * primero. La API lista sólo activos por defecto y retirados aparte; esta
 * pantalla pide los dos, porque un tipo retirado sigue siendo stock real en
 * la calle y tiene que quedar visible, marcado, nunca escondido.
 */
const NAME_REQUIRED_MESSAGE = "Escribe el nombre del tipo de envase";
const WITHDRAW_EXPLANATION =
  "Ya no se podrán entregar envases nuevos de este tipo. Los que ya están en poder de los " +
  "clientes siguen contando y pueden devolverse. Se puede reactivar después.";

useHead({ title: "Tipos de envase · Yacco" });

function sortByName(items: readonly ContainerType[]): ContainerType[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

const session = useSession();
const api = useApi();
const isAdmin = computed(() => session.hasRole("ADMIN"));

const types = ref<ContainerType[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const slow = useSlowRequest(loading);

async function loadTypes(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const [active, withdrawn] = await Promise.all([
      api.request<ContainerType[]>("/container-types", { query: { active: true } }),
      api.request<ContainerType[]>("/container-types", { query: { active: false } }),
    ]);
    types.value = sortByName([...active, ...withdrawn]);
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}
onMounted(loadTypes);

const activeCount = computed(() => types.value.filter((type) => type.active).length);
const summary = computed(() => {
  if (loading.value) return "Cargando…";
  const withdrawnCount = types.value.length - activeCount.value;
  return `${activeCount.value} en uso${withdrawnCount > 0 ? `, ${withdrawnCount} ${withdrawnCount === 1 ? "retirado" : "retirados"}` : ""}`;
});

function replaceType(updated: ContainerType): void {
  types.value = sortByName(types.value.map((type) => (type.id === updated.id ? updated : type)));
}

// --- Alta ---
const adding = ref(false);
const newName = ref("");
const createError = ref<string | null>(null);
const creating = ref(false);

function startAdd(): void {
  adding.value = true;
  newName.value = "";
  createError.value = null;
}

async function create(): Promise<void> {
  if (creating.value) return;
  const name = newName.value.trim();
  if (name === "") {
    createError.value = NAME_REQUIRED_MESSAGE;
    return;
  }
  creating.value = true;
  createError.value = null;
  try {
    const created = await api.request<ContainerType>("/container-types", {
      method: "POST",
      body: { name },
    });
    types.value = sortByName([...types.value, created]);
    adding.value = false;
  } catch (error) {
    // El mensaje de la API nombra el duplicado ("Ya existe un tipo de envase
    // con el nombre ..."): tal cual, es el error más frecuente.
    createError.value = describeApiFailure(error);
  } finally {
    creating.value = false;
  }
}

// --- Renombrar y retirar/reactivar, por fila ---
const renamingId = ref<string | null>(null);
const renameValue = ref("");
const withdrawingId = ref<string | null>(null);
/** El id de la fila viaja con el mensaje: con veinte tipos, un error arriba no dice cuál falló. */
const actionError = ref<{ typeId: string; message: string } | null>(null);
const savingAction = ref(false);

function startRename(type: ContainerType): void {
  renamingId.value = type.id;
  renameValue.value = type.name;
  withdrawingId.value = null;
  actionError.value = null;
}

async function saveRename(id: string): Promise<void> {
  if (savingAction.value) return;
  const name = renameValue.value.trim();
  if (name === "") {
    actionError.value = { typeId: id, message: NAME_REQUIRED_MESSAGE };
    return;
  }
  savingAction.value = true;
  actionError.value = null;
  try {
    const updated = await api.request<ContainerType>(`/container-types/${id}`, {
      method: "PATCH",
      body: { name },
    });
    replaceType(updated);
    renamingId.value = null;
  } catch (error) {
    actionError.value = { typeId: id, message: describeApiFailure(error) };
  } finally {
    savingAction.value = false;
  }
}

function startWithdraw(id: string): void {
  withdrawingId.value = id;
  renamingId.value = null;
  actionError.value = null;
}

async function setActive(id: string, active: boolean): Promise<void> {
  if (savingAction.value) return;
  savingAction.value = true;
  actionError.value = null;
  try {
    const updated = await api.request<ContainerType>(`/container-types/${id}`, {
      method: "PATCH",
      body: { active },
    });
    replaceType(updated);
    withdrawingId.value = null;
  } catch (error) {
    actionError.value = {
      typeId: id,
      message: describeApiFailure(error),
    };
  } finally {
    savingAction.value = false;
  }
}

const columns = computed<TableColumn<ContainerType>[]>(() => [
  { accessorKey: "name", header: "Tipo de envase" },
  { id: "status", header: "Estado" },
  ...(isAdmin.value
    ? [{ id: "actions", header: hiddenHeader("Acciones"), meta: RIGHT_ALIGNED }]
    : []),
]);
// El error de una acción se abre debajo de su fila.
const expandedTypeIds = computed<Record<string, boolean>>(() =>
  actionError.value === null ? {} : { [actionError.value.typeId]: true },
);
</script>

<template>
  <AppPage title="Tipos de envase" :description="summary">
    <template #actions>
      <UButton
        v-if="isAdmin && !adding"
        icon="i-lucide-plus"
        label="Nuevo tipo de envase"
        :disabled="loading"
        @click="startAdd"
      />
    </template>

    <UPageBody>
      <UCard v-if="adding">
        <UForm
          :state="{}"
          :validate-on="[]"
          :loading-auto="false"
          novalidate
          aria-label="Nuevo tipo de envase"
          @submit="create"
        >
          <UAlert
            v-if="createError"
            role="alert"
            color="error"
            variant="subtle"
            :title="createError"
          />
          <UFormField
            label="Nombre"
            help="Si la planta distingue el mismo bidón por etiqueta, cada etiqueta es un tipo aparte."
          >
            <UInput
              v-model="newName"
              placeholder="Bidón 20L (V)"
              :maxlength="80"
              :disabled="creating"
              class="w-full"
            />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="creating"
              @click="adding = false"
            />
            <UButton
              type="submit"
              :label="creating ? 'Guardando…' : 'Guardar'"
              :disabled="creating"
            />
          </div>
        </UForm>
      </UCard>

      <UAlert
        v-if="slow && loading"
        role="status"
        color="neutral"
        variant="subtle"
        :title="SLOW_REQUEST_MESSAGE"
      />

      <ListStatus
        v-if="loadError || loading || types.length === 0"
        :error-message="loadError"
        :loading="loading"
        :empty="types.length === 0"
        loading-label="Cargando tipos de envase…"
        empty-icon="i-lucide-package"
        empty-title="Todavía no hay tipos de envase"
        empty-description="Registra los bidones con los que trabaja la planta antes de empezar a contar."
        @retry="loadTypes"
      />

      <UCard v-else>
        <UTable
          :data="types"
          :columns="columns"
          :get-row-id="(type: ContainerType) => type.id"
          :expanded="expandedTypeIds"
          caption="Tipos de envase de la planta"
        >
          <template #name-cell="{ row }">
            <UInput
              v-if="renamingId === row.original.id"
              :model-value="renameValue"
              :aria-label="`Nuevo nombre de ${row.original.name}`"
              :maxlength="80"
              :disabled="savingAction"
              class="w-full"
              @update:model-value="(value: string | number) => (renameValue = String(value))"
            />
            <template v-else>{{ row.original.name }}</template>
          </template>
          <template #status-cell="{ row }">
            <UBadge
              :color="row.original.active ? 'success' : 'neutral'"
              variant="subtle"
              :label="row.original.active ? 'En uso' : 'Retirado'"
            />
          </template>
          <template #actions-cell="{ row }">
            <WithdrawConfirm
              v-if="withdrawingId === row.original.id"
              :item-label="row.original.name"
              :explanation="WITHDRAW_EXPLANATION"
              :saving="savingAction"
              @cancel="withdrawingId = null"
              @confirm="setActive(row.original.id, false)"
            />
            <div v-else-if="renamingId === row.original.id" class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="outline"
                size="sm"
                label="Cancelar"
                :disabled="savingAction"
                @click="renamingId = null"
              />
              <UButton
                size="sm"
                :label="savingAction ? 'Guardando…' : 'Guardar'"
                :disabled="savingAction"
                @click="saveRename(row.original.id)"
              />
            </div>
            <div v-else class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                label="Renombrar"
                :disabled="savingAction"
                @click="startRename(row.original)"
              />
              <UButton
                v-if="row.original.active"
                color="neutral"
                variant="ghost"
                size="sm"
                label="Retirar"
                :disabled="savingAction"
                @click="startWithdraw(row.original.id)"
              />
              <UButton
                v-else
                color="neutral"
                variant="ghost"
                size="sm"
                :label="savingAction ? 'Reactivando…' : 'Reactivar'"
                :disabled="savingAction"
                @click="setActive(row.original.id, true)"
              />
            </div>
          </template>
          <!-- Fila aparte, no dentro de la celda de acciones: esa columna
            es angosta y el mensaje desbordaría la tabla. -->
          <template #expanded>
            <UAlert
              v-if="actionError"
              role="alert"
              color="error"
              variant="subtle"
              :title="actionError.message"
            />
          </template>
        </UTable>
      </UCard>
    </UPageBody>
  </AppPage>
</template>
