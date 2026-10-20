import { describe, it } from "vitest";
import { expectNativeNuxtUi } from "../support/nuxt-ui-guard";

const SHARED_TEMPLATES = [
  "../../app/components/ListStatus.vue",
  "../../app/components/ResourceState.vue",
  "../../app/components/ListPagination.vue",
  "../../app/components/SegmentedFilter.vue",
  "../../app/components/WithdrawConfirm.vue",
  "../../app/components/DeliveryDaysField.vue",
  "../../app/components/LinkedText.vue",
  "../../app/components/CustomerPicker.vue",
  "../../app/components/CustomerQuickSearch.vue",
];

/**
 * Las únicas clases que quedan en estas plantillas, cada una con lo que
 * ningún componente ni prop de Nuxt UI resuelve. Agregar una acá es una
 * decisión que se anota en el PR, no un atajo.
 */
const ALLOWED_CLASSES: Record<string, string> = {
  "w-full": "UInputMenu es inline por defecto; el campo ocupa su fila",
  "size-8 animate-spin":
    "el ícono de carga gira; la prop loading de UEmpty pone aria-busy, que calla el role=status",
  "flex items-center justify-between gap-4 border-t border-default px-4 py-3":
    "el pie de la lista: la página a un lado y los botones al otro, separado de las filas",
  "text-sm text-muted": "el número de página como texto auxiliar, no como contenido",
  "flex flex-col gap-1.5": "el nombre del filtro encima de sus botones",
  "text-sm font-medium text-default":
    "el nombre de un grupo de botones o casillas con el aspecto de la etiqueta de UFormField, que no sirve: su <label> apunta a un solo control",
  "sr-only": "en la edición en fila el nombre del grupo lo lee el lector, no se ve",
  "mt-1.5 flex flex-wrap gap-x-4 gap-y-2": "los siete días en fila, bajando de línea si no entran",
  "break-all underline": "un enlace dentro de un texto se distingue, y una URL larga no desborda",
};

describe("Componentes compartidos con Nuxt UI nativo", () => {
  it.each(SHARED_TEMPLATES)(
    "%s no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón",
    (path) => {
      expectNativeNuxtUi(new URL(path, import.meta.url), ALLOWED_CLASSES);
    },
  );
});
