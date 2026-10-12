<script setup lang="ts">
import { formatCalendarDay, formatInstantInLima } from "@yacco/shared";
import type {
  CreateVehicleBody,
  CreateVehicleReviewBody,
  CreateVehicleReviewTypeBody,
  UpdateVehicleBody,
  Vehicle,
  VehicleReview,
  VehicleReviewStatusCode,
  VehicleReviewType,
  VehicleReviewTypeStatus,
} from "@yacco/shared";

useHead({ title: "Vehículos · Yacco" });

const session = useSession();
const api = useApi();
const isAdmin = computed(() => session.hasRole("ADMIN"));
const canManageReviews = computed(() => session.hasRole("ADMIN") || session.hasRole("SELLER"));

// --- Pestañas ---
const activeTab = ref<"vehicles" | "reviewTypes">("vehicles");

// --- Catálogo de Vehículos ---
const vehicles = ref<Vehicle[]>([]);
const loadingVehicles = ref(true);
const vehicleFilter = ref<"active" | "all">("active");
const vehicleError = ref<string | null>(null);

const REVIEW_STATUS_CONFIG: Record<
  VehicleReviewStatusCode,
  { label: string; color: "success" | "warning" | "error" | "neutral" }
> = {
  VIGENTE: { label: "Vigente", color: "success" },
  POR_VENCER: { label: "Por vencer", color: "warning" },
  VENCIDA: { label: "Vencida", color: "error" },
  SIN_REGISTRO: { label: "Sin registro", color: "neutral" },
};

async function loadVehicles(): Promise<void> {
  loadingVehicles.value = true;
  vehicleError.value = null;
  try {
    vehicles.value = await api.request<Vehicle[]>("/vehicles", {
      query: { includeInactive: vehicleFilter.value === "all" ? "true" : "false" },
    });
  } catch (error) {
    vehicleError.value = describeApiFailure(error);
  } finally {
    loadingVehicles.value = false;
  }
}

// --- Tipos de revisión ---
const reviewTypes = ref<VehicleReviewType[]>([]);
const loadingReviewTypes = ref(false);
const reviewTypeError = ref<string | null>(null);

async function loadReviewTypes(): Promise<void> {
  loadingReviewTypes.value = true;
  reviewTypeError.value = null;
  try {
    reviewTypes.value = await api.request<VehicleReviewType[]>("/vehicle-review-types", {
      query: { includeInactive: "true" },
    });
  } catch (error) {
    reviewTypeError.value = describeApiFailure(error);
  } finally {
    loadingReviewTypes.value = false;
  }
}

onMounted(() => {
  loadVehicles();
  loadReviewTypes();
});

watch(vehicleFilter, loadVehicles);

// --- Modal Alta de Vehículo ---
const addVehicleModal = ref(false);
const newPlate = ref("");
const newName = ref("");
const newBrand = ref("");
const newModel = ref("");
const newCapacityUnits = ref<number | undefined>(undefined);
const newVehicleClass = ref("");
const newCirculationCardNumber = ref("");
const savingVehicle = ref(false);
const addVehicleError = ref<string | null>(null);

function startAddVehicle(): void {
  newPlate.value = "";
  newName.value = "";
  newBrand.value = "";
  newModel.value = "";
  newCapacityUnits.value = undefined;
  newVehicleClass.value = "";
  newCirculationCardNumber.value = "";
  addVehicleError.value = null;
  addVehicleModal.value = true;
}

async function submitCreateVehicle(): Promise<void> {
  if (savingVehicle.value) return;
  if (!newPlate.value.trim()) {
    addVehicleError.value = "Escribe la placa del vehículo.";
    return;
  }
  if (!newName.value.trim()) {
    addVehicleError.value = "Escribe el nombre o alias del vehículo.";
    return;
  }
  if (!newBrand.value.trim()) {
    addVehicleError.value = "Escribe la marca del vehículo.";
    return;
  }
  if (!newModel.value.trim()) {
    addVehicleError.value = "Escribe el modelo del vehículo.";
    return;
  }

  savingVehicle.value = true;
  addVehicleError.value = null;
  try {
    const body: CreateVehicleBody = {
      plate: newPlate.value.trim(),
      name: newName.value.trim(),
      brand: newBrand.value.trim(),
      model: newModel.value.trim(),
      capacityUnits: newCapacityUnits.value ?? null,
      vehicleClass: newVehicleClass.value.trim() || null,
      circulationCardNumber: newCirculationCardNumber.value.trim() || null,
    };
    await api.request("/vehicles", { method: "POST", body });
    addVehicleModal.value = false;
    await loadVehicles();
  } catch (error) {
    addVehicleError.value = describeApiFailure(error);
  } finally {
    savingVehicle.value = false;
  }
}

