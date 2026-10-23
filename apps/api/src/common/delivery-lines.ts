import type { Prisma } from "@prisma/client";
import type { DeliveryLineDto } from "./dto/delivery-line.dto.js";

/**
 * «Pedido» y «entregado» lado a lado (fila 11): lo que el detalle del pedido y
 * el de la ruta leen de los ítems del pedido y de la venta vigente. Un solo
 * select para los dos lados, así `DeliveryLineDto` no tiene dos armados que
 * puedan separarse.
 */
export const DELIVERY_LINE_SELECT = {
  productId: true,
  quantity: true,
  product: { select: { id: true, name: true } },
} satisfies Prisma.SaleItemSelect & Prisma.OrderItemSelect;

/**
 * La venta VIGENTE de una parada con sus ítems. `voidedAt: null` es lo que
 * importa: una parada corregida conserva su venta anulada —nunca se borra— y
 * lo entregado es lo de la venta que vale hoy. El `orderBy` hace que, si la
 * invariante de una sola venta vigente fallara, se vea siempre la misma.
 */
export const LIVE_SALE_ITEMS = {
  where: { voidedAt: null },
  select: { items: { select: DELIVERY_LINE_SELECT } },
  orderBy: { soldAt: "desc" },
  take: 1,
} satisfies Prisma.RouteStop$salesArgs;

type SelectedLine = Prisma.SaleItemGetPayload<{ select: typeof DELIVERY_LINE_SELECT }>;

export function toDeliveryLines(lines: readonly SelectedLine[]): DeliveryLineDto[] {
  return lines.map((line) => ({
    productId: line.productId,
    product: line.product,
    quantity: line.quantity,
  }));
}

/** Los ítems de la venta vigente, o `null` si la parada no tiene venta. */
export function toDeliveredItems(
  sales: readonly { items: readonly SelectedLine[] }[] | undefined,
): DeliveryLineDto[] | null {
  const [sale] = sales ?? [];
  return sale === undefined ? null : toDeliveryLines(sale.items);
}
