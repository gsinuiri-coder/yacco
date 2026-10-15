<script setup lang="ts">
import { formatInstantInLima } from "@yacco/shared";
import type {
  MaquilaBalanceItem,
  MaquilaCustomerSummary,
  MaquilaMovementItem,
  PaginatedMaquilaMovements,
} from "@yacco/shared";
import { positiveWhole } from "../utils/quantity";

const session = useSession();
const api = useApi();
const canFill = computed(
  () =>
    session.hasRole("ADMIN") ||
    session.hasRole("PLANT_SUPERVISOR") ||
    session.hasRole("PLANT_OPERATOR"),
);
const canVoid = computed(() => session.hasRole("ADMIN") || session.hasRole("PLANT_SUPERVISOR"));
const canViewReturns = computed(
  () =>
    session.hasRole("ADMIN") || session.hasRole("SELLER") || session.hasRole("PLANT_SUPERVISOR"),
);

const customers = ref<MaquilaCustomerSummary[]>([]);
const fillings = ref<MaquilaMovementItem[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const [custs, movs] = await Promise.all([
      api.request<MaquilaCustomerSummary[]>("/maquila/customers"),
      api.request<PaginatedMaquilaMovements>("/maquila/movements", {
        query: { type: "FILLED", limit: 20 },
      }),
    ]);
    customers.value = custs;
    fillings.value = movs.data;
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// --- Modal Llenar Maquila ---
const fillModalOpen = ref(false);
const selectedCustomerId = ref("");
const selectedContainerTypeId = ref("");
const fillQuantity = ref("1");
const fillSubmitting = ref(false);
const fillError = ref<string | null>(null);

const customersWithEmpties = computed(() => customers.value.filter((c) => c.emptyAtPlantTotal > 0));
const customersWithReturns = computed(() => customers.value.filter((c) => c.fullToReturnTotal > 0));

const selectedCustomer = computed(() =>
  customers.value.find((c) => c.customerId === selectedCustomerId.value),
);

const availableBalances = computed<MaquilaBalanceItem[]>(() => {
  if (!selectedCustomer.value) return [];
  return selectedCustomer.value.balances.filter((b) => b.emptyAtPlant > 0);
});

const selectedBalance = computed(() =>
  availableBalances.value.find((b) => b.containerTypeId === selectedContainerTypeId.value),
);

function openFillModal(): void {
  selectedCustomerId.value = customersWithEmpties.value[0]?.customerId ?? "";
  selectedContainerTypeId.value = availableBalances.value[0]?.containerTypeId ?? "";
  fillQuantity.value = "1";
  fillError.value = null;
  fillModalOpen.value = true;
}

watch(selectedCustomerId, () => {
  selectedContainerTypeId.value = availableBalances.value[0]?.containerTypeId ?? "";
});

async function submitFill(): Promise<void> {
  if (
    fillSubmitting.value ||
    !selectedCustomerId.value ||
    !selectedContainerTypeId.value ||
    !selectedBalance.value
  ) {
    return;
  }
  const qty = positiveWhole(fillQuantity.value);
  if (qty === null) {
    fillError.value = "La cantidad debe ser un número entero mayor que 0";
    return;
  }
  if (qty > selectedBalance.value.emptyAtPlant) {
    fillError.value = `No puedes llenar más de los vacíos en planta (${selectedBalance.value.emptyAtPlant})`;
    return;
  }

  fillSubmitting.value = true;
  fillError.value = null;
  try {
    await api.request("/maquila/fillings", {
      method: "POST",
      body: {
        customerId: selectedCustomerId.value,
        containerTypeId: selectedContainerTypeId.value,
        quantity: qty,
      },
    });
    fillModalOpen.value = false;
    await load();
  } catch (error) {
    fillError.value = describeApiFailure(error);
  } finally {
    fillSubmitting.value = false;
  }
}

// --- Modal Anular Llenado ---
const { openVoidModal, submitVoid, voidError, voidModalOpen, voidReason, voidSubmitting } =
  useMaquilaVoid(load);

function canVoidItem(mov: MaquilaMovementItem): boolean {
  if (!canVoid.value) return false;
  if (mov.reversesMovementId !== null) return false;
  if (mov.type.endsWith("_VOID")) return false;
  return !fillings.value.some((m) => m.reversesMovementId === mov.id);
}
</script>

<template>
  <SectionCard
    title="Maquila"
    description="Llenado en bidones del cliente. No forman parte del lote ni del stock de la planta."
  >
    <template #actions>
      <UButton
        v-if="canFill"
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-droplet"
        label="Llenar maquila"
        @click="openFillModal"
      />
    </template>

    <ListStatus
      v-if="loadError || loading"
      :error-message="loadError"
      :loading="loading"
      :empty="false"
      loading-label="Cargando maquila…"
      empty-title=""
      empty-description=""
      @retry="load"
    />

    <div v-else class="space-y-6">
      <!-- Clientes con vacíos en espera -->
      <div>
        <h3 class="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
          Vacíos de clientes en planta
        </h3>
        <p v-if="customersWithEmpties.length === 0" class="text-sm text-muted">
          No hay bidones vacíos de clientes pendientes de llenado en planta.
        </p>
        <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="c in customersWithEmpties"
            :key="c.customerId"
            class="rounded-md border border-default p-3 space-y-2"
          >
            <div class="flex items-center justify-between">
              <span class="font-medium text-highlighted">{{ c.customerName }}</span>
              <UBadge
                color="info"
                variant="subtle"
                size="xs"
                :label="`${c.emptyAtPlantTotal} vacíos`"
              />
            </div>
            <div class="flex flex-wrap gap-1 text-xs text-muted">
              <span
                v-for="b in c.balances.filter((x) => x.emptyAtPlant > 0)"
                :key="b.containerTypeId"
                class="rounded bg-elevated px-1.5 py-0.5"
              >
                {{ b.containerTypeName }}: {{ b.emptyAtPlant }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <section v-if="canViewReturns" aria-label="Llenos de maquila por devolver">
        <h3>Llenos de clientes por devolver</h3>
        <p v-if="customersWithReturns.length === 0">
          No hay bidones llenos de clientes pendientes de devolución.
        </p>
        <UPageGrid v-else>
          <UPageCard
            v-for="customer in customersWithReturns"
            :key="customer.customerId"
            :title="customer.customerName"
            :description="`${customer.fullToReturnTotal} llenos`"
            variant="subtle"
          >
            <p
              v-for="balance in customer.balances.filter((item) => item.fullToReturn > 0)"
              :key="balance.containerTypeId"
            >
              {{ balance.containerTypeName }}: {{ balance.fullToReturn }}
            </p>
          </UPageCard>
        </UPageGrid>
      </section>

      <!-- Llenados recientes -->
      <div>
        <h3 class="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
          Llenados registrados
        </h3>
        <p v-if="fillings.length === 0" class="text-sm text-muted">
          Todavía no hay llenados de maquila registrados.
        </p>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-elevated text-muted uppercase">
              <tr>
                <th scope="col" class="px-3 py-2 font-medium">Fecha</th>
                <th scope="col" class="px-3 py-2 font-medium">Cliente</th>
                <th scope="col" class="px-3 py-2 font-medium">Tipo de envase</th>
                <th scope="col" class="px-3 py-2 text-right font-medium">Cantidad</th>
                <th scope="col" class="px-3 py-2 font-medium">Registrado por</th>
                <th v-if="canVoid" scope="col" class="px-3 py-2 text-right">
                  <span class="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr v-for="m in fillings" :key="m.id">
                <td class="px-3 py-2 whitespace-nowrap text-muted">
                  {{ formatInstantInLima(m.occurredAt) }}
                </td>
                <td class="px-3 py-2 font-medium text-highlighted">{{ m.customerName }}</td>
                <td class="px-3 py-2">{{ m.containerTypeName }}</td>
                <td class="px-3 py-2 text-right font-medium tabular-nums">{{ m.quantity }}</td>
                <td class="px-3 py-2 text-muted">{{ m.recordedByName }}</td>
                <td v-if="canVoid" class="px-3 py-2 text-right">
                  <UButton
                    v-if="canVoidItem(m)"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-ban"
                    label="Anular"
                    @click="openVoidModal(m)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Modal Llenar Maquila -->
    <UModal v-model:open="fillModalOpen" title="Llenar bidones de maquila">
      <template #body>
        <form class="space-y-4" @submit.prevent="submitFill">
          <UAlert v-if="fillError" role="alert" color="error" variant="subtle" :title="fillError" />

          <UAlert
            v-if="customersWithEmpties.length === 0"
            color="warning"
            variant="subtle"
            icon="i-lucide-info"
            title="Sin vacíos en planta"
            description="Ningún cliente tiene bidones vacíos registrados en planta para llenar."
          />

          <template v-else>
            <UFormField label="Cliente" required>
              <USelect
                v-model="selectedCustomerId"
                :items="
                  customersWithEmpties.map((c) => ({ label: c.customerName, value: c.customerId }))
                "
                :disabled="fillSubmitting"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Tipo de envase" required>
              <USelect
                v-model="selectedContainerTypeId"
                :items="
                  availableBalances.map((b) => ({
                    label: `${b.containerTypeName} (${b.emptyAtPlant} vacíos en planta)`,
                    value: b.containerTypeId,
                  }))
                "
                :disabled="fillSubmitting"
                class="w-full"
              />
            </UFormField>

            <UFormField
              label="Cantidad a llenar"
              required
              :help="
                selectedBalance
                  ? `Máximo ${selectedBalance.emptyAtPlant} vacíos en planta`
                  : undefined
              "
            >
              <UInput
                v-model="fillQuantity"
                type="number"
                :min="1"
                :max="selectedBalance?.emptyAtPlant"
                :step="1"
                :disabled="fillSubmitting || !selectedBalance"
                class="w-full"
              />
            </UFormField>
          </template>

          <div class="flex justify-end gap-2 pt-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="fillSubmitting"
              @click="fillModalOpen = false"
            />
            <UButton
              type="submit"
              label="Registrar llenado"
              :loading="fillSubmitting"
              :disabled="customersWithEmpties.length === 0 || !selectedBalance"
            />
          </div>
        </form>
      </template>
    </UModal>

    <!-- Modal Anular Llenado -->
    <UModal v-model:open="voidModalOpen" title="Anular llenado de maquila">
      <template #body>
        <form class="space-y-4" @submit.prevent="submitVoid">
          <UAlert v-if="voidError" role="alert" color="error" variant="subtle" :title="voidError" />

          <p class="text-sm text-muted">
            La anulación emite un movimiento inverso de llenado, restaurando los vacíos en planta
            del cliente.
          </p>

          <UFormField label="Motivo de la anulación" required>
            <UInput
              v-model="voidReason"
              placeholder="Ej. Error de tipeo en la cantidad"
              :disabled="voidSubmitting"
              class="w-full"
            />
          </UFormField>

          <div class="flex justify-end gap-2 pt-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="voidSubmitting"
              @click="voidModalOpen = false"
            />
            <UButton type="submit" color="error" label="Anular llenado" :loading="voidSubmitting" />
          </div>
        </form>
      </template>
    </UModal>
  </SectionCard>
</template>
