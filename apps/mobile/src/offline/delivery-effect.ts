import {
  addAmounts,
  agreedPrice,
  isAboveZero,
  subtractAmounts,
  timesQuantity,
  type MarkRouteStopBody,
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

/**
 * La deuda del cliente como la ve el chofer: la que bajó con la ruta más lo
 * que suman las entregas que el celular todavía no mandó. Si el cliente tiene
 * dos locales en la ruta, la deuda es una sola.
 */
export function debtWithQueued(
  snapshot: Pick<RouteSnapshot, "route" | "locations" | "products" | "paymentMethods">,
  operations: readonly QueuedOperation[],
  customerId: string,
): string {
  const location = snapshot.locations.find((candidate) => candidate.customer.id === customerId);
  if (location === undefined) return "0.00";
  const deltas: string[] = [location.debtBalance];
  for (const op of operations) {
    if (op.state !== "PENDING" || op.envelope.type !== "STOP_MARK") continue;
    const payload = op.envelope.payload as unknown as StopMarkPayloadV1;
    if (payload.status !== "DELIVERED") continue;
    const stop = snapshot.route.stops.find((candidate) => candidate.id === payload.stopId);
    const stopLocation = snapshot.locations.find((l) => l.id === stop?.location.id);
    if (stopLocation?.customer.id !== customerId) continue;
    deltas.push(deliveryEffect(snapshot, stopLocation, payload).debtDelta);
  }
  return addAmounts(deltas);
}
