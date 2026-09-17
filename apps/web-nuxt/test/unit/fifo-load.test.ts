import type { ProductionBatch } from "@yacco/shared";
import { describe, expect, it } from "vitest";
import { planFifoLoad } from "../../app/utils/fifo-load";
import { positiveWhole } from "../../app/utils/quantity";

const BIDON = "ct-bidon";
const BOTELLA = "ct-botella";

function batch(
  code: string,
  date: string,
  items: Array<{ id: string; containerTypeId: string; availableQty: number }>,
): ProductionBatch {
  return {
    id: `batch-${code}`,
    code,
    date,
    filledById: "u-1",
    filledBy: { id: "u-1", name: "Administrador" },
    notes: null,
    items: items.map((item) => ({
      ...item,
      containerType: { id: item.containerTypeId, name: "Bidón 20L" },
      producedQty: item.availableQty,
    })),
  };
}

/** Como los devuelve la API: fecha ascendente, el orden FIFO. */
const BATCHES = [
  batch("LOTE-A", "2026-08-01", [{ id: "item-a", containerTypeId: BIDON, availableQty: 30 }]),
  batch("LOTE-B", "2026-08-03", [
    { id: "item-b", containerTypeId: BIDON, availableQty: 40 },
    { id: "item-b2", containerTypeId: BOTELLA, availableQty: 15 },
  ]),
];

describe("planFifoLoad", () => {
  it("toma todo de un solo lote cuando alcanza", () => {
    expect(planFifoLoad(BATCHES, BIDON, 20)).toEqual({
      lines: [
        { batchItemId: "item-a", batchCode: "LOTE-A", batchDate: "2026-08-01", quantity: 20 },
      ],
      available: 70,
      shortfall: 0,
    });
  });

  it("agota el lote más antiguo antes de tocar el siguiente", () => {
    expect(planFifoLoad(BATCHES, BIDON, 50).lines).toEqual([
      { batchItemId: "item-a", batchCode: "LOTE-A", batchDate: "2026-08-01", quantity: 30 },
      { batchItemId: "item-b", batchCode: "LOTE-B", batchDate: "2026-08-03", quantity: 20 },
    ]);
  });

  it("informa cuánto falta cuando la planta no tiene tanto", () => {
    const plan = planFifoLoad(BATCHES, BIDON, 100);
    expect(plan.available).toBe(70);
    expect(plan.shortfall).toBe(30);
  });

  it("ignora otros tipos de envase y salta líneas agotadas", () => {
    const withEmpty = [
      batch("LOTE-0", "2026-07-30", [{ id: "item-0", containerTypeId: BOTELLA, availableQty: 0 }]),
      ...BATCHES,
    ];
    expect(planFifoLoad(withEmpty, BOTELLA, 5)).toEqual({
      lines: [
        { batchItemId: "item-b2", batchCode: "LOTE-B", batchDate: "2026-08-03", quantity: 5 },
      ],
      available: 15,
      shortfall: 0,
    });
  });

  it("sin lotes, falta todo lo pedido", () => {
    expect(planFifoLoad([], BIDON, 10)).toEqual({ lines: [], available: 0, shortfall: 10 });
  });
});

describe("positiveWhole", () => {
  it("sólo acepta enteros mayores que cero, leídos del texto", () => {
    expect(positiveWhole(" 12 ")).toBe(12);
    expect(positiveWhole("0")).toBeNull();
    expect(positiveWhole("1.5")).toBeNull();
    expect(positiveWhole("-3")).toBeNull();
    expect(positiveWhole("")).toBeNull();
    // Lo que entrega un campo numérico con v-model.
    expect(positiveWhole(7)).toBe(7);
    expect(positiveWhole(2.5)).toBeNull();
  });
});
