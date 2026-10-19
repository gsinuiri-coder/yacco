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
import type { TableColumn } from "@nuxt/ui";

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

const vehicleColumns: TableColumn<Vehicle>[] = [
  { accessorKey: "plate", header: "Placa" },
  { accessorKey: "name", header: "Nombre / Alias" },
  { id: "brandModel", header: "Marca y Modelo" },
  { id: "capacity", header: "Capacidad", meta: RIGHT_ALIGNED },
  { id: "status", header: "Estado" },
  { id: "actions", header: hiddenHeader("Acciones"), meta: RIGHT_ALIGNED },
];
const reviewTypeColumns = computed<TableColumn<VehicleReviewType>[]>(() => [
  { accessorKey: "name", header: "Tipo de revisión" },
  { id: "status", header: "Estado" },
  ...(isAdmin.value
    ? [{ id: "actions", header: hiddenHeader("Acciones"), meta: RIGHT_ALIGNED }]
    : []),
]);
const reviewHistoryColumns = computed<TableColumn<VehicleReview>[]>(() => [
  { id: "type", header: "Tipo" },
  { id: "validity", header: "Vigencia" },
  { id: "notes", header: "Notas", meta: WRAPPING_TEXT },
  { id: "recorded", header: "Registrado" },
  { id: "status", header: "Estado" },
  ...(isAdmin.value
    ? [{ id: "actions", header: hiddenHeader("Acciones"), meta: RIGHT_ALIGNED }]
    : []),
]);
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

    <UPageBody>
      <!-- Pestañas de sección -->
      <div class="flex flex-wrap gap-2">
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
      <UCard v-if="activeTab === 'vehicles'">
        <template #header>
          <UPageGrid>
            <UFormField label="Estado">
              <USelect
                v-model="vehicleFilter"
                :items="[
                  { label: 'En uso', value: 'active' },
                  { label: 'Todos', value: 'all' },
                ]"
                class="w-full"
              />
            </UFormField>
          </UPageGrid>
        </template>

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

        <UTable v-else :data="vehicles" :columns="vehicleColumns" caption="Vehículos de reparto">
          <template #brandModel-cell="{ row }">
            {{ row.original.brand }} {{ row.original.model }}
          </template>
          <template #capacity-cell="{ row }">
            {{ row.original.capacityUnits ? `${row.original.capacityUnits} bidones` : "—" }}
          </template>
          <template #status-cell="{ row }">
            <UBadge
              :color="row.original.active ? 'success' : 'neutral'"
              variant="subtle"
              :label="row.original.active ? 'En uso' : 'Desactivado'"
            />
          </template>
          <template #actions-cell="{ row }">
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-shield-alert"
                label="Revisiones"
                @click="openReviewsModal(row.original)"
              />
              <template v-if="isAdmin">
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  icon="i-lucide-pencil"
                  label="Editar"
                  @click="startEditVehicle(row.original)"
                />
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :label="row.original.active ? 'Desactivar' : 'Reactivar'"
                  @click="toggleVehicleActive(row.original)"
                />
              </template>
            </div>
          </template>
        </UTable>
      </UCard>

      <!-- SECCIÓN 2: TIPOS DE REVISIÓN -->
      <UCard v-if="activeTab === 'reviewTypes'">
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

        <UTable
          v-else
          :data="reviewTypes"
          :columns="reviewTypeColumns"
          caption="Tipos de revisión vehicular"
        >
          <template #status-cell="{ row }">
            <UBadge
              :color="row.original.active ? 'success' : 'neutral'"
              variant="subtle"
              :label="row.original.active ? 'En uso' : 'Desactivado'"
            />
          </template>
          <template #actions-cell="{ row }">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              :label="row.original.active ? 'Desactivar' : 'Reactivar'"
              @click="toggleReviewTypeActive(row.original)"
            />
          </template>
        </UTable>
      </UCard>
    </UPageBody>

    <!-- MODAL ALTA VEHÍCULO -->
    <UModal
      v-model:open="addVehicleModal"
      title="Nuevo vehículo"
      description="Registra un vehículo para la flota de reparto."
    >
      <template #body>
        <UForm :state="{}" :validate-on="[]" :loading-auto="false" @submit="submitCreateVehicle">
          <UPageGrid>
            <UFormField label="Placa" required help="Mayúsculas sin guiones. Ej: ABC123">
              <UInput
                v-model="newPlate"
                placeholder="ABC123"
                :disabled="savingVehicle"
                class="w-full"
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
            <UFormField label="Tarjeta de circulación / Habilitación" help="Opcional">
              <UInput
                v-model="newCirculationCardNumber"
                placeholder="TUC-12345678"
                :disabled="savingVehicle"
                class="w-full"
              />
            </UFormField>
          </UPageGrid>

          <UAlert
            v-if="addVehicleError"
            role="alert"
            color="error"
            variant="subtle"
            :title="addVehicleError"
          />

          <div class="flex justify-end gap-2">
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
        </UForm>
      </template>
    </UModal>

    <!-- MODAL EDITAR VEHÍCULO -->
    <UModal
      v-model:open="editVehicleModal"
      title="Editar vehículo"
      description="Modifica los datos del vehículo. La placa no puede cambiarse si ya estuvo en una ruta."
    >
      <template #body>
        <UForm :state="{}" :validate-on="[]" :loading-auto="false" @submit="submitEditVehicle">
          <UPageGrid>
            <UFormField label="Placa" required help="Inmutable tras usarse en una ruta">
              <UInput
                v-model="editPlate"
                placeholder="ABC123"
                :disabled="savingVehicle"
                class="w-full"
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
            <UFormField label="Tarjeta de circulación / Habilitación">
              <UInput
                v-model="editCirculationCardNumber"
                placeholder="TUC-12345678"
                :disabled="savingVehicle"
                class="w-full"
              />
            </UFormField>
          </UPageGrid>

          <UAlert
            v-if="editVehicleError"
            role="alert"
            color="error"
            variant="subtle"
            :title="editVehicleError"
          />

          <div class="flex justify-end gap-2">
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
        </UForm>
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
    >
      <template #body>
        <UPageBody>
          <UAlert
            v-if="reviewsError"
            role="alert"
            color="error"
            variant="subtle"
            :title="reviewsError"
          />

          <!-- Estado por cada tipo de revisión -->
          <UPageCard variant="naked" orientation="horizontal">
            <template #title><h3>Estado actual de revisiones</h3></template>
            <div class="flex justify-end gap-2">
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
          </UPageCard>

          <UPageGrid>
            <UPageCard
              v-for="st in vehicleReviewsStatus"
              :key="st.reviewTypeId"
              :title="st.reviewTypeName"
              variant="soft"
            >
              <UFieldGroup>
                <UBadge
                  :color="REVIEW_STATUS_CONFIG[st.status].color"
                  variant="subtle"
                  size="sm"
                  :label="REVIEW_STATUS_CONFIG[st.status].label"
                />
              </UFieldGroup>
              <template v-if="st.latestReview">
                <p>Vence: {{ formatCalendarDay(st.latestReview.endsOn) }}</p>
                <p v-if="st.daysRemaining !== null">
                  {{
                    st.daysRemaining < 0
                      ? `Vencida hace ${Math.abs(st.daysRemaining)} días`
                      : st.daysRemaining === 0
                        ? "Vence hoy"
                        : `Faltan ${st.daysRemaining} días`
                  }}
                </p>
              </template>
              <p v-else>Sin revisión registrada</p>
            </UPageCard>
          </UPageGrid>

          <!-- Formulario registrar nueva revisión -->
          <UPageCard v-if="addingReview" variant="soft">
            <template #title><h4>Registrar nueva revisión</h4></template>
            <UForm :state="{}" :validate-on="[]" :loading-auto="false" @submit="submitCreateReview">
              <UPageGrid>
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
              </UPageGrid>
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

              <div class="flex justify-end gap-2">
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
            </UForm>
          </UPageCard>

          <!-- Diálogo anular revisión -->
          <UPageCard
            v-if="voidingReview"
            variant="soft"
            description="Solo se debe anular si fue un error de registro. La revisión quedará marcada como anulada con el motivo indicado."
          >
            <template #title>
              <h4>Anular revisión de {{ voidingReview.reviewType.name }}</h4>
            </template>
            <UForm :state="{}" :validate-on="[]" :loading-auto="false" @submit="submitVoidReview">
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
            </UForm>
          </UPageCard>

          <!-- Historial de revisiones -->
          <h3>Historial de revisiones</h3>

          <p v-if="vehicleReviewsHistory.length === 0">
            No hay revisiones registradas para este vehículo.
          </p>

          <UTable
            v-else
            :data="vehicleReviewsHistory"
            :columns="reviewHistoryColumns"
            caption="Historial de revisiones"
          >
            <template #type-cell="{ row }">{{ row.original.reviewType.name }}</template>
            <template #validity-cell="{ row }">
              {{ formatCalendarDay(row.original.startsOn) }} al
              {{ formatCalendarDay(row.original.endsOn) }}
            </template>
            <template #notes-cell="{ row }">{{ row.original.notes || "—" }}</template>
            <template #recorded-cell="{ row }">
              {{ row.original.recordedBy.name }} ({{ formatInstantInLima(row.original.createdAt) }})
            </template>
            <template #status-cell="{ row }">
              <template v-if="row.original.voidedAt">
                <UBadge color="error" variant="subtle" size="xs" label="Anulada" />
                <p>{{ row.original.voidReason }} ({{ row.original.voidedBy?.name }})</p>
              </template>
              <UBadge v-else color="success" variant="subtle" size="xs" label="Válida" />
            </template>
            <template #actions-cell="{ row }">
              <UButton
                v-if="!row.original.voidedAt && voidingReview?.id !== row.original.id"
                color="error"
                variant="ghost"
                size="xs"
                label="Anular"
                @click="startVoidReview(row.original)"
              />
            </template>
          </UTable>

          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cerrar"
              @click="reviewsModal = false"
            />
          </div>
        </UPageBody>
      </template>
    </UModal>

    <!-- MODAL NUEVO TIPO DE REVISIÓN -->
    <UModal
      v-model:open="addReviewTypeModal"
      title="Nuevo tipo de revisión"
      description="Agrega un requisito de revisión vehicular (SOAT, Revisión técnica, Extintor, etc.)."
    >
      <template #body>
        <UForm :state="{}" :validate-on="[]" :loading-auto="false" @submit="submitCreateReviewType">
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

          <div class="flex justify-end gap-2">
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
        </UForm>
      </template>
    </UModal>
  </AppPage>
</template>
