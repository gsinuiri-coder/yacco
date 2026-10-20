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
  "../../app/components/CustomerLocationPhotos.vue",
  "../../app/components/LocationPhotoImg.vue",
  "../../app/components/AppPage.vue",
  "../../app/pages/sales.vue",
  "../../app/layouts/default.vue",
  "../../app/app.vue",
];

/**
 * Las únicas clases que quedan en estas plantillas, cada una con lo que
 * ningún componente ni prop de Nuxt UI resuelve. Agregar una acá es una
 * decisión que se anota en el PR, no un atajo.
 */
const ALLOWED_CLASSES: Record<string, string> = {
  "w-full": "UInputMenu y UInput son inline por defecto; el campo ocupa su fila",
  "size-8 animate-spin":
    "el ícono de carga gira; la prop loading de UEmpty pone aria-busy, que calla el role=status",
  "flex items-center justify-between gap-4 border-t border-default px-4 py-3":
    "el pie de la lista: la página a un lado y los botones al otro, separado de las filas",
  "text-sm text-muted": "el número de página como texto auxiliar, no como contenido",
  "flex flex-col gap-1.5": "el nombre del filtro encima de sus botones",
  "text-sm font-medium text-default":
    "el nombre de un grupo de botones o casillas con el aspecto de la etiqueta de UFormField, que no sirve: su <label> apunta a un solo control",
  "sr-only":
    "un nombre que lee el lector y no se ve: los días en la edición en fila, el selector de foto",
  "mt-1.5 flex flex-wrap gap-x-4 gap-y-2": "los siete días en fila, bajando de línea si no entran",
  "break-all underline": "un enlace dentro de un texto se distingue, y una URL larga no desborda",
  hidden: "el selector de archivo del navegador no se ve: lo abre el botón «Subir foto»",
  "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4":
    "miniaturas de fotos, dos por fila en el teléfono y hasta cuatro; UPageGrid empieza en una",
  "group relative aspect-square cursor-pointer overflow-hidden rounded-md border border-default":
    "la miniatura cuadrada que se abre al tocarla y lleva encima sus acciones",
  "absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/60 via-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100":
    "las acciones sobre la foto, que aparecen al pasar por encima",
  "text-[10px] text-white": "el rótulo «Ver en grande» legible sobre la foto",
  "size-full": "la foto llena su miniatura",
  "space-y-4":
    "foto y datos apilados en el diálogo; UPageBody con v-if dentro del slot #body rompe el typecheck de CI",
  "flex items-center justify-between text-xs text-muted":
    "quién subió la foto y cuándo, a un lado, y «Ocultar foto» al otro",
  "font-medium text-highlighted": "el nombre de quien subió la foto resalta sobre su rótulo",
  "flex justify-end gap-2": "botones de cancelar y confirmar separados y a la derecha",
  "flex items-center justify-center overflow-hidden bg-elevated":
    "el cuadro de la foto, con fondo mientras carga o si no está",
  "flex size-full items-center justify-center text-xs text-muted":
    "«Cargando…» centrado en el cuadro de la foto; UEmpty no entra en una miniatura de 80 px",
  "flex size-full flex-col items-center justify-center p-2 text-center text-xs text-muted":
    "«No disponible» centrado en el cuadro de la foto, con su ícono encima",
  "mb-1 size-6": "el ícono de foto no disponible, chico para la miniatura",
  "mx-auto max-h-[60vh] w-auto rounded-lg object-contain":
    "la foto entera en el diálogo, sin recortar y sin pasar del alto de la pantalla",
  "size-full object-cover": "la foto llena su miniatura, recortada al cuadro",
};

describe("Componentes compartidos con Nuxt UI nativo", () => {
  it.each(SHARED_TEMPLATES)(
    "%s no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón",
    (path) => {
      expectNativeNuxtUi(new URL(path, import.meta.url), ALLOWED_CLASSES);
    },
  );
});
