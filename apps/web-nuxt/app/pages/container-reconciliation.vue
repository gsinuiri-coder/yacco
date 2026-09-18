<script setup lang="ts">
import { formatInstantInLima } from "@yacco/shared";
import type { ContainerReconciliation, ContainerReconciliationDiscrepancy } from "@yacco/shared";

/**
 * El cuadre de envases: dos cuentas INDEPENDIENTES del mismo hecho, hechas
 * por caminos distintos a propósito —el libro de movimientos, reconstruido
 * desde cero por una consulta aparte, contra el saldo que las pantallas
 * muestran. Que estén escritas por separado no es un detalle: si
 * compartieran función, el cuadre sólo probaría que algo coincide consigo
 * mismo. El resultado esperado es la lista vacía, así que ese estado se
 * muestra como buena noticia, no como una pantalla rota.
 *
 * Un saldo NEGATIVO en el que las dos cuentas coinciden no aparece acá, y no
 * es un olvido: significa una entrega sin registrar, un hallazgo real pero
 * no un descuadre de este cuadre.
 */
useHead({ title: "Cuadre de envases · Yacco" });

const session = useSession();
const api = useApi();
const isAdmin = computed(() => session.hasRole("ADMIN"));

const result = ref<ContainerReconciliation | null>(null);
const loading = ref(true);
const errorMessage = ref<string | null>(null);
const slow = useSlowRequest(loading);

