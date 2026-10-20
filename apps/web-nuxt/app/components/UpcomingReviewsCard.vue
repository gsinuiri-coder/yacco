<script setup lang="ts">
import { formatCalendarDay } from "@yacco/shared";
import type { UpcomingReviewAlert } from "@yacco/shared";

const api = useApi();
const alerts = ref<UpcomingReviewAlert[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    alerts.value = await api.request<UpcomingReviewAlert[]>("/vehicles/upcoming-reviews");
  } catch {
    alerts.value = [];
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <SectionCard
    v-if="!loading && alerts.length > 0"
    title="Revisiones por vencer"
    description="Revisiones técnicas, SOAT y licencias de conducir por vencer o vencidas."
  >
    <UPageList as="ul" divide>
      <UPageCard
        v-for="alert in alerts"
        :key="`${alert.type}-${alert.targetId}-${alert.detail}`"
        as="li"
        variant="naked"
        orientation="horizontal"
        :description="
          alert.daysRemaining < 0
            ? `Venció el ${formatCalendarDay(alert.expiresOn)}`
            : `Vence el ${formatCalendarDay(alert.expiresOn)}`
        "
      >
        <template #leading>
          <UBadge
            :color="alert.status === 'VENCIDA' ? 'error' : 'warning'"
            variant="subtle"
            size="sm"
            :label="alert.status === 'VENCIDA' ? 'Vencida' : 'Por vencer'"
          />
        </template>
        <template #title>
          {{ alert.targetName }}<span> — {{ alert.detail }}</span>
        </template>

        <UButton
          :to="alert.type === 'VEHICLE_REVIEW' ? '/vehicles' : '/users'"
          variant="link"
          :label="alert.type === 'VEHICLE_REVIEW' ? 'Ver vehículo' : 'Ver chofer'"
        />
      </UPageCard>
    </UPageList>
  </SectionCard>
</template>
