<script setup lang="ts">
import type { PaymentActionResult, PaymentRow } from "@yacco/shared";

/**
 * El rechazo exige motivo (RejectPaymentDto): se pide acá, antes de llamar, en
 * vez de dejar que el 400 sea la primera noticia.
 */
const props = defineProps<{ payment: PaymentRow }>();
const emit = defineEmits<{
  cancel: [];
  rejected: [result: PaymentActionResult];
  /** 409 (ya no está pendiente) o 404 (ya no existe): la bandeja avisa y recarga. */
  stale: [message: string];
}>();

const api = useApi();
const reason = ref("");
const submitting = ref(false);
const error = ref<string | null>(null);

watch(reason, () => {
  error.value = null;
});

async function submit(): Promise<void> {
  if (submitting.value) return;
  const text = reason.value.trim();
  if (text === "") {
    error.value = "Escribe el motivo del rechazo";
    return;
  }
  submitting.value = true;
  error.value = null;
  try {
    const result = await api.request<PaymentActionResult>(`/payments/${props.payment.id}/reject`, {
      method: "POST",
      body: { reason: text },
    });
    emit("rejected", result);
  } catch (caught) {
    // Otro administrador lo resolvió entre que se abrió esta fila y el envío.
    const stale = paymentStaleMessage(caught);
    if (stale !== null) {
      emit("stale", stale);
      return;
    }
    error.value = paymentActionFailure(caught, "rechazar");
    submitting.value = false;
  }
}
</script>

<template>
  <form
    class="space-y-3 rounded-md bg-elevated p-4"
    novalidate
    :aria-label="`Rechazar pago de ${payment.customer.name}`"
    @submit.prevent="submit"
  >
    <UFormField label="Motivo del rechazo">
      <UTextarea
        v-model="reason"
        :rows="2"
        autoresize
        placeholder="El Yape no llegó a la cuenta"
        :disabled="submitting"
        class="w-full"
      />
    </UFormField>
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" />
    <div class="flex justify-end gap-2">
      <UButton
        color="neutral"
        variant="outline"
        label="Cancelar"
        :disabled="submitting"
        @click="emit('cancel')"
      />
      <UButton
        type="submit"
        color="error"
        :disabled="submitting"
        :label="submitting ? 'Rechazando…' : 'Confirmar rechazo'"
      />
    </div>
  </form>
</template>
