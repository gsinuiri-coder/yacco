<script setup lang="ts">
import { formatSoles, isAboveZero, isMoneyInput } from "@yacco/shared";
import type { CreateOfficePaymentResult, PaymentMethod } from "@yacco/shared";

/**
 * Cobranza de oficina (HU-18): un pago fuera de ruta contra POST /payments.
 *
 * No mira `requiresConfirmation`: un cobro de oficina se escribe siempre
 * CONFIRMED (ver packages/shared/src/payments.ts). Avisar "quedará pendiente"
 * para Yape o transferencia describiría un estado que este endpoint no produce.
 */
const props = defineProps<{ customerId: string }>();
const emit = defineEmits<{ registered: [debtBalance: string] }>();

const api = useApi();

const methods = ref<PaymentMethod[]>([]);
const loadingMethods = ref(true);
const loadError = ref<string | null>(null);

async function loadMethods(): Promise<void> {
  loadingMethods.value = true;
  loadError.value = null;
  try {
    methods.value = await api.request<PaymentMethod[]>("/payment-methods");
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loadingMethods.value = false;
  }
}
onMounted(loadMethods);

const methodId = ref<string | undefined>(undefined);
const amount = ref("");
const submitting = ref(false);
const submitError = ref<string | null>(null);
const result = ref<Pick<CreateOfficePaymentResult, "debtBalance" | "exceedsDebt"> | null>(null);

/**
 * Una clave por intento. Un reintento IDÉNTICO tras un error de red la reusa,
 * así el segundo POST no duplica el cobro si el primero sí llegó a escribir.
 * Cambiar método o monto después de un fallo es otro cobro: clave nueva, o la
 * API respondería 409.
 */
const idempotencyKey = ref(crypto.randomUUID());
watch([methodId, amount], () => {
  if (submitError.value !== null) {
    submitError.value = null;
    idempotencyKey.value = crypto.randomUUID();
  }
});

const methodItems = computed(() =>
  methods.value.map((method) => ({ label: method.name, value: method.id })),
);

function describeFailure(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return (
      "Este cobro no se pudo registrar porque ya se había intentado antes con otro cliente " +
      "o otro monto. Revisa el historial de pagos antes de volver a intentarlo."
    );
  }
  return describeApiFailure(error);
}

async function submit(): Promise<void> {
  if (submitting.value) return;
  if (methodId.value === undefined) {
    submitError.value = "Elige un método de pago";
    return;
  }
  const value = amount.value.trim();
  if (!isMoneyInput(value) || !isAboveZero(value)) {
    submitError.value = 'El monto debe ser un valor válido y mayor que 0, como "12.50"';
    return;
  }

  submitting.value = true;
  submitError.value = null;
  try {
    const response = await api.request<CreateOfficePaymentResult>("/payments", {
      method: "POST",
      body: {
        customerId: props.customerId,
        paymentMethodId: methodId.value,
        amount: value,
        idempotencyKey: idempotencyKey.value,
      },
    });
    result.value = { debtBalance: response.debtBalance, exceedsDebt: response.exceedsDebt };
    emit("registered", response.debtBalance);
    amount.value = "";
    idempotencyKey.value = crypto.randomUUID();
  } catch (error) {
    submitError.value = describeFailure(error);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <SectionCard title="Registrar cobro" description="Un pago que llega a la oficina, fuera de ruta.">
    <ListStatus
      v-if="loadError || loadingMethods || methods.length === 0"
      :error-message="loadError"
      :loading="loadingMethods"
      :empty="methods.length === 0"
      loading-label="Cargando métodos de pago…"
      error-title="No se pudieron cargar los métodos de pago"
      empty-icon="i-lucide-wallet"
      empty-title="No hay métodos de pago activos"
      empty-description="Pídele a un administrador que revise el catálogo antes de registrar un cobro."
      @retry="loadMethods"
    />

    <form v-else class="space-y-4" novalidate @submit.prevent="submit">
      <UAlert v-if="submitError" role="alert" color="error" variant="subtle" :title="submitError" />
      <UAlert
        v-if="result"
        role="status"
        color="success"
        variant="subtle"
        icon="i-lucide-circle-check"
        :title="
          result.exceedsDebt
            ? `Cobro registrado. El cliente queda con saldo a favor de ${formatSoles(result.debtBalance.replace(/^-/, ''))}.`
            : `Cobro registrado. Deuda actual: ${formatSoles(result.debtBalance)}.`
        "
      />

      <div class="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <UFormField label="Método de pago" name="paymentMethod">
          <USelect
            v-model="methodId"
            :items="methodItems"
            placeholder="Selecciona un método"
            :disabled="submitting"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Monto" name="paymentAmount">
          <UInput
            v-model="amount"
            inputmode="decimal"
            placeholder="12.50"
            :disabled="submitting"
            class="w-full"
          >
            <template #leading><span class="text-sm text-muted">S/</span></template>
          </UInput>
        </UFormField>
        <UButton
          type="submit"
          icon="i-lucide-hand-coins"
          :loading="submitting"
          :label="submitting ? 'Registrando…' : 'Registrar cobro'"
        />
      </div>
    </form>
  </SectionCard>
</template>
