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
    <section class="mx-auto flex w-full max-w-2xl flex-col gap-6 pt-10 sm:pt-20">
      <div>
        <p class="text-sm font-medium text-muted">{{ today }}</p>
        <h2 class="mt-1 text-3xl font-semibold text-highlighted sm:text-4xl">
          Hola, {{ session.user.value?.username }}
        </h2>
        <p v-if="isOffice" class="mt-2 text-muted">
          Busca un cliente por nombre o teléfono para abrir su ficha.
        </p>
      </div>
      <CustomerQuickSearch v-if="isOffice" />
      <RoleDashboardSummary v-if="hasSummary" />
      <PendingApprovalsCard v-if="session.hasRole('ADMIN')" />
      <UpcomingReviewsCard v-if="session.hasRole('ADMIN') || session.hasRole('SELLER')" />
      <SetupChecklistCard v-if="session.hasRole('ADMIN')" />
    </section>
  </AppPage>
</template>
