<script setup lang="ts">
import type { NavigationMenuItem } from "@nuxt/ui";

const session = useSession();

const menus = computed(() =>
  visibleNavigation(session.user.value?.roles ?? []).map((section) => [
    { label: section.label, type: "label" as const },
    ...section.links.map<NavigationMenuItem>((link) => ({
      label: link.label,
      icon: link.icon,
      to: link.to,
      exact: link.to === "/",
    })),
  ]),
);
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar collapsible :ui="{ footer: 'border-t border-default' }">
      <template #header="{ collapsed }">
        <NuxtLink to="/" class="flex items-center gap-2" aria-label="Yacco, ir al panel">
          <span
            class="grid size-8 shrink-0 place-items-center rounded-md bg-primary font-display text-lg font-semibold text-inverted"
            aria-hidden="true"
            >Y</span
          >
          <span v-if="!collapsed" class="font-display text-lg font-semibold text-highlighted"
            >Yacco</span
          >
        </NuxtLink>
      </template>

      <template #default="{ collapsed }">
        <nav aria-label="Principal">
          <UNavigationMenu :collapsed="collapsed" :items="menus" orientation="vertical" highlight />
        </nav>
      </template>

      <template #footer="{ collapsed }">
        <ClientOnly>
          <div class="flex w-full items-center gap-2">
            <UAvatar
              :alt="session.user.value?.username"
              size="sm"
              class="bg-secondary-100 text-secondary-800"
            />
            <span v-if="!collapsed" class="min-w-0 flex-1 truncate text-sm font-medium">
              {{ session.user.value?.username }}
            </span>
            <UButton
              icon="i-lucide-log-out"
              color="neutral"
              variant="ghost"
              :aria-label="collapsed ? 'Cerrar sesión' : undefined"
              :label="collapsed ? undefined : 'Cerrar sesión'"
              @click="session.logout()"
            />
          </div>
        </ClientOnly>
      </template>
    </UDashboardSidebar>

    <!-- Los datos de cada pantalla son autenticados y se piden desde el
         cliente (D-022): el servidor entrega el marco y un estado de carga. -->
    <ClientOnly>
      <slot />
      <template #fallback>
        <UDashboardPanel>
          <template #body>
            <p role="status" class="text-muted">Cargando sesión…</p>
          </template>
        </UDashboardPanel>
      </template>
    </ClientOnly>
  </UDashboardGroup>
</template>
