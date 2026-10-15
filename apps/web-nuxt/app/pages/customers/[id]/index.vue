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

async function onStatementChanged(): Promise<void> {
  await resource.reload();
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
      <UPageBody v-if="customer">
        <UPageSection as="div" orientation="horizontal">
          <template #body>
            <UCard as="section" aria-label="Datos del cliente">
              <UPageBody>
                <UPageCard
                  title="Deuda actual"
                  :description="formatDebtBalance(customer.debtBalance)"
                  icon="i-lucide-wallet-cards"
                  :highlight="isAboveZero(customer.debtBalance)"
                  :highlight-color="isAboveZero(customer.debtBalance) ? 'error' : 'primary'"
                  variant="soft"
                >
                  <template #footer>
                    <UFieldGroup>
                      <UBadge
                        :color="customer.active ? 'success' : 'neutral'"
                        variant="subtle"
                        :label="customer.active ? 'Activo' : 'Desactivado'"
                      />
                      <UBadge
                        color="neutral"
                        variant="soft"
                        :label="`Límite de crédito: ${
                          customer.creditLimit === null
                            ? 'Sin límite'
                            : formatSoles(customer.creditLimit)
                        }`"
                      />
                    </UFieldGroup>
                  </template>
                </UPageCard>

                <UPageGrid>
                  <UPageCard title="Teléfono" :description="customer.phone" variant="soft" />
                  <UPageCard
                    title="Zona"
                    :description="customer.zone?.name ?? 'Sin zona'"
                    variant="soft"
                  />
                  <UPageCard title="Dirección" variant="soft">
                    <template #description>
                      <LinkedText :text="customer.address" />
                    </template>
                    <template #footer>
                      <LinkedText :text="customer.addressReference" />
                    </template>
                  </UPageCard>
                </UPageGrid>
                <UPageCard
                  v-if="customer.documentType && customer.documentNumber"
                  :title="`Documento (${customer.documentType})`"
                  :description="customer.documentNumber"
                  variant="soft"
                >
                  <UPageBody v-if="customer.legalName || customer.fiscalAddress">
                    <UPageCard
                      v-if="customer.legalName"
                      title="Razón social"
                      :description="customer.legalName"
                      variant="subtle"
                    />
                    <UPageCard
                      v-if="customer.fiscalAddress"
                      title="Dirección fiscal"
                      :description="customer.fiscalAddress"
                      variant="subtle"
                    />
                  </UPageBody>
                </UPageCard>
              </UPageBody>
            </UCard>
          </template>

          <CustomerAccountStatementSection
            :customer-id="customer.id"
            :refresh-signal="statementRefresh"
          />
        </UPageSection>

        <CustomerContactsSection
          :customer-id="customer.id"
          :can-edit="session.hasRole('ADMIN') || session.hasRole('SELLER')"
        />

        <CustomerLocationSection :customer-id="customer.id" />

        <CustomerPaymentSection :customer-id="customer.id" @registered="paymentRegistered" />
        <CustomerReceiptsSection
          v-if="session.hasRole('ADMIN') || session.hasRole('SELLER')"
          :customer-id="customer.id"
          :is-admin="session.hasRole('ADMIN')"
        />
        <CustomerPricesSection :customer-id="customer.id" :is-admin="session.hasRole('ADMIN')" />
        <CustomerContainersSection
          v-if="session.hasRole('ADMIN') || session.hasRole('SELLER')"
          :customer-id="customer.id"
        />
        <CustomerAccessoriesSection
          v-if="session.hasRole('ADMIN') || session.hasRole('SELLER')"
          :customer-id="customer.id"
          @statement-changed="onStatementChanged"
        />
        <CustomerMaquilaSection
          v-if="session.hasRole('ADMIN') || session.hasRole('SELLER')"
          :customer-id="customer.id"
          @statement-changed="onStatementChanged"
        />
      </UPageBody>
    </ResourceState>
  </AppPage>
</template>
