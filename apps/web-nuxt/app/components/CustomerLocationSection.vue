<script setup lang="ts">
import type {
  CustomerLocation,
  GoogleMapsLinkResolution,
  UpdateCustomerLocationBody,
} from "@yacco/shared";

interface LocationDraft {
  location: CustomerLocation;
  contactName: string;
  locationInput: string;
  submitting: boolean;
  submitError: string | null;
  saved: boolean;
}

const props = defineProps<{ customerId: string }>();
const api = useApi();
const drafts = ref<LocationDraft[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

function toDraft(location: CustomerLocation): LocationDraft {
  return {
    location,
    contactName: location.contactName ?? "",
    locationInput:
      location.latitude === null || location.longitude === null
        ? ""
        : `${location.latitude}, ${location.longitude}`,
    submitting: false,
    submitError: null,
    saved: false,
  };
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const locations = await api.request<CustomerLocation[]>(
      `/customers/${props.customerId}/locations`,
    );
    drafts.value = locations.map(toDraft);
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function coordinatesFrom(input: string) {
  const direct = parseLocationCoordinates(input);
  if (direct !== null || !isGoogleMapsShortUrl(input)) return direct;
  const resolution = await api.request<GoogleMapsLinkResolution>(
    `/customers/${props.customerId}/locations/google-maps-link-resolutions`,
    { method: "POST", body: { url: input } },
  );
  return parseLocationCoordinates(resolution.url);
}

async function save(draft: LocationDraft): Promise<void> {
  if (draft.submitting) return;
  draft.submitting = true;
  draft.submitError = null;
  draft.saved = false;
  try {
    const input = draft.locationInput.trim();
    const coordinates = input === "" ? null : await coordinatesFrom(input);
    if (input !== "" && coordinates === null) {
      draft.submitError =
        "Pega un enlace de Google Maps con coordenadas o escribe latitud, longitud.";
      return;
    }
    const body: UpdateCustomerLocationBody = {
      contactName: draft.contactName.trim() || null,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
    };
    const updated = await api.request<CustomerLocation>(
      `/customers/${props.customerId}/locations/${draft.location.id}`,
      { method: "PATCH", body },
    );
    draft.location = { ...draft.location, ...updated };
    draft.contactName = draft.location.contactName ?? "";
    draft.locationInput =
      draft.location.latitude === null || draft.location.longitude === null
        ? ""
        : `${draft.location.latitude}, ${draft.location.longitude}`;
    draft.saved = true;
  } catch (error) {
    draft.submitError = describeApiFailure(error);
  } finally {
    draft.submitting = false;
  }
}

function mapsUrl(draft: LocationDraft): string | null {
  const { latitude, longitude } = draft.location;
  return latitude === null || longitude === null
    ? null
    : googleMapsLocationUrl(latitude, longitude);
}
</script>

<template>
  <SectionCard
    title="Contacto y ubicación"
    description="Datos de cada local para preparar y hacer el reparto."
  >
    <ListStatus
      v-if="loadError || loading || drafts.length === 0"
      :error-message="loadError"
      :loading="loading"
      :empty="drafts.length === 0"
      loading-label="Cargando locales…"
      empty-icon="i-lucide-map-pin-off"
      empty-title="Sin locales"
      empty-description="Este cliente no tiene locales activos."
      @retry="load"
    />

    <div v-else class="divide-y divide-default">
      <fieldset v-for="draft in drafts" :key="draft.location.id" class="py-5 first:pt-0 last:pb-0">
        <legend class="mb-3 font-medium text-highlighted">{{ draft.location.name }}</legend>
        <form class="space-y-4" novalidate @submit.prevent="save(draft)">
          <UAlert
            v-if="draft.submitError"
            role="alert"
            color="error"
            variant="subtle"
            :title="draft.submitError"
          />
          <UAlert
            v-if="draft.saved"
            role="status"
            color="success"
            variant="subtle"
            icon="i-lucide-circle-check"
            title="Contacto y ubicación guardados."
          />

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField
              label="Persona que recibe (opcional)"
              :name="`contactName-${draft.location.id}`"
            >
              <UInput
                v-model="draft.contactName"
                autocomplete="name"
                placeholder="Ej. Rosa Quispe"
                :disabled="draft.submitting"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Enlace de Google Maps o coordenadas"
              :name="`locationCoordinates-${draft.location.id}`"
            >
              <UInput
                v-model="draft.locationInput"
                placeholder="-12.046374, -77.042793"
                :disabled="draft.submitting"
                class="w-full"
              />
            </UFormField>
          </div>

          <p class="text-sm text-muted">
            Pega un enlace de Google Maps, incluso abreviado, o escribe latitud, longitud.
          </p>
          <div class="flex flex-wrap gap-2">
            <UButton
              type="submit"
              icon="i-lucide-map-pin-check"
              :loading="draft.submitting"
              :label="draft.submitting ? 'Guardando…' : 'Guardar contacto y ubicación'"
              :aria-label="`Guardar contacto y ubicación de ${draft.location.name}`"
            />
            <UButton
              v-if="mapsUrl(draft)"
              :to="mapsUrl(draft)!"
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
      </fieldset>
    </div>
  </SectionCard>
</template>
