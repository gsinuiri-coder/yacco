/**
 * «Pedido» frente a «entregado» (Fase 3, fila 11, decisión de Giancarlo del
 * 2026-10-23): cuando el cliente cambia su pedido en la puerta, la venta lleva
 * lo que de verdad se entregó y el pedido no se edita. «Se entregó distinto»
 * NO se guarda en ninguna columna: se deriva comparando las dos listas, así
 * nunca puede quedar desfasado de lo que dicen el pedido y la venta.
 *
 * Se compara producto y cantidad, no el precio: cobrar otro precio por lo
 * mismo que se pidió no es entregar distinto (eso lo registra la venta con
 * quién lo autorizó).
 */

/** Una línea del pedido o de la venta vigente de la parada. */
export interface DeliveryLine {
  productId: string;
  product: { id: string; name: string };
  quantity: number;
}

/** Una fila de «pedido» y «entregado» lado a lado; 0 cuando no vino. */
export interface DeliveryComparisonRow {
  productId: string;
  productName: string;
  ordered: number;
  delivered: number;
}

/**
 * Las filas en el orden del pedido, y después lo que se entregó sin haberse
 * pedido. Un producto repetido en una lista suma sus cantidades.
 */
export function compareDelivery(
  ordered: readonly DeliveryLine[],
  delivered: readonly DeliveryLine[],
): DeliveryComparisonRow[] {
  const rows = new Map<string, DeliveryComparisonRow>();
  const rowFor = (line: DeliveryLine): DeliveryComparisonRow => {
    let row = rows.get(line.productId);
    if (row === undefined) {
      row = { productId: line.productId, productName: line.product.name, ordered: 0, delivered: 0 };
      rows.set(line.productId, row);
    }
    return row;
  };
  for (const line of ordered) rowFor(line).ordered += line.quantity;
  for (const line of delivered) rowFor(line).delivered += line.quantity;
  return [...rows.values()];
}

export function isDeliveredDifferently(
  ordered: readonly DeliveryLine[],
  delivered: readonly DeliveryLine[],
): boolean {
  return compareDelivery(ordered, delivered).some((row) => row.ordered !== row.delivered);
}
