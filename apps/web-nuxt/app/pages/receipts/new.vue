<script setup lang="ts">
import { formatInstantInLima, formatSoles, limaToday } from "@yacco/shared";
import type {
  Customer,
  Page,
  ReceiptFile,
  ReceiptMedium,
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
}

async function loadSales(): Promise<void> {
  resetSelection();
  if (customer.value === null) return;
  salesLoading.value = true;
  salesError.value = null;
  try {
    const result = await api.request<Page<ReceiptSaleStatusRow>>("/receipts/sales", {
      query: {
        customerId: customer.value.id,
        status: "AVAILABLE",
        page: 1,
        limit: 100,
      },
    });
    sales.value = result.data;
    const requestedSaleId = typeof route.query.saleId === "string" ? route.query.saleId : "";
    if (requestedSaleId !== "" && result.data.some((sale) => sale.id === requestedSaleId)) {
      selectedSaleIds.value = [requestedSaleId];
    }
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

onMounted(async () => {
  const customerId = typeof route.query.customerId === "string" ? route.query.customerId : "";
  if (customerId === "") return;
  customerLoading.value = true;
  try {
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
  if (medium.value === "MANUAL") {
    if (files.value.length > 1) return "Un comprobante manual admite una foto o un PDF.";
    return null;
  }
  const pdfCount = files.value.filter((file) => file.type === "application/pdf").length;
  const xmlCount = files.value.filter((file) =>
    ["application/xml", "text/xml"].includes(file.type),
  ).length;
  if (
    files.value.length > 2 ||
    pdfCount > 1 ||
    xmlCount > 1 ||
    pdfCount + xmlCount !== files.value.length
  ) {
    return "Un comprobante electrónico admite un PDF y un XML.";
  }
  return null;
}

async function uploadFiles(receiptId: string): Promise<void> {
  for (const file of files.value) {
    const body = new FormData();
    body.append("file", file);
    await api.request<ReceiptFile>(`/receipts/${receiptId}/files`, { method: "POST", body });
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
            <div v-else-if="sales.length > 0" class="overflow-x-auto">
              <table class="w-full text-sm">
                <caption class="sr-only">
                  Ventas sin comprobante
                </caption>
                <thead class="bg-elevated text-left text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th scope="col" class="px-4 py-2"><span class="sr-only">Elegir</span></th>
                    <th scope="col" class="px-4 py-2 font-medium">Venta</th>
                    <th scope="col" class="px-4 py-2 font-medium">Local</th>
                    <th scope="col" class="px-4 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-default">
                  <tr v-for="sale in sales" :key="sale.id">
                    <td class="px-4 py-3">
                      <UCheckbox
                        :model-value="selectedSaleIds.includes(sale.id)"
                        :aria-label="`${formatInstantInLima(sale.soldAt)} · ${sale.location.name} · ${formatSoles(sale.total)}`"
                        :disabled="saving || createdReceiptId !== null"
                        @update:model-value="
                          (checked: boolean | 'indeterminate') =>
                            toggleSale(sale.id, checked === true)
                        "
                      />
                    </td>
                    <td class="px-4 py-3 tabular-nums">{{ formatInstantInLima(sale.soldAt) }}</td>
                    <td class="px-4 py-3 font-medium text-highlighted">{{ sale.location.name }}</td>
                    <td class="px-4 py-3 text-right font-medium text-highlighted tabular-nums">
                      {{ formatSoles(sale.total) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
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
                :disabled="saving || createdReceiptId !== null"
                class="w-full"
                @change="chooseFiles"
              />
            </UFormField>
          </div>
          <ul v-if="files.length > 0" class="mt-2 space-y-1 text-sm text-highlighted">
            <li v-for="file in files" :key="`${file.name}-${file.size}`">{{ file.name }}</li>
          </ul>
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
            :disabled="customer === null || selectedSaleIds.length === 0 || previewing"
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
