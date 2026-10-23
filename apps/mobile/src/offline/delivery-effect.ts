import {
  addAmounts,
  agreedPrice,
  isAboveZero,
  subtractAmounts,
  timesQuantity,
  type MarkRouteStopBody,
  type NamedReference,
  type RouteSnapshot,
  type RouteSnapshotLocation,
  type StopMarkPayloadV1,
} from "@yacco/shared";

import type { QueuedOperation } from "./offline-store";

/**
 * Lo que una entrega mueve en los saldos del local, calculado en el celular
 * con las mismas reglas que SalesService.registerStopDeliveryWithinTransaction.
 * El servidor recalcula todo al recibirla; esto es lo que el chofer ve
 * mientras tanto.
 */
export interface DeliveryEffect {
  /** El total de la venta: cada línea al precio que aplica a ese local. */
  total: string;
  /**
   * Cuánto sube la deuda del cliente en S/: el total, menos lo cobrado solo si
   * el medio de pago no espera confirmación (un cobro por confirmar no baja la
   * deuda hasta que la oficina lo confirma).
   */
  debtDelta: string;
  /**
   * Envases que quedan en poder del local, por tipo de envase: suben las
   * recargas entregadas (el envase va prestado) y bajan los vacíos devueltos.
   * Un envase vendido sale del parque y no toca el saldo.
   */
  containers: Map<string, number>;
}

export function deliveryEffect(
  snapshot: Pick<RouteSnapshot, "products" | "paymentMethods">,
  location: Pick<RouteSnapshotLocation, "prices">,
  body: MarkRouteStopBody,
): DeliveryEffect {
  const containers = new Map<string, number>();
  const move = (containerTypeId: string, quantity: number) => {
    containers.set(containerTypeId, (containers.get(containerTypeId) ?? 0) + quantity);
  };

  const subtotals: string[] = [];
  for (const item of body.items ?? []) {
    const price = item.unitPrice ?? agreedPrice(location.prices, item.productId);
    if (price !== null) subtotals.push(timesQuantity(price, item.quantity));
    const product = snapshot.products.find((candidate) => candidate.id === item.productId);
    if (product?.type === "REFILL" && product.containerType !== null) {
      move(product.containerType.id, item.quantity);
    }
  }
  for (const returned of body.containersReturned ?? []) {
    move(returned.containerTypeId, -returned.quantity);
  }

  const total = addAmounts(subtotals);
  const { payment } = body;
  const method = snapshot.paymentMethods.find((m) => m.id === payment?.paymentMethodId);
  const debtDelta =
    payment !== undefined && method?.requiresConfirmation === false
      ? subtractAmounts(total, payment.amount)
      : total;
  return { total, debtDelta, containers };
}

/** HU-09: avisa si la deuda queda por encima del límite. Nunca bloquea. */
export function exceedsCreditLimit(
  location: Pick<RouteSnapshotLocation, "creditLimit">,
  debtBefore: string,
  debtDelta: string,
): boolean {
  if (location.creditLimit === null) return false;
  return isAboveZero(subtractAmounts(addAmounts([debtBefore, debtDelta]), location.creditLimit));
}

type BalanceSnapshot = Pick<RouteSnapshot, "route" | "locations" | "products" | "paymentMethods">;

interface UncountedDelivery {
  location: RouteSnapshotLocation;
  effect: DeliveryEffect;
}

/**
 * Las entregas que hizo el celular y que la ruta guardada todavía no cuenta:
 * las pendientes de enviar, y las ya enviadas cuya parada la ruta todavía
 * muestra pendiente (se bajó antes del envío). Cuando la ruta ya trae la
 * parada resuelta, los saldos que bajaron ya la incluyen. Las que revisa la
 * oficina no cuentan: ahí gana el servidor.
 */
function uncountedDeliveries(
  snapshot: BalanceSnapshot,
  operations: readonly QueuedOperation[],
): UncountedDelivery[] {
  const deliveries: UncountedDelivery[] = [];
  for (const op of operations) {
    if (op.state === "IN_REVIEW" || op.envelope.type !== "STOP_MARK") continue;
    const payload = op.envelope.payload as unknown as StopMarkPayloadV1;
    if (payload.status !== "DELIVERED") continue;
    const stop = snapshot.route.stops.find((candidate) => candidate.id === payload.stopId);
    if (stop === undefined) continue;
    if (op.state === "SENT" && stop.status !== "PENDING") continue;
    const location = snapshot.locations.find((candidate) => candidate.id === stop.location.id);
    if (location === undefined) continue;
    deliveries.push({ location, effect: deliveryEffect(snapshot, location, payload) });
  }
  return deliveries;
}

/**
 * La deuda del cliente como la ve el chofer: la que bajó con la ruta más lo
 * que suman las entregas que esa ruta todavía no cuenta. Si el cliente tiene
 * dos locales en la ruta, la deuda es una sola.
 */
export function debtWithQueued(
  snapshot: BalanceSnapshot,
  operations: readonly QueuedOperation[],
  customerId: string,
): string {
  const location = snapshot.locations.find((candidate) => candidate.customer.id === customerId);
  if (location === undefined) return "0.00";
  const deltas: string[] = [location.debtBalance];
  for (const delivery of uncountedDeliveries(snapshot, operations)) {
    if (delivery.location.customer.id === customerId) deltas.push(delivery.effect.debtDelta);
  }
  return addAmounts(deltas);
}

/**
 * Los envases que tiene el local, por tipo, como los ve el chofer: los que
 * bajaron con la ruta más lo que mueven las entregas que esa ruta todavía no
 * cuenta. El saldo de envases es del local, no del cliente. Un tipo que queda
 * en cero no se muestra.
 */
export function containersWithQueued(
  snapshot: BalanceSnapshot & Pick<RouteSnapshot, "containerTypes">,
  operations: readonly QueuedOperation[],
  locationId: string,
): { containerType: NamedReference; quantity: number }[] {
  const location = snapshot.locations.find((candidate) => candidate.id === locationId);
  if (location === undefined) return [];
  const names = new Map(snapshot.containerTypes.map((type) => [type.id, type]));
  const quantities = new Map<string, number>();
  for (const balance of location.containerBalances) {
    names.set(balance.containerType.id, balance.containerType);
    quantities.set(balance.containerType.id, balance.quantity);
  }
  for (const delivery of uncountedDeliveries(snapshot, operations)) {
    if (delivery.location.id !== locationId) continue;
    for (const [containerTypeId, quantity] of delivery.effect.containers) {
      quantities.set(containerTypeId, (quantities.get(containerTypeId) ?? 0) + quantity);
    }
  }
  return [...quantities]
    .filter(([, quantity]) => quantity !== 0)
    .map(([id, quantity]) => ({ containerType: names.get(id) ?? { id, name: id }, quantity }));
}
