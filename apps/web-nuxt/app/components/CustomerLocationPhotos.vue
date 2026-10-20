<script setup lang="ts">
import { formatCalendarDay } from "@yacco/shared";
import type { CustomerLocationPhoto } from "@yacco/shared";

const props = defineProps<{
  locationId: string;
  locationName: string;
  isAdmin?: boolean;
  canUpload?: boolean;
}>();

const api = useApi();
const session = useSession();
const photos = ref<CustomerLocationPhoto[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const uploadError = ref<string | null>(null);

const selectedPhoto = ref<CustomerLocationPhoto | null>(null);

const hideModalOpen = ref(false);
const photoToHide = ref<CustomerLocationPhoto | null>(null);
const hideReason = ref("");
const hiding = ref(false);
const hideError = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    photos.value = await api.request<CustomerLocationPhoto[]>(
      `/customer-locations/${props.locationId}/photos`,
    );
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function triggerFileInput(): void {
  uploadError.value = null;
  fileInput.value?.click();
}

async function handleFileChange(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    uploadError.value = "La foto no puede superar los 5 MB";
    target.value = "";
    return;
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    uploadError.value = "Solo se permiten imágenes JPEG, PNG o WebP";
    target.value = "";
    return;
  }

  uploading.value = true;
  uploadError.value = null;
  try {
    const formData = new FormData();
    formData.append("file", file);

    const token = session.accessToken();
    const res = await fetch(`/api/v1/customer-locations/${props.locationId}/photos`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.message || `Error al subir foto (${res.status})`);
    }

    target.value = "";
    await load();
  } catch (error) {
    uploadError.value = (error as Error).message || "No se pudo subir la foto";
  } finally {
    uploading.value = false;
  }
}

function openHideModal(photo: CustomerLocationPhoto): void {
  photoToHide.value = photo;
  hideReason.value = "";
  hideError.value = null;
  hideModalOpen.value = true;
}

async function confirmHide(): Promise<void> {
  if (!photoToHide.value) return;
  const reason = hideReason.value.trim();
  if (!reason) {
    hideError.value = "El motivo para ocultar la foto es obligatorio";
    return;
  }

  hiding.value = true;
  hideError.value = null;
  try {
    await api.request(`/customer-locations/photos/${photoToHide.value.id}/hide`, {
      method: "PATCH",
      body: { reason },
    });
    hideModalOpen.value = false;
    if (selectedPhoto.value?.id === photoToHide.value.id) {
      selectedPhoto.value = null;
    }
    photoToHide.value = null;
    await load();
  } catch (error) {
    hideError.value = describeApiFailure(error);
  } finally {
    hiding.value = false;
  }
}
</script>

<template>
  <UPageBody>
    <USeparator />
    <UPageCard
      variant="naked"
      orientation="horizontal"
      description="Fachada, puerta y referencias visuales."
    >
      <template #title>
        <h4>Fotos del local ({{ photos.length }}/10)</h4>
      </template>

      <div v-if="canUpload && photos.length < 10">
        <label :for="`location-photo-file-${locationId}`" class="sr-only">
          Subir foto del local
        </label>
        <input
          :id="`location-photo-file-${locationId}`"
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          class="hidden"
          @change="handleFileChange"
        />
        <UButton
          color="neutral"
          variant="outline"
          size="xs"
          icon="i-lucide-camera"
          :label="uploading ? 'Subiendo…' : 'Subir foto'"
          :loading="uploading"
          @click="triggerFileInput"
        />
      </div>
    </UPageCard>

    <UAlert
      v-if="uploadError"
      role="alert"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="uploadError"
    />

    <UEmpty v-if="loading" variant="naked" size="xs" description="Cargando fotos…" />

    <UAlert
      v-else-if="loadError"
      role="alert"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="loadError"
    />

    <UEmpty
      v-else-if="photos.length === 0"
      variant="naked"
      size="xs"
      description="No hay fotos registradas para este local."
    />

    <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      <div
        v-for="photo in photos"
        :key="photo.id"
        class="group relative aspect-square cursor-pointer overflow-hidden rounded-md border border-default"
        @click="selectedPhoto = photo"
      >
        <LocationPhotoImg :photo-id="photo.id" class="size-full" />
        <div
          class="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/60 via-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <span class="text-[10px] text-white">Ver en grande</span>
          <UButton
            v-if="isAdmin"
            color="error"
            variant="ghost"
            size="xs"
            icon="i-lucide-eye-off"
            aria-label="Ocultar foto"
            @click.stop="openHideModal(photo)"
          />
        </div>
      </div>
    </div>

    <!-- Modal ver en grande -->
    <UModal
      :open="selectedPhoto !== null"
      title="Foto del local"
      @update:open="
        (val) => {
          if (!val) selectedPhoto = null;
        }
      "
    >
      <template #body>
        <!-- Un div y no UPageBody/UPageCard: un componente con v-if dentro de un slot con
             nombre hace que el typecheck de CI pierda el descarte de selectedPhoto nulo. -->
        <div v-if="selectedPhoto" class="space-y-4">
          <LocationPhotoImg :photo-id="selectedPhoto.id" whole />

          <div class="flex items-center justify-between text-xs text-muted">
            <div>
              <p v-if="selectedPhoto.uploadedBy">
                Subida por:
                <span class="font-medium text-highlighted">{{
                  selectedPhoto.uploadedBy.name
                }}</span>
              </p>
              <p>Fecha: {{ formatCalendarDay(selectedPhoto.createdAt.slice(0, 10)) }}</p>
            </div>

            <UButton
              v-if="isAdmin"
              color="error"
              variant="outline"
              size="xs"
              icon="i-lucide-eye-off"
              label="Ocultar foto"
              @click="openHideModal(selectedPhoto)"
            />
          </div>
        </div>
      </template>
    </UModal>

    <!-- Modal ocultar foto -->
    <UModal v-model:open="hideModalOpen" title="Ocultar foto">
      <template #body>
        <UForm :state="{}" :validate-on="[]" :loading-auto="false" novalidate @submit="confirmHide">
          <p>
            La foto dejará de mostrarse en la ficha del local. Quedará guardada en el historial con
            el motivo y la auditoría.
          </p>

          <UAlert
            v-if="hideError"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="hideError"
          />

          <UFormField
            label="Motivo para ocultar"
            required
            :error="hideError && !hideReason.trim() ? hideError : undefined"
          >
            <UInput
              v-model="hideReason"
              placeholder="Ej. Fachada remodelada, foto desactualizada"
              class="w-full"
              autocomplete="off"
            />
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="hiding"
              @click="hideModalOpen = false"
            />
            <UButton type="submit" color="error" label="Ocultar foto" :loading="hiding" />
          </div>
        </UForm>
      </template>
    </UModal>
  </UPageBody>
</template>
