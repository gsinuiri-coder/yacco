<script setup lang="ts">
import { formatCalendarDay, limaToday } from "@yacco/shared";

useHead({ title: "Panel · Yacco" });

const session = useSession();
const today = formatCalendarDay(limaToday());
// Buscar clientes es trabajo de la oficina: la API no le abre clientes a la planta.
const isOffice = computed(() => session.hasRole("ADMIN") || session.hasRole("SELLER"));
const hasSummary = computed(
  () => isOffice.value || session.hasRole("PLANT_SUPERVISOR") || session.hasRole("PLANT_OPERATOR"),
);
</script>

<template>
  <AppPage title="Panel">
    <UPageBody class="mx-auto w-full max-w-2xl">
      <UPageCard
        variant="naked"
        :description="
          isOffice ? 'Busca un cliente por nombre o teléfono para abrir su ficha.' : undefined
        "
      >
        <template #header>{{ today }}</template>
        <template #title>
          <h2>Hola, {{ session.user.value?.username }}</h2>
        </template>
      </UPageCard>
      <CustomerQuickSearch v-if="isOffice" />
      <RoleDashboardSummary v-if="hasSummary" />
      <PendingApprovalsCard v-if="session.hasRole('ADMIN')" />
      <UpcomingReviewsCard v-if="session.hasRole('ADMIN') || session.hasRole('SELLER')" />
      <SetupChecklistCard v-if="session.hasRole('ADMIN')" />
    </UPageBody>
  </AppPage>
</template>
