<script setup lang="ts">
import {
  CONTAINER_MOVEMENT_TYPE_VALUES,
  CONTAINER_MOVEMENTS_PAGE_SIZE,
  formatInstantInLima,
} from "@yacco/shared";
import type {
  ContainerMovement,
  ContainerMovementType,
  ContainerState,
  ContainerType,
  Customer,
  CustomerLocation,
} from "@yacco/shared";
import type { ManualMovementType } from "../utils/container-movements";

useHead({ title: "Movimientos de envases · Yacco" });

const api = useApi();
const catalog = useCatalog<ContainerType>("/container-types");

// --- Registrar movimiento (las tres operaciones que la oficina anota a mano) ---
const type = ref<ManualMovementType | "">("");
const containerTypeId = ref("");
const quantity = ref("");
const originChoice = ref<ContainerState | "">("");
const customer = ref<Customer | null>(null);
const locationId = ref("");

const typeError = ref<string | undefined>(undefined);
const containerTypeError = ref<string | undefined>(undefined);
const quantityError = ref<string | undefined>(undefined);
const originError = ref<string | undefined>(undefined);
const customerError = ref<string | undefined>(undefined);
const locationError = ref<string | undefined>(undefined);

const submitting = ref(false);
const submitError = ref<string | null>(null);
const registered = ref(false);
const slowSubmit = useSlowRequest(submitting);

const origins = computed<ReadonlyArray<ContainerState | null>>(() =>
  type.value === "" ? [] : MANUAL_MOVEMENTS[type.value].origins,
);
const requiresOriginChoice = computed(() => origins.value.length > 1);
/** El origen fijo si la operación tiene uno solo; `undefined` mientras falta elegir. */
const effectiveOrigin = computed<ContainerState | null | undefined>(() => {
  if (!requiresOriginChoice.value) return origins.value[0] ?? null;
  return originChoice.value === "" ? undefined : originChoice.value;
});
const touchesCustomer = computed(() => effectiveOrigin.value === "WITH_CUSTOMER");

const locations = ref<CustomerLocation[]>([]);
const locationsLoading = ref(false);
const locationsError = ref<string | null>(null);
let locationsRequest = 0;

async function loadLocations(): Promise<void> {
  if (!touchesCustomer.value || customer.value === null) {
    locations.value = [];
    locationsLoading.value = false;
    locationsError.value = null;
    return;
  }
  const current = ++locationsRequest;
  locationsLoading.value = true;
  locationsError.value = null;
  try {
    const data = await api.request<CustomerLocation[]>(`/customers/${customer.value.id}/locations`);
    if (current === locationsRequest) locations.value = data;
  } catch (error) {
    if (current === locationsRequest) locationsError.value = describeApiFailure(error);
  } finally {
    if (current === locationsRequest) locationsLoading.value = false;
  }
}
watch([touchesCustomer, customer], loadLocations, { immediate: true });

function chooseType(value: ManualMovementType | ""): void {
  type.value = value;
  typeError.value = undefined;
  originChoice.value = "";
  originError.value = undefined;
  customer.value = null;
  customerError.value = undefined;
  locationId.value = "";
  locationError.value = undefined;
}

function chooseOrigin(value: ContainerState): void {
  originChoice.value = value;
  originError.value = undefined;
  customer.value = null;
  customerError.value = undefined;
  locationId.value = "";
  locationError.value = undefined;
}

function chooseCustomer(next: Customer | null): void {
  customer.value = next;
  customerError.value = undefined;
  locationId.value = "";
  locationError.value = undefined;
}

function validate(): boolean {
  typeError.value = type.value === "" ? "Elige una operación" : undefined;
  containerTypeError.value = containerTypeId.value === "" ? "Elige un tipo de envase" : undefined;
  quantityError.value =
    positiveWhole(quantity.value) === null
      ? "La cantidad debe ser un número entero mayor que 0"
      : undefined;
  originError.value =
    requiresOriginChoice.value && originChoice.value === ""
      ? "Elige el estado de origen"
      : undefined;
  customerError.value =
    touchesCustomer.value && customer.value === null ? "Elige un cliente" : undefined;
  locationError.value =
    touchesCustomer.value && customer.value !== null && locationId.value === ""
      ? "Elige una ubicación"
      : undefined;
  return [
    typeError.value,
    containerTypeError.value,
    quantityError.value,
    originError.value,
    customerError.value,
    locationError.value,
  ].every((error) => error === undefined);
}

