import type { RouteSnapshot, RouteStop, StopStatus, SyncOperationEnvelope } from "@yacco/shared";

import {
  containersWithQueued,
  debtWithQueued,
  deliveryEffect,
  exceedsCreditLimit,
} from "../src/offline/delivery-effect";
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

function stopAt(id: string, locationId: string, status: StopStatus = "PENDING"): RouteStop {
  return { id, status, location: { id: locationId } } as RouteStop;
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
    route: {
      stops: [
        stopAt("s-1", "loc-1"),
        stopAt("s-2", "loc-2"),
        stopAt("s-3", "loc-3"),
        // Ya entregada cuando se bajó la ruta: su venta está en la deuda que bajó.
        stopAt("s-4", "loc-1", "DELIVERED"),
      ],
    },
  } as unknown as RouteSnapshot;
  const twoRefills = { status: "DELIVERED", items: [{ productId: "p-refill", quantity: 2 }] };

  it("suma las entregas que el celular todavía no mandó, de cualquier local del cliente", () => {
    const operations = [
      queued("PENDING", "s-1", twoRefills),
      queued("PENDING", "s-2", twoRefills),
      // Ya contada en la ruta que bajó, o en revisión: la deuda del servidor manda.
      queued("SENT", "s-4", { status: "DELIVERED", items: [{ productId: "p-jug", quantity: 1 }] }),
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

  it("una entrega enviada después de bajar la ruta sigue sumando: la ruta todavía no la cuenta", () => {
    // La ruta guardada tiene s-1 pendiente: se bajó antes de que la entrega saliera.
    const operations = [queued("SENT", "s-1", twoRefills)];

    expect(debtWithQueued(snapshot, operations, "c-1")).toBe("35.00");
  });

  it("una pendiente cuya parada la ruta ya trae resuelta no suma dos veces", () => {
    // El servidor la aplicó y la respuesta no llegó: sigue pendiente en el
    // celular, pero la ruta que bajó después ya cuenta la venta en la deuda.
    const operations = [queued("PENDING", "s-4", twoRefills), queued("PENDING", "s-1", twoRefills)];

    expect(debtWithQueued(snapshot, operations, "c-1")).toBe("35.00");
  });

  it("un cliente que no está en la ruta guardada no debe nada a la vista", () => {
    expect(debtWithQueued(snapshot, [], "c-otro")).toBe("0.00");
  });
});

describe("los envases que ve el chofer en cada local", () => {
  const secondLocal = { ...rosita, id: "loc-2", name: "Rosita (anexo)" };
  const snapshot = {
    ...catalog,
    containerTypes: [...catalog.containerTypes, { id: "ct-10l", name: "Bidón 10L" }],
    locations: [rosita, secondLocal],
    route: {
      stops: [
        stopAt("s-1", "loc-1"),
        stopAt("s-2", "loc-2"),
        stopAt("s-3", "loc-1"),
        stopAt("s-4", "loc-1", "DELIVERED"),
      ],
    },
  } as unknown as RouteSnapshot;

  it("los que bajaron más las recargas y menos los vacíos de lo que la ruta no cuenta, solo de ese local", () => {
    const operations = [
      // Rosita tiene 3: deja 2 recargas y recoge 1 vacío -> 4.
      queued("PENDING", "s-1", {
        status: "DELIVERED",
        items: [{ productId: "p-refill", quantity: 2 }],
        containersReturned: [{ containerTypeId: "ct-20l", quantity: 1 }],
      }),
      // Enviada después de bajar la ruta -> 5.
      queued("SENT", "s-3", {
        status: "DELIVERED",
        items: [{ productId: "p-refill", quantity: 1 }],
      }),
      // Ya contada en la ruta que bajó, en revisión, o de otro local: no mueven.
      queued("SENT", "s-4", {
        status: "DELIVERED",
        items: [{ productId: "p-refill", quantity: 7 }],
      }),
      queued("IN_REVIEW", "s-1", {
        status: "DELIVERED",
        items: [{ productId: "p-refill", quantity: 9 }],
      }),
      queued("PENDING", "s-2", {
        status: "DELIVERED",
        items: [{ productId: "p-refill", quantity: 4 }],
      }),
      // Un tipo que no venía en la ruta guardada también se muestra.
      queued("PENDING", "s-1", {
        status: "DELIVERED",
        items: [{ productId: "p-jug", quantity: 1 }],
        containersReturned: [{ containerTypeId: "ct-10l", quantity: 1 }],
      }),
    ];

    expect(containersWithQueued(snapshot, operations, "loc-1")).toEqual([
      { containerType: { id: "ct-20l", name: "Bidón 20L" }, quantity: 5 },
      { containerType: { id: "ct-10l", name: "Bidón 10L" }, quantity: -1 },
    ]);
    expect(containersWithQueued(snapshot, operations, "loc-2")).toEqual([
      { containerType: { id: "ct-20l", name: "Bidón 20L" }, quantity: 7 },
    ]);
  });

  it("un tipo que queda en cero no se muestra, y un local fuera de la ruta no tiene nada", () => {
    const operations = [
      queued("PENDING", "s-1", {
        status: "DELIVERED",
        items: [{ productId: "p-jug", quantity: 1 }],
        containersReturned: [{ containerTypeId: "ct-20l", quantity: 3 }],
      }),
    ];

    expect(containersWithQueued(snapshot, operations, "loc-1")).toEqual([]);
    expect(containersWithQueued(snapshot, operations, "loc-otro")).toEqual([]);
  });
});
