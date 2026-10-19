<script setup lang="ts">
import { formatInstantInLima, formatSoles } from "@yacco/shared";

interface IssuerSettings {
  id: string;
  taxId: string;
  legalName: string;
  fiscalAddress: string;
  taxRate: string;
  receiptDocumentThreshold: string;
  createdById: string;
  createdAt: string;
  createdBy: { id: string; username: string };
}

interface IssuerSettingsForm {
  taxId: string;
  legalName: string;
  fiscalAddress: string;
  taxRate: string;
  receiptDocumentThreshold: string;
}

useHead({ title: "Datos de facturación · Yacco" });

const session = useSession();
const api = useApi();
const isAdmin = computed(() => session.hasRole("ADMIN"));
const current = ref<IssuerSettings | null>(null);
const loading = ref(false);
const saving = ref(false);
const loadError = ref<string | null>(null);
const formError = ref<string | null>(null);
const notice = ref<string | null>(null);

const form = reactive<IssuerSettingsForm>({
  taxId: "",
  legalName: "",
  fiscalAddress: "",
  taxRate: "18.00",
  receiptDocumentThreshold: "700.00",
});

function fillForm(settings: IssuerSettings | null): void {
  form.taxId = settings?.taxId ?? "";
  form.legalName = settings?.legalName ?? "";
  form.fiscalAddress = settings?.fiscalAddress ?? "";
  form.taxRate = settings?.taxRate ?? "18.00";
  form.receiptDocumentThreshold = settings?.receiptDocumentThreshold ?? "700.00";
}

async function load(): Promise<void> {
  if (!isAdmin.value) return;
  loading.value = true;
  loadError.value = null;
  try {
    current.value = (await api.request<IssuerSettings | null>("/issuer-settings/current")) ?? null;
    fillForm(current.value);
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function normalizeDecimal(value: string, integerDigits: number): string | null {
  const match = new RegExp(`^(\\d{1,${integerDigits}})(?:\\.(\\d{1,2}))?$`).exec(value.trim());
  if (match === null) return null;
  return `${match[1]}.${(match[2] ?? "").padEnd(2, "0")}`;
}

async function save(): Promise<void> {
  if (saving.value) return;
  formError.value = null;
  notice.value = null;

  const errors: string[] = [];
  const taxId = form.taxId.trim();
  const legalName = form.legalName.trim();
  const fiscalAddress = form.fiscalAddress.trim();
  const taxRate = normalizeDecimal(form.taxRate, 3);
  const threshold = normalizeDecimal(form.receiptDocumentThreshold, 8);

  if (!/^\d{11}$/.test(taxId)) errors.push("El RUC debe tener 11 dígitos.");
  if (legalName === "") errors.push("Escribe la razón social.");
  if (fiscalAddress === "") errors.push("Escribe la dirección fiscal.");
  if (taxRate === null || threshold === null) {
    errors.push("La tasa y el monto se escriben con punto y dos decimales.");
  }
  if (errors.length > 0) {
    formError.value = errors.join(" ");
    return;
  }

  saving.value = true;
  try {
    current.value = await api.request<IssuerSettings>("/issuer-settings", {
      method: "POST",
      body: {
        taxId,
        legalName,
        fiscalAddress,
        taxRate,
        receiptDocumentThreshold: threshold,
      },
    });
    fillForm(current.value);
    notice.value = "Se guardó una nueva versión de los datos de facturación.";
  } catch (error) {
    formError.value = describeApiFailure(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppPage
    title="Datos de facturación"
    description="Información fiscal que queda asociada a cada comprobante registrado."
  >
    <UAlert
      v-if="!isAdmin"
      color="warning"
      variant="subtle"
      icon="i-lucide-lock-keyhole"
      title="Esta configuración es solo para administradores"
      description="El administrador conserva el historial fiscal con cada nueva versión."
    />

    <UPageBody v-else>
      <UPageCard
        role="region"
        aria-label="Versión vigente"
        description="La que usarán los próximos comprobantes."
      >
        <template #title><h2>Versión vigente</h2></template>

        <UAlert
          v-if="loadError"
          role="alert"
          color="error"
          variant="subtle"
          :title="loadError"
          :actions="[{ label: 'Reintentar', onClick: load }]"
        />
        <UAlert
          v-else-if="loading"
          role="status"
          color="neutral"
          variant="subtle"
          title="Cargando datos de facturación…"
        >
          <template #leading>
            <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" aria-hidden="true" />
          </template>
        </UAlert>
        <UAlert
          v-else-if="current === null"
          color="neutral"
          variant="soft"
          title="Todavía no hay datos de facturación"
          description="Completa el formulario para guardar la primera versión."
        />
        <template v-else>
          <UPageGrid>
            <UPageCard title="Empresa" :description="current.legalName" variant="soft">
              <p>RUC {{ current.taxId }}</p>
            </UPageCard>
            <UPageCard
              title="Dirección fiscal"
              :description="current.fiscalAddress"
              variant="soft"
            />
            <UPageCard title="IGV" :description="`${current.taxRate} %`" variant="soft" />
            <UPageCard
              title="Documento en boleta desde"
              :description="formatSoles(current.receiptDocumentThreshold)"
              variant="soft"
            />
          </UPageGrid>
          <p>
            Versión guardada por {{ current.createdBy.username }} ·
            {{ formatInstantInLima(current.createdAt) }}
          </p>
        </template>
      </UPageCard>

      <UPageCard
        description="La versión anterior queda en el historial de los comprobantes ya registrados."
      >
        <template #title><h2>Guardar una versión nueva</h2></template>

        <UForm :state="{}" :validate-on="[]" :loading-auto="false" novalidate @submit="save">
          <UAlert v-if="notice" role="status" color="success" variant="subtle" :title="notice" />
          <UAlert v-if="formError" role="alert" color="error" variant="subtle" :title="formError" />

          <UFormField label="RUC del emisor" required>
            <UInput
              v-model="form.taxId"
              inputmode="numeric"
              autocomplete="off"
              maxlength="11"
              :disabled="saving || loading"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Razón social" required>
            <UInput
              v-model="form.legalName"
              maxlength="200"
              :disabled="saving || loading"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Dirección fiscal" required>
            <UTextarea
              v-model="form.fiscalAddress"
              :rows="3"
              maxlength="500"
              :disabled="saving || loading"
              class="w-full"
            />
          </UFormField>
          <UPageGrid>
            <UFormField label="Tasa de IGV" help="Porcentaje; por ejemplo, 18.00" required>
              <UInput
                v-model="form.taxRate"
                inputmode="decimal"
                :disabled="saving || loading"
                class="w-full"
              >
                <template #trailing>%</template>
              </UInput>
            </UFormField>
            <UFormField
              label="Boleta exige documento desde"
              help="Monto final en soles; por ejemplo, 700.00"
              required
            >
              <UInput
                v-model="form.receiptDocumentThreshold"
                inputmode="decimal"
                :disabled="saving || loading"
                class="w-full"
              >
                <template #leading>S/</template>
              </UInput>
            </UFormField>
          </UPageGrid>

          <div class="flex justify-end gap-2">
            <UButton
              type="submit"
              icon="i-lucide-save"
              label="Guardar nueva versión"
              :loading="saving"
              :disabled="saving || loading"
            />
          </div>
        </UForm>
      </UPageCard>
    </UPageBody>
  </AppPage>
</template>
