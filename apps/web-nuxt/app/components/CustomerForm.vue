<script setup lang="ts">
import type { CustomerFormErrors, CustomerFormValues, ZoneOption } from "../utils/customer-form";

const props = defineProps<{
  initialValues: CustomerFormValues;
  submitLabel: string;
  submitting: boolean;
  /** El mensaje de la API (un 400 con su detalle). Nunca se traga. */
  submitError: string | null;
  zones: ZoneOption[];
  /** Sólo al editar: la baja vive acá; un cliente nuevo nace activo. */
  showActiveToggle?: boolean;
}>();

const emit = defineEmits<{ submit: [values: CustomerFormValues]; cancel: [] }>();

const values = reactive<CustomerFormValues>({ ...props.initialValues });
const errors = ref<CustomerFormErrors>({});

// Reka Select no admite "" como valor de una opción: "Sin zona" viaja como
// este centinela y se traduce en el borde.
const NO_ZONE = "__none__";
const zoneItems = computed(() => [
  { label: "Sin zona", value: NO_ZONE },
  ...props.zones.map((zone) => ({ label: zone.name, value: zone.id })),
]);
const zoneModel = computed({
  get: () => (values.zoneId === "" ? NO_ZONE : values.zoneId),
  set: (value: string) => {
    values.zoneId = value === NO_ZONE ? "" : value;
  },
});

// Corregir un campo borra SU error, no el de los demás: revalidar todo en cada
// tecla marcaría campos que el usuario todavía no terminó de escribir.
for (const key of Object.keys(values) as Array<keyof CustomerFormValues>) {
  watch(
    () => values[key],
    () => {
      if (errors.value[key]) errors.value = { ...errors.value, [key]: undefined };
    },
  );
}

function submit(): void {
  errors.value = checkCustomerForm(values);
  if (Object.values(errors.value).every((message) => message === undefined)) {
    emit("submit", { ...values });
  }
}
</script>

<template>
  <UCard>
    <form class="space-y-6" novalidate @submit.prevent="submit">
      <UAlert
        v-if="submitError"
        role="alert"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="submitError"
      />

      <fieldset class="grid gap-5 sm:grid-cols-2" :disabled="submitting">
        <legend class="sr-only">Datos del cliente</legend>
        <UFormField label="Nombre" name="name" :error="errors.name">
          <UInput v-model="values.name" class="w-full" autocomplete="off" />
        </UFormField>
        <UFormField label="Teléfono" name="phone" :error="errors.phone">
          <UInput v-model="values.phone" type="tel" class="w-full" autocomplete="off" />
        </UFormField>
        <UFormField label="Dirección" name="address" :error="errors.address" class="sm:col-span-2">
          <UInput v-model="values.address" class="w-full" autocomplete="off" />
        </UFormField>
        <UFormField
          label="Referencia"
          name="addressReference"
          :error="errors.addressReference"
          help="Cómo encontrar la puerta: un color, una esquina, un negocio al lado."
          class="sm:col-span-2"
        >
          <UInput v-model="values.addressReference" class="w-full" autocomplete="off" />
        </UFormField>
        <UFormField label="Zona (opcional)" name="zoneId">
          <USelect v-model="zoneModel" :items="zoneItems" class="w-full" />
        </UFormField>
        <UFormField
          label="Límite de crédito (opcional)"
          name="creditLimit"
          :error="errors.creditLimit"
          help="En soles, con dos decimales. Avisa al superarse; nunca bloquea la venta."
        >
          <UInput
            v-model="values.creditLimit"
            inputmode="decimal"
            placeholder="150.00"
            class="w-full"
          >
            <template #leading><span class="text-sm text-muted">S/</span></template>
          </UInput>
        </UFormField>

        <div class="sm:col-span-2">
          <slot name="summary" />
        </div>

        <UCheckbox
          v-if="showActiveToggle"
          v-model="values.active"
          label="Cliente activo"
          description="Al desactivarlo deja de aparecer en el reparto. No se borra: su historial de pedidos y deuda se conserva."
          class="sm:col-span-2"
        />
      </fieldset>

      <div class="flex justify-end gap-3 border-t border-default pt-5">
        <UButton
          color="neutral"
          variant="outline"
          label="Cancelar"
          :disabled="submitting"
          @click="emit('cancel')"
        />
        <UButton
          type="submit"
          :loading="submitting"
          :label="submitting ? 'Guardando…' : submitLabel"
        />
      </div>
    </form>
  </UCard>
</template>
