<script setup lang="ts">
import type { CustomerContact } from "@yacco/shared";

const props = defineProps<{
  customerId: string;
  canEdit?: boolean;
}>();

const api = useApi();
const contacts = ref<CustomerContact[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

const addModalOpen = ref(false);
const newName = ref("");
const newPhone = ref("");
const adding = ref(false);
const addError = ref<string | null>(null);

const removingId = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    contacts.value = await api.request<CustomerContact[]>(
      `/customers/${props.customerId}/contacts`,
    );
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function openAddModal(): void {
  newName.value = "";
  newPhone.value = "";
  addError.value = null;
  addModalOpen.value = true;
}

async function addContact(): Promise<void> {
  const name = newName.value.trim();
  if (name === "") {
    addError.value = "El nombre del contacto es obligatorio";
    return;
  }

  adding.value = true;
  addError.value = null;
  try {
    const phone = newPhone.value.trim();
    await api.request<CustomerContact>(`/customers/${props.customerId}/contacts`, {
      method: "POST",
      body: {
        name,
        ...(phone ? { phone } : {}),
      },
    });
    addModalOpen.value = false;
    await load();
  } catch (error) {
    addError.value = describeApiFailure(error);
  } finally {
    adding.value = false;
  }
}

async function removeContact(contactId: string): Promise<void> {
  removingId.value = contactId;
  try {
    await api.request(`/customers/${props.customerId}/contacts/${contactId}`, {
      method: "DELETE",
    });
    await load();
  } catch (error) {
    const toast = useToast();
    toast.add({
      title: "Error al quitar contacto",
      description: describeApiFailure(error),
      color: "error",
    });
  } finally {
    removingId.value = null;
  }
}
</script>

<template>
  <SectionCard title="Contactos" description="Personas de contacto adicionales para este cliente.">
    <template #actions>
      <UButton
        v-if="canEdit"
        color="neutral"
        variant="outline"
        size="xs"
        icon="i-lucide-plus"
        label="Agregar contacto"
        @click="openAddModal"
      />
    </template>

    <div v-if="loading" class="py-3 text-sm text-muted">Cargando contactos…</div>

    <UAlert
      v-else-if="loadError"
      role="alert"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="loadError"
    />

    <div v-else-if="contacts.length === 0" class="py-3 text-sm text-muted">
      Sin contactos registrados.
    </div>

    <ul v-else class="flex flex-col divide-y divide-default">
      <li
        v-for="contact in contacts"
        :key="contact.id"
        class="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
      >
        <div>
          <p class="font-medium text-highlighted">{{ contact.name }}</p>
          <p v-if="contact.phone" class="text-xs text-muted tabular-nums">
            {{ contact.phone }}
          </p>
          <p v-else class="text-xs text-dimmed">Sin teléfono</p>
        </div>

        <UButton
          v-if="canEdit"
          color="error"
          variant="ghost"
          size="xs"
          icon="i-lucide-trash-2"
          label="Quitar"
          :loading="removingId === contact.id"
          @click="removeContact(contact.id)"
        />
      </li>
    </ul>

    <UModal v-model:open="addModalOpen" title="Agregar contacto">
      <template #body>
        <form class="space-y-4" @submit.prevent="addContact">
          <UAlert
            v-if="addError"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="addError"
          />

          <UFormField
            label="Nombre"
            required
            :error="addError && !newName.trim() ? addError : undefined"
          >
            <UInput
              v-model="newName"
              placeholder="Nombre de la persona"
              class="w-full"
              autocomplete="off"
            />
          </UFormField>

          <UFormField label="Teléfono (opcional)">
            <UInput
              v-model="newPhone"
              type="tel"
              placeholder="Teléfono o celular"
              class="w-full"
              autocomplete="off"
            />
          </UFormField>

          <div class="flex justify-end gap-2 pt-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="adding"
              @click="addModalOpen = false"
            />
            <UButton type="submit" label="Guardar contacto" :loading="adding" />
          </div>
        </form>
      </template>
    </UModal>
  </SectionCard>
</template>
