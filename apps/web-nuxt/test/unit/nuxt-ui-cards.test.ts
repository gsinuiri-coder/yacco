import { describe, expect, it } from "vitest";
import { expectNativeNuxtUi, templateOf } from "../support/nuxt-ui-guard";

const SECTION_CARD = "../../app/components/SectionCard.vue";
const STAT_TILE = "../../app/components/StatTile.vue";

/**
 * Las únicas clases que quedan en estas plantillas, cada una con lo que
 * ningún componente ni prop de Nuxt UI resuelve. Agregar una acá es una
 * decisión que se anota en el PR, no un atajo.
 */
const ALLOWED_CLASSES: Record<string, string> = {
  "flex flex-wrap items-center gap-2":
    "varias acciones de la sección en fila y separadas; UFieldGroup las pegaría como un solo control",
  "rounded-md bg-elevated px-4 py-3":
    "la caja del dato: un <dl> pide <dt>/<dd> hijos directos de este <div>, y ningún componente de Nuxt UI lo pinta",
  "text-xs font-medium tracking-wide text-muted uppercase": "la etiqueta del dato (<dt>)",
  "mt-1 text-xl font-semibold text-highlighted": "el valor del dato (<dd>)",
  "mt-1 text-xl font-semibold text-warning": "el valor de un dato que pide atención",
  "mt-1 text-xl font-semibold text-success": "el valor de un dato que cuadró",
  "mt-0.5 text-xs text-muted": "la aclaración de qué significa el dato",
};

describe("SectionCard y StatTile con Nuxt UI nativo", () => {
  it.each([SECTION_CARD, STAT_TILE])(
    "%s no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón",
    (path) => {
      expectNativeNuxtUi(new URL(path, import.meta.url), ALLOWED_CLASSES);
    },
  );

  it("SectionCard es una UPageCard, no una caja armada con clases", () => {
    expect(templateOf(new URL(SECTION_CARD, import.meta.url))).toMatch(/<UPageCard\b/);
  });
});
