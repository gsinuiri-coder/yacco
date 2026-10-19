import { describe, it } from "vitest";
import { expectNativeNuxtUi } from "../support/nuxt-ui-guard";

const ADMIN_TEMPLATES = [
  "../../app/pages/users.vue",
  "../../app/pages/vehicles/index.vue",
  "../../app/pages/issuer-settings.vue",
];

/**
 * Las únicas clases que quedan en estas plantillas, cada una con lo que
 * ningún componente ni prop de Nuxt UI resuelve. Agregar una acá es una
 * decisión que se anota en el PR, no un atajo.
 */
const ALLOWED_CLASSES: Record<string, string> = {
  "w-full": "UInput y USelect son inline por defecto; el campo ocupa su fila",
  "flex justify-end gap-2": "botones de cancelar y confirmar separados y a la derecha",
  "flex flex-wrap gap-2": "botones hermanos separados, sin fundirse como UFieldGroup",
  "size-5 animate-spin": "ícono de carga girando; UAlert no anima su ícono",
};

describe("usuarios, vehículos y datos de facturación con Nuxt UI nativo", () => {
  it.each(ADMIN_TEMPLATES)(
    "%s no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón",
    (path) => {
      expectNativeNuxtUi(new URL(path, import.meta.url), ALLOWED_CLASSES);
    },
  );
});
