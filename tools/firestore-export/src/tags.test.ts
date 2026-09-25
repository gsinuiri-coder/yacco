import { describe, expect, it } from "vitest";
import { toCustomerTags } from "./tags.js";

describe("toCustomerTags", () => {
  it("deja solo el id y las etiquetas, en su orden", () => {
    const docs = [
      {
        id: "a1",
        data: { name: "Bodega Real", phone: "987654321", tags: ["SURCO", " EMPRESAS "] },
      },
    ];

    expect(toCustomerTags(docs)).toEqual([{ externalCode: "a1", tags: ["SURCO", "EMPRESAS"] }]);
    expect(JSON.stringify(toCustomerTags(docs))).not.toContain("Bodega Real");
    expect(JSON.stringify(toCustomerTags(docs))).not.toContain("987654321");
  });

  it("sin etiquetas, o con basura en vez de texto, queda con la lista vacía", () => {
    const docs = [
      { id: "b1", data: {} },
      { id: "b2", data: { tags: "SURCO" } },
      { id: "b3", data: { tags: [3, "", null, "PARQUE"] } },
    ];

    expect(toCustomerTags(docs)).toEqual([
      { externalCode: "b1", tags: [] },
      { externalCode: "b2", tags: [] },
      { externalCode: "b3", tags: ["PARQUE"] },
    ]);
  });
});
