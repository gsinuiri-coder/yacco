<script setup lang="ts">
import { formatCalendarDay } from "@yacco/shared";
import type { CustomerLocationCoordinateRequest, CustomerLocationPhoto } from "@yacco/shared";

useHead({ title: "Por aprobar · Yacco" });

interface PendingApprovalsData {
  photos: CustomerLocationPhoto[];
  coordinateRequests: CustomerLocationCoordinateRequest[];
}

const api = useApi();
const session = useSession();

const data = ref<PendingApprovalsData>({ photos: [], coordinateRequests: [] });
const loading = ref(true);
const loadError = ref<string | null>(null);

// Modal de rechazo
const rejectModalOpen = ref(false);
const rejectTarget = ref<{ type: "photo" | "coordinate"; id: string; title: string } | null>(null);
const rejectionReason = ref("");
const rejecting = ref(false);
const rejectError = ref<string | null>(null);

// Procesando aprobación
const reviewingId = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    data.value = await api.request<PendingApprovalsData>("/pending-approvals");
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (session.hasRole("ADMIN")) {
    load();
  } else {
    loading.value = false;
  }
});

async function approvePhoto(photoId: string): Promise<void> {
  reviewingId.value = photoId;
  try {
    await api.request(`/customer-locations/photos/${photoId}/review`, {
      method: "PATCH",
      body: { status: "APPROVED" },
    });
    await load();
  } catch (error) {
    const toast = useToast();
    toast.add({
      title: "Error al aprobar foto",
      description: describeApiFailure(error),
      color: "error",
    });
  } finally {
    reviewingId.value = null;
  }
}

async function approveCoordinate(requestId: string): Promise<void> {
  reviewingId.value = requestId;
  try {
    await api.request(`/customer-locations/coordinate-requests/${requestId}/review`, {
      method: "PATCH",
      body: { status: "APPROVED" },
    });
    await load();
  } catch (error) {
    const toast = useToast();
    toast.add({
      title: "Error al aprobar ubicación",
      description: describeApiFailure(error),
      color: "error",
    });
  } finally {
    reviewingId.value = null;
  }
}

function openRejectModal(type: "photo" | "coordinate", id: string, title: string): void {
  rejectTarget.value = { type, id, title };
  rejectionReason.value = "";
  rejectError.value = null;
  rejectModalOpen.value = true;
}

async function confirmReject(): Promise<void> {
  if (!rejectTarget.value) return;
  const reason = rejectionReason.value.trim();
  if (!reason) {
    rejectError.value = "El motivo de rechazo es obligatorio";
    return;
  }

  rejecting.value = true;
  rejectError.value = null;
  try {
    const endpoint =
      rejectTarget.value.type === "photo"
        ? `/customer-locations/photos/${rejectTarget.value.id}/review`
        : `/customer-locations/coordinate-requests/${rejectTarget.value.id}/review`;

    await api.request(endpoint, {
      method: "PATCH",
      body: {
        status: "REJECTED",
        rejectionReason: reason,
      },
    });

    rejectModalOpen.value = false;
    rejectTarget.value = null;
    await load();
  } catch (error) {
    rejectError.value = describeApiFailure(error);
  } finally {
    rejecting.value = false;
  }
}
</script>

