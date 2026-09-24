import { addAmounts, isMoneyInput, timesQuantity } from "@yacco/shared";
import type { EffectivePrice, MarkRouteStopBody } from "@yacco/shared";
import { positiveWhole } from "./quantity";

/**
 * Registrar lo que pasó en una parada. Los tres escenarios de HU-12 salen sin
 * ninguna rama especial, porque el dominio los distingue por el TIPO de
 * producto:
 *
 * - Canje 1:1: 3 recargas y 3 vacíos devueltos; el saldo de envases no se mueve.
 * - Deuda de envases: 3 recargas y 1 vacío; el saldo sube en 2.
 * - Venta completa: 1 recarga, 2 bidones vendidos (CONTAINER_SALE) y 1 vacío;
 *   esos 2 salen del parque y el saldo no se mueve.
 *
 * El precio se deja VACÍO en el camino normal: la API resuelve el pactado. Sólo
 * se escribe cuando se cobró algo distinto, y entonces hace falta quién lo
 * autorizó, la misma regla que aplica SalesService.
 */
export type StopOutcome = "DELIVERED" | "FAILED";

export interface SaleLineDraft {
  key: number;
  productId: string;
  quantity: string;
  /** Vacío: se cobra el pactado. */
  unitPrice: string;
}

export interface ReturnLineDraft {
  key: number;
  containerTypeId: string;
  quantity: string;
}

export interface StopMarkDraft {
  outcome: StopOutcome;
  failureReason: string;
  items: SaleLineDraft[];
  returns: ReturnLineDraft[];
  paymentMethodId: string;
  amount: string;
  authorizerId: string;
}

export function agreedPrice(
  effective: readonly EffectivePrice[],
  productId: string,
): string | null {
  return effective.find((price) => price.product.id === productId)?.price ?? null;
}

/** Dos montos iguales por texto, con la fracción llevada a dos dígitos. */
function sameAmount(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const [whole = "", fraction = ""] = value.split(".");
    return `${whole === "" ? "0" : whole}.${`${fraction}00`.slice(0, 2)}`;
  };
  return normalize(left) === normalize(right);
}

/** Un precio escrito que difiere del pactado. Sin pactado a la vista no hay contra qué comparar. */
export function isPriceOverride(
  line: SaleLineDraft,
  effective: readonly EffectivePrice[],
): boolean {
  const typed = line.unitPrice.trim();
  if (typed === "" || !isMoneyInput(typed)) return false;
  const agreed = agreedPrice(effective, line.productId);
  return agreed !== null && !sameAmount(typed, agreed);
}

/** El subtotal con el precio que se va a cobrar: el escrito, o el pactado. */
export function saleLineSubtotal(line: SaleLineDraft, agreed: string | null): string | null {
  const quantity = positiveWhole(line.quantity);
  const typed = line.unitPrice.trim();
  const price = typed === "" ? agreed : typed;
  if (quantity === null || price === null || !isMoneyInput(price)) return null;
  return timesQuantity(price, quantity);
}

export function saleTotal(
  lines: readonly SaleLineDraft[],
  effective: readonly EffectivePrice[],
): string {
  return addAmounts(
    lines
      .map((line) => saleLineSubtotal(line, agreedPrice(effective, line.productId)))
      .filter((subtotal): subtotal is string => subtotal !== null),
  );
}

/**
 * El cuerpo de PATCH /routes/:id/stops/:stopId, o el motivo por el que todavía
 * no se puede enviar (en el vocabulario de la planta y nombrando la línea).
 */
export function buildMarkBody(
  draft: StopMarkDraft,
  effective: readonly EffectivePrice[],
  options: { correction?: boolean } = {},
): MarkRouteStopBody | string {
  if (draft.outcome === "FAILED") {
    const reason = draft.failureReason.trim();
    return reason === ""
      ? "Escribe por qué no se pudo entregar"
      : { status: "FAILED", failureReason: reason };
  }

  const items: NonNullable<MarkRouteStopBody["items"]> = [];
  for (const [index, line] of draft.items.entries()) {
    const n = index + 1;
    if (line.productId === "") return `Elige el producto de la línea ${n}`;
    const quantity = positiveWhole(line.quantity);
    if (quantity === null) {
      return `La cantidad de la línea ${n} debe ser un número entero mayor que 0`;
    }
    const typed = line.unitPrice.trim();
    if (typed !== "" && !isMoneyInput(typed)) {
      return `El precio de la línea ${n} debe ser un monto como "12.50"`;
    }
    items.push({
      productId: line.productId,
      quantity,
      ...(typed === "" ? {} : { unitPrice: typed }),
    });
  }
  if (items.length === 0) return "Una entrega tiene que decir qué se entregó";

  const containersReturned: NonNullable<MarkRouteStopBody["containersReturned"]> = [];
  for (const [index, row] of draft.returns.entries()) {
    const n = index + 1;
    if (row.containerTypeId === "") return `Elige el tipo de envase devuelto de la línea ${n}`;
    const quantity = positiveWhole(row.quantity);
    if (quantity === null) {
      return `Los envases devueltos de la línea ${n} deben ser un número entero mayor que 0`;
    }
    containersReturned.push({ containerTypeId: row.containerTypeId, quantity });
  }

  const amount = draft.amount.trim();
  if (draft.paymentMethodId !== "" && amount === "") {
    return "Escribe cuánto se cobró, o quita el método de pago para dejarlo al fiado";
  }
  if (amount !== "" && draft.paymentMethodId === "") return "Elige con qué método se cobró";
  if (amount !== "" && !isMoneyInput(amount)) {
    return 'El monto cobrado debe ser un monto como "25.00"';
  }

  // En una corrección, quien corrige es quien autoriza (supuesto 8): la API
  // lo fija sola y rechaza que venga en el cuerpo.
  const override = draft.items.some((line) => isPriceOverride(line, effective));
  if (override && draft.authorizerId === "" && options.correction !== true) {
    return "Un precio distinto del pactado necesita quién lo autorizó";
  }

  return {
    status: "DELIVERED",
    items,
    ...(containersReturned.length > 0 ? { containersReturned } : {}),
    ...(amount === "" ? {} : { payment: { paymentMethodId: draft.paymentMethodId, amount } }),
    ...(draft.authorizerId === "" || options.correction === true
      ? {}
      : { priceOverrideAuthorizedById: draft.authorizerId }),
  };
}