// --- Modal Edición de Vehículo ---
const editVehicleModal = ref(false);
const editingVehicle = ref<Vehicle | null>(null);
const editPlate = ref("");
const editName = ref("");
const editBrand = ref("");
const editModel = ref("");
const editCapacityUnits = ref<number | undefined>(undefined);
const editVehicleClass = ref("");
const editCirculationCardNumber = ref("");
const editVehicleError = ref<string | null>(null);

function startEditVehicle(v: Vehicle): void {
  editingVehicle.value = v;
  editPlate.value = v.plate;
  editName.value = v.name;
  editBrand.value = v.brand;
  editModel.value = v.model;
  editCapacityUnits.value = v.capacityUnits ?? undefined;
  editVehicleClass.value = v.vehicleClass ?? "";
  editCirculationCardNumber.value = v.circulationCardNumber ?? "";
  editVehicleError.value = null;
  editVehicleModal.value = true;
}

async function submitEditVehicle(): Promise<void> {
  if (savingVehicle.value || !editingVehicle.value) return;
  if (!editPlate.value.trim()) {
    editVehicleError.value = "Escribe la placa del vehículo.";
    return;
  }
  if (!editName.value.trim()) {
    editVehicleError.value = "Escribe el nombre o alias del vehículo.";
    return;
  }
  if (!editBrand.value.trim()) {
    editVehicleError.value = "Escribe la marca del vehículo.";
    return;
  }
  if (!editModel.value.trim()) {
    editVehicleError.value = "Escribe el modelo del vehículo.";
    return;
  }

  savingVehicle.value = true;
  editVehicleError.value = null;
  try {
    const body: UpdateVehicleBody = {
      plate: editPlate.value.trim(),
      name: editName.value.trim(),
      brand: editBrand.value.trim(),
      model: editModel.value.trim(),
      capacityUnits: editCapacityUnits.value ?? null,
      vehicleClass: editVehicleClass.value.trim() || null,
      circulationCardNumber: editCirculationCardNumber.value.trim() || null,
    };
    await api.request(`/vehicles/${editingVehicle.value.id}`, { method: "PATCH", body });
    editVehicleModal.value = false;
    await loadVehicles();
  } catch (error) {
    editVehicleError.value = describeApiFailure(error);
  } finally {
    savingVehicle.value = false;
  }
}

async function toggleVehicleActive(v: Vehicle): Promise<void> {
  try {
    await api.request(`/vehicles/${v.id}`, {
      method: "PATCH",
      body: { active: !v.active },
    });
    await loadVehicles();
  } catch (error) {
    vehicleError.value = describeApiFailure(error);
  }
}

// --- Modal Revisiones de Vehículo ---
const reviewsModal = ref(false);
const activeVehicleForReviews = ref<Vehicle | null>(null);
const vehicleReviewsStatus = ref<VehicleReviewTypeStatus[]>([]);
const vehicleReviewsHistory = ref<VehicleReview[]>([]);
const loadingReviews = ref(false);
const reviewsError = ref<string | null>(null);

// Formulario nueva revisión
const addingReview = ref(false);
const newReviewTypeId = ref<string | undefined>(undefined);
const newReviewStartsOn = ref("");
const newReviewEndsOn = ref("");
const newReviewNotes = ref("");
const savingReview = ref(false);
const addReviewError = ref<string | null>(null);

// Anulación de revisión
const voidingReview = ref<VehicleReview | null>(null);
const voidReason = ref("");
const savingVoid = ref(false);
const voidError = ref<string | null>(null);

