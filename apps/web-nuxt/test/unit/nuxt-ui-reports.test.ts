import { describe, it } from "vitest";
import { expectNativeNuxtUi } from "../support/nuxt-ui-guard";

const REPORT_TEMPLATES = [
  "../../app/components/ReportState.vue",
  "../../app/pages/reports/production.vue",
  "../../app/pages/reports/debt.vue",
  "../../app/pages/reports/debt-reconciliation.vue",
  "../../app/pages/reports/loaned-containers.vue",
  "../../app/pages/reports/borrowed-accessories.vue",
];

/**
 * Las únicas clases que quedan en estas plantillas, cada una con lo que
 * ningún componente ni prop de Nuxt UI resuelve. Agregar una acá es una
 * decisión que se anota en el PR, no un atajo.
 */
const ALLOWED_CLASSES: Record<string, string> = {
  "w-full": "UInput y USelect son inline por defecto; el campo ocupa su fila",
};

describe("reportes con Nuxt UI nativo", () => {
  it.each(REPORT_TEMPLATES)(
    "%s no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón",
    (path) => {
      expectNativeNuxtUi(new URL(path, import.meta.url), ALLOWED_CLASSES);
    },
  );
});
