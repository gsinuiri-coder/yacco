<script setup lang="ts">
import {
  PRODUCTION_BATCHES_PAGE_SIZE,
  formatCalendarDay,
  formatInstantInLima,
  limaToday,
} from "@yacco/shared";
import type {
  ContainerType,
  CreateProductionBatchResponse,
  ProductionBatch,
  ProductionBatchCodeProposal,
  ProductionBatchWarning,
} from "@yacco/shared";
import type { BatchLineDraft } from "../utils/production-batch";

useHead({ title: "Producción · Yacco" });

const session = useSession();
const api = useApi();
const isAdmin = computed(() => session.hasRole("ADMIN"));

// --- Registrar lote (ADMIN) ---
const code = ref("");
const date = ref(limaToday());
const notes = ref("");
const lines = ref<BatchLineDraft[]>([blankBatchLine(0)]);
let nextKey = 1;
const dateError = ref<string | undefined>(undefined);
const lineErrors = ref<Array<string | undefined>>([]);
const submitting = ref(false);
const submitError = ref<string | null>(null);
const slowSubmit = useSlowRequest(submitting);
const registered = ref<{
  code: string;
  warnings: ProductionBatchWarning[];
  appended: boolean;
} | null>(null);
const proposalLoading = ref(false);
const willAppend = ref(false);

const catalog = useCatalog<ContainerType>("/container-types");

let proposalRequest = 0;
async function loadCodeProposal(): Promise<void> {
  if (!isAdmin.value || date.value === "") return;
  const request = ++proposalRequest;
  const requestedDate = date.value;
  const codeBeforeRequest = code.value;
  proposalLoading.value = true;
  try {
    const proposal = await api.request<ProductionBatchCodeProposal>(
      "/production-batches/code-proposals",
      { query: { date: requestedDate } },
    );
    if (
      request === proposalRequest &&
      date.value === requestedDate &&
      (proposal.willAppend || code.value === codeBeforeRequest)
    ) {
      code.value = proposal.code;
      willAppend.value = proposal.willAppend;
    }
  } catch {
    // El POST también genera el código: una propuesta caída no bloquea producción.
  } finally {
    if (request === proposalRequest) proposalLoading.value = false;
  }
}

watch(
  date,
  () => {
    dateError.value = undefined;
    willAppend.value = false;
    // Un código propuesto pertenece a una sola fecha. Si la nueva propuesta
    // falla, el POST vacío deja que la API genere el código correcto.
    code.value = "";
    void loadCodeProposal();
  },
  { immediate: true },
);

function editLine(index: number, patch: Partial<BatchLineDraft>): void {
  lines.value = lines.value.map((line, i) => (i === index ? { ...line, ...patch } : line));
  lineErrors.value = lineErrors.value.map((error, i) => (i === index ? undefined : error));
}

async function register(): Promise<void> {
  // Con un arranque en frío, un botón vivo son varios lotes duplicados. Mientras
  // cambia la fecha tampoco se puede enviar el código que propuso la anterior.
  if (submitting.value || proposalLoading.value) return;
  dateError.value = date.value === "" ? "Elige una fecha" : undefined;
  lineErrors.value = lines.value.map(checkBatchLine);
  if (dateError.value || lineErrors.value.some(Boolean)) return;

  submitting.value = true;
  submitError.value = null;
  registered.value = null;
  const appended = willAppend.value;
  try {
    const response = await api.request<CreateProductionBatchResponse>("/production-batches", {
      method: "POST",
      body: batchBody(code.value, date.value, notes.value, lines.value),
    });
    registered.value = { code: response.code, warnings: response.warnings, appended };
    code.value = "";
    date.value = limaToday();
    notes.value = "";
    lines.value = [blankBatchLine(nextKey++)];
    lineErrors.value = [];
    void loadCodeProposal();
    list.retry();
  } catch (error) {
    // El 400 nombra el problema (código duplicado, tipo inactivo): tal cual.
    submitError.value = describeApiFailure(error);
  } finally {
    submitting.value = false;
  }
}

// --- Lotes (ADMIN y SELLER) ---
const dateFrom = ref("");
const dateTo = ref("");
const list = usePagedList<ProductionBatch>(
  "/production-batches",
  PRODUCTION_BATCHES_PAGE_SIZE,
  computed(() => ({ dateFrom: dateFrom.value, dateTo: dateTo.value })),
);
const summary = computed(() => {
  if (list.firstLoad.value) return "Cargando…";
  const total = list.total.value;
  return `${total} ${total === 1 ? "lote" : "lotes"}${list.hasFilters.value ? " con este filtro" : ""}`;
});

const expandedBatchIds = ref(new Set<string>());
function toggleBatchDetails(batchId: string): void {
  const next = new Set(expandedBatchIds.value);
  if (next.has(batchId)) next.delete(batchId);
  else next.add(batchId);
  expandedBatchIds.value = next;
}

function fillingAudit(item: ProductionBatch["items"][number]): string | null {
  if (item.createdAt === null && item.recordedBy === null) {
    return "Registro anterior sin hora ni responsable";
  }
  return null;
}
</script>

