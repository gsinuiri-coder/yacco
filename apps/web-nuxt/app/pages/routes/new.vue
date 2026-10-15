<script setup lang="ts">
import { limaToday } from "@yacco/shared";
import type { Route, User, Vehicle, Zone } from "@yacco/shared";

/**
 * Planificar es decidir el día, el chofer y el vehículo: POST /routes crea la ruta VACÍA.
 * Las paradas y la carga se agregan desde el detalle, y la zona es sólo una
 * etiqueta para agrupar: no arma la ruta con los clientes de esa zona. La
 * pantalla lo dice para que nadie espere lo contrario.
 */
useHead({ title: "Planificar ruta · Yacco" });

const api = useApi();
const NO_ZONE = "none";

// Choferes y vehículos activos: la API ya excluye a los desactivados y rechaza a uno
// inactivo con 400; ofrecerlo sería construir un error.
const drivers = useCatalog<User>("/users", { role: "DRIVER" });
const vehicles = useCatalog<Vehicle>("/vehicles", { active: true });
const zones = useCatalog<Zone>("/zones", { active: true });

const date = ref(limaToday());
const driverId = ref<string | undefined>(undefined);
const vehicleId = ref<string | undefined>(undefined);
const zoneId = ref(NO_ZONE);
const driverError = ref<string | undefined>(undefined);
const vehicleError = ref<string | undefined>(undefined);
const submitting = ref(false);
const submitError = ref<string | null>(null);
const slow = useSlowRequest(submitting);

const driverItems = computed(() =>
  drivers.items.value.map((driver) => ({ label: driver.name, value: driver.id })),
);
const vehicleItems = computed(() =>
  vehicles.items.value.map((vehicle) => ({
    label: `${vehicle.plate} (${vehicle.name})`,
    value: vehicle.id,
  })),
);
const zoneItems = computed(() => [
  { label: "Sin zona", value: NO_ZONE },
  ...zones.items.value.map((zone) => ({ label: zone.name, value: zone.id })),
]);

const noDrivers = computed(
  () => !drivers.loading.value && !drivers.failed.value && drivers.items.value.length === 0,
);
const noVehicles = computed(
  () => !vehicles.loading.value && !vehicles.failed.value && vehicles.items.value.length === 0,
);

watch(driverId, () => {
  driverError.value = undefined;
});
watch(vehicleId, () => {
  vehicleError.value = undefined;
});

async function submit(): Promise<void> {
  if (submitting.value) return;
  if (driverId.value === undefined) {
    driverError.value = "Elige el chofer que va a hacer la ruta";
    return;
  }
  if (vehicleId.value === undefined) {
    vehicleError.value = "Elige el vehículo asignado a la ruta";
    return;
  }
  submitting.value = true;
  submitError.value = null;
  try {
    const route = await api.request<Route>("/routes", {
      method: "POST",
      body: {
        driverId: driverId.value,
        vehicleId: vehicleId.value,
        date: date.value,
        ...(zoneId.value === NO_ZONE ? {} : { zoneId: zoneId.value }),
      },
    });
    await navigateTo(`/routes/${route.id}`);
  } catch (error) {
    // El 400 nombra el problema (chofer ya con ruta ese día, chofer
    // desactivado): tal cual, para que no se despegue del de la API.
    submitError.value = describeApiFailure(error);
    submitting.value = false;
  }
}
</script>

<template>
  <AppPage
    title="Planificar ruta"
    description="La ruta nace planificada y vacía: las paradas y la carga se agregan después."
  >
    <template #actions>
      <UButton
        to="/routes"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        label="Rutas"
      />
    </template>

    <UForm :state="{}" :validate-on="[]" :loading-auto="false" novalidate @submit="submit">
      <UCard>
        <UAlert
          v-if="submitError"
          role="alert"
          color="error"
          variant="subtle"
          :title="submitError"
        />
        <UAlert
          v-if="drivers.failed.value"
          role="alert"
          color="error"
          variant="subtle"
          title="No se pudo cargar la lista de choferes."
        >
          <template #actions>
            <UButton
              color="neutral"
              variant="outline"
              size="sm"
              label="Reintentar"
              @click="drivers.reload"
            />
          </template>
        </UAlert>
        <UAlert
          v-if="noDrivers"
          role="status"
          color="warning"
          variant="subtle"
          title="No hay choferes activos para asignar. Da de alta un usuario con rol de chofer antes de planificar la ruta."
        />
        <UAlert
          v-if="noVehicles"
          role="status"
          color="warning"
          variant="subtle"
          title="No hay vehículos activos para asignar. Da de alta un vehículo antes de planificar la ruta."
        />

        <UPageGrid>
          <UFormField label="Día de la ruta" name="routeDate">
            <UInput v-model="date" type="date" :disabled="submitting" class="w-full" />
          </UFormField>
          <UFormField
            label="Chofer"
            name="routeDriver"
            :error="driverError"
            help="Un chofer sólo puede tener una ruta por día."
          >
            <USelect
              v-model="driverId"
              :items="driverItems"
              placeholder="Elige un chofer"
              :disabled="submitting || noDrivers || drivers.failed.value"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Vehículo"
            name="routeVehicle"
            :error="vehicleError"
            help="Vehículo asignado para el recorrido del día."
          >
            <USelect
              v-model="vehicleId"
              :items="vehicleItems"
              placeholder="Elige un vehículo"
              :disabled="submitting || noVehicles || vehicles.failed.value"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Zona (opcional)"
            name="routeZone"
            help="Sólo sirve para agrupar y filtrar rutas; no agrega los clientes de la zona."
          >
            <USelect v-model="zoneId" :items="zoneItems" :disabled="submitting" class="w-full" />
          </UFormField>
        </UPageGrid>
      </UCard>

      <UAlert
        v-if="slow && submitting"
        role="status"
        color="neutral"
        variant="subtle"
        :title="SLOW_REQUEST_MESSAGE"
      />

      <UFieldGroup>
        <UButton
          color="neutral"
          variant="outline"
          label="Cancelar"
          :disabled="submitting"
          @click="navigateTo('/routes')"
        />
        <UButton
          type="submit"
          :disabled="
            submitting || noDrivers || noVehicles || drivers.failed.value || vehicles.failed.value
          "
          :label="submitting ? 'Planificando…' : 'Planificar ruta'"
        />
      </UFieldGroup>
    </UForm>
  </AppPage>
</template>
