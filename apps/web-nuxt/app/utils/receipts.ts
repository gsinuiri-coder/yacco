import type { ReceiptMedium, ReceiptStatus, ReceiptType } from "@yacco/shared";

type BadgeColor = "success" | "error" | "info" | "neutral";

export const RECEIPT_TYPE: Record<ReceiptType, { label: string; color: BadgeColor }> = {
  SALES_RECEIPT: { label: "Boleta", color: "info" },
  INVOICE: { label: "Factura", color: "neutral" },
  CREDIT_NOTE: { label: "Nota de crédito", color: "error" },
};

export const RECEIPT_MEDIUM: Record<ReceiptMedium, { label: string }> = {
  MANUAL: { label: "Manual" },
  EXTERNAL_ELECTRONIC: { label: "Electrónico" },
};

export const RECEIPT_STATUS: Record<ReceiptStatus, { label: string; color: BadgeColor }> = {
  ACTIVE: { label: "Vigente", color: "success" },
  VOIDED: { label: "Anulado", color: "error" },
};

export function receiptNumber(series: string, number: string): string {
  return `${series}-${number}`;
}
