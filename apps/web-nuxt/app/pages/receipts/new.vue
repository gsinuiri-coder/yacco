<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { formatInstantInLima, formatSoles, limaToday } from "@yacco/shared";
import type {
  Customer,
  Page,
  ReceiptFile,
  ReceiptMedium,
  ReceiptDetail,
  ReceiptPreview,
  ReceiptRow,
  ReceiptSaleStatusRow,
  ReceiptType,
} from "@yacco/shared";

useHead({ title: "Registrar comprobante · Yacco" });

const route = useRoute();
const api = useApi();
const customer = ref<Customer | null>(null);
const customerLoading = ref(false);
const sales = ref<ReceiptSaleStatusRow[]>([]);
const salesLoading = ref(false);
const salesError = ref<string | null>(null);
const selectedSaleIds = ref<string[]>([]);

const type = ref<Exclude<ReceiptType, "CREDIT_NOTE">>("SALES_RECEIPT");
const medium = ref<ReceiptMedium>("MANUAL");
const series = ref("");
const number = ref("");
const issuedOn = ref(limaToday());
const files = ref<File[]>([]);

const preview = ref<ReceiptPreview | null>(null);
const previewing = ref(false);
const previewError = ref<string | null>(null);
const saving = ref(false);
const saveError = ref<string | null>(null);
const confirmUnusualSeries = ref(false);
const createdReceiptId = ref<string | null>(null);

// «Volver a registrar el original»: a voided receipt prefills the form and
// its attachments can be linked again without uploading them.
const restoreSource = ref<ReceiptDetail | null>(null);
const reuseFiles = ref(true);
const restoreSalesTaken = ref(false);
let pendingSaleIds: string[] = [];

const reusableFiles = computed(() => {
  const source = restoreSource.value;
  if (source === null) return [];
  if (customer.value?.id !== source.customer.id || medium.value !== source.medium) return [];
  return source.files;
});
const filesToReuse = computed(() => (reuseFiles.value ? reusableFiles.value : []));
const reuseLabel = computed(
  () =>
    `Volver a asociar los adjuntos del original (${reusableFiles.value
      .map((file) => fileKind(file.contentType))
      .join(" y ")})`,
);

// The stored file name is an internal id; the office knows a file by what it is.
function fileKind(contentType: string): string {
  if (contentType === "application/pdf") return "PDF";
  if (contentType === "application/xml") return "XML";
  return "foto";
}

const saleColumns: TableColumn<ReceiptSaleStatusRow>[] = [
  { id: "select", meta: { class: { td: "w-0" } } },
  { accessorKey: "soldAt", header: "Venta" },
  { accessorKey: "location", header: "Local" },
  {
    accessorKey: "total",
    header: "Total",
    meta: { class: { th: "text-right", td: "text-right" } },
  },
];

const typeItems = [
  { label: "Boleta", value: "SALES_RECEIPT" },
  { label: "Factura", value: "INVOICE" },
];
const mediumItems = [
  { label: "Manual", value: "MANUAL" },
  { label: "Electrónico", value: "EXTERNAL_ELECTRONIC" },
];

const unusualSeries = computed(() => {
  const value = series.value.trim().toUpperCase();
  if (value === "") return false;
  const prefix = type.value === "INVOICE" ? "F" : "B";
  return !new RegExp(`^${prefix}[A-Z0-9]{3}$`).test(value);
});

const fileHelp = computed(() =>
  medium.value === "MANUAL"
    ? "Puedes adjuntar una foto o un PDF."
    : "Puedes adjuntar un PDF y un XML.",
);
const fileAccept = computed(() =>
  medium.value === "MANUAL"
    ? "application/pdf,image/jpeg,image/png"
    : "application/pdf,application/xml,text/xml",
);

function resetSelection(): void {
  sales.value = [];
  selectedSaleIds.value = [];
  preview.value = null;
  previewError.value = null;
  restoreSalesTaken.value = false;
}

function requestedSaleIds(): string[] {
  if (pendingSaleIds.length > 0) return pendingSaleIds;
  return typeof route.query.saleId === "string" && route.query.saleId !== ""
    ? [route.query.saleId]
    : [];
}

function preselectSales(available: ReceiptSaleStatusRow[]): void {
  const requested = requestedSaleIds();
  const availableIds = new Set(available.map((sale) => sale.id));
  if (pendingSaleIds.length > 0) {
    // Registering the original again takes all of its sales or none.
    restoreSalesTaken.value = requested.some((id) => !availableIds.has(id));
    selectedSaleIds.value = restoreSalesTaken.value ? [] : requested;
    pendingSaleIds = [];
    return;
  }
  selectedSaleIds.value = requested.filter((id) => availableIds.has(id));
}

