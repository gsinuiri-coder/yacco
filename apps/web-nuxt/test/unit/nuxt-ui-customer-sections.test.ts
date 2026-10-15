import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SECTION_TEMPLATES = [
  "../../app/components/SectionCard.vue",
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

function templateOf(relativePath: string): string {
  const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
  return source.slice(source.indexOf("<template>"));
}

describe("secciones de cliente con Nuxt UI nativo", () => {
  it.each(SECTION_TEMPLATES)(
    "%s no maqueta con clases ni elementos HTML sustituidos por Nuxt UI",
    (path) => {
      const template = templateOf(path);

      expect(template).not.toMatch(/\s:?class=/);
      expect(template).not.toMatch(/<table\b/);
      expect(template).not.toMatch(/<form\b/);
      expect(template).not.toMatch(/:ui=/);
    },
  );

  it("usa formularios y tablas nativos donde hay captura de datos o grillas", () => {
    expect(templateOf("../../app/components/SectionCard.vue")).toContain("<UPageCard");

    for (const path of [
      "../../app/components/CustomerContactsSection.vue",
      "../../app/components/CustomerLocationSection.vue",
      "../../app/components/CustomerPaymentSection.vue",
      "../../app/components/CustomerPricesSection.vue",
      "../../app/components/CustomerAccessoriesSection.vue",
      "../../app/components/CustomerMaquilaSection.vue",
    ]) {
      expect(templateOf(path)).toContain("<UForm");
    }

    for (const path of [
      "../../app/components/CustomerAccountStatementSection.vue",
      "../../app/components/CustomerReceiptsSection.vue",
      "../../app/components/CustomerPricesSection.vue",
      "../../app/components/CustomerAccessoriesSection.vue",
      "../../app/components/CustomerMaquilaSection.vue",
    ]) {
      expect(templateOf(path)).toContain("<UTable");
    }
  });
});
