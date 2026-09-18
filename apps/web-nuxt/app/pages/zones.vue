<script setup lang="ts">
import type { Weekday, Zone } from "@yacco/shared";

/**
 * El catálogo por el que el padrón y los reportes agrupan clientes. Mismos
 * roles asimétricos que Tipos de envase (lectura ADMIN+SELLER, escritura
 * sólo ADMIN) y la misma forma: alta, edición en fila, retiro con
 * confirmación, reactivación sin ella. Los días de reparto nunca son
 * obligatorios — una lista vacía se muestra como "Sin días definidos", no
 * como un error; ver CreateZoneDto.
 */
const NAME_REQUIRED_MESSAGE = "Escribe el nombre de la zona";
const WITHDRAW_EXPLANATION =
  "Los clientes de esta zona no se reasignan: siguen existiendo tal cual. Solo deja de " +
  "ofrecerse para clientes nuevos y de agrupar reportes. Se puede reactivar después.";

useHead({ title: "Zonas · Yacco" });

function sortByName(items: readonly Zone[]): Zone[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

const session = useSession();
const api = useApi();
const isAdmin = computed(() => session.hasRole("ADMIN"));

const zones = ref<Zone[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const slow = useSlowRequest(loading);

async function loadZones(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const [active, withdrawn] = await Promise.all([
      api.request<Zone[]>("/zones", { query: { active: true } }),
      api.request<Zone[]>("/zones", { query: { active: false } }),
    ]);
    zones.value = sortByName([...active, ...withdrawn]);
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}
onMounted(loadZones);

const activeCount = computed(() => zones.value.filter((zone) => zone.active).length);
const summary = computed(() => {
  if (loading.value) return "Cargando…";
  const withdrawnCount = zones.value.length - activeCount.value;
  return `${activeCount.value} en uso${withdrawnCount > 0 ? `, ${withdrawnCount} ${withdrawnCount === 1 ? "retirada" : "retiradas"}` : ""}`;
});

function replaceZone(updated: Zone): void {
  zones.value = sortByName(zones.value.map((zone) => (zone.id === updated.id ? updated : zone)));
}

// --- Alta ---
const adding = ref(false);
const newName = ref("");
const newDeliveryDays = ref<Weekday[]>([]);
const createError = ref<string | null>(null);
const creating = ref(false);

function startAdd(): void {
  adding.value = true;
  newName.value = "";
  newDeliveryDays.value = [];
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
    const created = await api.request<Zone>("/zones", {
      method: "POST",
      body: {
        name,
        ...(newDeliveryDays.value.length > 0 ? { deliveryDays: newDeliveryDays.value } : {}),
      },
    });
    zones.value = sortByName([...zones.value, created]);
    adding.value = false;
  } catch (error) {
    // El mensaje de la API nombra el duplicado ("Ya existe una zona con el
    // nombre ..."): tal cual, es el error más frecuente.
    createError.value = describeApiFailure(error);
  } finally {
    creating.value = false;
  }
}

// --- Editar y retirar/reactivar, por fila ---
const editingId = ref<string | null>(null);
const editName = ref("");
const editDeliveryDays = ref<Weekday[]>([]);
const withdrawingId = ref<string | null>(null);
const actionError = ref<string | null>(null);
const savingAction = ref(false);

function startEdit(zone: Zone): void {
  editingId.value = zone.id;
  editName.value = zone.name;
  editDeliveryDays.value = zone.deliveryDays;
  withdrawingId.value = null;
  actionError.value = null;
}

async function saveEdit(id: string): Promise<void> {
  if (savingAction.value) return;
  const name = editName.value.trim();
  if (name === "") {
    actionError.value = NAME_REQUIRED_MESSAGE;
    return;
  }
  savingAction.value = true;
  actionError.value = null;
  try {
    const updated = await api.request<Zone>(`/zones/${id}`, {
      method: "PATCH",
      body: { name, deliveryDays: editDeliveryDays.value },
    });
    replaceZone(updated);
    editingId.value = null;
  } catch (error) {
    actionError.value = describeApiFailure(error);
  } finally {
    savingAction.value = false;
  }
}

function startWithdraw(id: string): void {
  withdrawingId.value = id;
  editingId.value = null;
  actionError.value = null;
}

async function setActive(id: string, active: boolean): Promise<void> {
  if (savingAction.value) return;
  savingAction.value = true;
  actionError.value = null;
  try {
    const updated = await api.request<Zone>(`/zones/${id}`, { method: "PATCH", body: { active } });
    replaceZone(updated);
    withdrawingId.value = null;
  } catch (error) {
    actionError.value = describeApiFailure(error);
  } finally {
    savingAction.value = false;
  }
}
</script>

<template>
  <AppPage title="Zonas" :description="summary">
    <template #actions>
      <UButton
        v-if="isAdmin && !adding"
        icon="i-lucide-plus"
        label="Nueva zona"
        :disabled="loading"
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
          <form class="space-y-4" novalidate aria-label="Nueva zona" @submit.prevent="create">
            <UFormField label="Nombre">
              <UInput
                v-model="newName"
                placeholder="Norte"
                :maxlength="80"
                :disabled="creating"
                class="w-full"
              />
            </UFormField>
            <DeliveryDaysField
              id-prefix="newZone"
              label="Días de reparto (opcional)"
              :model-value="newDeliveryDays"
              :disabled="creating"
              @update:model-value="(days: Weekday[]) => (newDeliveryDays = days)"
            />
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
                :label="creating ? 'Guardando…' : 'Guardar'"
                :disabled="creating"
              />
            </div>
          </form>
        </div>
      </UCard>

      <UAlert v-if="actionError" role="alert" color="error" variant="subtle" :title="actionError" />

      <UAlert
        v-if="slow && loading"
        role="status"
        color="neutral"
        variant="subtle"
        :title="SLOW_REQUEST_MESSAGE"
      />

      <ListStatus
        v-if="loadError || loading || zones.length === 0"
        :error-message="loadError"
        :loading="loading"
        :empty="zones.length === 0"
        loading-label="Cargando zonas…"
        empty-icon="i-lucide-map-pin"
        empty-title="Todavía no hay zonas"
        empty-description="Registra la primera para empezar a agrupar clientes y reportes por zona."
        @retry="loadZones"
      />

      <UCard v-else :ui="{ body: 'p-0 sm:p-0' }">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <caption class="sr-only">
              Zonas con sus días de reparto y estado
            </caption>
            <thead class="bg-elevated text-left text-xs tracking-wide text-muted uppercase">
              <tr>
                <th scope="col" class="px-4 py-2 font-medium">Zona</th>
                <th scope="col" class="px-4 py-2 font-medium">Días de reparto</th>
                <th scope="col" class="px-4 py-2 font-medium">Estado</th>
                <th v-if="isAdmin" scope="col" class="px-4 py-2">
                  <span class="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr v-for="zone in zones" :key="zone.id">
                <td class="px-4 py-3">
                  <UInput
                    v-if="editingId === zone.id"
                    :model-value="editName"
                    :aria-label="`Nuevo nombre de ${zone.name}`"
                    :maxlength="80"
                    :disabled="savingAction"
                    class="w-full"
                    @update:model-value="(value: string | number) => (editName = String(value))"
                  />
                  <span v-else class="font-medium text-highlighted">{{ zone.name }}</span>
                </td>
                <td class="px-4 py-3">
                  <DeliveryDaysField
                    v-if="editingId === zone.id"
                    :id-prefix="`editZone-${zone.id}`"
                    :label="`Días de reparto de ${zone.name}`"
                    hide-label
                    :model-value="editDeliveryDays"
                    :disabled="savingAction"
                    @update:model-value="(days: Weekday[]) => (editDeliveryDays = days)"
                  />
                  <span v-else class="text-muted">{{ formatDeliveryDays(zone.deliveryDays) }}</span>
                </td>
                <td class="px-4 py-3">
                  <UBadge
                    :color="zone.active ? 'success' : 'neutral'"
                    variant="subtle"
                    :label="zone.active ? 'En uso' : 'Retirada'"
                  />
                </td>
                <td v-if="isAdmin" class="px-4 py-3">
                  <WithdrawConfirm
                    v-if="withdrawingId === zone.id"
                    :item-label="zone.name"
                    :explanation="WITHDRAW_EXPLANATION"
                    :saving="savingAction"
                    @cancel="withdrawingId = null"
                    @confirm="setActive(zone.id, false)"
                  />
                  <div v-else-if="editingId === zone.id" class="flex justify-end gap-2">
                    <UButton
                      color="neutral"
                      variant="outline"
                      size="sm"
                      label="Cancelar"
                      :disabled="savingAction"
                      @click="editingId = null"
                    />
                    <UButton
                      size="sm"
                      :label="savingAction ? 'Guardando…' : 'Guardar'"
                      :disabled="savingAction"
                      @click="saveEdit(zone.id)"
                    />
                  </div>
                  <div v-else class="flex justify-end gap-2">
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      label="Editar"
                      :disabled="savingAction"
                      @click="startEdit(zone)"
                    />
                    <UButton
                      v-if="zone.active"
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      label="Retirar"
                      :disabled="savingAction"
                      @click="startWithdraw(zone.id)"
                    />
                    <UButton
                      v-else
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      :label="savingAction ? 'Reactivando…' : 'Reactivar'"
                      :disabled="savingAction"
                      @click="setActive(zone.id, true)"
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
