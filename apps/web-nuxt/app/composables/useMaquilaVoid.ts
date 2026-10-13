import type { MaquilaMovementItem } from "@yacco/shared";

export function useMaquilaVoid(afterVoid: () => Promise<void> | void) {
  const api = useApi();
  const voidModalOpen = ref(false);
  const targetMovement = ref<MaquilaMovementItem | null>(null);
  const voidReason = ref("");
  const voidSubmitting = ref(false);
  const voidError = ref<string | null>(null);

  function openVoidModal(movement: MaquilaMovementItem): void {
    targetMovement.value = movement;
    voidReason.value = "";
    voidError.value = null;
    voidModalOpen.value = true;
  }

  async function submitVoid(): Promise<void> {
    if (voidSubmitting.value || !targetMovement.value) return;
    const reason = voidReason.value.trim();
    if (reason.length < 3) {
      voidError.value = "El motivo debe tener al menos 3 caracteres";
      return;
    }

    voidSubmitting.value = true;
    voidError.value = null;
    try {
      await api.request(`/maquila/movements/${targetMovement.value.id}/void`, {
        method: "POST",
        body: { reason },
      });
      voidModalOpen.value = false;
      await afterVoid();
    } catch (error) {
      voidError.value = describeApiFailure(error);
    } finally {
      voidSubmitting.value = false;
    }
  }

  return {
    openVoidModal,
    submitVoid,
    voidError,
    voidModalOpen,
    voidReason,
    voidSubmitting,
  };
}
