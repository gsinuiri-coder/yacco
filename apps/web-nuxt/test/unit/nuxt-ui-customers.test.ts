import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CUSTOMER_TEMPLATES = [
  "../../app/pages/customers/index.vue",
  "../../app/pages/customers/new.vue",
  "../../app/pages/customers/[id]/index.vue",
  "../../app/pages/customers/[id]/edit.vue",
  "../../app/components/CustomerForm.vue",
];

function templateOf(relativePath: string): string {
  const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
  return source.slice(source.indexOf("<template>"));
}

describe("clientes con Nuxt UI nativo", () => {
  it.each(CUSTOMER_TEMPLATES)(
    "%s no maqueta con clases ni elementos HTML sustituidos por Nuxt UI",
    (path) => {
      const template = templateOf(path);

      expect(template).not.toMatch(/\s:?class=/);
      expect(template).not.toMatch(/<table\b/);
      expect(template).not.toMatch(/<form\b/);
      expect(template).not.toMatch(/:ui=/);
    },
  );

  it("usa los componentes nativos para lista, ficha y formulario", () => {
    const list = templateOf("../../app/pages/customers/index.vue");
    expect(list).toContain("<UPageGrid");
    expect(list).toContain("<UUser");
    expect(list).toContain("<UTable");

    const detail = templateOf("../../app/pages/customers/[id]/index.vue");
    expect(detail).toContain("<UPageGrid");
    expect(detail).toContain("<UPageCard");
    expect(detail).toContain("<UFieldGroup");

    const form = templateOf("../../app/components/CustomerForm.vue");
    expect(form).toContain("<UForm");
    expect(form).toContain("<UPageGrid");
    expect(form).toContain("<UPageCard");
    expect(form).toContain("<UFieldGroup");
  });
});
