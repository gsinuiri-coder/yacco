import { jest } from "@jest/globals";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma, ReceiptType } from "@prisma/client";
import { ReceiptsService } from "./receipts.service.js";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const SALE_IDS = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
];

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function settingsRow() {
  return {
    id: "settings-1",
    taxRate: decimal("18.00"),
    receiptDocumentThreshold: decimal("700.00"),
  };
}

function saleRow(id: string, total: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    total: decimal(total),
    voidedAt: null,
    isOpeningBalance: false,
    location: {
      customer: {
        id: CUSTOMER_ID,
        documentType: "DNI",
        documentNumber: "12345678",
      },
    },
    receiptSales: [],
    receiptExemptions: [],
    ...overrides,
  };
}

function buildPrismaMock() {
  return {
    issuerSettingsVersion: { findFirst: jest.fn<() => Promise<unknown>>() },
    sale: { findMany: jest.fn<() => Promise<unknown>>() },
  };
}

function previewDto(type: ReceiptType = ReceiptType.SALES_RECEIPT) {
  return { type, customerId: CUSTOMER_ID, saleIds: SALE_IDS };
}

describe("ReceiptsService.preview", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: ReceiptsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    prisma.issuerSettingsVersion.findFirst.mockResolvedValue(settingsRow());
    prisma.sale.findMany.mockResolvedValue([
      saleRow(SALE_IDS[0]!, "1.00"),
      saleRow(SALE_IDS[1]!, "1.01"),
      saleRow(SALE_IDS[2]!, "1.04"),
    ]);
    service = new ReceiptsService(prisma as never);
  });

  test("sums final prices, rounds the base per sale, and squares tax to the total", async () => {
    const result = await service.preview(previewDto());

    expect(result).toEqual({
      customerId: CUSTOMER_ID,
      saleIds: SALE_IDS,
      issuerSettingsVersionId: "settings-1",
      taxRate: "18.00",
      taxableAmount: "2.59",
      taxAmount: "0.46",
      total: "3.05",
    });
    expect(prisma.sale.findMany).toHaveBeenCalledWith({
      where: { id: { in: SALE_IDS } },
      select: expect.objectContaining({ total: true, voidedAt: true, isOpeningBalance: true }),
    });
  });

  test("rejects missing, voided, or opening-balance rows instead of trusting the ids", async () => {
    prisma.sale.findMany.mockResolvedValue([
      saleRow(SALE_IDS[0]!, "1.00"),
      saleRow(SALE_IDS[1]!, "1.01", { voidedAt: new Date() }),
      saleRow(SALE_IDS[2]!, "1.04", { isOpeningBalance: true }),
    ]);

    await expect(service.preview(previewDto())).rejects.toThrow(BadRequestException);

    prisma.sale.findMany.mockResolvedValue([saleRow(SALE_IDS[0]!, "1.00")]);
    await expect(service.preview(previewDto())).rejects.toThrow(NotFoundException);
  });

  test("rejects sales from two customers", async () => {
    prisma.sale.findMany.mockResolvedValue([
      saleRow(SALE_IDS[0]!, "1.00"),
      saleRow(SALE_IDS[1]!, "1.01", {
        location: {
          customer: {
            id: OTHER_CUSTOMER_ID,
            documentType: "DNI",
            documentNumber: "87654321",
          },
        },
      }),
      saleRow(SALE_IDS[2]!, "1.04"),
    ]);

    await expect(service.preview(previewDto())).rejects.toThrow(
      "Todas las ventas deben ser del mismo cliente",
    );
  });

  test("rejects an active receipt but allows an exemption that create will release", async () => {
    prisma.sale.findMany.mockResolvedValue([
      saleRow(SALE_IDS[0]!, "1.00", { receiptSales: [{ receiptId: "receipt-1" }] }),
      saleRow(SALE_IDS[1]!, "1.01"),
      saleRow(SALE_IDS[2]!, "1.04"),
    ]);
    await expect(service.preview(previewDto())).rejects.toThrow(ConflictException);

    prisma.sale.findMany.mockResolvedValue([
      saleRow(SALE_IDS[0]!, "1.00", { receiptExemptions: [{ id: "exemption-1" }] }),
      saleRow(SALE_IDS[1]!, "1.01"),
      saleRow(SALE_IDS[2]!, "1.04"),
    ]);
    await expect(service.preview(previewDto())).resolves.toMatchObject({ total: "3.05" });
  });

  test("an invoice requires the selected customer's RUC", async () => {
    await expect(service.preview(previewDto(ReceiptType.INVOICE))).rejects.toThrow(
      "La factura requiere que el cliente tenga RUC",
    );
  });

  test("a sales receipt at the configured threshold requires a document", async () => {
    prisma.sale.findMany.mockResolvedValue([
      saleRow(SALE_IDS[0]!, "300.00", {
        location: {
          customer: { id: CUSTOMER_ID, documentType: null, documentNumber: null },
        },
      }),
      saleRow(SALE_IDS[1]!, "250.00", {
        location: {
          customer: { id: CUSTOMER_ID, documentType: null, documentNumber: null },
        },
      }),
      saleRow(SALE_IDS[2]!, "150.00", {
        location: {
          customer: { id: CUSTOMER_ID, documentType: null, documentNumber: null },
        },
      }),
    ]);

    await expect(service.preview(previewDto())).rejects.toThrow(
      "La boleta por este monto requiere documento del cliente",
    );
  });

  test("fails clearly until issuer settings have been configured", async () => {
    prisma.issuerSettingsVersion.findFirst.mockResolvedValue(null);

    await expect(service.preview(previewDto())).rejects.toThrow(
      "Configurá primero los datos de facturación",
    );
  });
});