const activeReviewTypeOptions = computed(() =>
  reviewTypes.value.filter((rt) => rt.active).map((rt) => ({ label: rt.name, value: rt.id })),
);

async function openReviewsModal(v: Vehicle): Promise<void> {
  activeVehicleForReviews.value = v;
  reviewsModal.value = true;
  addingReview.value = false;
  voidingReview.value = null;
  reviewsError.value = null;
  await reloadVehicleReviews();
}

async function reloadVehicleReviews(): Promise<void> {
  if (!activeVehicleForReviews.value) return;
  loadingReviews.value = true;
  reviewsError.value = null;
  try {
    const [statuses, history] = await Promise.all([
      api.request<VehicleReviewTypeStatus[]>(
        `/vehicles/${activeVehicleForReviews.value.id}/reviews-status`,
      ),
      api.request<VehicleReview[]>(`/vehicles/${activeVehicleForReviews.value.id}/reviews`),
    ]);
    vehicleReviewsStatus.value = statuses;
    vehicleReviewsHistory.value = history;
  } catch (error) {
    reviewsError.value = describeApiFailure(error);
  } finally {
    loadingReviews.value = false;
  }
}

function startAddReview(): void {
  addingReview.value = true;
  newReviewTypeId.value = activeReviewTypeOptions.value[0]?.value;
  newReviewStartsOn.value = "";
  newReviewEndsOn.value = "";
  newReviewNotes.value = "";
  addReviewError.value = null;
}

async function submitCreateReview(): Promise<void> {
  if (savingReview.value || !activeVehicleForReviews.value) return;
  if (!newReviewTypeId.value) {
    addReviewError.value = "Selecciona un tipo de revisión.";
    return;
  }
  if (!newReviewStartsOn.value) {
    addReviewError.value = "Indica la fecha de inicio de la revisión.";
    return;
  }
  if (!newReviewEndsOn.value) {
    addReviewError.value = "Indica la fecha de vencimiento de la revisión.";
    return;
  }
  if (newReviewEndsOn.value < newReviewStartsOn.value) {
    addReviewError.value = "La fecha de vencimiento no puede ser anterior a la de inicio.";
    return;
  }

  savingReview.value = true;
  addReviewError.value = null;
  try {
    const body: CreateVehicleReviewBody = {
      reviewTypeId: newReviewTypeId.value,
      startsOn: newReviewStartsOn.value,
      endsOn: newReviewEndsOn.value,
      notes: newReviewNotes.value.trim() || null,
    };
    await api.request(`/vehicles/${activeVehicleForReviews.value.id}/reviews`, {
      method: "POST",
      body,
    });
    addingReview.value = false;
    await reloadVehicleReviews();
  } catch (error) {
    addReviewError.value = describeApiFailure(error);
  } finally {
    savingReview.value = false;
  }
}

function startVoidReview(review: VehicleReview): void {
  voidingReview.value = review;
  voidReason.value = "";
  voidError.value = null;
}

async function submitVoidReview(): Promise<void> {
  if (savingVoid.value || !activeVehicleForReviews.value || !voidingReview.value) return;
  if (!voidReason.value.trim()) {
    voidError.value = "Escribe el motivo de la anulación.";
    return;
  }

  savingVoid.value = true;
  voidError.value = null;
  try {
    await api.request(
      `/vehicles/${activeVehicleForReviews.value.id}/reviews/${voidingReview.value.id}/void`,
      {
        method: "PATCH",
        body: { voidReason: voidReason.value.trim() },
      },
    );
    voidingReview.value = null;
    await reloadVehicleReviews();
  } catch (error) {
    voidError.value = describeApiFailure(error);
  } finally {
    savingVoid.value = false;
  }
}

// --- Tipos de revisión ---
const addReviewTypeModal = ref(false);
const newReviewTypeName = ref("");
const savingReviewType = ref(false);
const addReviewTypeError = ref<string | null>(null);

function startAddReviewType(): void {
  newReviewTypeName.value = "";
  addReviewTypeError.value = null;
  addReviewTypeModal.value = true;
}