async function loadSales(): Promise<void> {
  resetSelection();
  if (customer.value === null) return;
  salesLoading.value = true;
  salesError.value = null;
  try {
    const loaded: ReceiptSaleStatusRow[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const result = await api.request<Page<ReceiptSaleStatusRow>>("/receipts/sales", {
        query: { customerId: customer.value.id, status: "AVAILABLE", page, limit: 100 },
      });
      loaded.push(...result.data);
      totalPages = result.totalPages;
      page += 1;
    } while (page <= totalPages);
    sales.value = loaded;
    preselectSales(loaded);
  } catch (error) {
    salesError.value = describeApiFailure(error);
  } finally {
    salesLoading.value = false;
  }
}

watch(
  () => customer.value?.id,
  (currentId, previousId) => {
    if (currentId !== previousId) void loadSales();
  },
);

watch([type, selectedSaleIds], () => {
  preview.value = null;
  previewError.value = null;
  confirmUnusualSeries.value = false;
});

watch(series, () => {
  confirmUnusualSeries.value = false;
});

async function loadRestoreSource(sourceId: string): Promise<string> {
  const source = await api.request<ReceiptDetail>(`/receipts/${sourceId}`);
  restoreSource.value = source;
  if (source.type !== "CREDIT_NOTE") type.value = source.type;
  medium.value = source.medium;
  series.value = source.series;
  number.value = source.number;
  issuedOn.value = source.issuedOn;
  pendingSaleIds = source.sales.map((sale) => sale.id);
  return source.customer.id;
}

onMounted(async () => {
  const sourceId = typeof route.query.from === "string" ? route.query.from : "";
  const queryCustomerId = typeof route.query.customerId === "string" ? route.query.customerId : "";
  if (sourceId === "" && queryCustomerId === "") return;
  customerLoading.value = true;
  try {
    const customerId = sourceId === "" ? queryCustomerId : await loadRestoreSource(sourceId);
    customer.value = await api.request<Customer>(`/customers/${customerId}`);
  } catch (error) {
    salesError.value = describeApiFailure(error);
  } finally {
    customerLoading.value = false;
  }
});

function toggleSale(saleId: string, checked: boolean): void {
  selectedSaleIds.value = checked
    ? [...selectedSaleIds.value, saleId]
    : selectedSaleIds.value.filter((id) => id !== saleId);
}

async function calculatePreview(): Promise<void> {
  if (customer.value === null || selectedSaleIds.value.length === 0 || previewing.value) return;
  previewing.value = true;
  previewError.value = null;
  try {
    preview.value = await api.request<ReceiptPreview>("/receipts/preview", {
      method: "POST",
      body: {
        type: type.value,
        customerId: customer.value.id,
        saleIds: selectedSaleIds.value,
      },
    });
  } catch (error) {
    previewError.value = describeApiFailure(error);
  } finally {
    previewing.value = false;
  }
}

function chooseFiles(event: Event): void {
  const input = event.target as HTMLInputElement;
  files.value = Array.from(input.files ?? []);
  saveError.value = null;
}

function validateFiles(): string | null {
  if (files.value.some((file) => file.size > 10 * 1024 * 1024)) {
    return "Cada archivo debe pesar 10 MB o menos.";
  }
  const types = [
    ...files.value.map((file) => file.type),
    ...filesToReuse.value.map((file) => file.contentType),
  ];
  if (medium.value === "MANUAL") {
    if (types.length > 1) return "Un comprobante manual admite una foto o un PDF.";
    return null;
  }
  const pdfCount = types.filter((fileType) => fileType === "application/pdf").length;
  const xmlCount = types.filter((fileType) =>
    ["application/xml", "text/xml"].includes(fileType),
  ).length;
  if (types.length > 2 || pdfCount > 1 || xmlCount > 1 || pdfCount + xmlCount !== types.length) {
    return "Un comprobante electrónico admite un PDF y un XML.";
  }
  return null;
}

async function uploadFiles(receiptId: string): Promise<void> {
  while (files.value.length > 0) {
    const file = files.value[0]!;
    const body = new FormData();
    body.append("file", file);
    await api.request<ReceiptFile>(`/receipts/${receiptId}/files`, { method: "POST", body });
    files.value = files.value.slice(1);
  }
}

