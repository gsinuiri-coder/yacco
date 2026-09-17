import { MAX_ITEM_QUANTITY, addAmounts, isMoneyInput, timesQuantity } from "@yacco/shared";
import type { CreateOrderItemBody, EffectivePrice, PriceSource, Product } from "@yacco/shared";

/**
 * Una línea del pedido mientras se arma. `key` es sólo para Vue.
 *
 * `priceOrigin` dice de dónde salió el precio prellenado (pactado o de lista).
 * Cuando el vendedor escribe el precio a mano pasa a `null`: ese valor es suyo,
 * y cambiar de cliente nunca lo pisa en silencio.
 */
export interface OrderLineDraft {
  key: number;
  productId: string;
  quantity: string;
  unitPrice: string;
  priceOrigin: PriceSource | null;
}

export function blankOrderLine(key: number): OrderLineDraft {
  return { key, productId: "", quantity: "1", unitPrice: "", priceOrigin: null };
}

/**
 * El precio con que se prellena un producto: el efectivo del cliente si la
 * consulta está disponible y lo trae, el de lista si no. La precedencia
 * (local > cliente > lista) la resuelve la API en `source`; acá no se repite.
 */
export function prefillPrice(
  productId: string,
  products: readonly Product[],
  effective: readonly EffectivePrice[],
  effectiveAvailable: boolean,
): Pick<OrderLineDraft, "unitPrice" | "priceOrigin"> {
  const product = products.find((candidate) => candidate.id === productId);
  if (product === undefined) return { unitPrice: "", priceOrigin: null };
  const agreed = effectiveAvailable
    ? effective.find((price) => price.product.id === productId)
    : undefined;
  return agreed === undefined
    ? { unitPrice: product.listPrice, priceOrigin: "LIST" }
    : { unitPrice: agreed.price, priceOrigin: agreed.source };
}

/** Al cambiar de cliente: vuelve a prellenar sólo lo que era prellenado. */
export function repriceLines(
  lines: readonly OrderLineDraft[],
  products: readonly Product[],
  effective: readonly EffectivePrice[],
  effectiveAvailable: boolean,
): OrderLineDraft[] {
  return lines.map((line) =>
    line.productId === "" || line.priceOrigin === null
      ? line
      : { ...line, ...prefillPrice(line.productId, products, effective, effectiveAvailable) },
  );
}

/** Una cantidad entera positiva, leída del texto; `null` si no lo es. */
function wholeQuantity(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/** Las mismas reglas que CreateOrderItemDto, para que una línea mala no llegue a la API. */
export function checkOrderLine(line: OrderLineDraft): string | undefined {
  if (line.productId === "") return "Elige un producto";
  const quantity = wholeQuantity(line.quantity);
  if (quantity === null || quantity < 1) return "La cantidad debe ser un número entero mayor que 0";
  if (quantity > MAX_ITEM_QUANTITY) return `La cantidad no puede superar ${MAX_ITEM_QUANTITY}`;
  if (!isMoneyInput(line.unitPrice.trim())) {
    return 'El precio unitario debe ser un monto como "12.50"';
  }
  return undefined;
}

/** El subtotal de una línea completa; `null` mientras no se puede calcular. */
export function lineSubtotal(line: OrderLineDraft): string | null {
  const quantity = wholeQuantity(line.quantity);
  const price = line.unitPrice.trim();
  if (quantity === null || quantity < 1 || !isMoneyInput(price)) return null;
  return timesQuantity(price, quantity);
}

/** El total en vivo: suma sólo las líneas que ya se pueden calcular. */
export function linesTotal(lines: readonly OrderLineDraft[]): string {
  return addAmounts(
    lines.map(lineSubtotal).filter((subtotal): subtotal is string => subtotal !== null),
  );
}

export function lineToBody(line: OrderLineDraft): CreateOrderItemBody {
  return {
    productId: line.productId,
    quantity: Number(line.quantity.trim()),
    unitPrice: line.unitPrice.trim(),
  };
}
