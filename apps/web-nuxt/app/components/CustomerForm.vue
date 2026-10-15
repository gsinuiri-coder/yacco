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

const NO_DOC_TYPE = "__none__";
const docTypeItems = [
  { label: "Sin documento", value: NO_DOC_TYPE },
  { label: "RUC", value: "RUC" },
  { label: "DNI", value: "DNI" },
  { label: "Carné de extranjería", value: "CE" },
];
const docTypeModel = computed({
  get: () => (values.documentType === "" ? NO_DOC_TYPE : values.documentType),
  set: (value: string) => {
    values.documentType = value === NO_DOC_TYPE ? "" : value;
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
  <UForm
    :state="values"
    :validate-on="[]"
    :loading-auto="false"
    :disabled="submitting"
    novalidate
    @submit="submit"
  >
    <UAlert
      v-if="submitError"
      role="alert"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="submitError"
    />

    <UCard>
      <UPageGrid>
        <UFormField label="Nombre" name="name" :error="errors.name">
          <UInput v-model="values.name" autocomplete="off" />
        </UFormField>
        <UFormField label="Teléfono" name="phone" :error="errors.phone">
          <UInput v-model="values.phone" type="tel" autocomplete="off" />
        </UFormField>
        <UFormField label="Dirección" name="address" :error="errors.address">
          <UInput v-model="values.address" autocomplete="off" />
        </UFormField>
        <UFormField
          label="Referencia"
          name="addressReference"
          :error="errors.addressReference"
          help="Cómo encontrar la puerta: un color, una esquina, un negocio al lado."
        >
          <UInput v-model="values.addressReference" autocomplete="off" />
        </UFormField>
        <UFormField label="Zona (opcional)" name="zoneId">
          <USelect v-model="zoneModel" :items="zoneItems" />
        </UFormField>
        <UFormField
          label="Límite de crédito (opcional)"
          name="creditLimit"
          :error="errors.creditLimit"
          help="En soles, con dos decimales. Avisa al superarse; nunca bloquea la venta."
        >
          <UInput v-model="values.creditLimit" inputmode="decimal" placeholder="150.00">
            <template #leading>S/</template>
          </UInput>
        </UFormField>
      </UPageGrid>
    </UCard>

    <UPageCard title="Comprobante y datos fiscales (opcional)" variant="soft">
      <UPageGrid>
        <UFormField label="Tipo de documento" name="documentType" :error="errors.documentType">
          <USelect v-model="docTypeModel" :items="docTypeItems" />
        </UFormField>
        <UFormField
          label="Número de documento"
          name="documentNumber"
          :error="errors.documentNumber"
        >
          <UInput
            v-model="values.documentNumber"
            autocomplete="off"
            :placeholder="
              values.documentType === 'RUC'
                ? '11 dígitos'
                : values.documentType === 'DNI'
                  ? '8 dígitos'
                  : ''
            "
          />
        </UFormField>
        <UFormField label="Razón social / Nombre legal" name="legalName" :error="errors.legalName">
          <UInput v-model="values.legalName" autocomplete="off" />
        </UFormField>
        <UFormField label="Dirección fiscal" name="fiscalAddress" :error="errors.fiscalAddress">
          <UInput v-model="values.fiscalAddress" autocomplete="off" />
        </UFormField>
      </UPageGrid>
    </UPageCard>

    <slot v-if="$slots.summary" name="summary" />

    <UCard v-if="showActiveToggle">
      <template #header>
        <UCheckbox
          v-model="values.active"
          label="Cliente activo"
          description="Al desactivarlo deja de aparecer en el reparto. No se borra: su historial de pedidos y deuda se conserva."
        />
      </template>
    </UCard>

    <UFieldGroup>
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
    </UFieldGroup>
  </UForm>
</template>
