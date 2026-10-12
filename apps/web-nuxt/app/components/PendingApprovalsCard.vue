<script setup lang="ts">
import type { CustomerLocationCoordinateRequest, CustomerLocationPhoto } from "@yacco/shared";

interface PendingApprovalsData {
  photos: CustomerLocationPhoto[];
  coordinateRequests: CustomerLocationCoordinateRequest[];
}

const api = useApi();
const photosCount = ref(0);
const coordinatesCount = ref(0);
const loading = ref(true);

onMounted(async () => {
  try {
    const res = await api.request<PendingApprovalsData>("/pending-approvals");
    photosCount.value = res.photos.length;
    coordinatesCount.value = res.coordinateRequests.length;
  } catch {
    photosCount.value = 0;
    coordinatesCount.value = 0;
  } finally {
    loading.value = false;
  }
});

const totalPending = computed(() => photosCount.value + coordinatesCount.value);
</script>

<template>
  <SectionCard
    v-if="!loading && totalPending > 0"
    title="Por aprobar"
    description="Solicitudes enviadas por los choferes desde el reparto que requieren validación."
  >
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge
          v-if="photosCount > 0"
          color="warning"
          variant="subtle"
          size="md"
          :label="`${photosCount} ${photosCount === 1 ? 'foto' : 'fotos'} por revisar`"
        />
        <UBadge
          v-if="coordinatesCount > 0"
          color="info"
          variant="subtle"
          size="md"
          :label="`${coordinatesCount} ${coordinatesCount === 1 ? 'ubicación' : 'ubicaciones'} por revisar`"
        />
      </div>

      <NuxtLink
        to="/pending-approvals"
        class="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <span>Revisar solicitudes</span>
        <UIcon name="i-lucide-arrow-right" class="size-4" />
      </NuxtLink>
    </div>
  </SectionCard>
</template>
