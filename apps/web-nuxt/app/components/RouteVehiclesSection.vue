<script setup lang="ts">
import { formatInstantInLima } from "@yacco/shared";
import type { Route, RouteVehicleAssignment, Vehicle } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";

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

/** Marca y modelo, y la capacidad si se conoce. */
const vehicleDetail = computed(() => {
  const vehicle = props.route.vehicle;
  if (!vehicle) return undefined;
  const capacity = vehicle.capacityUnits ? ` · Capacidad: ${vehicle.capacityUnits} bidones` : "";
  return `${vehicle.brand} ${vehicle.model}${capacity}`;
});

const assignmentColumns: TableColumn<RouteVehicleAssignment>[] = [
  { accessorKey: "createdAt", header: "Fecha y hora" },
  { accessorKey: "vehicle", header: "Vehículo" },
  { accessorKey: "assignedBy", header: "Asignado por" },
  { id: "origin", header: "Origen / Pit" },
  { accessorKey: "reason", header: "Motivo" },
  { id: "status", header: "Estado" },
];

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

    <UPageBody>
      <UPageCard v-if="route.vehicle" variant="soft" :description="vehicleDetail">
        <template #title>
          <span>{{ route.vehicle.plate }}</span> <span>— {{ route.vehicle.name }}</span>
        </template>
        <UFieldGroup>
          <UBadge color="primary" variant="subtle" label="Vehículo actual" />
        </UFieldGroup>
      </UPageCard>
      <UPageCard
        v-else
        variant="soft"
        description="Esta ruta no tiene un vehículo asignado (ruta anterior a la incorporación de vehículos)."
      />

      <UPageCard
        v-if="route.vehicleAssignments && route.vehicleAssignments.length > 0"
        title="Historial de asignaciones"
        variant="outline"
      >
        <UTable
          :data="route.vehicleAssignments"
          :columns="assignmentColumns"
          caption="Historial de asignaciones de vehículo de la ruta"
        >
          <template #createdAt-cell="{ row }">
            {{ formatInstantInLima(row.original.createdAt) }}
          </template>
          <template #vehicle-cell="{ row }">
            {{ row.original.vehicle.plate }} ({{ row.original.vehicle.name }})
          </template>
          <template #assignedBy-cell="{ row }">
            {{ row.original.assignedBy.name }}
          </template>
          <template #origin-cell="{ row }">
            {{ row.original.pitStopId ? "En parada en planta (pit)" : "Planificación / Oficina" }}
          </template>
          <template #reason-cell="{ row }">
            {{ row.original.reason || "—" }}
          </template>
          <template #status-cell="{ row }">
            <UBadge
              v-if="row.original.isVoided"
              color="error"
              variant="subtle"
              size="sm"
              label="Anulada (pit revertido)"
            />
            <UBadge v-else color="success" variant="subtle" size="sm" label="Vigente" />
          </template>
        </UTable>
      </UPageCard>
    </UPageBody>

    <!-- Modal cambiar vehículo -->
    <UModal
      v-model:open="modalOpen"
      title="Cambiar vehículo de la ruta"
      description="Elige el nuevo vehículo asignado. La ruta sigue planificada y el cambio quedará auditado."
    >
      <template #body>
        <UForm :state="{}" :validate-on="[]" :loading-auto="false" @submit="submitChangeVehicle">
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

          <div class="flex justify-end gap-2">
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
        </UForm>
      </template>
    </UModal>
  </SectionCard>
</template>