async function register(): Promise<void> {
  // Con un arranque en frío, un botón vivo son varios movimientos duplicados.
  if (submitting.value) return;
  if (!validate() || type.value === "") return;

  const chosenType = type.value;
  const origin = requiresOriginChoice.value
    ? (originChoice.value as ContainerState)
    : (origins.value[0] ?? null);
  const destination = MANUAL_MOVEMENTS[chosenType].destination;

  submitting.value = true;
  submitError.value = null;
  registered.value = false;
  try {
    await api.request<ContainerMovement>("/container-movements", {
      method: "POST",
      body: {
        type: chosenType,
        containerTypeId: containerTypeId.value,
        quantity: positiveWhole(quantity.value) ?? 0,
        ...(origin !== null ? { fromState: origin } : {}),
        ...(destination !== null ? { toState: destination } : {}),
        ...(touchesCustomer.value ? { locationId: locationId.value } : {}),
      },
    });
    registered.value = true;
    type.value = "";
    containerTypeId.value = "";
    quantity.value = "";
    originChoice.value = "";
    customer.value = null;
    locationId.value = "";
    history.retry();
  } catch (error) {
    // El 400 nombra el problema (transición inválida, ubicación ajena): tal cual.
    submitError.value = describeApiFailure(error);
  } finally {
    submitting.value = false;
  }
}

// --- Historial del libro (TODAS las operaciones, también las de otros procesos) ---
const ALL = "all";
const historyType = ref<ContainerMovementType | typeof ALL>(ALL);
const historyContainerTypeId = ref(ALL);
const dateFrom = ref("");
const dateTo = ref("");
const history = usePagedList<ContainerMovement>(
  "/container-movements",
  CONTAINER_MOVEMENTS_PAGE_SIZE,
  computed(() => ({
    type: historyType.value === ALL ? undefined : historyType.value,
    containerTypeId:
      historyContainerTypeId.value === ALL ? undefined : historyContainerTypeId.value,
    dateFrom: dateFrom.value,
    dateTo: dateTo.value,
  })),
);
const summary = computed(() => {
  if (history.firstLoad.value) return "Cargando…";
  const total = history.total.value;
  return `${total} ${total === 1 ? "movimiento" : "movimientos"}${history.hasFilters.value ? " con este filtro" : ""}`;
});
function clearHistoryFilters(): void {
  historyType.value = ALL;
  historyContainerTypeId.value = ALL;
  dateFrom.value = "";
  dateTo.value = "";
}
</script>

