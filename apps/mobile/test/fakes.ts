import type { RouteSnapshot } from "@yacco/shared";

import type { LocationTracker, MarkedPosition } from "../src/location/location-tracker";
import type { OfflineStore, QueuedOperation } from "../src/offline/offline-store";
import type { TokenStore } from "../src/session/api-client";

/** El almacenamiento seguro, en memoria: guarda lo mismo que guardaría el celular. */
export function memoryStore(initial: string | null = null): TokenStore & { value: string | null } {
  return {
    value: initial,
    async read() {
      return this.value;
    },
    async write(token) {
      this.value = token;
    },
    async clear() {
      this.value = null;
    },
  };
}

export interface RecordedCall {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

type Reply = { status: number; body?: unknown } | Error;

/**
 * Un servidor de mentira: responde en orden lo que el test le da y anota cada
 * pedido tal como salió del celular (URL, método, token, cuerpo).
 */
export function fakeServer(...replies: Reply[]) {
  const calls: RecordedCall[] = [];
  const fetchImpl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("Authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const reply = replies.shift();
    if (reply === undefined) throw new Error(`Pedido no esperado: ${String(input)}`);
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

/**
 * Un token con la forma de los del servidor (cabecera.cuerpo.firma) y `sub`
 * en el cuerpo. La firma es de mentira: el celular no la verifica, solo lee
 * de quién es la sesión.
 */
export function fakeToken(sub: string, label = "refresh"): string {
  const body = btoa(JSON.stringify({ sub, type: label }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `cabecera.${body}.firma-${label}`;
}

/** La base del celular, en memoria: la cola queda en el orden en que entró. */
export function memoryOfflineStore(): OfflineStore & {
  snapshot: RouteSnapshot | null;
  operations: (QueuedOperation & { driverId: string })[];
} {
  return {
    snapshot: null,
    operations: [],
    async saveSnapshot(snapshot) {
      this.snapshot = snapshot;
    },
    async loadSnapshot() {
      return this.snapshot;
    },
    async clearSnapshot() {
      this.snapshot = null;
    },
    async addOperation(envelope, driverId) {
      this.operations.push({ envelope, state: "PENDING", reason: null, driverId });
    },
    async listOperations(driverId) {
      return this.operations
        .filter((op) => op.driverId === driverId)
        .map(({ envelope, state, reason }) => ({ envelope, state, reason }));
    },
    async setOperationState(id, state, reason) {
      const op = this.operations.find((candidate) => candidate.envelope.id === id);
      if (op) Object.assign(op, { state, reason });
    },
  };
}

/**
 * Lo que la ruta guardada trae para entregar en el local `loc-1` del cliente
 * `c-1`: recarga a 12.50 (el envase va prestado), bidón vendido a 25.00 (sale
 * del parque), efectivo (confirmado al toque) y Yape (lo confirma la oficina).
 * Debe 10.00 con un límite de 50.00.
 */
export function deliveryCatalog(): Pick<
  RouteSnapshot,
  "products" | "containerTypes" | "paymentMethods"
> & { locations: RouteSnapshot["locations"] } {
  const jug = { id: "ct-20l", name: "Bidón 20L" };
  return {
    products: [
      { id: "p-refill", name: "Recarga 20L", type: "REFILL", containerType: jug },
      { id: "p-jug", name: "Bidón nuevo 20L", type: "CONTAINER_SALE", containerType: jug },
    ],
    containerTypes: [jug],
    paymentMethods: [
      { id: "pm-cash", name: "Efectivo", requiresConfirmation: false },
      { id: "pm-yape", name: "Yape", requiresConfirmation: true },
    ],
    locations: [
      {
        id: "loc-1",
        name: "Bodega Rosita",
        address: "Av. Los Olivos 100",
        addressReference: "",
        phone: "",
        contactName: null,
        latitude: null,
        longitude: null,
        onRoute: true,
        customer: { id: "c-1", name: "Cliente 1" },
        debtBalance: "10.00",
        creditLimit: "50.00",
        containerBalances: [{ containerType: jug, quantity: 3 }],
        loanedAccessories: [],
        prices: [
          { product: { id: "p-refill", name: "Recarga 20L" }, price: "12.50", source: "CUSTOMER" },
          { product: { id: "p-jug", name: "Bidón nuevo 20L" }, price: "25.00", source: "LIST" },
        ],
      },
    ],
  };
}

/**
 * La ubicación del celular, de mentira: anota cada vez que la lista le pide
 * seguir o apagarse, contesta la posición que el test le da, y deja simular
 * que la tarea de fondo guardó puntos.
 */
export function fakeLocationTracker(position: MarkedPosition = {}) {
  const listeners = new Set<() => void>();
  const tracker = {
    follow: jest.fn(async (_routeInProgress: boolean, _intervalSeconds: number) => undefined),
    stop: jest.fn(async () => undefined),
    markedPosition: jest.fn(async () => position),
    onRecorded(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } satisfies LocationTracker;
  return {
    tracker,
    /** Lo que hace la tarea de fondo después de dejar puntos en la cola. */
    recorded() {
      for (const listener of listeners) listener();
    },
  };
}

export const DRIVER = { id: "u-1", username: "chofer.juan", roles: ["DRIVER" as const] };

/** El refresh de 30 días de `DRIVER`, como lo guarda el celular. */
export const DRIVER_REFRESH = fakeToken(DRIVER.id);
