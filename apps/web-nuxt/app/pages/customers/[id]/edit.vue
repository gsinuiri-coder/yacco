<script setup lang="ts">
import { formatSoles } from "@yacco/shared";
import type { Customer } from "@yacco/shared";
import type { CustomerFormValues } from "../../../utils/customer-form";

const route = useRoute();
const customerId = String(route.params.id);
const api = useApi();
const zones = useActiveZones();
const resource = useApiResource<Customer>(`/customers/${customerId}`);
const customer = resource.data;
const submitting = ref(false);
const submitError = ref<string | null>(null);

useHead(() => ({ title: `${customer.value?.name ?? "Editar cliente"} · Yacco` }));

async function save(values: CustomerFormValues): Promise<void> {
  submitting.value = true;
  submitError.value = null;
  try {
    await api.request<Customer>(`/customers/${customerId}`, {
      method: "PATCH",
      body: updateBodyFrom(values),
    });
    await navigateTo("/customers");
  } catch (error) {
    submitError.value = describeApiFailure(error);
    submitting.value = false;
  }
}
</script>

<template>
  <AppPage
    :title="customer?.name ?? 'Editar cliente'"
    description="Para dar de baja a un cliente, desmarca «Cliente activo». No se elimina."
  >
    <template #actions>
      <UButton
        :to="`/customers/${customerId}`"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        label="Ficha"
      />
    </template>

    <div class="max-w-3xl">
      <ResourceState
        :loading="resource.loading.value"
        :slow="resource.slow.value"
        :not-found="resource.notFound.value"
        :error-message="resource.errorMessage.value"
        noun="cliente"
        article="el"
        back-to="/customers"
        back-label="Volver a clientes"
        @retry="resource.reload"
      >
        <CustomerForm
          v-if="customer"
          :initial-values="formFromCustomer(customer)"
          submit-label="Guardar cambios"
          :submitting="submitting"
          :submit-error="submitError"
          :zones="zonesIncludingAssigned(zones, customer)"
          show-active-toggle
          @submit="save"
          @cancel="navigateTo('/customers')"
        >
          <template #summary>
            <div class="rounded-md bg-elevated p-4">
              <p class="text-xs font-medium tracking-wide text-muted uppercase">Deuda actual</p>
              <p class="mt-1 text-2xl font-semibold text-highlighted tabular-nums">
                {{ formatSoles(customer.debtBalance) }}
              </p>
              <p class="mt-1 text-sm text-muted">
                Sólo lectura: se mueve con las ventas y los pagos, no desde esta pantalla. Límite de
                crédito vigente:
                {{
                  customer.creditLimit === null ? "Sin límite" : formatSoles(customer.creditLimit)
                }}.
              </p>
            </div>
          </template>
        </CustomerForm>
      </ResourceState>
    </div>
  </AppPage>
</template>
