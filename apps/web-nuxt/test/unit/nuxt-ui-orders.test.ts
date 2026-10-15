import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ORDER_TEMPLATES = [
  "../../app/pages/orders/index.vue",
  "../../app/pages/orders/new.vue",
  "../../app/pages/orders/[id].vue",
  "../../app/pages/orders/undelivered.vue",
  "../../app/components/OrderLinesEditor.vue",
];

function templateOf(relativePath: string): string {
  const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
  return source.slice(source.indexOf("<template>"));
}

describe("pedidos con Nuxt UI nativo", () => {
  it.each(ORDER_TEMPLATES)(
    "%s no maqueta con clases ni elementos HTML sustituidos por Nuxt UI",
    (path) => {
      const template = templateOf(path);

      expect(template).not.toMatch(/\s:?class=/);
      expect(template).not.toMatch(/<table\b/);
      expect(template).not.toMatch(/<form\b/);
      expect(template).not.toMatch(/:ui=/);
    },
  );

  it("usa los componentes nativos para formulario, grillas y tablas", () => {
    expect(templateOf("../../app/pages/orders/new.vue")).toContain("<UForm");
    expect(templateOf("../../app/pages/orders/index.vue")).toContain("<UPageGrid");
    expect(templateOf("../../app/pages/orders/[id].vue")).toContain("<UTable");
    expect(templateOf("../../app/components/OrderLinesEditor.vue")).toContain("<UTable");
  });
});
