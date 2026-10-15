import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SECTION_TEMPLATES = [
  "../../app/components/CustomerAccountStatementSection.vue",
  "../../app/components/CustomerContactsSection.vue",
  "../../app/components/CustomerLocationSection.vue",
  "../../app/components/CustomerPaymentSection.vue",
  "../../app/components/CustomerReceiptsSection.vue",
  "../../app/components/CustomerPricesSection.vue",
  "../../app/components/CustomerContainersSection.vue",
  "../../app/components/CustomerAccessoriesSection.vue",
  "../../app/components/CustomerMaquilaSection.vue",
];

/**
 * Las únicas clases que quedan en estas plantillas, cada una con lo que
 * ningún componente ni prop de Nuxt UI resuelve. Agregar una acá es una
 * decisión que se anota en el PR, no un atajo.
 */
const ALLOWED_CLASSES: Record<string, string> = {
  "w-full": "UInput, USelect y UTextarea son inline por defecto; el campo ocupa su fila",
  "w-32": "el precio editado en la fila mantiene el ancho de la columna",
  "flex justify-end gap-2": "botones de cancelar y confirmar separados y a la derecha",
  "flex flex-wrap gap-2": "botones hermanos separados, sin fundirse como UFieldGroup",
  "flex flex-wrap items-center gap-2": "texto y badges en una línea, separados",
  "flex flex-wrap items-center justify-end gap-2": "confirmación en la fila, a la derecha",
  "grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end":
    "método, monto y botón en una fila, alineados abajo; UPageGrid reparte en partes iguales",
  "size-5 animate-spin": "ícono de carga girando; UAlert no anima su ícono",
  "text-error": "precio faltante en rojo, como antes",
};

function templateOf(relativePath: string): string {
  const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
  return source.slice(source.indexOf("<template>"));
}

describe("secciones de cliente con Nuxt UI nativo", () => {
  it.each(SECTION_TEMPLATES)(
    "%s no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón",
    (path) => {
      const template = templateOf(path);

      expect(template).not.toMatch(/<table\b/);
      expect(template).not.toMatch(/<form\b/);
      expect(template).not.toMatch(/:ui=/);
      expect(template).not.toMatch(/(:|v-bind:)class=/);

      const classes = [...template.matchAll(/\sclass="([^"]*)"/g)].map((match) => match[1]);
      for (const value of classes) {
        expect(ALLOWED_CLASSES, `clase sin razón en ${path}`).toHaveProperty([value!]);
      }
    },
  );
});
