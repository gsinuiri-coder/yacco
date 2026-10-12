<script setup lang="ts">
const props = defineProps<{
  photoId: string;
  alt?: string;
  imgClass?: string;
}>();

const session = useSession();
const src = ref<string | null>(null);
const loading = ref(true);
const failed = ref(false);

async function loadBlob(): Promise<void> {
  loading.value = true;
  failed.value = false;
  try {
    const token = session.accessToken();
    const res = await fetch(`/api/v1/customer-locations/photos/${props.photoId}/raw`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      failed.value = true;
      return;
    }
    const blob = await res.blob();
    src.value = URL.createObjectURL(blob);
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(loadBlob);

onUnmounted(() => {
  if (src.value) {
    URL.revokeObjectURL(src.value);
  }
});

watch(
  () => props.photoId,
  () => {
    if (src.value) {
      URL.revokeObjectURL(src.value);
      src.value = null;
    }
    loadBlob();
  },
);
</script>

<template>
  <div class="relative flex items-center justify-center overflow-hidden bg-elevated">
    <div v-if="loading" class="flex size-full items-center justify-center text-xs text-muted">
      Cargando…
    </div>
    <div
      v-else-if="failed"
      class="flex size-full flex-col items-center justify-center p-2 text-center text-xs text-muted"
    >
      <UIcon name="i-lucide-image-off" class="size-6 text-muted mb-1" />
      <span>No disponible</span>
    </div>
    <img
      v-else-if="src"
      :src="src"
      :alt="alt ?? 'Foto de local'"
      :class="imgClass ?? 'size-full object-cover'"
    />
  </div>
</template>