async function check(): Promise<void> {
  if (!isAdmin.value) {
    loading.value = false;
    return;
  }
  loading.value = true;
  errorMessage.value = null;
  try {
    result.value = await api.request<ContainerReconciliation>("/container-reconciliation");
  } catch (error) {
    // El 403 de Nest es genérico; el resto llega con su propio mensaje.
    errorMessage.value =
      error instanceof ApiError && error.status === 403
        ? "Solo un administrador puede correr el cuadre de envases."
        : describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}
onMounted(check);

const subtitle = computed(() =>
  result.value === null
    ? "Compara el saldo de envases contra el libro de movimientos."
    : `Revisado el ${formatInstantInLima(result.value.checkedAt)}.`,
);

function describeDifference(discrepancy: ContainerReconciliationDiscrepancy): string {
  const gap = Math.abs(discrepancy.difference);
  const unidades = gap === 1 ? "envase" : "envases";
  return discrepancy.difference > 0
    ? `Al saldo le ${gap === 1 ? "falta" : "faltan"} ${gap} ${unidades}`
    : `El saldo tiene ${gap} ${unidades} de más`;
}
</script>

<template>
  <AppPage title="Cuadre de envases" :description="subtitle">
    <template #actions>
      <UButton
        v-if="isAdmin"
        color="neutral"
        variant="outline"
        icon="i-lucide-rotate-cw"
        :label="loading ? 'Revisando…' : 'Volver a revisar'"
        :disabled="loading"
        @click="check"
      />
    </template>

    <div v-if="!isAdmin" class="rounded-lg border border-default bg-default p-6">
      <p class="font-medium text-highlighted">Este cuadre es solo para administradores</p>
      <p class="mt-1 text-muted">
        Revisa el parque entero de envases y sirve para decidir si un saldo es confiable, así que lo
        corre el dueño de la planta.
      </p>
    </div>

    <div v-else class="space-y-6">
      <SectionCard title="Qué se compara">
        <div class="space-y-4">
          <p class="text-muted">
            Dos cuentas <strong class="text-highlighted">independientes</strong> del mismo hecho,
            hechas por caminos distintos a propósito:
          </p>
          <div class="grid gap-4 sm:grid-cols-2">
            <StatTile
              label="Según el libro"
              value="Lo que pasó"
              note="Cada entrega y cada devolución registrada, sumadas desde cero."
            />
            <StatTile
              label="Según el saldo"
              value="Lo que el sistema muestra"
              note="El número que ven las pantallas de envases y el estado de cuenta."
            />
          </div>
          <p class="text-muted">
            Si las dos coinciden, el saldo es confiable. Si no, acá se ve exactamente dónde. Este
            cuadre <strong class="text-highlighted">informa y no corrige</strong>: reparar en
            silencio borraría el rastro de lo que salió mal.
          </p>
          <p class="text-sm text-dimmed">
            Un saldo negativo en el que las dos cuentas coinciden no aparece acá: no es un descuadre
            sino una entrega que nunca se registró, y se ve en el saldo de envases del cliente.
          </p>
        </div>
      </SectionCard>

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <UAlert
          v-if="slow && loading"
          role="status"
          color="neutral"
          variant="subtle"
          class="rounded-none"
          :title="SLOW_REQUEST_MESSAGE"
        />

        <div v-if="errorMessage" class="flex flex-col items-start gap-3 p-6">
          <p class="font-medium text-highlighted">No se pudo correr el cuadre de envases</p>
          <p role="alert" class="text-muted">{{ errorMessage }}</p>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-rotate-cw"
            label="Reintentar"
            @click="check"
          />
        </div>
        <p v-else-if="loading" role="status" class="p-6 text-muted">
          Revisando el parque de envases…
        </p>
        <div
          v-else-if="result && result.discrepancies.length === 0"
          class="flex flex-col items-center gap-3 px-6 py-14 text-center"
        >
          <UIcon name="i-lucide-badge-check" class="size-8 text-success" aria-hidden="true" />
          <p class="font-medium text-highlighted">Las dos cuentas coinciden</p>
          <p class="max-w-md text-muted">
            Ninguna ubicación tiene un saldo de envases distinto del que se desprende de sus
            movimientos. El saldo que muestran las pantallas es confiable.
          </p>
        </div>
        <template v-else-if="result">
          <UAlert
            role="status"
            color="warning"
            variant="subtle"
            class="rounded-none"
            :title="
              result.discrepancyCount === 1
                ? 'Hay 1 saldo que no coincide con sus movimientos.'
                : `Hay ${result.discrepancyCount} saldos que no coinciden con sus movimientos.`
            "
            description="Nada se corrigió: esto es lo que hay que revisar."
          />
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <caption class="sr-only">
                Saldos de envases que no coinciden con el libro de movimientos
              </caption>
              <thead class="bg-elevated text-left text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" class="px-4 py-2 font-medium">Ubicación</th>
                  <th scope="col" class="px-4 py-2 font-medium">Tipo de envase</th>
                  <th scope="col" class="px-4 py-2 text-right font-medium">Según el libro</th>
                  <th scope="col" class="px-4 py-2 text-right font-medium">Según el saldo</th>
                  <th scope="col" class="px-4 py-2 font-medium">Diferencia</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr
                  v-for="discrepancy in result.discrepancies"
                  :key="`${discrepancy.locationId ?? 'sin-ubicacion'}-${discrepancy.containerTypeId}`"
                >
                  <td class="px-4 py-3">
                    <template v-if="discrepancy.locationName === null">
                      <p class="font-medium text-highlighted">Ubicación desconocida</p>
                      <!-- El nombre nulo ES el hallazgo: se muestra el id crudo porque es lo único que hay para rastrearlo. -->
                      <p class="text-muted">
                        {{ discrepancy.locationId ?? "el movimiento no indica ubicación" }}
                      </p>
                    </template>
                    <p v-else class="font-medium text-highlighted">
                      {{ discrepancy.locationName }}
                    </p>
                  </td>
                  <td class="px-4 py-3">
                    <template v-if="discrepancy.containerTypeName === null">
                      <p class="font-medium text-highlighted">Tipo de envase desconocido</p>
                      <p class="text-muted">{{ discrepancy.containerTypeId }}</p>
                    </template>
                    <span v-else>{{ discrepancy.containerTypeName }}</span>
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums">
                    {{ discrepancy.ledgerQuantity }}
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums">
                    {{ discrepancy.materializedQuantity }}
                  </td>
                  <td class="px-4 py-3">
                    <p class="font-semibold tabular-nums text-highlighted">
                      {{ formatDifference(discrepancy.difference) }}
                    </p>
                    <p class="text-muted">{{ describeDifference(discrepancy) }}</p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </UCard>
    </div>
  </AppPage>
</template>
