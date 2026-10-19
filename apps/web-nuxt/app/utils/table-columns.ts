import { h } from "vue";

/**
 * Ajustes de columna de `UTable` que Nuxt UI no trae como prop: la tabla solo
 * acepta clases por `meta`. Viven acá para que cada clase que queda en las
 * tablas esté en un solo lugar.
 */

/** Montos, cantidades y acciones alineados a la derecha, cabecera incluida. */
export const RIGHT_ALIGNED = { class: { th: "text-right", td: "text-right" } };

/** Texto libre (un motivo, un local) que parte en líneas en vez de estirar la tabla. */
export const WRAPPING_TEXT = { class: { td: "whitespace-normal" } };

/** Columna que solo ocupa lo que mide su contenido (una casilla). */
export const SHRINK_TO_CONTENT = { class: { td: "w-0" } };

/**
 * Cabecera que el lector de pantalla anuncia y no se ve, para columnas cuyo
 * contenido ya se explica solo (botones, casillas).
 */
export function hiddenHeader(label: string): () => ReturnType<typeof h> {
  return () => h("span", { class: "sr-only" }, label);
}
