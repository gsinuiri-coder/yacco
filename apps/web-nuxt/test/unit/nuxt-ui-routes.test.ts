import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROUTE_TEMPLATES = [
  "../../app/pages/routes/index.vue",
  "../../app/pages/routes/new.vue",
  "../../app/pages/routes/[id]/index.vue",
  "../../app/components/RouteMarkOutcome.vue",
  "../../app/components/RouteStopAddForm.vue",
  "../../app/components/RouteBatchStopsForm.vue",
  "../../app/components/RouteVehiclesSection.vue",
  "../../app/components/RouteLoadsSection.vue",
  "../../app/components/RouteStopsSection.vue",
  "../../app/components/RouteStopMarkForm.vue",
  "../../app/components/RoutePitStopsSection.vue",
  "../../app/components/RoutePitStopForm.vue",
  "../../app/pages/my-route.vue",
  "../../app/pages/routes/[id]/settlement.vue",
  "../../app/components/SettlementCountSheet.vue",
];

/**
 * Las únicas clases que quedan en estas plantillas, cada una con lo que
 * ningún componente ni prop de Nuxt UI resuelve. Agregar una acá es una
 * decisión que se anota en el PR, no un atajo.
 */
const ALLOWED_CLASSES: Record<string, string> = {
  "w-full": "UInput y USelect son inline por defecto; el campo ocupa su fila",
  "flex justify-end gap-2": "botones de cancelar y confirmar separados y a la derecha",
  "flex flex-wrap items-center gap-2": "texto y badges en una línea, separados",
  "flex flex-wrap items-center justify-end gap-2": "confirmación en la fila, a la derecha",
  "flex flex-wrap items-center justify-between gap-2":
    "«Agregar producto» a la izquierda y el total de la venta a la derecha, en la misma fila",
  "flex flex-wrap items-end gap-2":
    "tipo de envase, cantidad y quitar en una fila, alineados por la base del campo con etiqueta",
  "font-semibold text-highlighted":
    "el h3 del panel de registro va junto a la dirección en el #body de UPageCard, que no le da estilo de título",
  "mx-auto w-full max-w-xl": "«Mi ruta» se usa en el celular; en escritorio conserva ese ancho",
  "list-disc pl-5":
    "las diferencias de llenos y vacíos dentro del UAlert, con viñeta; el alerta no le da estilo a una lista",
  "text-warning":
    "la diferencia por tipo junto a la cantidad descargada, en amarillo como antes; es texto en la línea, no un aviso aparte",
};

function templateOf(relativePath: string): string {
  const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
  return source.slice(source.indexOf("<template>"));
}

describe("rutas con Nuxt UI nativo", () => {
  it.each(ROUTE_TEMPLATES)(
    "%s no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón",
    (path) => {
      const template = templateOf(path);

      expect(template).not.toMatch(/<table\b/);
      expect(template).not.toMatch(/<form\b/);
      expect(template).not.toMatch(/<dl\b/);
      expect(template).not.toMatch(/:ui=/);
      expect(template).not.toMatch(/(:|v-bind:)class=/);

      const classes = [...template.matchAll(/\sclass="([^"]*)"/g)].map((match) => match[1]);
      for (const value of classes) {
        expect(ALLOWED_CLASSES, `clase sin razón en ${path}`).toHaveProperty([value!]);
      }
    },
  );
});
