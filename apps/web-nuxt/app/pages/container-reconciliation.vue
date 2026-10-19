<script setup lang="ts">
import { formatInstantInLima } from "@yacco/shared";
import type { ContainerReconciliation, ContainerReconciliationDiscrepancy } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";

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

const columns: TableColumn<ContainerReconciliationDiscrepancy>[] = [
  { id: "location", header: "Ubicación" },
  { id: "containerType", header: "Tipo de envase" },
  { accessorKey: "ledgerQuantity", header: "Según el libro", meta: RIGHT_ALIGNED },
  { accessorKey: "materializedQuantity", header: "Según el saldo", meta: RIGHT_ALIGNED },
  { id: "difference", header: "Diferencia" },
];
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

    <UEmpty
      v-if="!isAdmin"
      icon="i-lucide-lock"
      title="Este cuadre es solo para administradores"
      description="Revisa todos los envases de la planta y sirve para decidir si un saldo es confiable, así que lo corre el dueño de la planta."
    />

    <UPageBody v-else>
      <SectionCard title="Qué se compara">
        <UPageBody>
          <p>
            Dos cuentas <strong>independientes</strong> del mismo hecho, hechas por caminos
            distintos a propósito:
          </p>
          <UPageGrid>
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
          </UPageGrid>
          <p>
            Si las dos coinciden, el saldo es confiable. Si no, acá se ve exactamente dónde. Este
            cuadre <strong>informa y no corrige</strong>: reparar en silencio borraría el rastro de
            lo que salió mal.
          </p>
          <p>
            Un saldo negativo en el que las dos cuentas coinciden no aparece acá: no es un descuadre
            sino una entrega que nunca se registró, y se ve en el saldo de envases del cliente.
          </p>
        </UPageBody>
      </SectionCard>

      <UCard>
        <UAlert
          v-if="slow && loading"
          role="status"
          color="neutral"
          variant="subtle"
          :title="SLOW_REQUEST_MESSAGE"
        />

        <ListStatus
          v-if="errorMessage || loading"
          :error-message="errorMessage"
          :loading="loading"
          :empty="false"
          loading-label="Revisando los envases de la planta…"
          error-title="No se pudo correr el cuadre de envases"
          empty-title=""
          empty-description=""
          @retry="check"
        />
        <UEmpty
          v-else-if="result && result.discrepancies.length === 0"
          icon="i-lucide-badge-check"
          title="Las dos cuentas coinciden"
          description="Ninguna ubicación tiene un saldo de envases distinto del que se desprende de sus movimientos. El saldo que muestran las pantallas es confiable."
        />
        <UPageBody v-else-if="result">
          <UAlert
            role="status"
            color="warning"
            variant="subtle"
            :title="
              result.discrepancyCount === 1
                ? 'Hay 1 saldo que no coincide con sus movimientos.'
                : `Hay ${result.discrepancyCount} saldos que no coinciden con sus movimientos.`
            "
            description="Nada se corrigió: esto es lo que hay que revisar."
          />
          <UTable
            :data="result.discrepancies"
            :columns="columns"
            caption="Saldos de envases que no coinciden con el libro de movimientos"
          >
            <template #location-cell="{ row }">
              <!-- El nombre nulo ES el hallazgo: se muestra el id crudo porque es lo único que hay para rastrearlo. -->
              <UUser
                v-if="row.original.locationName === null"
                name="Ubicación desconocida"
                :description="row.original.locationId ?? 'el movimiento no indica ubicación'"
              />
              <UUser v-else :name="row.original.locationName" />
            </template>
            <template #containerType-cell="{ row }">
              <UUser
                v-if="row.original.containerTypeName === null"
                name="Tipo de envase desconocido"
                :description="row.original.containerTypeId"
              />
              <template v-else>{{ row.original.containerTypeName }}</template>
            </template>
            <template #difference-cell="{ row }">
              <UUser
                :name="formatDifference(row.original.difference)"
                :description="describeDifference(row.original)"
              />
            </template>
          </UTable>
        </UPageBody>
      </UCard>
    </UPageBody>
  </AppPage>
</template>
