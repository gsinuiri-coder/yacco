<script setup lang="ts">
import { limaToday } from "@yacco/shared";
import type { Route, User, Zone } from "@yacco/shared";

/**
 * Planificar es decidir el día y el chofer: POST /routes crea la ruta VACÍA.
 * Las paradas y la carga se agregan desde el detalle, y la zona es sólo una
 * etiqueta para agrupar: no arma la ruta con los clientes de esa zona. La
 * pantalla lo dice para que nadie espere lo contrario.
 */
useHead({ title: "Planificar ruta · Yacco" });

const api = useApi();
const NO_ZONE = "none";

// Choferes activos: la API ya excluye a los desactivados y rechaza a uno
// inactivo con 400; ofrecerlo sería construir un error.
const drivers = useCatalog<User>("/users", { role: "DRIVER" });
const zones = useCatalog<Zone>("/zones", { active: true });

const date = ref(limaToday());
const driverId = ref<string | undefined>(undefined);
const zoneId = ref(NO_ZONE);
const driverError = ref<string | undefined>(undefined);
const submitting = ref(false);
const submitError = ref<string | null>(null);
const slow = useSlowRequest(submitting);

const driverItems = computed(() =>
  drivers.items.value.map((driver) => ({ label: driver.name, value: driver.id })),
);
const zoneItems = computed(() => [
  { label: "Sin zona", value: NO_ZONE },
  ...zones.items.value.map((zone) => ({ label: zone.name, value: zone.id })),
]);

const noDrivers = computed(
  () => !drivers.loading.value && !drivers.failed.value && drivers.items.value.length === 0,
);

watch(driverId, () => {
  driverError.value = undefined;
});

async function submit(): Promise<void> {
  if (submitting.value) return;
  if (driverId.value === undefined) {
    driverError.value = "Elige el chofer que va a hacer la ruta";
    return;
  }
  submitting.value = true;
  submitError.value = null;
  try {
    const route = await api.request<Route>("/routes", {
      method: "POST",
      body: {
        driverId: driverId.value,
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

    <UCard class="max-w-3xl">
      <form class="space-y-6" novalidate @submit.prevent="submit">
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

        <div class="grid gap-5 sm:grid-cols-2">
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
            label="Zona (opcional)"
            name="routeZone"
            help="Sólo sirve para agrupar y filtrar rutas; no agrega los clientes de la zona."
            class="sm:col-span-2"
          >
            <USelect
              v-model="zoneId"
              :items="zoneItems"
              :disabled="submitting"
              class="w-full sm:w-1/2"
            />
          </UFormField>
        </div>

        <UAlert
          v-if="slow && submitting"
          role="status"
          color="neutral"
          variant="subtle"
          :title="SLOW_REQUEST_MESSAGE"
        />

        <div class="flex justify-end gap-3 border-t border-default pt-5">
          <UButton
            color="neutral"
            variant="outline"
            label="Cancelar"
            :disabled="submitting"
            @click="navigateTo('/routes')"
          />
          <UButton
            type="submit"
            :disabled="submitting || noDrivers || drivers.failed.value"
            :label="submitting ? 'Planificando…' : 'Planificar ruta'"
          />
        </div>
      </form>
    </UCard>
  </AppPage>
</template>
