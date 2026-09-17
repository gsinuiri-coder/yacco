import type { Ref } from "vue";

/** A partir de acá la interfaz avisa que el servidor está despertando. */
export const SLOW_REQUEST_NOTICE_MS = 5_000;

export const SLOW_REQUEST_MESSAGE = "Conectando con el servidor, puede tardar un momento…";

/**
 * True cuando una petición en curso pasa de SLOW_REQUEST_NOTICE_MS. Demo
 * duerme sin tráfico (D-008) y sin aviso la espera se lee como una app colgada.
 */
export function useSlowRequest(pending: Ref<boolean>): Readonly<Ref<boolean>> {
  const slow = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function stop(): void {
    clearTimeout(timer);
    timer = undefined;
  }

  watch(
    pending,
    (isPending) => {
      stop();
      slow.value = false;
      if (isPending) {
        timer = setTimeout(() => {
          slow.value = true;
        }, SLOW_REQUEST_NOTICE_MS);
      }
    },
    { immediate: true },
  );
  onScopeDispose(stop);

  return readonly(slow);
}
