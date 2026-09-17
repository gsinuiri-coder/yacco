import type { Ref } from "vue";

/** Una copia de `source` que se actualiza recién cuando deja de cambiar por `delayMs`. */
export function useDebounced<T>(source: Ref<T>, delayMs: number): Readonly<Ref<T>> {
  const settled = ref(source.value) as Ref<T>;
  let timer: ReturnType<typeof setTimeout> | undefined;

  watch(source, (value) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      settled.value = value;
    }, delayMs);
  });
  onScopeDispose(() => clearTimeout(timer));

  return readonly(settled) as Readonly<Ref<T>>;
}
