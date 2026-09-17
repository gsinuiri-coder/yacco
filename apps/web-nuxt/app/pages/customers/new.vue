<script setup lang="ts">
import type { Customer } from "@yacco/shared";
import type { CustomerFormValues } from "../../utils/customer-form";

useHead({ title: "Nuevo cliente · Yacco" });

const api = useApi();
const zones = useActiveZones();
const submitting = ref(false);
const submitError = ref<string | null>(null);

async function register(values: CustomerFormValues): Promise<void> {
  submitting.value = true;
  submitError.value = null;
  try {
    await api.request<Customer>("/customers", { method: "POST", body: createBodyFrom(values) });
    await navigateTo("/customers");
  } catch (error) {
    // El 400 de la API trae el motivo: mostrarlo tal cual vale más que un
    // "no se pudo" genérico.
    submitError.value = describeApiFailure(error);
    submitting.value = false;
  }
}
</script>

<template>
  <AppPage title="Nuevo cliente" description="Se registra con deuda S/ 0.00 y sin envases prestados.">
    <template #actions>
      <UButton to="/customers" color="neutral" variant="ghost" icon="i-lucide-arrow-left" label="Clientes" />
    </template>
    <div class="max-w-3xl">
      <CustomerForm
        :initial-values="blankCustomerForm()"
        submit-label="Registrar cliente"
        :submitting="submitting"
        :submit-error="submitError"
        :zones="zones"
        @submit="register"
        @cancel="navigateTo('/customers')"
      />
    </div>
  </AppPage>
</template>
