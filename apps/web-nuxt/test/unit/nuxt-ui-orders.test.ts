import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectPageListsAreLists } from "../support/nuxt-ui-guard";

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
      expectPageListsAreLists(new URL(path, import.meta.url));
    },
  );

  it("usa los componentes nativos para formulario, grillas y tablas", () => {
    const list = templateOf("../../app/pages/orders/index.vue");
    expect(list).toContain("<UPageGrid");
    expect(list).toContain("<UFieldGroup");
    expect(list).toContain("<UUser");
    expect(list).toContain("<UTable");

    const create = templateOf("../../app/pages/orders/new.vue");
    expect(create).toContain("<UForm");
    expect(create).toContain("<UPageGrid");
    expect(create).toContain("<UFieldGroup");

    const detail = templateOf("../../app/pages/orders/[id].vue");
    expect(detail).toContain("<UPageCard");
    expect(detail).toContain("<UFieldGroup");
    expect(detail).toContain("<UTable");

    const undelivered = templateOf("../../app/pages/orders/undelivered.vue");
    expect(undelivered).toContain("<UPageGrid");
    expect(undelivered).toContain("<UFieldGroup");
    expect(undelivered).toContain("<UUser");
    expect(undelivered).toContain("<UTable");

    const editor = templateOf("../../app/components/OrderLinesEditor.vue");
    expect(editor).toContain("<UFieldGroup");
    expect(editor).toContain("<UTable");
  });
});
