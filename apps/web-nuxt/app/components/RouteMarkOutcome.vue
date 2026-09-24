<script setup lang="ts">
import { formatSoles } from "@yacco/shared";
import type { PaymentStatus, RouteStop } from "@yacco/shared";

/**
 * Lo que dejó registrado una parada, en el orden que le importa a la oficina:
 * la venta, el aviso de crédito, el cobro y los envases que quedan en poder del
 * cliente. Todo sale de la respuesta de la API; acá no se calcula nada.
 */
const props = defineProps<{ stopName: string; result: RouteStop }>();

const PAYMENT_NOTE: Record<PaymentStatus, string> = {
  CONFIRMED: "confirmado",
  PENDING: "queda por confirmar",
  REJECTED: "rechazado",
};

const summary = computed(() => {
  const { result, stopName } = props;
  if (result.status === "FAILED") {
    const reason = result.failureReason ? `: ${result.failureReason}` : "";
    return `La parada de ${stopName} quedó registrada como no entregada${reason}.`;
  }
  const sale = result.sale ? ` por ${formatSoles(result.sale.total)}` : "";
  const payment = result.payment
    ? `. Cobro de ${formatSoles(result.payment.amount)} (${PAYMENT_NOTE[result.payment.status]})`
    : ". No se cobró nada: queda al fiado";
  const balances = result.containerBalances ?? [];
  const containers =
    balances.length > 0
      ? ` Envases en poder del cliente: ${balances.map((balance) => `${balance.quantity} × ${balance.containerType.name}`).join(", ")}.`
      : "";
  return `Entrega de ${stopName} registrada${sale}${payment}.${containers}`;
});
</script>

<template>
  <div class="space-y-2">
    <UAlert
      role="status"
      :color="result.status === 'FAILED' ? 'neutral' : 'success'"
      variant="subtle"
      :icon="result.status === 'FAILED' ? 'i-lucide-circle-slash' : 'i-lucide-circle-check'"
      :title="summary"
    />
    <!-- HU-13 E2: la advertencia se muestra y nunca bloquea; para cuando se ve,
         la venta ya quedó registrada. -->
    <UAlert
      v-if="result.sale?.creditLimitExceeded"
      role="status"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="`Esta venta superó el límite de crédito de ${stopName}. Quedó registrada igual.`"
    />
    <!-- Supuesto 10: una corrección hacia arriba se registra aunque el camión no
         figurara con esos llenos; el saldo del camión queda negativo y acá se
         avisa. Lo típico detrás es una carga mal anotada. -->
    <UAlert
      v-for="line in result.stockShortfall ?? []"
      :key="line.containerTypeId"
      role="status"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="`Según lo cargado, el camión tenía ${line.available} × ${line.containerType.name} y se registraron ${line.requested}. Quedó registrado igual; revisá la carga de la ruta.`"
    />
  </div>
</template>
