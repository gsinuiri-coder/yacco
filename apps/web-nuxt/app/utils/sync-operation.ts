import { formatInstantInLima, formatSoles } from "@yacco/shared";
import type { StopStatus } from "@yacco/shared";
import { STOP_STATUS } from "./route-status";

/** Los nombres de cada catálogo, por id, leídos de su propio endpoint. */
export interface SyncOperationCatalogs {
  products: Map<string, string>;
  paymentMethods: Map<string, string>;
  containerTypes: Map<string, string>;
}

interface StopMarkPayload {
  status?: unknown;
  failureReason?: unknown;
  items?: unknown;
  containersReturned?: unknown;
  payment?: unknown;
}

interface Line {
  productId?: unknown;
  containerTypeId?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
}

/**
 * Lo que el chofer quiso hacer, en palabras de la planta, para que la oficina
 * lo compare con lo que la parada tiene hoy sin leer el payload crudo. El
 * payload llegó tal cual del celular y por eso se lee con desconfianza: lo que
 * no tenga la forma esperada simplemente no se muestra.
 */
export function describeSyncOperation(
  type: string,
  version: number,
  payload: unknown,
  catalogs: SyncOperationCatalogs,
): string[] {
  if (type === "ROUTE_START") {
    return ["Empezar la ruta"];
  }
  if (type === "ROUTE_LOCATION_POINT") {
    const recordedAt = (payload as { recordedAt?: unknown } | null)?.recordedAt;
    return typeof recordedAt === "string"
      ? [`Ubicación del celular, tomada el ${formatInstantInLima(recordedAt)}`]
      : ["Ubicación del celular"];
  }
  if (type !== "STOP_MARK" || typeof payload !== "object" || payload === null) {
    return [`Operación «${type}», versión ${version}`];
  }
  const mark = payload as StopMarkPayload;
  const status = STOP_STATUS[mark.status as StopStatus];
  const lines = [`Marcar la parada como ${status?.label.toLowerCase() ?? "desconocido"}`];

  if (typeof mark.failureReason === "string") {
    lines.push(`Motivo: ${mark.failureReason}`);
  }
  for (const item of linesOf(mark.items)) {
    const name = nameOf(catalogs.products, item.productId, "producto");
    const price = typeof item.unitPrice === "string" ? ` a ${formatSoles(item.unitPrice)}` : "";
    lines.push(`Vendió ${String(item.quantity)} × ${name}${price}`);
  }
  for (const item of linesOf(mark.containersReturned)) {
    const name = nameOf(catalogs.containerTypes, item.containerTypeId, "envase");
    lines.push(`Recogió ${String(item.quantity)} vacíos de ${name}`);
  }
  const payment = mark.payment as { paymentMethodId?: unknown; amount?: unknown } | undefined;
  if (payment !== undefined && typeof payment.amount === "string") {
    const method = nameOf(catalogs.paymentMethods, payment.paymentMethodId, "medio de pago");
    lines.push(`Cobró ${formatSoles(payment.amount)} en ${method}`);
  } else if (mark.status === "DELIVERED") {
    lines.push("Sin cobro: quedó fiado");
  }
  return lines;
}

function linesOf(value: unknown): Line[] {
  return Array.isArray(value)
    ? value.filter((line): line is Line => typeof line === "object" && line !== null)
    : [];
}

function nameOf(names: Map<string, string>, id: unknown, what: string): string {
  return (typeof id === "string" ? names.get(id) : undefined) ?? `un ${what} que ya no figura`;
}
