import { describe, it } from "vitest";
import { expectNativeNuxtUi } from "../support/nuxt-ui-guard";

const CONTAINER_TEMPLATES = [
  "../../app/pages/maquila.vue",
  "../../app/pages/container-movements.vue",
  "../../app/pages/container-reconciliation.vue",
  "../../app/pages/container-counts.vue",
  "../../app/components/ContainerCountForm.vue",
];

/**
 * Las únicas clases que quedan en estas plantillas, cada una con lo que
 * ningún componente ni prop de Nuxt UI resuelve. Agregar una acá es una
 * decisión que se anota en el PR, no un atajo.
 */
const ALLOWED_CLASSES: Record<string, string> = {
  "w-full": "UInput y USelect son inline por defecto; el campo ocupa su fila",
  "flex justify-end gap-2": "botones de cancelar y confirmar separados y a la derecha",
  "flex flex-wrap items-center gap-2": "el desglose por tipo de envase en badges, en una línea",
  "list-disc pl-5":
    "las diferencias del conteo, con viñeta: una lista suelta no tiene estilo en Nuxt UI",
};

describe("envases y maquila con Nuxt UI nativo", () => {
  it.each(CONTAINER_TEMPLATES)(
    "%s no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón",
    (path) => {
      expectNativeNuxtUi(new URL(path, import.meta.url), ALLOWED_CLASSES);
    },
  );
});