async function submitCreateReviewType(): Promise<void> {
  if (savingReviewType.value) return;
  if (!newReviewTypeName.value.trim()) {
    addReviewTypeError.value = "Escribe el nombre del tipo de revisión.";
    return;
  }

  savingReviewType.value = true;
  addReviewTypeError.value = null;
  try {
    const body: CreateVehicleReviewTypeBody = {
      name: newReviewTypeName.value.trim(),
    };
    await api.request("/vehicle-review-types", { method: "POST", body });
    addReviewTypeModal.value = false;
    await loadReviewTypes();
  } catch (error) {
    addReviewTypeError.value = describeApiFailure(error);
  } finally {
    savingReviewType.value = false;
  }
}

async function toggleReviewTypeActive(rt: VehicleReviewType): Promise<void> {
  try {
    await api.request(`/vehicle-review-types/${rt.id}`, {
      method: "PATCH",
      body: { active: !rt.active },
    });
    await loadReviewTypes();
  } catch (error) {
    reviewTypeError.value = describeApiFailure(error);
  }
}
</script>

<template>
  <AppPage
    title="Vehículos"
    description="Catálogo de vehículos para reparto y control de revisiones técnicas, SOAT y extintores."
  >
    <template #actions>
      <UButton
        v-if="isAdmin && activeTab === 'vehicles'"
        icon="i-lucide-plus"
        label="Nuevo vehículo"
        @click="startAddVehicle"
      />
      <UButton
        v-if="isAdmin && activeTab === 'reviewTypes'"
        icon="i-lucide-plus"
        label="Nuevo tipo de revisión"
        @click="startAddReviewType"
      />
    </template>

    <div class="space-y-6">
      <!-- Pestañas de sección -->
      <div class="flex gap-2 border-b border-default pb-3">
        <UButton
          :color="activeTab === 'vehicles' ? 'primary' : 'neutral'"
          :variant="activeTab === 'vehicles' ? 'solid' : 'ghost'"
          icon="i-lucide-truck"
          label="Vehículos"
          @click="activeTab = 'vehicles'"
        />
        <UButton
          :color="activeTab === 'reviewTypes' ? 'primary' : 'neutral'"
          :variant="activeTab === 'reviewTypes' ? 'solid' : 'ghost'"
          icon="i-lucide-shield-check"
          label="Tipos de revisión"
          @click="activeTab = 'reviewTypes'"
        />
      </div>

      <!-- SECCIÓN 1: VEHÍCULOS -->
      <div v-if="activeTab === 'vehicles'" class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <UFormField label="Estado" class="w-44">
            <USelect
              v-model="vehicleFilter"
              :items="[
                { label: 'En uso', value: 'active' },
                { label: 'Todos', value: 'all' },
              ]"
              class="w-full"
            />
          </UFormField>
        </div>

        <ListStatus
          v-if="vehicleError || loadingVehicles || vehicles.length === 0"
          :error-message="vehicleError"
          :loading="loadingVehicles"
          :empty="vehicles.length === 0"
          loading-label="Cargando vehículos…"
          empty-icon="i-lucide-truck"
          empty-title="No hay vehículos registrados"
          empty-description="Registra el primer vehículo para asignarlo a las rutas de reparto."
          @retry="loadVehicles"
        />

        <UCard v-else :ui="{ body: 'p-0 sm:p-0' }">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-elevated text-left text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" class="px-4 py-2 font-medium">Placa</th>
                  <th scope="col" class="px-4 py-2 font-medium">Nombre / Alias</th>
                  <th scope="col" class="px-4 py-2 font-medium">Marca y Modelo</th>
                  <th scope="col" class="px-4 py-2 font-medium text-right">Capacidad</th>
                  <th scope="col" class="px-4 py-2 font-medium">Estado</th>
                  <th scope="col" class="px-4 py-2 text-right">
                    <span class="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="v in vehicles" :key="v.id">
                  <td class="px-4 py-3 font-mono font-bold text-highlighted">
                    {{ v.plate }}
                  </td>
                  <td class="px-4 py-3 font-medium text-highlighted">
                    {{ v.name }}
                  </td>
                  <td class="px-4 py-3 text-muted">{{ v.brand }} {{ v.model }}</td>
                  <td class="px-4 py-3 text-right tabular-nums text-muted">
                    {{ v.capacityUnits ? `${v.capacityUnits} bidones` : "—" }}
                  </td>
                  <td class="px-4 py-3">
                    <UBadge
                      :color="v.active ? 'success' : 'neutral'"
                      variant="subtle"
                      :label="v.active ? 'En uso' : 'Desactivado'"
                    />
                  </td>
                  <td class="px-4 py-3 text-right">
                    <div class="flex justify-end gap-1">
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        icon="i-lucide-shield-alert"
                        label="Revisiones"
                        @click="openReviewsModal(v)"
                      />
                      <template v-if="isAdmin">
                        <UButton
                          color="neutral"
                          variant="ghost"
                          size="sm"
                          icon="i-lucide-pencil"
                          label="Editar"
                          @click="startEditVehicle(v)"
                        />
                        <UButton
                          color="neutral"
                          variant="ghost"
                          size="sm"
                          :label="v.active ? 'Desactivar' : 'Reactivar'"
                          @click="toggleVehicleActive(v)"
                        />
                      </template>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>
      </div>

      <!-- SECCIÓN 2: TIPOS DE REVISIÓN -->
      <div v-if="activeTab === 'reviewTypes'" class="space-y-4">
        <ListStatus
          v-if="reviewTypeError || loadingReviewTypes || reviewTypes.length === 0"
          :error-message="reviewTypeError"
          :loading="loadingReviewTypes"
          :empty="reviewTypes.length === 0"
          loading-label="Cargando tipos de revisión…"
          empty-icon="i-lucide-shield-check"
          empty-title="No hay tipos de revisión"
          empty-description="Crea tipos de revisión como SOAT, Revisión técnica o Extintor."
          @retry="loadReviewTypes"
        />

        <UCard v-else :ui="{ body: 'p-0 sm:p-0' }">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-elevated text-left text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" class="px-4 py-2 font-medium">Tipo de revisión</th>
                  <th scope="col" class="px-4 py-2 font-medium">Estado</th>
                  <th v-if="isAdmin" scope="col" class="px-4 py-2 text-right">
                    <span class="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="rt in reviewTypes" :key="rt.id">
                  <td class="px-4 py-3 font-medium text-highlighted">
                    {{ rt.name }}
                  </td>
                  <td class="px-4 py-3">
                    <UBadge
                      :color="rt.active ? 'success' : 'neutral'"
                      variant="subtle"
                      :label="rt.active ? 'En uso' : 'Desactivado'"
                    />
                  </td>
                  <td v-if="isAdmin" class="px-4 py-3 text-right">
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      :label="rt.active ? 'Desactivar' : 'Reactivar'"
                      @click="toggleReviewTypeActive(rt)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>
      </div>
    </div>

    <!-- MODAL ALTA VEHÍCULO -->
    <UModal
      v-model:open="addVehicleModal"
      title="Nuevo vehículo"
      description="Registra un vehículo para la flota de reparto."
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="submitCreateVehicle">
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Placa" required help="Mayúsculas sin guiones. Ej: ABC123">
              <UInput
                v-model="newPlate"
                placeholder="ABC123"
                :disabled="savingVehicle"
                class="w-full font-mono uppercase"
              />
            </UFormField>
            <UFormField label="Nombre / Alias" required help="Ej: Camión 1">
              <UInput
                v-model="newName"
                placeholder="Camión 1"
                :disabled="savingVehicle"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Marca" required>
              <UInput
                v-model="newBrand"
                placeholder="Toyota"
                :disabled="savingVehicle"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Modelo" required>
              <UInput
                v-model="newModel"
                placeholder="Dyna"
                :disabled="savingVehicle"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Capacidad (bidones)" help="Opcional">
              <UInput
                v-model.number="newCapacityUnits"
                type="number"
                min="0"
                placeholder="80"
                :disabled="savingVehicle"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Clase o categoría (guías)" help="Opcional. Ej: N2">
              <UInput
                v-model="newVehicleClass"
                placeholder="N2"
                :disabled="savingVehicle"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Tarjeta de circulación / Habilitación"
              help="Opcional"
              class="sm:col-span-2"
            >
              <UInput
                v-model="newCirculationCardNumber"
                placeholder="TUC-12345678"
                :disabled="savingVehicle"
                class="w-full"
              />
            </UFormField>
          </div>

          <UAlert
            v-if="addVehicleError"
            role="alert"
            color="error"
            variant="subtle"
            :title="addVehicleError"
          />

          <div class="flex justify-end gap-2 pt-3">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="savingVehicle"
              @click="addVehicleModal = false"
            />
            <UButton
              type="submit"
              :label="savingVehicle ? 'Guardando…' : 'Crear vehículo'"
              :disabled="savingVehicle"
            />
          </div>
        </form>
      </template>
    </UModal>

    <!-- MODAL EDITAR VEHÍCULO -->
    <UModal
      v-model:open="editVehicleModal"
      title="Editar vehículo"
      description="Modifica los datos del vehículo. La placa no puede cambiarse si ya estuvo en una ruta."
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="submitEditVehicle">
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Placa" required help="Inmutable tras usarse en una ruta">
              <UInput
                v-model="editPlate"
                placeholder="ABC123"
                :disabled="savingVehicle"
                class="w-full font-mono uppercase"
              />
            </UFormField>
            <UFormField label="Nombre / Alias" required>
              <UInput
                v-model="editName"
                placeholder="Camión 1"
                :disabled="savingVehicle"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Marca" required>
              <UInput
                v-model="editBrand"
                placeholder="Toyota"
                :disabled="savingVehicle"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Modelo" required>
              <UInput
                v-model="editModel"
                placeholder="Dyna"
                :disabled="savingVehicle"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Capacidad (bidones)">
              <UInput
                v-model.number="editCapacityUnits"
                type="number"
                min="0"
                placeholder="80"
                :disabled="savingVehicle"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Clase o categoría">
              <UInput
                v-model="editVehicleClass"
                placeholder="N2"
                :disabled="savingVehicle"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Tarjeta de circulación / Habilitación" class="sm:col-span-2">
              <UInput
                v-model="editCirculationCardNumber"
                placeholder="TUC-12345678"
                :disabled="savingVehicle"
                class="w-full"
              />
            </UFormField>
          </div>

          <UAlert
            v-if="editVehicleError"
            role="alert"
            color="error"
            variant="subtle"
            :title="editVehicleError"
          />

          <div class="flex justify-end gap-2 pt-3">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="savingVehicle"
              @click="editVehicleModal = false"
            />
            <UButton
              type="submit"
              :label="savingVehicle ? 'Guardando…' : 'Guardar cambios'"
              :disabled="savingVehicle"
            />
          </div>
        </form>
      </template>
    </UModal>

    <!-- MODAL REVISIONES DE VEHÍCULO -->
    <UModal
      v-model:open="reviewsModal"
      :title="
        activeVehicleForReviews
          ? `Revisiones: ${activeVehicleForReviews.name} (${activeVehicleForReviews.plate})`
          : 'Revisiones'
      "
      description="Control de vencimiento de SOAT, revisión técnica y extintores."
      :ui="{ content: 'max-w-3xl' }"
    >
      <template #body>
        <div class="space-y-6">
          <UAlert
            v-if="reviewsError"
            role="alert"
            color="error"
            variant="subtle"
            :title="reviewsError"
          />

          <!-- Estado por cada tipo de revisión -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-semibold uppercase tracking-wider text-muted">
                Estado actual de revisiones
              </h3>
              <UButton
                v-if="canManageReviews && !addingReview"
                color="primary"
                variant="subtle"
                size="xs"
                icon="i-lucide-plus"
                label="Registrar revisión"
                @click="startAddReview"
              />
            </div>

            <div class="grid gap-3 sm:grid-cols-3">
              <div
                v-for="st in vehicleReviewsStatus"
                :key="st.reviewTypeId"
                class="rounded-lg border border-default bg-elevated/40 p-3 space-y-1"
              >
                <div class="flex items-center justify-between">
                  <span class="font-medium text-highlighted text-xs">{{ st.reviewTypeName }}</span>
                  <UBadge
                    :color="REVIEW_STATUS_CONFIG[st.status].color"
                    variant="subtle"
                    size="sm"
                    :label="REVIEW_STATUS_CONFIG[st.status].label"
                  />
                </div>
                <div class="text-xs text-muted">
                  <template v-if="st.latestReview">
                    <span>Vence: {{ formatCalendarDay(st.latestReview.endsOn) }}</span>
                    <span v-if="st.daysRemaining !== null" class="block text-dimmed">
                      {{
                        st.daysRemaining < 0
                          ? `Vencida hace ${Math.abs(st.daysRemaining)} días`
                          : st.daysRemaining === 0
                            ? "Vence hoy"
                            : `Faltan ${st.daysRemaining} días`
                      }}
                    </span>
                  </template>
                  <span v-else class="text-dimmed italic">Sin revisión registrada</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Formulario registrar nueva revisión -->
          <div
            v-if="addingReview"
            class="rounded-lg border border-default bg-elevated/60 p-4 space-y-3"
          >
            <h4 class="text-sm font-semibold text-highlighted">Registrar nueva revisión</h4>
            <form class="space-y-3" @submit.prevent="submitCreateReview">
              <div class="grid gap-3 sm:grid-cols-3">
                <UFormField label="Tipo de revisión" required>
                  <USelect
                    v-model="newReviewTypeId"
                    :items="activeReviewTypeOptions"
                    class="w-full"
                    :disabled="savingReview"
                  />
                </UFormField>
                <UFormField label="Fecha de inicio" required>
                  <UInput
                    v-model="newReviewStartsOn"
                    type="date"
                    class="w-full"
                    :disabled="savingReview"
                  />
                </UFormField>
                <UFormField label="Fecha de vencimiento" required>
                  <UInput
                    v-model="newReviewEndsOn"
                    type="date"
                    class="w-full"
                    :disabled="savingReview"
                  />
                </UFormField>
              </div>
              <UFormField label="Notas / Observaciones (opcional)">
                <UInput
                  v-model="newReviewNotes"
                  placeholder="Ej: Póliza Rimac N° 98765"
                  class="w-full"
                  :disabled="savingReview"
                />
              </UFormField>

              <UAlert
                v-if="addReviewError"
                role="alert"
                color="error"
                variant="subtle"
                :title="addReviewError"
              />

              <div class="flex justify-end gap-2 pt-2">
                <UButton
                  color="neutral"
                  variant="outline"
                  size="sm"
                  label="Cancelar"
                  :disabled="savingReview"
                  @click="addingReview = false"
                />
                <UButton
                  type="submit"
                  size="sm"
                  :label="savingReview ? 'Guardando…' : 'Guardar revisión'"
                  :disabled="savingReview"
                />
              </div>
            </form>
          </div>

          <!-- Diálogo anular revisión -->
          <div
            v-if="voidingReview"
            class="rounded-lg border border-error/30 bg-error/5 p-4 space-y-3"
          >
            <h4 class="text-sm font-semibold text-error">
              Anular revisión de {{ voidingReview.reviewType.name }}
            </h4>
            <p class="text-xs text-muted">
              Solo se debe anular si fue un error de registro. La revisión quedará marcada como
              anulada con el motivo indicado.
            </p>
            <form class="space-y-3" @submit.prevent="submitVoidReview">
              <UFormField label="Motivo de la anulación" required>
                <UInput
                  v-model="voidReason"
                  placeholder="Ej: Error al digitar la fecha de vencimiento"
                  class="w-full"
                  :disabled="savingVoid"
                />
              </UFormField>

              <UAlert
                v-if="voidError"
                role="alert"
                color="error"
                variant="subtle"
                :title="voidError"
              />

              <div class="flex justify-end gap-2">
                <UButton
                  color="neutral"
                  variant="outline"
                  size="sm"
                  label="Cancelar"
                  :disabled="savingVoid"
                  @click="voidingReview = null"
                />
                <UButton
                  color="error"
                  type="submit"
                  size="sm"
                  :label="savingVoid ? 'Anulando…' : 'Confirmar anulación'"
                  :disabled="savingVoid || !voidReason.trim()"
                />
              </div>
            </form>
          </div>

          <!-- Historial de revisiones -->
          <div class="space-y-2">
            <h3 class="text-sm font-semibold uppercase tracking-wider text-muted">
              Historial de revisiones
            </h3>

            <div v-if="vehicleReviewsHistory.length === 0" class="text-xs text-dimmed italic">
              No hay revisiones registradas para este vehículo.
            </div>

            <div v-else class="overflow-x-auto rounded-lg border border-default">
              <table class="w-full text-left text-xs">
                <thead class="bg-elevated text-muted uppercase">
                  <tr>
                    <th scope="col" class="px-3 py-2 font-medium">Tipo</th>
                    <th scope="col" class="px-3 py-2 font-medium">Vigencia</th>
                    <th scope="col" class="px-3 py-2 font-medium">Notas</th>
                    <th scope="col" class="px-3 py-2 font-medium">Registrado</th>
                    <th scope="col" class="px-3 py-2 font-medium">Estado</th>
                    <th v-if="isAdmin" scope="col" class="px-3 py-2 text-right">
                      <span class="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-default">
                  <tr
                    v-for="r in vehicleReviewsHistory"
                    :key="r.id"
                    :class="{ 'opacity-60 bg-error/5': r.voidedAt }"
                  >
                    <td class="px-3 py-2 font-medium text-highlighted">
                      {{ r.reviewType.name }}
                    </td>
                    <td class="px-3 py-2 whitespace-nowrap tabular-nums text-muted">
                      {{ formatCalendarDay(r.startsOn) }} al {{ formatCalendarDay(r.endsOn) }}
                    </td>
                    <td class="px-3 py-2 text-muted max-w-xs truncate">
                      {{ r.notes || "—" }}
                    </td>
                    <td class="px-3 py-2 text-muted tabular-nums">
                      {{ r.recordedBy.name }} ({{ formatInstantInLima(r.createdAt) }})
                    </td>
                    <td class="px-3 py-2">
                      <div v-if="r.voidedAt" class="space-y-0.5">
                        <UBadge color="error" variant="subtle" size="xs" label="Anulada" />
                        <span class="block text-[10px] text-muted">
                          {{ r.voidReason }} ({{ r.voidedBy?.name }})
                        </span>
                      </div>
                      <span v-else class="text-success font-medium">Válida</span>
                    </td>
                    <td v-if="isAdmin" class="px-3 py-2 text-right">
                      <UButton
                        v-if="!r.voidedAt && voidingReview?.id !== r.id"
                        color="error"
                        variant="ghost"
                        size="xs"
                        label="Anular"
                        @click="startVoidReview(r)"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="flex justify-end pt-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cerrar"
              @click="reviewsModal = false"
            />
          </div>
        </div>
      </template>
    </UModal>

    <!-- MODAL NUEVO TIPO DE REVISIÓN -->
    <UModal
      v-model:open="addReviewTypeModal"
      title="Nuevo tipo de revisión"
      description="Agrega un requisito de revisión vehicular (SOAT, Revisión técnica, Extintor, etc.)."
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="submitCreateReviewType">
          <UFormField label="Nombre" required help="Ej: Extintor">
            <UInput
              v-model="newReviewTypeName"
              placeholder="Extintor"
              :disabled="savingReviewType"
              class="w-full"
            />
          </UFormField>

          <UAlert
            v-if="addReviewTypeError"
            role="alert"
            color="error"
            variant="subtle"
            :title="addReviewTypeError"
          />

          <div class="flex justify-end gap-2 pt-3">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="savingReviewType"
              @click="addReviewTypeModal = false"
            />
            <UButton
              type="submit"
              :label="savingReviewType ? 'Guardando…' : 'Crear tipo'"
              :disabled="savingReviewType"
            />
          </div>
        </form>
      </template>
    </UModal>
  </AppPage>
</template>
