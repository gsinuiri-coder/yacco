import { describe, it } from "vitest";
import { expectNativeNuxtUi } from "../support/nuxt-ui-guard";

const PRODUCTION_TEMPLATES = [
  "../../app/pages/production.vue",
  "../../app/components/ProductionMaquilaSection.vue",
];

/**
 * Las únicas clases que quedan en estas plantillas, cada una con lo que
 * ningún componente ni prop de Nuxt UI resuelve. Agregar una acá es una
 * decisión que se anota en el PR, no un atajo.
 */
const ALLOWED_CLASSES: Record<string, string> = {
  "w-full": "UInput y USelect son inline por defecto; el campo ocupa su fila",
  "flex justify-end gap-2": "botones de cancelar y confirmar separados y a la derecha",
  "flex flex-wrap items-center gap-2":
    "badges en una línea, separados; y «Agregar tipo de envase» sin estirarse a todo el ancho",
  "flex flex-wrap items-end gap-2":
    "tipo de envase, cantidad y quitar en una fila, alineados por la base del campo con etiqueta",
  "list-disc pl-5":
    "los tipos sobreproducidos dentro del UAlert, con viñeta; el alerta no le da estilo a una lista",
};

describe("producción con Nuxt UI nativo", () => {
  it.each(PRODUCTION_TEMPLATES)(
    "%s no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón",
    (path) => {
      expectNativeNuxtUi(new URL(path, import.meta.url), ALLOWED_CLASSES);
    },
  );
});
