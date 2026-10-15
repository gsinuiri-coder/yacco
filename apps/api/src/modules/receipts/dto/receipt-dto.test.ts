import { validate } from "class-validator";
import { ReceiptMedium, ReceiptType } from "@prisma/client";
import { CreateIssuerSettingsDto } from "./create-issuer-settings.dto.js";
import { CreateReceiptDto } from "./create-receipt.dto.js";
import {
  CreateCreditNoteDto,
  MarkReceiptExemptionsDto,
  ReceiptReasonDto,
} from "./receipt-action.dto.js";

const CUSTOMER_ID = "33333333-3333-4333-8333-333333333333";
const SALE_ID = "77777777-7777-4777-8777-777777777777";

async function invalidProperties<T extends object>(instance: T): Promise<string[]> {
  return (await validate(instance)).map((error) => error.property);
}

describe("receipt DTO text validation", () => {
  it.each([
    [
      "razón social",
      Object.assign(new CreateIssuerSettingsDto(), {
        taxId: "20123456789",
        legalName: "   ",
        fiscalAddress: "Av. Planta 123",
        taxRate: "18.00",
        receiptDocumentThreshold: "700.00",
      }),
      "legalName",
    ],
    [
      "dirección fiscal",
      Object.assign(new CreateIssuerSettingsDto(), {
        taxId: "20123456789",
        legalName: "Yacco S.A.C.",
        fiscalAddress: "   ",
        taxRate: "18.00",
        receiptDocumentThreshold: "700.00",
      }),
      "fiscalAddress",
    ],
    [
      "serie",
      Object.assign(new CreateReceiptDto(), {
        type: ReceiptType.SALES_RECEIPT,
        medium: ReceiptMedium.MANUAL,
        series: "   ",
        number: "000001",
        issuedOn: "2026-10-14",
        customerId: CUSTOMER_ID,
        saleIds: [SALE_ID],
      }),
      "series",
    ],
    [
      "número",
      Object.assign(new CreateReceiptDto(), {
        type: ReceiptType.SALES_RECEIPT,
        medium: ReceiptMedium.MANUAL,
        series: "B001",
        number: "   ",
        issuedOn: "2026-10-14",
        customerId: CUSTOMER_ID,
        saleIds: [SALE_ID],
      }),
      "number",
    ],
    [
      "motivo de excepción",
      Object.assign(new MarkReceiptExemptionsDto(), {
        customerId: CUSTOMER_ID,
        saleIds: [SALE_ID],
        reason: "   ",
      }),
      "reason",
    ],
    ["motivo de anulación", Object.assign(new ReceiptReasonDto(), { reason: "   " }), "reason"],
    [
      "datos de nota de crédito",
      Object.assign(new CreateCreditNoteDto(), {
        medium: ReceiptMedium.MANUAL,
        series: "   ",
        number: "   ",
        issuedOn: "2026-10-14",
        reason: "   ",
      }),
      "series",
    ],
  ])("rechaza %s cuando solo contiene espacios", async (_label, dto, property) => {
    expect(await invalidProperties(dto)).toContain(property);
  });
});
