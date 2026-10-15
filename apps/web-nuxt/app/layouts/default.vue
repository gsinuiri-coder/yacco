<script setup lang="ts">
import type { NavigationMenuItem } from "@nuxt/ui";

const session = useSession();

// El servidor no conoce la sesión (D-022), así que no dibuja el menú. El
// primer render del cliente tiene que ser IDÉNTICO o Vue avisa «Hydration
// completed but contains mismatches» (el nodo era «Cuadre de envases», solo
// ADMIN). El menú, que depende del rol, aparece recién después de montar: así
// tampoco se le muestra un instante el menú de la oficina a un chofer.
const mounted = ref(false);
onMounted(() => {
  mounted.value = true;
});

const menus = computed(() =>
  (mounted.value ? visibleNavigation(session.user.value?.roles ?? []) : []).map((section) => [
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
    <UDashboardSidebar collapsible :default-size="20">
      <template #header="{ collapsed }">
        <UButton
          to="/"
          icon="i-lucide-droplets"
          :label="collapsed ? undefined : 'Yacco'"
          aria-label="Yacco, ir al panel"
          color="neutral"
          variant="ghost"
          size="xl"
          :square="collapsed"
        />
      </template>

      <template #default="{ collapsed }">
        <nav aria-label="Principal">
          <UNavigationMenu :collapsed="collapsed" :items="menus" orientation="vertical" highlight />
        </nav>
      </template>

      <template #footer="{ collapsed }">
        <ClientOnly>
          <UUser
            v-if="!collapsed"
            :name="session.user.value?.username"
            :avatar="{ alt: session.user.value?.username }"
            size="sm"
          />
          <UButton
            icon="i-lucide-log-out"
            color="neutral"
            variant="ghost"
            :aria-label="collapsed ? 'Cerrar sesión' : undefined"
            :label="collapsed ? undefined : 'Cerrar sesión'"
            :square="collapsed"
            @click="session.logout()"
          />
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
            <UAlert
              role="status"
              title="Cargando sesión…"
              icon="i-lucide-loader-circle"
              color="neutral"
              variant="soft"
            />
          </template>
        </UDashboardPanel>
      </template>
    </ClientOnly>
  </UDashboardGroup>
</template>
