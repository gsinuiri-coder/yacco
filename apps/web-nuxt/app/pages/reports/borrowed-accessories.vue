<script setup lang="ts">
import { formatInstantInLima } from "@yacco/shared";
import type { BorrowedAccessoryItem } from "@yacco/shared";

useHead({ title: "Accesorios prestados · Yacco" });

const api = useApi();
const rows = ref<BorrowedAccessoryItem[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const slow = useSlowRequest(loading);

const searchInput = ref("");

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    rows.value = await api.request<BorrowedAccessoryItem[]>("/accessories/borrowed-report");
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const filteredRows = computed(() => {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) return rows.value;
  return rows.value.filter(
    (row) =>
      row.customerName.toLowerCase().includes(query) ||
      row.locationName.toLowerCase().includes(query) ||
      row.productName.toLowerCase().includes(query),
  );
});

const totalQuantity = computed(() => rows.value.reduce((sum, r) => sum + r.quantity, 0));

const uniqueCustomersCount = computed(() => new Set(rows.value.map((r) => r.customerId)).size);

const byAccessory = computed(() => {
  const map = new Map<string, { name: string; quantity: number }>();
  for (const row of rows.value) {
    const existing = map.get(row.productId);
    if (existing) {
      existing.quantity += row.quantity;
    } else {
      map.set(row.productId, { name: row.productName, quantity: row.quantity });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.quantity - a.quantity);
});

const summary = computed(() => {
  if (loading.value) return "Cargando…";
  return `${totalQuantity.value} ${totalQuantity.value === 1 ? "accesorio prestado" : "accesorios prestados"} en ${uniqueCustomersCount.value} ${uniqueCustomersCount.value === 1 ? "cliente" : "clientes"}`;
});
</script>

<template>
  <AppPage title="Accesorios prestados" :description="summary">
    <div class="space-y-6">
      <UAlert
        v-if="slow && loading"
        role="status"
        color="neutral"
        variant="subtle"
        :title="SLOW_REQUEST_MESSAGE"
      />

      <ListStatus
        v-if="loadError || loading || rows.length === 0"
        :error-message="loadError"
        :loading="loading"
        :empty="rows.length === 0"
        loading-label="Cargando reporte de accesorios prestados…"
        empty-icon="i-lucide-archive"
        empty-title="Ningún cliente tiene accesorios prestados"
        empty-description="Aparecen aquí cuando se registran préstamos desde la ficha del cliente."
        @retry="load"
      />

      <div v-else class="space-y-6">
        <!-- Totales destacados -->
        <dl class="grid gap-3 p-4 bg-elevated rounded-lg sm:grid-cols-3">
          <StatTile label="Total prestado" :value="totalQuantity" />
          <StatTile
            v-for="item in byAccessory"
            :key="item.name"
            :label="item.name"
            :value="item.quantity"
          />
        </dl>

        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <div class="flex items-center gap-4 border-b border-default p-4">
            <UFormField label="Buscar" class="w-full sm:w-72">
              <UInput
                v-model="searchInput"
                type="search"
                icon="i-lucide-search"
                placeholder="Cliente, local o accesorio"
                class="w-full"
              />
            </UFormField>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <caption class="sr-only">
                Accesorios prestados por cliente y local
              </caption>
              <thead class="bg-elevated text-left text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" class="px-4 py-3 font-medium">Cliente</th>
                  <th scope="col" class="px-4 py-3 font-medium">Local</th>
                  <th scope="col" class="px-4 py-3 font-medium">Accesorio</th>
                  <th scope="col" class="px-4 py-3 text-right font-medium">Prestados</th>
                  <th scope="col" class="px-4 py-3 text-right font-medium">Último movimiento</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="row in filteredRows" :key="`${row.locationId}:${row.productId}`">
                  <td class="px-4 py-3 font-medium text-highlighted">
                    <NuxtLink
                      :to="`/customers/${row.customerId}`"
                      class="hover:text-primary underline"
                    >
                      {{ row.customerName }}
                    </NuxtLink>
                  </td>
                  <td class="px-4 py-3 text-muted">
                    {{ row.locationName }}
                  </td>
                  <td class="px-4 py-3 font-medium text-highlighted">
                    {{ row.productName }}
                  </td>
                  <td class="px-4 py-3 text-right font-semibold tabular-nums text-highlighted">
                    {{ row.quantity }}
                  </td>
                  <td class="px-4 py-3 text-right text-muted tabular-nums whitespace-nowrap">
                    {{ formatInstantInLima(row.lastMovementAt) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>
      </div>
    </div>
  </AppPage>
</template>