async function submit(): Promise<void> {
  if (saving.value || customer.value === null || preview.value === null) return;
  saveError.value = null;

  const cleanSeries = series.value.trim().toUpperCase();
  const cleanNumber = number.value.trim();
  if (cleanSeries === "" || cleanNumber === "" || issuedOn.value === "") {
    saveError.value = "Completa serie, número y fecha de emisión.";
    return;
  }
  const fileError = validateFiles();
  if (fileError !== null) {
    saveError.value = fileError;
    return;
  }
  if (unusualSeries.value && !confirmUnusualSeries.value) {
    confirmUnusualSeries.value = true;
    return;
  }

  saving.value = true;
  try {
    const created = await api.request<ReceiptRow>("/receipts", {
      method: "POST",
      body: {
        type: type.value,
        medium: medium.value,
        series: cleanSeries,
        number: cleanNumber,
        issuedOn: issuedOn.value,
        customerId: customer.value.id,
        saleIds: selectedSaleIds.value,
        ...(filesToReuse.value.length > 0 && restoreSource.value !== null
          ? { filesFromReceiptId: restoreSource.value.id }
          : {}),
      },
    });
    createdReceiptId.value = created.id;
    try {
      await uploadFiles(created.id);
      await navigateTo(`/receipts/${created.id}`);
    } catch (error) {
      saveError.value = `El comprobante quedó registrado, pero no se pudieron adjuntar todos los archivos. ${describeApiFailure(error)}`;
    }
  } catch (error) {
    saveError.value = describeApiFailure(error);
  } finally {
    saving.value = false;
  }
}

