<script setup lang="ts">
const props = defineProps<{ receiptId: string; fileName: string }>();

const session = useSession();
const opening = ref(false);
const error = ref<string | null>(null);

async function openFile(): Promise<void> {
  if (opening.value) return;
  opening.value = true;
  error.value = null;
  try {
    const token = session.accessToken();
    const response = await fetch(
      `/api/v1/receipts/${props.receiptId}/files/${encodeURIComponent(props.fileName)}/raw`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!response.ok) throw new Error();
    const objectUrl = URL.createObjectURL(await response.blob());
    window.open(objectUrl, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch {
    error.value = `No se pudo abrir ${props.fileName}. Intenta otra vez.`;
  } finally {
    opening.value = false;
  }
}
</script>

<template>
  <div>
    <UButton
      color="neutral"
      variant="outline"
      icon="i-lucide-paperclip"
      :label="`Abrir ${fileName}`"
      :loading="opening"
      @click="openFile"
    />
    <p v-if="error" role="alert" class="mt-1 text-sm text-error">{{ error }}</p>
  </div>
</template>