<template>
  <AppPage
    title="Movimientos de envases"
    description="El libro no se edita ni se borra: un error se corrige registrando el movimiento inverso, nunca cambiando este."
  >
    <div class="space-y-6">
      <SectionCard
        title="Registrar movimiento"
        description="Lo que la oficina anota a mano: ingreso de envases nuevos, dañados o perdidos."
      >
        <div class="space-y-4">
          <UAlert
            v-if="registered"
            role="status"
            color="success"
            variant="subtle"
            title="Movimiento registrado."
          >
            <template #description>
              <ULink to="/inventory" class="underline">Ver inventario actualizado</ULink>
            </template>
          </UAlert>
          <UAlert
            v-if="submitError"
            role="alert"
            color="error"
            variant="subtle"
            :title="submitError"
          />

          <form
            class="space-y-4"
            novalidate
            aria-label="Registrar movimiento"
            @submit.prevent="register"
          >
            <div class="grid gap-4 sm:grid-cols-3">
              <UFormField label="Operación" :error="typeError">
                <USelect
                  :content="NON_BLOCKING_SELECT"
                  :model-value="type === '' ? undefined : type"
                  :items="
                    (Object.keys(MANUAL_MOVEMENTS) as ManualMovementType[]).map((value) => ({
                      label: MOVEMENT_TYPE_LABEL[value],
                      value,
                    }))
                  "
                  placeholder="Selecciona una operación"
                  :disabled="submitting"
                  class="w-full"
                  @update:model-value="(value: ManualMovementType) => chooseType(value)"
                />
              </UFormField>
              <UFormField label="Tipo de envase" :error="containerTypeError">
                <USelect
                  :content="NON_BLOCKING_SELECT"
                  :model-value="containerTypeId === '' ? undefined : containerTypeId"
                  :items="catalog.items.value.map((item) => ({ label: item.name, value: item.id }))"
                  :placeholder="
                    catalog.loading.value ? 'Cargando…' : 'Selecciona un tipo de envase'
                  "
                  :disabled="submitting || catalog.loading.value"
                  class="w-full"
                  @update:model-value="
                    (value: string) => {
                      containerTypeId = value;
                      containerTypeError = undefined;
                    }
                  "
                />
              </UFormField>
              <UFormField label="Cantidad" :error="quantityError">
                <UInput
                  :model-value="quantity"
                  type="number"
                  :min="1"
                  :step="1"
                  :disabled="submitting"
                  class="w-full"
                  @update:model-value="
                    (value: string | number) => {
                      quantity = String(value);
                      quantityError = undefined;
                    }
                  "
                />
              </UFormField>
              <UFormField v-if="requiresOriginChoice" label="¿De dónde sale?" :error="originError">
                <USelect
                  :content="NON_BLOCKING_SELECT"
                  :model-value="originChoice === '' ? undefined : originChoice"
                  :items="
                    origins
                      .filter((state): state is ContainerState => state !== null)
                      .map((state) => ({ label: ORIGIN_LABEL[state], value: state }))
                  "
                  placeholder="Selecciona el origen"
                  :disabled="submitting"
                  class="w-full"
                  @update:model-value="(value: ContainerState) => chooseOrigin(value)"
                />
              </UFormField>
              <template v-if="touchesCustomer">
                <div class="sm:col-span-3">
                  <CustomerPicker
                    :model-value="customer"
                    label="Cliente"
                    :error="customerError"
                    :disabled="submitting"
                    @update:model-value="chooseCustomer"
                  />
                </div>
                <div v-if="customer" class="sm:col-span-3">
                  <UAlert
                    v-if="locationsError"
                    role="alert"
                    color="error"
                    variant="subtle"
                    :title="locationsError"
                  >
                    <template #actions>
                      <UButton
                        color="neutral"
                        variant="outline"
                        size="sm"
                        label="Reintentar"
                        @click="loadLocations"
                      />
                    </template>
                  </UAlert>
                  <p
                    v-else-if="locations.length === 0 && !locationsLoading"
                    class="text-sm text-error"
                  >
                    Este cliente no tiene ubicaciones registradas.
                  </p>
                  <UFormField v-else label="Ubicación" :error="locationError">
                    <USelect
                      :content="NON_BLOCKING_SELECT"
                      :model-value="locationId === '' ? undefined : locationId"
                      :items="
                        locations.map((location) => ({
                          label: `${location.name} (${location.address})`,
                          value: location.id,
                        }))
                      "
                      :placeholder="locationsLoading ? 'Cargando…' : 'Selecciona una ubicación'"
                      :disabled="submitting || locationsLoading"
                      class="w-full"
                      @update:model-value="
                        (value: string) => {
                          locationId = value;
                          locationError = undefined;
                        }
                      "
                    />
                  </UFormField>
                </div>
              </template>
            </div>

            <UAlert
              v-if="slowSubmit && submitting"
              role="status"
              color="neutral"
              variant="subtle"
              :title="SLOW_REQUEST_MESSAGE"
            />

            <div class="flex justify-end border-t border-default pt-4">
              <UButton
                type="submit"
                icon="i-lucide-package-plus"
                :disabled="submitting"
                :label="submitting ? 'Registrando…' : 'Registrar movimiento'"
              />
            </div>
          </form>
        </div>
      </SectionCard>

      <section aria-label="Historial">
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <div class="border-b border-default p-4">
            <h2 class="text-lg font-semibold text-highlighted">Historial</h2>
            <p class="text-sm text-muted">{{ summary }}</p>
          </div>
          <div class="flex flex-wrap items-end gap-4 border-b border-default p-4">
            <UFormField label="Operación" class="w-52">
              <USelect
                v-model="historyType"
                :content="NON_BLOCKING_SELECT"
                :items="[
                  { label: 'Todas', value: ALL },
                  ...CONTAINER_MOVEMENT_TYPE_VALUES.map((value) => ({
                    label: MOVEMENT_TYPE_LABEL[value],
                    value,
                  })),
                ]"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Tipo de envase" class="w-44">
              <USelect
                v-model="historyContainerTypeId"
                :content="NON_BLOCKING_SELECT"
                :items="[
                  { label: 'Todos', value: ALL },
                  ...catalog.items.value.map((item) => ({ label: item.name, value: item.id })),
                ]"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Desde">
              <UInput v-model="dateFrom" type="date" />
            </UFormField>
            <UFormField label="Hasta">
              <UInput v-model="dateTo" type="date" />
            </UFormField>
            <UButton
              v-if="history.hasFilters.value"
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              label="Limpiar filtros"
              @click="clearHistoryFilters"
            />
          </div>

          <UAlert
            v-if="history.slow.value && history.loading.value"
            role="status"
            color="neutral"
            variant="subtle"
            class="rounded-none"
            :title="SLOW_REQUEST_MESSAGE"
          />

          <ListStatus
            v-if="
              history.errorMessage.value ||
              history.loading.value ||
              history.items.value.length === 0
            "
            :error-message="history.errorMessage.value"
            :loading="history.loading.value"
            :empty="history.items.value.length === 0"
            loading-label="Cargando historial…"
            empty-icon="i-lucide-package-search"
            :empty-title="
              history.hasFilters.value
                ? 'Ningún movimiento coincide con el filtro'
                : 'Todavía no hay movimientos'
            "
            :empty-description="
              history.hasFilters.value
                ? 'Prueba con otra operación, tipo de envase o rango de fechas.'
                : 'Los movimientos registrados aparecerán aquí.'
            "
            @retry="history.retry"
          />

          <template v-else>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <caption class="sr-only">
                  Libro de movimientos de envases con fecha, operación, tipo, cantidad y estados
                </caption>
                <thead class="bg-elevated text-left text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th scope="col" class="px-4 py-2 font-medium">Fecha</th>
                    <th scope="col" class="px-4 py-2 font-medium">Operación</th>
                    <th scope="col" class="px-4 py-2 font-medium">Tipo de envase</th>
                    <th scope="col" class="px-4 py-2 text-right font-medium">Cantidad</th>
                    <th scope="col" class="px-4 py-2 font-medium">De → a</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-default">
                  <tr v-for="movement in history.items.value" :key="movement.id">
                    <td class="px-4 py-3 whitespace-nowrap tabular-nums">
                      {{ formatInstantInLima(movement.occurredAt) }}
                    </td>
                    <td class="px-4 py-3">{{ MOVEMENT_TYPE_LABEL[movement.type] }}</td>
                    <td class="px-4 py-3">{{ movement.containerType.name }}</td>
                    <td class="px-4 py-3 text-right tabular-nums">{{ movement.quantity }}</td>
                    <td class="px-4 py-3 text-muted">
                      {{ describeTransition(movement.fromState, movement.toState) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ListPagination
              :shown-page="history.shownPage.value"
              :page="history.page.value"
              :total-pages="history.totalPages.value"
              @previous="history.previous"
              @next="history.next"
            />
          </template>
        </UCard>
      </section>
    </div>
  </AppPage>
</template>
