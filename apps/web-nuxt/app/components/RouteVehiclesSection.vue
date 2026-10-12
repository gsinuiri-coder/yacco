<script setup lang="ts">
import { formatInstantInLima } from "@yacco/shared";
import type { Route, Vehicle } from "@yacco/shared";

const props = defineProps<{ route: Route }>();
const emit = defineEmits<{ changed: [] }>();

const api = useApi();
const session = useSession();

const isPlanned = computed(() => props.route.status === "PLANNED");
const canChangeVehicle = computed(
  () => isPlanned.value && (session.hasRole("ADMIN") || session.hasRole("SELLER")),
);

// --- Modal cambiar vehículo ---
const modalOpen = ref(false);
const activeVehicles = ref<Vehicle[]>([]);
const loadingVehicles = ref(false);
const selectedVehicleId = ref<string | undefined>(undefined);
const reason = ref("");
const saving = ref(false);
const saveError = ref<string | null>(null);
const warnings = ref<string[]>([]);

const vehicleOptions = computed(() =>
  activeVehicles.value
    .filter((v) => v.id !== props.route.vehicleId)
    .map((v) => ({ label: `${v.plate} (${v.name})`, value: v.id })),
);

async function openChangeModal(): Promise<void> {
  modalOpen.value = true;
  selectedVehicleId.value = undefined;
  reason.value = "";
  saveError.value = null;
  warnings.value = [];
  loadingVehicles.value = true;
  try {
    activeVehicles.value = await api.request<Vehicle[]>("/vehicles", {
      query: { active: true },
    });
  } catch (error) {
    saveError.value = describeApiFailure(error);
  } finally {
    loadingVehicles.value = false;
  }
}

async function submitChangeVehicle(): Promise<void> {
  if (saving.value) return;
  if (!selectedVehicleId.value) {
    saveError.value = "Elige el nuevo vehículo para la ruta.";
    return;
  }

  saving.value = true;
  saveError.value = null;
  try {
    const updated = await api.request<Route>(`/routes/${props.route.id}/vehicle`, {
      method: "PATCH",
      body: {
        vehicleId: selectedVehicleId.value,
        ...(reason.value.trim() ? { reason: reason.value.trim() } : {}),
      },
    });
    if (updated.warnings && updated.warnings.length > 0) {
      warnings.value = updated.warnings;
    }
    emit("changed");
    modalOpen.value = false;
  } catch (error) {
    saveError.value = describeApiFailure(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <SectionCard
    title="Vehículo de la ruta"
    description="Vehículo asignado para el reparto y su historial de cambios auditados."
  >
    <template #actions>
      <UButton
        v-if="canChangeVehicle"
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-truck"
        label="Cambiar vehículo"
        @click="openChangeModal"
      />
    </template>

    <div class="space-y-4">
      <!-- Vehículo actual -->
      <div class="rounded-lg border border-default bg-elevated/40 p-4">
        <div v-if="route.vehicle" class="flex flex-wrap items-center justify-between gap-4">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="font-mono text-base font-bold text-highlighted">
                {{ route.vehicle.plate }}
              </span>
              <span class="font-medium text-highlighted">— {{ route.vehicle.name }}</span>
            </div>
            <p class="text-xs text-muted">
              {{ route.vehicle.brand }} {{ route.vehicle.model }}
              <span v-if="route.vehicle.capacityUnits">
                · Capacidad: {{ route.vehicle.capacityUnits }} bidones
              </span>
            </p>
          </div>
          <UBadge color="primary" variant="subtle" label="Vehículo actual" />
        </div>
        <div v-else class="text-sm text-dimmed">
          Esta ruta no tiene un vehículo asignado (ruta anterior a la incorporación de vehículos).
        </div>
      </div>

      <!-- Historial de asignaciones -->
      <div v-if="route.vehicleAssignments && route.vehicleAssignments.length > 0" class="space-y-2">
        <h4 class="text-xs font-semibold uppercase tracking-wider text-muted">
          Historial de asignaciones
        </h4>
        <div class="overflow-x-auto rounded-lg border border-default">
          <table class="w-full text-left text-xs">
            <thead class="bg-elevated text-muted uppercase">
              <tr>
                <th scope="col" class="px-3 py-2 font-medium">Fecha y hora</th>
                <th scope="col" class="px-3 py-2 font-medium">Vehículo</th>
                <th scope="col" class="px-3 py-2 font-medium">Asignado por</th>
                <th scope="col" class="px-3 py-2 font-medium">Origen / Pit</th>
                <th scope="col" class="px-3 py-2 font-medium">Motivo</th>
                <th scope="col" class="px-3 py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr
                v-for="a in route.vehicleAssignments"
                :key="a.id"
                :class="{ 'opacity-60 bg-error/5': a.isVoided }"
              >
                <td class="px-3 py-2 whitespace-nowrap tabular-nums text-muted">
                  {{ formatInstantInLima(a.createdAt) }}
                </td>
                <td class="px-3 py-2 font-medium text-highlighted">
                  <span class="font-mono font-bold">{{ a.vehicle.plate }}</span>
                  <span class="ml-1 text-muted">({{ a.vehicle.name }})</span>
                </td>
                <td class="px-3 py-2 text-muted">{{ a.assignedBy.name }}</td>
                <td class="px-3 py-2 text-muted">
                  {{ a.pitStopId ? "En parada en planta (pit)" : "Planificación / Oficina" }}
                </td>
                <td class="px-3 py-2 text-muted">{{ a.reason || "—" }}</td>
                <td class="px-3 py-2">
                  <UBadge
                    v-if="a.isVoided"
                    color="error"
                    variant="subtle"
                    size="sm"
                    label="Anulada (pit revertido)"
                  />
                  <span v-else class="text-success font-medium">Vigente</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Modal cambiar vehículo -->
    <UModal
      v-model:open="modalOpen"
      title="Cambiar vehículo de la ruta"
      description="Elige el nuevo vehículo asignado. La ruta sigue planificada y el cambio quedará auditado."
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="submitChangeVehicle">
          <UFormField label="Nuevo vehículo" required>
            <USelect
              v-model="selectedVehicleId"
              :items="vehicleOptions"
              placeholder="Elige un vehículo"
              :disabled="saving || loadingVehicles"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Motivo del cambio (opcional)">
            <UInput
              v-model="reason"
              placeholder="Ejemplo: Reasignación de flota antes de salir"
              :disabled="saving"
              class="w-full"
            />
          </UFormField>

          <UAlert v-if="saveError" role="alert" color="error" variant="subtle" :title="saveError" />

          <div class="flex justify-end gap-2 pt-3">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="saving"
              @click="modalOpen = false"
            />
            <UButton
              type="submit"
              :label="saving ? 'Guardando…' : 'Confirmar cambio'"
              :disabled="saving || !selectedVehicleId"
            />
          </div>
        </form>
      </template>
    </UModal>
  </SectionCard>
</template>