<template>
  <AppPage title="Producción" :description="summary">
    <div class="space-y-6">
      <SectionCard
        v-if="isAdmin"
        title="Registrar llenada"
        description="Cada registro queda separado dentro del lote de su fecha."
      >
        <div class="space-y-4">
          <UAlert
            v-if="registered"
            role="status"
            color="success"
            variant="subtle"
            :title="
              registered.appended
                ? `Llenada sumada al lote ${registered.code}.`
                : `Lote ${registered.code} registrado.`
            "
          >
            <template #description>
              <ULink to="/inventory" class="underline">Ver inventario actualizado</ULink>
            </template>
          </UAlert>
          <!-- Una advertencia, no un error: el lote se guardó. -->
          <UAlert
            v-if="registered && registered.warnings.length > 0"
            role="alert"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="El lote se guardó igual, pero se llenó más de lo que había vacío en planta: faltan registrar entradas de envases."
          >
            <template #description>
              <ul class="list-disc pl-5">
                <li v-for="warning in registered.warnings" :key="warning.containerTypeId">
                  {{ warning.containerType.name }}: se produjeron {{ warning.produced }}, había
                  {{ warning.emptyAvailable }} vacíos en planta.
                </li>
              </ul>
            </template>
          </UAlert>
          <UAlert
            v-if="submitError"
            role="alert"
            color="error"
            variant="subtle"
            :title="submitError"
          />
          <UAlert
            v-if="willAppend"
            role="status"
            color="info"
            variant="subtle"
            icon="i-lucide-layers-3"
            :title="`Se suma al lote de hoy, ${code}`"
            description="Esta llenada quedará como un renglón nuevo, con su hora, responsable y nota."
          />

          <form
            class="space-y-5"
            novalidate
            aria-label="Registrar llenada"
            @submit.prevent="register"
          >
            <div class="grid gap-4 sm:grid-cols-[12rem_12rem_1fr]">
              <UFormField label="Código">
                <UInput
                  v-model="code"
                  :disabled="submitting || proposalLoading || willAppend"
                  class="w-full"
                />
                <template #hint>
                  <span v-if="proposalLoading">Buscando el lote de esta fecha…</span>
                  <span v-else-if="willAppend">El código pertenece al lote ya creado.</span>
                  <span v-else>Se propone automáticamente; podés cambiarlo.</span>
                </template>
              </UFormField>
              <UFormField label="Fecha" :error="dateError">
                <UInput v-model="date" type="date" :disabled="submitting" class="w-full" />
              </UFormField>
              <UFormField label="Notas (opcional)">
                <UInput v-model="notes" :disabled="submitting" class="w-full" />
              </UFormField>
            </div>

            <ListStatus
              v-if="catalog.failed.value"
              error-message="No se pudo cargar el catálogo de tipos de envase."
              :loading="false"
              :empty="false"
              loading-label=""
              error-title="Sin tipos de envase no se puede registrar el lote"
              empty-title=""
              empty-description=""
              @retry="catalog.reload"
            />
            <div v-else class="space-y-2">
              <div
                v-for="(line, index) in lines"
                :key="line.key"
                class="flex flex-wrap items-end gap-3"
              >
                <UFormField :label="`Tipo de envase ${index + 1}`" class="min-w-56">
                  <USelect
                    :model-value="line.containerTypeId === '' ? undefined : line.containerTypeId"
                    :items="
                      typesForLine(catalog.items.value, lines, index).map((type) => ({
                        label: type.name,
                        value: type.id,
                      }))
                    "
                    placeholder="Elige un tipo de envase"
                    :disabled="submitting || catalog.loading.value"
                    class="w-full"
                    @update:model-value="
                      (value: string) => editLine(index, { containerTypeId: value })
                    "
                  />
                </UFormField>
                <UFormField :label="`Cantidad producida ${index + 1}`" class="w-40">
                  <UInput
                    :model-value="line.producedQty"
                    type="number"
                    :min="1"
                    :step="1"
                    :disabled="submitting"
                    @update:model-value="
                      (value: string | number) => editLine(index, { producedQty: String(value) })
                    "
                  />
                </UFormField>
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-x"
                  :aria-label="`Quitar tipo de envase ${index + 1}`"
                  :disabled="submitting || lines.length <= 1"
                  @click="lines = lines.filter((_, i) => i !== index)"
                />
                <p v-if="lineErrors[index]" class="w-full text-sm text-error">
                  {{ lineErrors[index] }}
                </p>
              </div>
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-plus"
                label="Agregar tipo de envase"
                :disabled="submitting"
                @click="lines = [...lines, blankBatchLine(nextKey++)]"
              />
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
                icon="i-lucide-factory"
                :disabled="submitting || proposalLoading"
                :label="submitting ? 'Registrando…' : willAppend ? 'Sumar llenada' : 'Crear lote'"
              />
            </div>
          </form>
        </div>
      </SectionCard>

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <div class="flex flex-wrap items-end gap-4 border-b border-default p-4">
          <UFormField label="Desde">
            <UInput v-model="dateFrom" type="date" />
          </UFormField>
          <UFormField label="Hasta">
            <UInput v-model="dateTo" type="date" />
          </UFormField>
          <UButton
            v-if="list.hasFilters.value"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            label="Limpiar filtros"
            @click="
              dateFrom = '';
              dateTo = '';
            "
          />
        </div>

        <UAlert
          v-if="list.slow.value && list.loading.value"
          role="status"
          color="neutral"
          variant="subtle"
          class="rounded-none"
          :title="SLOW_REQUEST_MESSAGE"
        />

        <ListStatus
          v-if="list.errorMessage.value || list.loading.value || list.items.value.length === 0"
          :error-message="list.errorMessage.value"
          :loading="list.loading.value"
          :empty="list.items.value.length === 0"
          loading-label="Cargando lotes…"
          empty-icon="i-lucide-factory"
          :empty-title="
            list.hasFilters.value
              ? 'Ningún lote coincide con el filtro'
              : 'Todavía no hay lotes registrados'
          "
          :empty-description="
            list.hasFilters.value
              ? 'Prueba con otro rango de fechas.'
              : 'Los lotes registrados aparecerán aquí.'
          "
          @retry="list.retry"
        />

        <template v-else>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <caption class="sr-only">
                Lotes de producción con código, fecha, responsable, lo producido y lo que todavía no
                salió en ninguna ruta
              </caption>
              <thead class="bg-elevated text-left text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" class="px-4 py-2 font-medium">Código</th>
                  <th scope="col" class="px-4 py-2 font-medium">Fecha</th>
                  <th scope="col" class="px-4 py-2 font-medium">Responsable</th>
                  <th scope="col" class="px-4 py-2 font-medium">Producido</th>
                  <th scope="col" class="px-4 py-2 font-medium">Sin cargar</th>
                  <th scope="col" class="px-4 py-2 text-right font-medium">Llenadas</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <template v-for="batch in list.items.value" :key="batch.id">
                  <tr>
                    <td class="px-4 py-3 font-medium text-highlighted">{{ batch.code }}</td>
                    <td class="px-4 py-3 tabular-nums">{{ formatCalendarDay(batch.date) }}</td>
                    <td class="px-4 py-3">{{ batch.filledBy.name }}</td>
                    <td class="px-4 py-3 text-muted">{{ producedSummary(batch) }}</td>
                    <td class="px-4 py-3">
                      <UBadge
                        v-if="remainingSummary(batch) === 'Todo cargado'"
                        color="neutral"
                        variant="soft"
                        label="Todo cargado"
                      />
                      <span v-else class="text-highlighted">{{ remainingSummary(batch) }}</span>
                    </td>
                    <td class="px-4 py-3 text-right">
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :icon="
                          expandedBatchIds.has(batch.id)
                            ? 'i-lucide-chevron-up'
                            : 'i-lucide-chevron-down'
                        "
                        :label="
                          expandedBatchIds.has(batch.id)
                            ? 'Ocultar llenadas'
                            : `Ver ${batch.items.length} ${batch.items.length === 1 ? 'llenada' : 'llenadas'}`
                        "
                        :aria-expanded="expandedBatchIds.has(batch.id)"
                        @click="toggleBatchDetails(batch.id)"
                      />
                    </td>
                  </tr>
                  <tr v-if="expandedBatchIds.has(batch.id)" class="bg-elevated/40">
                    <td colspan="6" class="px-4 py-4">
                      <section
                        class="space-y-3"
                        role="region"
                        :aria-label="`Llenadas del lote ${batch.code}`"
                      >
                        <div class="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 class="font-medium text-highlighted">Registro de llenadas</h3>
                          <p class="text-sm text-muted">Total: {{ producedSummary(batch) }}</p>
                        </div>
                        <ul
                          class="divide-y divide-default rounded-lg border border-default bg-default"
                        >
                          <li
                            v-for="item in batch.items"
                            :key="item.id"
                            class="grid gap-2 px-4 py-3 sm:grid-cols-[10rem_minmax(10rem,1fr)_minmax(12rem,1fr)] sm:items-center"
                          >
                            <div class="text-sm tabular-nums">
                              <p v-if="item.createdAt" class="font-medium text-highlighted">
                                {{ formatInstantInLima(item.createdAt) }}
                              </p>
                              <p v-if="item.recordedBy" class="text-muted">
                                {{ item.recordedBy.name }}
                              </p>
                              <p v-if="fillingAudit(item)" class="text-muted">
                                {{ fillingAudit(item) }}
                              </p>
                            </div>
                            <p class="font-medium text-highlighted">
                              {{ item.producedQty }}× {{ item.containerType.name }}
                            </p>
                            <p class="text-sm text-muted">
                              {{ item.notes || "Sin nota" }}
                            </p>
                          </li>
                        </ul>
                      </section>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <ListPagination
            :shown-page="list.shownPage.value"
            :page="list.page.value"
            :total-pages="list.totalPages.value"
            @previous="list.previous"
            @next="list.next"
          />
        </template>
      </UCard>
    </div>
  </AppPage>
</template>
