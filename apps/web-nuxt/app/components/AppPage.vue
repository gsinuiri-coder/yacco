<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
}>();
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar :title="title">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <slot name="actions" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UDashboardToolbar v-if="description">
        {{ description }}
      </UDashboardToolbar>
      <slot />
    </template>
  </UDashboardPanel>
</template>
