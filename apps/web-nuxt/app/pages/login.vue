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

// Antes de hidratar el formulario no tiene manejador: un clic en «Ingresar»
// hacía el envío NATIVO del navegador, un GET que dejaba usuario y contraseña
// en la URL (historial, logs) y recargaba la página como si el clic no hubiera
// tomado. El botón espera a que la página esté lista, y `method="post"` cubre
// el Enter: aun sin JavaScript, la contraseña nunca viaja en la URL.
const ready = ref(false);
onMounted(() => {
  ready.value = true;
});

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
  <UMain>
    <!-- `reverse`: el lema a la izquierda y el formulario a la derecha, como antes. -->
    <UPageHero
      orientation="horizontal"
      reverse
      headline="Yacco"
      title="Ingresar"
      description="Con el usuario que te dio la planta."
    >
      <template #body>
        <UForm
          method="post"
          :state="{}"
          :validate-on="[]"
          :loading-auto="false"
          novalidate
          @submit="submit"
        >
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
            :disabled="!ready"
            :label="submitting ? 'Ingresando…' : 'Ingresar'"
          />
        </UForm>
      </template>

      <UPageCard
        variant="solid"
        title="Cada bidón que sale, vuelve contado."
        description="Pedidos, rutas, cobranzas y envases de la planta, en un solo lugar."
        class="hidden lg:flex"
      />
    </UPageHero>
  </UMain>
</template>
