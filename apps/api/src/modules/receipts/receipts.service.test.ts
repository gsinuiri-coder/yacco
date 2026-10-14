import { jest } from "@jest/globals";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma, ReceiptMedium, ReceiptType } from "@prisma/client";
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

describe("ReceiptsService transactional writes", () => {
  const USER_ID = "33333333-3333-4333-8333-333333333333";

  function buildTransactionMock() {
    return {
      $queryRaw: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
      issuerSettingsVersion: {
        findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue(settingsRow()),
      },
      sale: {
        findMany: jest.fn<() => Promise<unknown>>().mockResolvedValue([
          saleRow(SALE_IDS[0]!, "1.00", {
            receiptExemptions: [{ id: "exemption-1" }],
          }),
          saleRow(SALE_IDS[1]!, "1.01"),
          saleRow(SALE_IDS[2]!, "1.04"),
        ]),
      },
      saleReceiptExemption: {
        updateMany: jest.fn<() => Promise<unknown>>().mockResolvedValue({ count: 1 }),
        createMany: jest.fn<() => Promise<unknown>>().mockResolvedValue({ count: 2 }),
        findUnique: jest.fn<() => Promise<unknown>>(),
      },
      receipt: {
        create: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          id: "receipt-1",
          type: ReceiptType.SALES_RECEIPT,
          medium: ReceiptMedium.MANUAL,
          series: "B001",
          number: "000001",
          issuedOn: new Date("2026-10-14T00:00:00.000Z"),
          customerId: CUSTOMER_ID,
          issuerSettingsVersionId: "settings-1",
          taxableAmount: decimal("2.59"),
          taxAmount: decimal("0.46"),
          total: decimal("3.05"),
          affectedReceiptId: null,
          reason: null,
          createdById: USER_ID,
          createdAt: new Date("2026-10-14T08:00:00.000Z"),
          voidedAt: null,
          voidedById: null,
          voidReason: null,
        }),
        findUnique: jest.fn<() => Promise<unknown>>(),
        updateMany: jest.fn<() => Promise<unknown>>().mockResolvedValue({ count: 1 }),
      },
      receiptSale: {
        updateMany: jest.fn<() => Promise<unknown>>().mockResolvedValue({ count: 3 }),
      },
    };
  }

  function buildTransactionalPrisma(tx: ReturnType<typeof buildTransactionMock>) {
    return {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
  }

  test("creating a receipt releases selected exemptions and stores server-derived amounts", async () => {
    const tx = buildTransactionMock();
    const service = new ReceiptsService(buildTransactionalPrisma(tx) as never);

    const result = await service.create(
      {
        type: ReceiptType.SALES_RECEIPT,
        medium: ReceiptMedium.MANUAL,
        series: " B001 ",
        number: " 000001 ",
        issuedOn: "2026-10-14",
        customerId: CUSTOMER_ID,
        saleIds: SALE_IDS,
      },
      USER_ID,
    );

    expect(tx.saleReceiptExemption.updateMany).toHaveBeenCalledWith({
      where: { saleId: { in: SALE_IDS }, releasedAt: null },
      data: expect.objectContaining({
        releasedAt: expect.any(Date),
        releasedById: USER_ID,
        releaseReason: "Se registró el comprobante B001-000001",
      }),
    });
    expect(tx.receipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taxableAmount: decimal("2.59"),
        taxAmount: decimal("0.46"),
        total: decimal("3.05"),
        sales: { create: SALE_IDS.map((saleId) => ({ saleId })) },
      }),
    });
    expect(result.total).toBe("3.05");
  });

  test("marking sales exempt rejects an active receipt", async () => {
    const tx = buildTransactionMock();
    tx.sale.findMany.mockResolvedValue([
      saleRow(SALE_IDS[0]!, "1.00", { receiptSales: [{ receiptId: "receipt-1" }] }),
      saleRow(SALE_IDS[1]!, "1.01"),
    ]);
    const service = new ReceiptsService(buildTransactionalPrisma(tx) as never);

    await expect(
      service.markExemptions(
        {
          customerId: CUSTOMER_ID,
          saleIds: SALE_IDS.slice(0, 2),
          reason: "El cliente no solicita comprobante",
        },
        USER_ID,
      ),
    ).rejects.toThrow(ConflictException);
    expect(tx.saleReceiptExemption.createMany).not.toHaveBeenCalled();
  });

  test("voiding a receipt stamps it and releases every active sale once", async () => {
    const tx = buildTransactionMock();
    tx.receipt.findUnique.mockResolvedValue({
      id: "receipt-1",
      voidedAt: null,
      sales: SALE_IDS.map((saleId) => ({ saleId, releasedAt: null })),
    });
    const service = new ReceiptsService(buildTransactionalPrisma(tx) as never);

    await service.void("receipt-1", { reason: "Se cargó una serie equivocada" }, USER_ID);

    expect(tx.receipt.updateMany).toHaveBeenCalledWith({
      where: { id: "receipt-1", voidedAt: null },
      data: expect.objectContaining({
        voidedAt: expect.any(Date),
        voidedById: USER_ID,
        voidReason: "Se cargó una serie equivocada",
      }),
    });
    expect(tx.receiptSale.updateMany).toHaveBeenCalledWith({
      where: { receiptId: "receipt-1", releasedAt: null },
      data: expect.objectContaining({ releasedAt: expect.any(Date), releasedById: USER_ID }),
    });
  });

  test("manually releasing an exemption records all three release fields", async () => {
    const tx = buildTransactionMock();
    tx.saleReceiptExemption.findUnique.mockResolvedValue({
      id: "exemption-1",
      saleId: SALE_IDS[0],
      releasedAt: null,
    });
    const service = new ReceiptsService(buildTransactionalPrisma(tx) as never);

    await service.releaseExemption(
      "exemption-1",
      { reason: "El cliente pidió boleta después" },
      USER_ID,
    );

    expect(tx.saleReceiptExemption.updateMany).toHaveBeenCalledWith({
      where: { id: "exemption-1", releasedAt: null },
      data: {
        releasedAt: expect.any(Date),
        releasedById: USER_ID,
        releaseReason: "El cliente pidió boleta después",
      },
    });
  });

  test("a credit note voids its original and releases the original sales", async () => {
    const tx = buildTransactionMock();
    tx.receipt.findUnique.mockResolvedValue({
      id: "receipt-1",
      type: ReceiptType.INVOICE,
      customerId: CUSTOMER_ID,
      issuerSettingsVersionId: "settings-1",
      taxableAmount: decimal("100.00"),
      taxAmount: decimal("18.00"),
      total: decimal("118.00"),
      voidedAt: null,
      sales: SALE_IDS.map((saleId) => ({ saleId, releasedAt: null })),
    });
    const service = new ReceiptsService(buildTransactionalPrisma(tx) as never);

    await service.createCreditNote(
      "receipt-1",
      {
        medium: ReceiptMedium.EXTERNAL_ELECTRONIC,
        series: "FC01",
        number: "000123",
        issuedOn: "2026-10-14",
        reason: "Operación anulada",
      },
      USER_ID,
    );

    expect(tx.receipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: ReceiptType.CREDIT_NOTE,
        affectedReceiptId: "receipt-1",
        reason: "Operación anulada",
        total: decimal("118.00"),
      }),
    });
    expect(tx.receiptSale.updateMany).toHaveBeenCalledWith({
      where: { receiptId: "receipt-1", releasedAt: null },
      data: expect.objectContaining({ releasedAt: expect.any(Date), releasedById: USER_ID }),
    });
  });
});
