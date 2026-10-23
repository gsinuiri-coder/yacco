import type { RouteSnapshot, RouteStop, SyncOperationEnvelope } from "@yacco/shared";

import { debtWithQueued, deliveryEffect, exceedsCreditLimit } from "../src/offline/delivery-effect";
import type { QueuedOperation, QueuedOperationState } from "../src/offline/offline-store";
import { deliveryCatalog } from "./fakes";

const catalog = deliveryCatalog();
const rosita = catalog.locations[0]!;

describe("lo que mueve una entrega, igual que SalesService", () => {
  it("la recarga deja el envase prestado; el bidón vendido no toca el saldo; los vacíos lo bajan", () => {
    const effect = deliveryEffect(catalog, rosita, {
      status: "DELIVERED",
      items: [
        { productId: "p-refill", quantity: 3 },
        { productId: "p-jug", quantity: 2 },
      ],
      containersReturned: [{ containerTypeId: "ct-20l", quantity: 1 }],
    });

    expect(effect.total).toBe("87.50");
    expect(effect.debtDelta).toBe("87.50");
    expect([...effect.containers]).toEqual([["ct-20l", 2]]);
  });

  it("un cobro en efectivo baja la deuda; uno que confirma la oficina todavía no", () => {
    const sale = { status: "DELIVERED" as const, items: [{ productId: "p-refill", quantity: 4 }] };

    const cash = deliveryEffect(catalog, rosita, {
      ...sale,
      payment: { paymentMethodId: "pm-cash", amount: "20.00" },
    });
    const yape = deliveryEffect(catalog, rosita, {
      ...sale,
      payment: { paymentMethodId: "pm-yape", amount: "20.00" },
    });

    expect(cash.debtDelta).toBe("30.00");
    expect(yape.debtDelta).toBe("50.00");
  });

  it("un precio escrito manda sobre el pactado, y una línea sin precio no suma", () => {
    const effect = deliveryEffect(
      catalog,
      { prices: [] },
      {
        status: "DELIVERED",
        items: [
          { productId: "p-refill", quantity: 2, unitPrice: "11.00" },
          { productId: "p-jug", quantity: 1 },
        ],
      },
    );

    expect(effect.total).toBe("22.00");
  });
});

describe("el límite de crédito avisa", () => {
  it("solo cuando la deuda queda por encima, no cuando llega justo", () => {
    expect(exceedsCreditLimit(rosita, "10.00", "40.00")).toBe(false);
    expect(exceedsCreditLimit(rosita, "10.00", "40.01")).toBe(true);
  });

  it("un cliente sin límite nunca avisa", () => {
    expect(exceedsCreditLimit({ creditLimit: null }, "900.00", "100.00")).toBe(false);
  });
});

function stopAt(id: string, locationId: string): RouteStop {
  return { id, location: { id: locationId } } as RouteStop;
}

function queued(
  state: QueuedOperationState,
  stopId: string,
  payload: Record<string, unknown>,
): QueuedOperation {
  const envelope: SyncOperationEnvelope = {
    id: `op-${stopId}-${state}`,
    type: "STOP_MARK",
    version: 1,
    clientTimestamp: "2026-10-23T14:00:00.000Z",
    payload: { routeId: "r-1", stopId, ...payload },
  };
  return { envelope, state, reason: null };
}

describe("la deuda que ve el chofer", () => {
  // Rosita y su segundo local son del mismo cliente; Lucha es otro cliente.
  const secondLocal = { ...rosita, id: "loc-2", name: "Rosita (anexo)" };
  const lucha = { ...rosita, id: "loc-3", customer: { id: "c-3", name: "Lucha" } };
  const snapshot = {
    ...catalog,
    locations: [rosita, secondLocal, lucha],
    route: { stops: [stopAt("s-1", "loc-1"), stopAt("s-2", "loc-2"), stopAt("s-3", "loc-3")] },
  } as unknown as RouteSnapshot;
  const twoRefills = { status: "DELIVERED", items: [{ productId: "p-refill", quantity: 2 }] };

  it("suma las entregas que el celular todavía no mandó, de cualquier local del cliente", () => {
    const operations = [
      queued("PENDING", "s-1", twoRefills),
      queued("PENDING", "s-2", twoRefills),
      // Ya mandadas o en revisión: la deuda que bajó o la del servidor ya las cuenta.
      queued("SENT", "s-1", { status: "DELIVERED", items: [{ productId: "p-jug", quantity: 1 }] }),
      queued("IN_REVIEW", "s-2", {
        status: "DELIVERED",
        items: [{ productId: "p-jug", quantity: 3 }],
      }),
      // Otro cliente, y una parada no entregada: no suman.
      queued("PENDING", "s-3", twoRefills),
      queued("PENDING", "s-1", { status: "FAILED", failureReason: "Cerrado" }),
    ];

    expect(debtWithQueued(snapshot, operations, "c-1")).toBe("60.00");
    expect(debtWithQueued(snapshot, operations, "c-3")).toBe("35.00");
  });

  it("un cliente que no está en la ruta guardada no debe nada a la vista", () => {
    expect(debtWithQueued(snapshot, [], "c-otro")).toBe("0.00");
  });
});
