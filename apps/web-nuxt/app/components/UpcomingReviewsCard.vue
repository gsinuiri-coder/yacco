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
    <ul class="flex flex-col divide-y divide-default">
      <li
        v-for="alert in alerts"
        :key="`${alert.type}-${alert.targetId}-${alert.detail}`"
        class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5 first:pt-0 last:pb-0"
      >
        <div class="flex items-center gap-2">
          <UBadge
            :color="alert.status === 'VENCIDA' ? 'error' : 'warning'"
            variant="subtle"
            size="sm"
            :label="alert.status === 'VENCIDA' ? 'Vencida' : 'Por vencer'"
          />
          <div>
            <span class="font-medium text-highlighted">{{ alert.targetName }}</span>
            <span class="text-sm text-muted"> — {{ alert.detail }}</span>
          </div>
        </div>

        <div class="flex items-center gap-3 text-sm">
          <span class="text-muted tabular-nums">
            {{
              alert.daysRemaining < 0
                ? `Venció el ${formatCalendarDay(alert.expiresOn)}`
                : `Vence el ${formatCalendarDay(alert.expiresOn)}`
            }}
          </span>
          <NuxtLink
            :to="alert.type === 'VEHICLE_REVIEW' ? '/vehicles' : '/users'"
            class="font-medium text-primary hover:underline"
          >
            {{ alert.type === "VEHICLE_REVIEW" ? "Ver vehículo" : "Ver chofer" }}
          </NuxtLink>
        </div>
      </li>
    </ul>
  </SectionCard>
</template>
