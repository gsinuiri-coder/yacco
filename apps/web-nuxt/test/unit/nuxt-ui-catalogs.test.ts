import { describe, it } from "vitest";
import { expectNativeNuxtUi } from "../support/nuxt-ui-guard";

const CATALOG_TEMPLATES = [
  "../../app/pages/container-types.vue",
  "../../app/pages/zones.vue",
  "../../app/pages/products.vue",
  "../../app/pages/accessories.vue",
];

/**
 * Las únicas clases que quedan en estas plantillas, cada una con lo que
 * ningún componente ni prop de Nuxt UI resuelve. Agregar una acá es una
 * decisión que se anota en el PR, no un atajo.
 */
const ALLOWED_CLASSES: Record<string, string> = {
  "w-full": "UInput y USelect son inline por defecto; el campo ocupa su fila",
  "flex justify-end gap-2": "botones de cancelar y confirmar separados y a la derecha",
};

describe("catálogos con Nuxt UI nativo", () => {
  it.each(CATALOG_TEMPLATES)(
    "%s no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón",
    (path) => {
      expectNativeNuxtUi(new URL(path, import.meta.url), ALLOWED_CLASSES);
    },
  );
});
