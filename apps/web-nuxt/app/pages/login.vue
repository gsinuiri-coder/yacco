<script setup lang="ts">
definePageMeta({ public: true, layout: false });
useHead({ title: "Ingresar · Yacco" });

const nuxtApp = useNuxtApp();
const session = useSession();
const route = useRoute();

const username = ref("");
const password = ref("");
const errorMessage = ref<string | null>(null);
const submitting = ref(false);
const slow = useSlowRequest(submitting);

// El aviso de sesión vencida sólo si venció: nunca tras "Cerrar sesión".
const showExpired = computed(() => session.expired.value && errorMessage.value === null);

async function submit(): Promise<void> {
  errorMessage.value = null;
  if (username.value.trim() === "" || password.value === "") {
    errorMessage.value = "Ingresa usuario y contraseña.";
    return;
  }

  submitting.value = true;
  try {
    await session.login({ username: username.value.trim(), password: password.value });
  } catch (error) {
    // Un 401 no dice si el usuario existe (la API responde lo mismo a
    // propósito), así que tampoco lo dice la pantalla.
    errorMessage.value =
      error instanceof ApiError && error.status === 401
        ? "Usuario o contraseña incorrectos."
        : describeApiFailure(error);
    return;
  } finally {
    submitting.value = false;
  }
  await nuxtApp.runWithContext(() =>
    navigateTo(safeReturnPath(route.query.from), { replace: true }),
  );
}
</script>

<template>
  <div class="grid min-h-dvh lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
    <aside
      class="relative hidden overflow-hidden bg-primary-950 p-12 text-primary-50 lg:flex lg:flex-col lg:justify-between"
    >
      <p class="font-display text-2xl font-semibold tracking-tight">Yacco</p>

      <div class="relative z-10 max-w-md">
        <p class="font-display text-4xl leading-tight font-semibold text-white">
          Cada bidón que sale, vuelve contado.
        </p>
        <p class="mt-4 text-primary-200">
          Pedidos, rutas, cobranzas y envases de la planta, en un solo lugar.
        </p>
      </div>

      <svg
        class="pointer-events-none absolute inset-x-0 bottom-0 h-64 w-full text-primary-700/40"
        viewBox="0 0 600 240"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M0 120 C 100 90 200 150 300 120 S 500 90 600 120"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        />
        <path
          d="M0 160 C 100 130 200 190 300 160 S 500 130 600 160"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        />
        <path
          d="M0 200 C 100 170 200 230 300 200 S 500 170 600 200 L600 240 L0 240 Z"
          fill="currentColor"
        />
      </svg>
    </aside>

    <main class="flex items-center justify-center bg-default px-4 py-12 sm:px-8">
      <div class="w-full max-w-sm">
        <p class="font-display text-2xl font-semibold text-highlighted lg:hidden">Yacco</p>
        <h1 class="mt-6 text-3xl font-semibold text-highlighted lg:mt-0">Ingresar</h1>
        <p class="mt-2 text-muted">Con el usuario que te dio la planta.</p>

        <form class="mt-8 space-y-5" novalidate @submit.prevent="submit">
          <UAlert
            v-if="showExpired"
            role="status"
            color="info"
            variant="subtle"
            icon="i-lucide-clock"
            :title="SESSION_EXPIRED_MESSAGE"
          />
          <UAlert
            v-if="errorMessage"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="errorMessage"
          />
          <UAlert
            v-if="slow"
            role="status"
            color="neutral"
            variant="subtle"
            icon="i-lucide-loader"
            :title="SLOW_REQUEST_MESSAGE"
          />

          <UFormField label="Usuario" name="username">
            <UInput
              v-model="username"
              autocomplete="username"
              size="xl"
              class="w-full"
              :disabled="submitting"
            />
          </UFormField>

          <UFormField label="Contraseña" name="password">
            <UInput
              v-model="password"
              type="password"
              autocomplete="current-password"
              size="xl"
              class="w-full"
              :disabled="submitting"
            />
          </UFormField>

          <UButton
            type="submit"
            size="xl"
            block
            :loading="submitting"
            :label="submitting ? 'Ingresando…' : 'Ingresar'"
          />
        </form>
      </div>
    </main>
  </div>
</template>