async function retryFiles(): Promise<void> {
  if (createdReceiptId.value === null || saving.value) return;
  saving.value = true;
  saveError.value = null;
  try {
    await uploadFiles(createdReceiptId.value);
    await navigateTo(`/receipts/${createdReceiptId.value}`);
  } catch (error) {
    saveError.value = describeApiFailure(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppPage
    title="Registrar comprobante"
    description="Elige ventas completas del mismo cliente y revisa los montos antes de guardar."
  >
    <template #actions>
      <UButton
        to="/receipts"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        label="Volver a comprobantes"
        aria-label="Volver a comprobantes"
        :ui="{ label: 'hidden sm:inline' }"
      />
    </template>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
      <div class="space-y-6">
        <UCard>
          <template #header>
            <div>
              <h2 class="text-lg font-semibold text-highlighted">Cliente y ventas</h2>
              <p class="text-sm text-muted">Solo se muestran ventas que todavía están libres.</p>
            </div>
          </template>

          <div class="space-y-4">
            <UAlert
              v-if="restoreSource"
              color="info"
              variant="subtle"
              icon="i-lucide-rotate-ccw"
              :title="`Volver a registrar ${RECEIPT_TYPE[restoreSource.type].label} ${receiptNumber(restoreSource.series, restoreSource.number)}`"
              description="Se registra como un comprobante nuevo; el anulado sigue a la vista."
            />
            <UAlert
              v-if="restoreSalesTaken"
              role="alert"
              color="error"
              variant="subtle"
              title="Una o más ventas del original ya tienen otro comprobante o están marcadas «No lleva comprobante»."
              description="Anula ese comprobante o libera la marca antes de volver a registrar el original."
            />
            <CustomerPicker
              v-model="customer"
              label="Cliente"
              :disabled="customerLoading || saving || createdReceiptId !== null"
            />
            <UAlert
              v-if="customer"
              color="neutral"
              variant="soft"
              icon="i-lucide-user-round"
              :title="customer.name"
              :description="customer.phone"
            />
            <UAlert
              v-if="salesError"
              role="alert"
              color="error"
              variant="subtle"
              :title="salesError"
            />
            <div v-else-if="salesLoading" role="status" class="flex items-center gap-2 text-muted">
              <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
              Cargando ventas sin comprobante…
            </div>
            <UAlert
              v-else-if="customer && sales.length === 0"
              color="neutral"
              variant="soft"
              title="Este cliente no tiene ventas sin comprobante"
            />
            <UTable
              v-else-if="sales.length > 0"
              :data="sales"
              :columns="saleColumns"
              caption="Ventas sin comprobante"
              :ui="{ caption: 'sr-only' }"
            >
              <template #select-header>
                <span class="sr-only">Elegir</span>
              </template>
              <template #select-cell="{ row }">
                <UCheckbox
                  :model-value="selectedSaleIds.includes(row.original.id)"
                  :aria-label="`${formatInstantInLima(row.original.soldAt)} · ${row.original.location.name} · ${formatSoles(row.original.total)}`"
                  :disabled="saving || createdReceiptId !== null"
                  @update:model-value="
                    (checked: boolean | 'indeterminate') =>
                      toggleSale(row.original.id, checked === true)
                  "
                />
              </template>
              <template #soldAt-cell="{ row }">
                <span class="tabular-nums">{{ formatInstantInLima(row.original.soldAt) }}</span>
              </template>
              <template #location-cell="{ row }">
                <span class="font-medium text-highlighted">{{ row.original.location.name }}</span>
              </template>
              <template #total-cell="{ row }">
                <span class="font-medium text-highlighted tabular-nums">
                  {{ formatSoles(row.original.total) }}
                </span>
              </template>
            </UTable>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="text-lg font-semibold text-highlighted">Datos del comprobante</h2>
          </template>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Tipo" required>
              <USelect
                v-model="type"
                :items="typeItems"
                :disabled="saving || createdReceiptId !== null"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Medio" required>
              <USelect
                v-model="medium"
                :items="mediumItems"
                :disabled="saving || createdReceiptId !== null"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Serie" required>
              <UInput
                v-model="series"
                maxlength="20"
                :disabled="saving || createdReceiptId !== null"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Número" required>
              <UInput
                v-model="number"
                maxlength="30"
                :disabled="saving || createdReceiptId !== null"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Fecha de emisión" required>
              <UInput
                v-model="issuedOn"
                type="date"
                :disabled="saving || createdReceiptId !== null"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Archivos del comprobante" :help="fileHelp">
              <UInput
                type="file"
                multiple
                :accept="fileAccept"
                :disabled="saving"
                class="w-full"
                @change="chooseFiles"
              />
            </UFormField>
          </div>
          <ul v-if="files.length > 0" class="mt-2 space-y-1 text-sm text-highlighted">
            <li v-for="file in files" :key="`${file.name}-${file.size}`">{{ file.name }}</li>
          </ul>
          <UCheckbox
            v-if="reusableFiles.length > 0"
            v-model="reuseFiles"
            class="mt-4"
            :label="reuseLabel"
            :disabled="saving || createdReceiptId !== null"
          />
          <UAlert
            v-if="unusualSeries"
            class="mt-4"
            color="warning"
            variant="subtle"
            title="La serie no tiene el formato habitual"
            description="Revísala contra el talonario o el portal. Este aviso no impide registrarla."
          />
        </UCard>
      </div>

      <UCard>
        <template #header>
          <div>
            <h2 class="text-lg font-semibold text-highlighted">Montos</h2>
            <p class="text-sm text-muted">Los calcula la API con la versión fiscal vigente.</p>
          </div>
        </template>

        <div class="space-y-4">
          <UAlert
            v-if="previewError"
            role="alert"
            color="error"
            variant="subtle"
            :title="previewError"
          />
          <UAlert v-if="saveError" role="alert" color="error" variant="subtle" :title="saveError" />

          <UButton
            v-if="preview === null && createdReceiptId === null"
            block
            color="neutral"
            variant="outline"
            icon="i-lucide-calculator"
            label="Calcular montos"
            :loading="previewing"
            :disabled="
              customer === null || selectedSaleIds.length === 0 || previewing || restoreSalesTaken
            "
            @click="calculatePreview"
          />

          <section v-if="preview" aria-label="Vista previa de montos" class="space-y-4">
            <dl class="space-y-3 text-sm">
              <div class="flex items-center justify-between gap-4">
                <dt class="text-muted">Base imponible</dt>
                <dd class="font-medium text-highlighted tabular-nums">
                  {{ formatSoles(preview.taxableAmount) }}
                </dd>
              </div>
              <div class="flex items-center justify-between gap-4">
                <dt class="text-muted">IGV</dt>
                <dd class="font-medium text-highlighted tabular-nums">
                  {{ formatSoles(preview.taxAmount) }}
                </dd>
              </div>
              <div class="flex items-center justify-between gap-4">
                <dt class="text-muted">Tasa</dt>
                <dd class="font-medium text-highlighted tabular-nums">
                  IGV {{ preview.taxRate }} %
                </dd>
              </div>
              <div class="flex items-center justify-between gap-4 border-t border-default pt-3">
                <dt class="font-medium text-highlighted">Total</dt>
                <dd class="font-display text-xl font-semibold text-highlighted tabular-nums">
                  {{ formatSoles(preview.total) }}
                </dd>
              </div>
            </dl>
            <UButton
              block
              :label="confirmUnusualSeries ? 'Registrar de todas formas' : 'Registrar comprobante'"
              :loading="saving"
              :disabled="saving"
              @click="submit"
            />
          </section>

          <div v-if="createdReceiptId !== null && saveError" class="space-y-2">
            <UButton block label="Reintentar adjuntos" :loading="saving" @click="retryFiles" />
            <UButton
              block
              color="neutral"
              variant="outline"
              :to="`/receipts/${createdReceiptId}`"
              label="Ver comprobante registrado"
            />
          </div>
        </div>
      </UCard>
    </div>
  </AppPage>
</template>