<template>
  <AppPage
    title="Por aprobar"
    description="Fotos y ubicaciones propuestas por los choferes desde el reparto."
  >
    <div v-if="!session.hasRole('ADMIN')" class="py-10 text-center">
      <UAlert
        color="warning"
        variant="subtle"
        icon="i-lucide-shield-alert"
        title="Acceso restringido"
        description="Esta bandeja solo está disponible para administradores."
      />
    </div>

    <div v-else class="space-y-8">
      <div v-if="loading" class="py-6 text-sm text-muted">Cargando solicitudes pendientes…</div>

      <UAlert
        v-else-if="loadError"
        role="alert"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="loadError"
      />

      <div
        v-else-if="data.photos.length === 0 && data.coordinateRequests.length === 0"
        class="rounded-lg border border-default bg-default p-8 text-center"
      >
        <UIcon name="i-lucide-check-check" class="mx-auto size-10 text-success mb-2" />
        <h3 class="text-base font-semibold text-highlighted">Bandeja al día</h3>
        <p class="mt-1 text-sm text-muted">No hay fotos ni ubicaciones pendientes de aprobación.</p>
      </div>

      <template v-else>
        <!-- Fotos pendientes -->
        <SectionCard
          v-if="data.photos.length > 0"
          :title="`Fotos por aprobar (${data.photos.length})`"
          description="Fotos tomadas por los choferes que requieren validación antes de mostrarse en la ficha."
        >
          <ul class="flex flex-col divide-y divide-default">
            <li
              v-for="photo in data.photos"
              :key="photo.id"
              class="flex flex-col gap-4 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="flex items-center gap-4">
                <div class="size-20 shrink-0 overflow-hidden rounded-md border border-default">
                  <LocationPhotoImg :photo-id="photo.id" class="size-full" />
                </div>

                <div>
                  <h4 class="font-medium text-highlighted">
                    {{ photo.location?.name ?? "Local" }}
                    <span v-if="photo.location?.customer" class="text-sm text-muted font-normal">
                      ({{ photo.location.customer.name }})
                    </span>
                  </h4>
                  <p class="text-xs text-muted mt-1">
                    Subida por:
                    <span class="font-medium text-highlighted">{{
                      photo.uploadedBy?.name ?? "Chofer"
                    }}</span>
                    · {{ formatCalendarDay(photo.createdAt.slice(0, 10)) }}
                  </p>
                </div>
              </div>

              <div class="flex items-center gap-2 self-end sm:self-center">
                <UButton
                  color="neutral"
                  variant="outline"
                  size="sm"
                  icon="i-lucide-x"
                  label="Rechazar"
                  :disabled="reviewingId === photo.id"
                  @click="
                    openRejectModal('photo', photo.id, `Foto de ${photo.location?.name ?? 'local'}`)
                  "
                />
                <UButton
                  color="primary"
                  size="sm"
                  icon="i-lucide-check"
                  label="Aprobar"
                  :loading="reviewingId === photo.id"
                  @click="approvePhoto(photo.id)"
                />
              </div>
            </li>
          </ul>
        </SectionCard>

        <!-- Ubicaciones pendientes -->
        <SectionCard
          v-if="data.coordinateRequests.length > 0"
          :title="`Ubicaciones por aprobar (${data.coordinateRequests.length})`"
          description="Coordenadas GPS tomadas por los choferes en campo para actualizar locales."
        >
          <ul class="flex flex-col divide-y divide-default">
            <li
              v-for="req in data.coordinateRequests"
              :key="req.id"
              class="flex flex-col gap-4 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="space-y-1">
                <h4 class="font-medium text-highlighted">
                  {{ req.location?.name ?? "Local" }}
                  <span v-if="req.location?.customer" class="text-sm text-muted font-normal">
                    ({{ req.location.customer.name }})
                  </span>
                </h4>

                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <p>
                    Propuesta:
                    <span class="font-mono font-medium text-highlighted">
                      {{ req.latitude }}, {{ req.longitude }}
                    </span>
                    <span v-if="req.accuracyM" class="text-dimmed">
                      (precisión ±{{ req.accuracyM }} m)</span
                    >
                  </p>

                  <p v-if="req.previousLatitude && req.previousLongitude">
                    Actual:
                    <span class="font-mono text-muted">
                      {{ req.previousLatitude }}, {{ req.previousLongitude }}
                    </span>
                  </p>
                  <p v-else class="text-dimmed">Sin coordenadas previas</p>
                </div>

                <div class="flex items-center gap-3 pt-1 text-xs">
                  <a
                    :href="`https://www.google.com/maps?q=${req.latitude},${req.longitude}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    <UIcon name="i-lucide-map-pin" class="size-3.5" />
                    Ver propuesta en Maps
                  </a>

                  <a
                    v-if="req.previousLatitude && req.previousLongitude"
                    :href="`https://www.google.com/maps?q=${req.previousLatitude},${req.previousLongitude}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1 text-muted hover:underline"
                  >
                    <UIcon name="i-lucide-map" class="size-3.5" />
                    Ver actual en Maps
                  </a>
                </div>

                <p class="text-[11px] text-muted pt-1">
                  Propuesto por:
                  <span class="font-medium text-highlighted">{{
                    req.requestedBy?.name ?? "Chofer"
                  }}</span>
                  · {{ formatCalendarDay(req.createdAt.slice(0, 10)) }}
                </p>
              </div>

              <div class="flex items-center gap-2 self-end sm:self-center">
                <UButton
                  color="neutral"
                  variant="outline"
                  size="sm"
                  icon="i-lucide-x"
                  label="Rechazar"
                  :disabled="reviewingId === req.id"
                  @click="
                    openRejectModal(
                      'coordinate',
                      req.id,
                      `Ubicación de ${req.location?.name ?? 'local'}`,
                    )
                  "
                />
                <UButton
                  color="primary"
                  size="sm"
                  icon="i-lucide-check"
                  label="Aprobar"
                  :loading="reviewingId === req.id"
                  @click="approveCoordinate(req.id)"
                />
              </div>
            </li>
          </ul>
        </SectionCard>
      </template>
    </div>

    <!-- Modal de rechazo con motivo obligatorio -->
    <UModal v-model:open="rejectModalOpen" title="Rechazar solicitud">
      <template #body>
        <form class="space-y-4" novalidate @submit.prevent="confirmReject">
          <p class="text-sm text-muted">
            Indica el motivo por el cual se rechaza esta propuesta ({{ rejectTarget?.title }}). El
            rechazo quedará guardado para auditoría.
          </p>

          <UAlert
            v-if="rejectError"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="rejectError"
          />

          <UFormField
            label="Motivo de rechazo"
            required
            :error="rejectError && !rejectionReason.trim() ? rejectError : undefined"
          >
            <UInput
              v-model="rejectionReason"
              placeholder="Ej. Foto borrosa, coordenadas tomadas en punto incorrecto"
              class="w-full"
              autocomplete="off"
            />
          </UFormField>

          <div class="flex justify-end gap-2 pt-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="rejecting"
              @click="rejectModalOpen = false"
            />
            <UButton type="submit" color="error" label="Rechazar solicitud" :loading="rejecting" />
          </div>
        </form>
      </template>
    </UModal>
  </AppPage>
</template>
