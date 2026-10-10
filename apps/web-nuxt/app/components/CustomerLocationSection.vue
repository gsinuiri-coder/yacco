<script setup lang="ts">
import type { Customer } from "@yacco/shared";

const props = defineProps<{ customer: Customer }>();
const emit = defineEmits<{ updated: [customer: Customer] }>();

const api = useApi();
const contactName = ref(props.customer.contactName ?? "");
const locationInput = ref(
  props.customer.latitude === null || props.customer.longitude === null
    ? ""
    : `${props.customer.latitude}, ${props.customer.longitude}`,
);
const submitting = ref(false);
const submitError = ref<string | null>(null);
const saved = ref(false);

const mapsUrl = computed(() =>
  props.customer.latitude === null || props.customer.longitude === null
    ? null
    : googleMapsLocationUrl(props.customer.latitude, props.customer.longitude),
);

async function save(): Promise<void> {
  if (submitting.value) return;
  const location = locationInput.value.trim();
  const coordinates = location === "" ? null : parseLocationCoordinates(location);
  if (location !== "" && coordinates === null) {
    submitError.value =
      "Pega un enlace de Google Maps con coordenadas o escribe latitud, longitud.";
    saved.value = false;
    return;
  }

  submitting.value = true;
  submitError.value = null;
  saved.value = false;
  try {
    const updated = await api.request<Customer>(`/customers/${props.customer.id}`, {
      method: "PATCH",
      body: {
        contactName: contactName.value.trim() || null,
        latitude: coordinates?.latitude ?? null,
        longitude: coordinates?.longitude ?? null,
      },
    });
    contactName.value = updated.contactName ?? "";
    locationInput.value =
      updated.latitude === null || updated.longitude === null
        ? ""
        : `${updated.latitude}, ${updated.longitude}`;
    saved.value = true;
    emit("updated", updated);
  } catch (error) {
    submitError.value = describeApiFailure(error);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <SectionCard
    title="Contacto y ubicación"
    description="Datos del local principal para preparar y hacer el reparto."
  >
    <form class="space-y-4" novalidate @submit.prevent="save">
      <UAlert v-if="submitError" role="alert" color="error" variant="subtle" :title="submitError" />
      <UAlert
        v-if="saved"
        role="status"
        color="success"
        variant="subtle"
        icon="i-lucide-circle-check"
        title="Contacto y ubicación guardados."
      />

      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField label="Persona que recibe (opcional)" name="contactName">
          <UInput
            v-model="contactName"
            autocomplete="name"
            placeholder="Ej. Rosa Quispe"
            :disabled="submitting"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Enlace de Google Maps o coordenadas" name="locationCoordinates">
          <UInput
            v-model="locationInput"
            placeholder="-12.046374, -77.042793"
            :disabled="submitting"
            class="w-full"
          />
        </UFormField>
      </div>

      <p class="text-sm text-muted">
        Pega el enlace que muestra las coordenadas o escríbelas como latitud, longitud.
      </p>
      <div class="flex flex-wrap gap-2">
        <UButton
          type="submit"
          icon="i-lucide-map-pin-check"
          :loading="submitting"
          :label="submitting ? 'Guardando…' : 'Guardar contacto y ubicación'"
        />
        <UButton
          v-if="mapsUrl"
          :to="mapsUrl"
          target="_blank"
          rel="noopener noreferrer"
          external
          color="neutral"
          variant="outline"
          icon="i-lucide-map"
          label="Abrir en Maps"
        />
      </div>
    </form>
  </SectionCard>
</template>
