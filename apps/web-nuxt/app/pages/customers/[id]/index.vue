<script setup lang="ts">
import { formatDebtBalance, formatSoles, isAboveZero } from "@yacco/shared";
import type { Customer } from "@yacco/shared";

const route = useRoute();
const customerId = String(route.params.id);
const session = useSession();
const resource = useApiResource<Customer>(`/customers/${customerId}`);
const customer = resource.data;
const statementRefresh = ref(0);

useHead(() => ({ title: `${customer.value?.name ?? "Cliente"} · Yacco` }));

/** Un cobro mueve la deuda que ya se ve, y agrega una fila al estado de cuenta. */
function paymentRegistered(debtBalance: string): void {
  if (customer.value) customer.value = { ...customer.value, debtBalance };
  statementRefresh.value++;
}
</script>

<template>
  <AppPage :title="customer?.name ?? 'Cliente'" :description="customer ? undefined : 'Cargando…'">
    <template #actions>
      <UButton
        to="/customers"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        label="Volver a clientes"
      />
      <UButton
        v-if="customer"
        :to="`/customers/${customer.id}/edit`"
        color="neutral"
        variant="outline"
        icon="i-lucide-pencil"
        label="Editar"
      />
    </template>

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
      <div v-if="customer" class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div class="space-y-6">
          <section
            aria-label="Datos del cliente"
            class="rounded-lg border border-default bg-default p-5"
          >
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="text-xs font-medium tracking-wide text-muted uppercase">Deuda actual</p>
                <p
                  class="mt-1 font-display text-3xl font-semibold tabular-nums"
                  :class="isAboveZero(customer.debtBalance) ? 'text-error' : 'text-highlighted'"
                >
                  {{ formatDebtBalance(customer.debtBalance) }}
                </p>
                <p class="mt-1 text-sm text-muted">
                  Límite de crédito:
                  {{
                    customer.creditLimit === null ? "Sin límite" : formatSoles(customer.creditLimit)
                  }}
                </p>
              </div>
              <UBadge
                :color="customer.active ? 'success' : 'neutral'"
                variant="subtle"
                size="lg"
                :label="customer.active ? 'Activo' : 'Desactivado'"
              />
            </div>
            <dl class="mt-5 grid gap-4 border-t border-default pt-5 text-sm sm:grid-cols-2">
              <div>
                <dt class="text-muted">Teléfono</dt>
                <dd class="font-medium text-highlighted">{{ customer.phone }}</dd>
              </div>
              <div>
                <dt class="text-muted">Zona</dt>
                <dd>
                  <UBadge
                    v-if="customer.zone"
                    color="neutral"
                    variant="soft"
                    :label="customer.zone.name"
                  />
                  <span v-else class="text-dimmed">Sin zona</span>
                </dd>
              </div>
              <div class="sm:col-span-2">
                <dt class="text-muted">Dirección</dt>
                <dd class="font-medium text-highlighted">
                  <LinkedText :text="customer.address" />
                </dd>
                <dd class="text-muted"><LinkedText :text="customer.addressReference" /></dd>
              </div>
            </dl>
          </section>

          <CustomerPaymentSection :customer-id="customer.id" @registered="paymentRegistered" />
          <CustomerPricesSection :customer-id="customer.id" :is-admin="session.hasRole('ADMIN')" />
        </div>

        <CustomerAccountStatementSection
          :customer-id="customer.id"
          :refresh-signal="statementRefresh"
        />
      </div>
    </ResourceState>
  </AppPage>
</template>
