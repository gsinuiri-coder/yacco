<script setup lang="ts">
import { formatCalendarDay, formatInstantInLima } from "@yacco/shared";
import type {
  ContainerType,
  PaymentMethod,
  Product,
  StopStatus,
  SyncOperationInReview,
} from "@yacco/shared";

useHead({ title: "Operaciones en revisión · Yacco" });

const api = useApi();
const session = useSession();
const isAdmin = computed(() => session.hasRole("ADMIN"));

const operations = ref<SyncOperationInReview[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

// Los nombres salen de cada catálogo, de su propio endpoint: el payload del
// celular solo trae ids.
const products = useCatalog<Product>("/products");
const paymentMethods = useCatalog<PaymentMethod>("/payment-methods");
const containerTypes = useCatalog<ContainerType>("/container-types");
const catalogs = computed(() => ({
  products: new Map(products.items.value.map((item) => [item.id, item.name])),
  paymentMethods: new Map(paymentMethods.items.value.map((item) => [item.id, item.name])),
  containerTypes: new Map(containerTypes.items.value.map((item) => [item.id, item.name])),
}));

const resolveTarget = ref<SyncOperationInReview | null>(null);
const resolveOpen = ref(false);
const note = ref("");
const resolving = ref(false);
const resolveError = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    operations.value = await api.request<SyncOperationInReview[]>("/sync/operations/in-review");
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (isAdmin.value) {
    load();
  } else {
    loading.value = false;
  }
});

function openResolve(operation: SyncOperationInReview): void {
  resolveTarget.value = operation;
  note.value = "";
  resolveError.value = null;
  resolveOpen.value = true;
}

async function confirmResolve(): Promise<void> {
  if (resolveTarget.value === null) return;
  const text = note.value.trim();
  if (text === "") {
    resolveError.value = "Anota qué se hizo con esta operación";
    return;
  }
  resolving.value = true;
  resolveError.value = null;
  try {
    await api.request(`/sync/operations/${resolveTarget.value.id}/resolution`, {
      method: "PATCH",
      body: { note: text },
    });
    resolveOpen.value = false;
    resolveTarget.value = null;
    await load();
  } catch (error) {
    resolveError.value = describeApiFailure(error);
  } finally {
    resolving.value = false;
  }
}

function stopStatusLabel(status: string): string {
  return STOP_STATUS[status as StopStatus]?.label ?? status;
}
</script>

<template>
  <AppPage
    title="Operaciones en revisión"
    description="Lo que un chofer anotó sin señal y no se pudo aplicar porque el sistema ya decía otra cosa. No se perdió: revísalo, corrige la parada si hace falta y dala por revisada."
  >
    <UAlert
      v-if="!isAdmin"
      color="warning"
      variant="subtle"
      icon="i-lucide-shield-alert"
      title="Acceso restringido"
      description="Esta bandeja solo está disponible para administradores."
    />

    <UPageBody v-else>
      <p v-if="loading">Cargando operaciones en revisión…</p>

      <UAlert
        v-else-if="loadError"
        role="alert"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="loadError"
      />

      <UEmpty
        v-else-if="operations.length === 0"
        icon="i-lucide-check-check"
        title="Bandeja al día"
        description="No hay operaciones de los choferes esperando revisión."
      />

      <UPageList v-else as="ul" divide>
        <UPageCard
          v-for="operation in operations"
          :key="operation.id"
          as="li"
          variant="naked"
          orientation="horizontal"
        >
          <template #title>
            <h3 v-if="operation.stop">
              {{ operation.stop.customerName }} · {{ operation.stop.locationName }}
            </h3>
            <h3 v-else>Operación de {{ operation.driverName }}</h3>
          </template>
          <template #description>
            <p>
              {{ operation.driverName }} lo anotó el
              {{ formatInstantInLima(operation.clientTimestamp) }}; llegó el
              {{ formatInstantInLima(operation.receivedAt) }}.
            </p>
            <p v-if="operation.stop">
              Ruta del {{ formatCalendarDay(operation.stop.routeDate) }}. Hoy la parada está
              <strong>{{ stopStatusLabel(operation.stop.stopStatus) }}</strong
              >.
            </p>
            <p>Lo que quiso hacer:</p>
            <ul class="list-disc ps-5">
              <li
                v-for="(line, index) in describeSyncOperation(
                  operation.type,
                  operation.version,
                  operation.payload,
                  catalogs,
                )"
                :key="index"
              >
                {{ line }}
              </li>
            </ul>
            <p>Por qué no se aplicó: {{ operation.rejectionReason }}</p>
          </template>

          <div class="flex flex-wrap justify-end gap-2">
            <UButton
              v-if="operation.stop"
              :to="`/routes/${operation.stop.routeId}`"
              color="neutral"
              variant="outline"
              size="sm"
              icon="i-lucide-route"
              label="Ver la ruta"
            />
            <UButton
              color="primary"
              size="sm"
              icon="i-lucide-check"
              label="Dar por revisada"
              @click="openResolve(operation)"
            />
          </div>
        </UPageCard>
      </UPageList>
    </UPageBody>

    <UModal v-model:open="resolveOpen" title="Dar por revisada">
      <template #body>
        <UForm
          :state="{}"
          :validate-on="[]"
          :loading-auto="false"
          novalidate
          @submit="confirmResolve"
        >
          <p>
            La operación sale de la bandeja y queda guardada tal como llegó, con tu nota. Si la
            parada estaba mal, corrígela antes desde la ruta.
          </p>

          <UAlert
            v-if="resolveError"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="resolveError"
          />

          <UFormField label="Qué se hizo" required>
            <UInput
              v-model="note"
              placeholder="Ej. Se corrigió la parada como entregada"
              class="w-full"
              autocomplete="off"
            />
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="resolving"
              @click="resolveOpen = false"
            />
            <UButton type="submit" color="primary" label="Guardar revisión" :loading="resolving" />
          </div>
        </UForm>
      </template>
    </UModal>
  </AppPage>
</template>
