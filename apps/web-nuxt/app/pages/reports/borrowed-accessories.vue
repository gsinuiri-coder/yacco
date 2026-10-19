<script setup lang="ts">
import { formatInstantInLima } from "@yacco/shared";
import type { BorrowedAccessoryItem } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";

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

const borrowedColumns: TableColumn<BorrowedAccessoryItem>[] = [
  { id: "customer", header: "Cliente" },
  { accessorKey: "locationName", header: "Local" },
  { accessorKey: "productName", header: "Accesorio" },
  { accessorKey: "quantity", header: "Prestados", meta: RIGHT_ALIGNED },
  { id: "lastMovementAt", header: "Último movimiento", meta: RIGHT_ALIGNED },
];
</script>

<template>
  <AppPage title="Accesorios prestados" :description="summary">
    <UPageBody>
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

      <template v-else>
        <!-- Totales destacados. UPageGrid como `dl`: StatTile pinta dt/dd. -->
        <UPageGrid as="dl">
          <StatTile label="Total prestado" :value="totalQuantity" />
          <StatTile
            v-for="item in byAccessory"
            :key="item.name"
            :label="item.name"
            :value="item.quantity"
          />
        </UPageGrid>

        <UCard>
          <template #header>
            <UPageGrid>
              <UFormField label="Buscar">
                <UInput
                  v-model="searchInput"
                  type="search"
                  icon="i-lucide-search"
                  placeholder="Cliente, local o accesorio"
                  class="w-full"
                />
              </UFormField>
            </UPageGrid>
          </template>

          <UTable
            :data="filteredRows"
            :columns="borrowedColumns"
            caption="Accesorios prestados por cliente y local"
          >
            <template #customer-cell="{ row }">
              <ULink :to="`/customers/${row.original.customerId}`">
                {{ row.original.customerName }}
              </ULink>
            </template>
            <template #lastMovementAt-cell="{ row }">
              {{ formatInstantInLima(row.original.lastMovementAt) }}
            </template>
          </UTable>
        </UCard>
      </template>
    </UPageBody>
  </AppPage>
</template>
