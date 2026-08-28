import { describe, expect, it } from "vitest";
import type { ProductionBatch } from "../api/production-batches";
import { planFifoLoad } from "./fifo-load-plan";

const BIDON = "11111111-1111-4111-8111-111111111111";
const BOTELLA = "22222222-2222-4222-8222-222222222222";

function batch(
  code: string,
  date: string,
  items: { id: string; containerTypeId: string; availableQty: number }[],
): ProductionBatch {
  return {
    id: `batch-${code}`,
    code,
    date,
    filledById: "user-1",
    filledBy: { id: "user-1", name: "Administrador" },
    notes: null,
    items: items.map((item) => ({
      id: item.id,
      containerTypeId: item.containerTypeId,
      containerType: { id: item.containerTypeId, name: "Bidón 20L" },
      producedQty: item.availableQty,
      availableQty: item.availableQty,
    })),
  };
}

/** Como los devuelve la API: fecha ascendente, que es el orden FIFO. */
const BATCHES = [
  batch("LOTE-A", "2026-08-01", [{ id: "item-a", containerTypeId: BIDON, availableQty: 30 }]),
  batch("LOTE-B", "2026-08-03", [
    { id: "item-b", containerTypeId: BIDON, availableQty: 40 },
    { id: "item-b2", containerTypeId: BOTELLA, availableQty: 15 },
  ]),
];

describe("planFifoLoad", () => {
  it("toma todo de un solo lote cuando alcanza", () => {
    const plan = planFifoLoad(BATCHES, BIDON, 20);

    expect(plan.lines).toEqual([
      { batchItemId: "item-a", batchCode: "LOTE-A", batchDate: "2026-08-01", quantity: 20 },
    ]);
    expect(plan.shortfall).toBe(0);
  });

  // La regla del dominio: primero el lote más antiguo, siempre.
  it("agota el lote más antiguo antes de tocar el siguiente", () => {
    const plan = planFifoLoad(BATCHES, BIDON, 50);

    expect(plan.lines).toEqual([
      { batchItemId: "item-a", batchCode: "LOTE-A", batchDate: "2026-08-01", quantity: 30 },
      { batchItemId: "item-b", batchCode: "LOTE-B", batchDate: "2026-08-03", quantity: 20 },
    ]);
    expect(plan.shortfall).toBe(0);
  });

  it("cuenta todo lo disponible del tipo, incluso lo que no llega a repartir", () => {
    const plan = planFifoLoad(BATCHES, BIDON, 10);

    expect(plan.available).toBe(70);
    expect(plan.lines).toHaveLength(1);
  });

  it("informa cuánto falta cuando la planta no tiene tanto", () => {
    const plan = planFifoLoad(BATCHES, BIDON, 100);

    expect(plan.available).toBe(70);
    expect(plan.shortfall).toBe(30);
    // Las líneas siguen siendo el reparto de lo que sí hay: nada se pierde.
    expect(plan.lines.reduce((sum, line) => sum + line.quantity, 0)).toBe(70);
  });

  it("ignora las líneas de otro tipo de envase", () => {
    const plan = planFifoLoad(BATCHES, BOTELLA, 10);

    expect(plan.lines).toEqual([
      { batchItemId: "item-b2", batchCode: "LOTE-B", batchDate: "2026-08-03", quantity: 10 },
    ]);
    expect(plan.available).toBe(15);
  });

  it("salta una línea agotada en vez de repartirle 0", () => {
    const withEmpty = [
      batch("LOTE-VIEJO", "2026-07-01", [
        { id: "item-viejo", containerTypeId: BIDON, availableQty: 0 },
      ]),
      ...BATCHES,
    ];

    const plan = planFifoLoad(withEmpty, BIDON, 5);

    expect(plan.lines).toEqual([
      { batchItemId: "item-a", batchCode: "LOTE-A", batchDate: "2026-08-01", quantity: 5 },
    ]);
  });

  it("sin lotes, todo lo pedido falta", () => {
    const plan = planFifoLoad([], BIDON, 5);

    expect(plan.lines).toEqual([]);
    expect(plan.available).toBe(0);
    expect(plan.shortfall).toBe(5);
  });
});
