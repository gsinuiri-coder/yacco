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

interface MapsLink {
  label: string;
  icon: string;
  color: "primary" | "neutral";
  to: string;
}

// La propuesta siempre; la ubicación actual solo si el local ya tenía una.
function mapsLinks(req: CustomerLocationCoordinateRequest): MapsLink[] {
  const links: MapsLink[] = [
    {
      label: "Ver propuesta en Maps",
      icon: "i-lucide-map-pin",
      color: "primary",
      to: `https://www.google.com/maps?q=${req.latitude},${req.longitude}`,
    },
  ];
  if (req.previousLatitude && req.previousLongitude) {
    links.push({
      label: "Ver actual en Maps",
      icon: "i-lucide-map",
      color: "neutral",
      to: `https://www.google.com/maps?q=${req.previousLatitude},${req.previousLongitude}`,
    });
  }
  return links;
}

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
    <UAlert
      v-if="!session.hasRole('ADMIN')"
      color="warning"
      variant="subtle"
      icon="i-lucide-shield-alert"
      title="Acceso restringido"
      description="Esta bandeja solo está disponible para administradores."
    />

    <UPageBody v-else>
      <p v-if="loading">Cargando solicitudes pendientes…</p>

      <UAlert
        v-else-if="loadError"
        role="alert"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="loadError"
      />

      <UEmpty
        v-else-if="data.photos.length === 0 && data.coordinateRequests.length === 0"
        icon="i-lucide-check-check"
        title="Bandeja al día"
        description="No hay fotos ni ubicaciones pendientes de aprobación."
      />

      <template v-else>
        <!-- Fotos pendientes -->
        <SectionCard
          v-if="data.photos.length > 0"
          :title="`Fotos por aprobar (${data.photos.length})`"
          description="Fotos tomadas por los choferes que requieren validación antes de mostrarse en la ficha."
        >
          <UPageList as="ul" divide>
            <UPageCard
              v-for="photo in data.photos"
              :key="photo.id"
              as="li"
              variant="naked"
              orientation="horizontal"
              :description="`Subida por: ${photo.uploadedBy?.name ?? 'Chofer'} · ${formatCalendarDay(photo.createdAt.slice(0, 10))}`"
            >
              <template #leading>
                <LocationPhotoImg :photo-id="photo.id" class="size-20" />
              </template>
              <template #title>
                <h3>
                  {{ photo.location?.name ?? "Local" }}
                  <span v-if="photo.location?.customer">({{ photo.location.customer.name }})</span>
                </h3>
              </template>

              <div class="flex justify-end gap-2">
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
            </UPageCard>
          </UPageList>
        </SectionCard>

        <!-- Ubicaciones pendientes -->
        <SectionCard
          v-if="data.coordinateRequests.length > 0"
          :title="`Ubicaciones por aprobar (${data.coordinateRequests.length})`"
          description="Coordenadas GPS tomadas por los choferes en campo para actualizar locales."
        >
          <UPageList as="ul" divide>
            <UPageCard
              v-for="req in data.coordinateRequests"
              :key="req.id"
              as="li"
              variant="naked"
              orientation="horizontal"
            >
              <template #title>
                <h3>
                  {{ req.location?.name ?? "Local" }}
                  <span v-if="req.location?.customer">({{ req.location.customer.name }})</span>
                </h3>
              </template>
              <template #description>
                <p>
                  Propuesta:
                  <span>{{ req.latitude }}, {{ req.longitude }}</span>
                  <span v-if="req.accuracyM"> (precisión ±{{ req.accuracyM }} m)</span>
                </p>
                <p v-if="req.previousLatitude && req.previousLongitude">
                  Actual:
                  <span>{{ req.previousLatitude }}, {{ req.previousLongitude }}</span>
                </p>
                <p v-else>Sin coordenadas previas</p>
                <div class="flex flex-wrap gap-2">
                  <UButton
                    v-for="link in mapsLinks(req)"
                    :key="link.label"
                    :to="link.to"
                    target="_blank"
                    :color="link.color"
                    variant="link"
                    size="xs"
                    :icon="link.icon"
                    :label="link.label"
                  />
                </div>
                <p>
                  Propuesto por: {{ req.requestedBy?.name ?? "Chofer" }} ·
                  {{ formatCalendarDay(req.createdAt.slice(0, 10)) }}
                </p>
              </template>

              <div class="flex justify-end gap-2">
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
            </UPageCard>
          </UPageList>
        </SectionCard>
      </template>
    </UPageBody>

    <!-- Modal de rechazo con motivo obligatorio -->
    <UModal v-model:open="rejectModalOpen" title="Rechazar solicitud">
      <template #body>
        <UForm
          :state="{}"
          :validate-on="[]"
          :loading-auto="false"
          novalidate
          @submit="confirmReject"
        >
          <p>
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

          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="rejecting"
              @click="rejectModalOpen = false"
            />
            <UButton type="submit" color="error" label="Rechazar solicitud" :loading="rejecting" />
          </div>
        </UForm>
      </template>
    </UModal>
  </AppPage>
</template>
