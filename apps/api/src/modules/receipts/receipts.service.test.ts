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

  test("voiding a manual credit note stamps only the note; an electronic one is rejected", async () => {
    const tx = buildTransactionMock();
    tx.receiptSale.updateMany.mockResolvedValue({ count: 0 });
    tx.receipt.findUnique.mockResolvedValue({
      id: "credit-note-1",
      type: ReceiptType.CREDIT_NOTE,
      medium: ReceiptMedium.MANUAL,
      voidedAt: null,
      sales: [],
    });
    const service = new ReceiptsService(buildTransactionalPrisma(tx) as never);

    await expect(
      service.void("credit-note-1", { reason: "Se anotó la nota equivocada" }, USER_ID),
    ).resolves.toEqual({ id: "credit-note-1", releasedSales: 0 });
    expect(tx.receipt.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.receipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "credit-note-1", voidedAt: null } }),
    );

    tx.receipt.updateMany.mockClear();
    tx.receipt.findUnique.mockResolvedValue({
      id: "credit-note-2",
      type: ReceiptType.CREDIT_NOTE,
      medium: ReceiptMedium.EXTERNAL_ELECTRONIC,
      voidedAt: null,
      sales: [],
    });
    await expect(
      service.void("credit-note-2", { reason: "Se anotó la nota equivocada" }, USER_ID),
    ).rejects.toThrow("Una nota de crédito electrónica no se puede anular");
    expect(tx.receipt.updateMany).not.toHaveBeenCalled();
  });

  describe("registering again with the original's files", () => {
    const ORIGINAL_ID = "44444444-4444-4444-8444-444444444444";
    const ORIGINAL_FILE = {
      objectKey: `receipts/${ORIGINAL_ID}/55555555-5555-4555-8555-555555555555.pdf`,
      contentType: "application/pdf",
    };

    function createDto() {
      return {
        type: ReceiptType.SALES_RECEIPT,
        medium: ReceiptMedium.MANUAL,
        series: "B001",
        number: "000001",
        issuedOn: "2026-10-14",
        customerId: CUSTOMER_ID,
        saleIds: SALE_IDS,
        filesFromReceiptId: ORIGINAL_ID,
      };
    }

    function originalRow(overrides: Record<string, unknown> = {}) {
      return {
        customerId: CUSTOMER_ID,
        medium: ReceiptMedium.MANUAL,
        voidedAt: new Date("2026-10-14T09:00:00.000Z"),
        files: [ORIGINAL_FILE],
        ...overrides,
      };
    }

    function withReceiptFiles(tx: ReturnType<typeof buildTransactionMock>) {
      const createMany = jest.fn<() => Promise<unknown>>().mockResolvedValue({ count: 1 });
      return { tx: { ...tx, receiptFile: { createMany } }, createMany };
    }

    test("copies each file row with the same object key and its own who and when", async () => {
      const { tx, createMany } = withReceiptFiles(buildTransactionMock());
      tx.receipt.findUnique.mockResolvedValue(originalRow());
      const service = new ReceiptsService(buildTransactionalPrisma(tx as never) as never);

      await service.create(createDto(), USER_ID);

      expect(createMany).toHaveBeenCalledWith({
        data: [
          {
            receiptId: "receipt-1",
            objectKey: ORIGINAL_FILE.objectKey,
            contentType: "application/pdf",
            createdAt: expect.any(Date),
            createdById: USER_ID,
          },
        ],
      });
    });

    test.each([
      ["a missing original", null, "El comprobante original no existe"],
      [
        "an active original",
        originalRow({ voidedAt: null }),
        "Solo se vuelven a asociar los adjuntos de un comprobante anulado",
      ],
      [
        "another customer's original",
        originalRow({ customerId: OTHER_CUSTOMER_ID }),
        "Los adjuntos solo se vuelven a asociar a un comprobante del mismo cliente y medio",
      ],
      [
        "an original of another medium",
        originalRow({ medium: ReceiptMedium.EXTERNAL_ELECTRONIC }),
        "Los adjuntos solo se vuelven a asociar a un comprobante del mismo cliente y medio",
      ],
    ])("rejects %s before writing anything", async (_label, original, message) => {
      const { tx, createMany } = withReceiptFiles(buildTransactionMock());
      tx.receipt.findUnique.mockResolvedValue(original);
      const service = new ReceiptsService(buildTransactionalPrisma(tx as never) as never);

      await expect(service.create(createDto(), USER_ID)).rejects.toThrow(message);
      expect(tx.receipt.create).not.toHaveBeenCalled();
      expect(createMany).not.toHaveBeenCalled();
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

describe("ReceiptsService reads", () => {
  const issuedOn = new Date("2026-10-13T00:00:00.000Z");
  const createdAt = new Date("2026-10-13T15:30:00.000Z");

  function receiptRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "receipt-1",
      type: ReceiptType.SALES_RECEIPT,
      medium: ReceiptMedium.MANUAL,
      series: "B001",
      number: "000001",
      issuedOn,
      customerId: CUSTOMER_ID,
      issuerSettingsVersionId: "settings-1",
      taxableAmount: decimal("100.00"),
      taxAmount: decimal("18.00"),
      total: decimal("118.00"),
      affectedReceiptId: null,
      reason: null,
      createdById: "user-1",
      createdAt,
      voidedAt: null,
      voidedById: null,
      voidReason: null,
      customer: { id: CUSTOMER_ID, name: "Bodega Azul" },
      createdBy: { id: "user-1", username: "vendedor" },
      ...overrides,
    };
  }

  test("lists receipts with type, medium, status, and business-date filters", async () => {
    const prisma = {
      receipt: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(1),
        findMany: jest.fn<() => Promise<unknown>>().mockResolvedValue([receiptRow()]),
      },
      $transaction: jest.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
    };
    const service = new ReceiptsService(prisma as never);

    const result = await service.findAll({
      page: 1,
      limit: 20,
      type: ReceiptType.SALES_RECEIPT,
      medium: ReceiptMedium.MANUAL,
      status: "ACTIVE",
      issuedFrom: "2026-10-01",
      issuedTo: "2026-10-14",
    } as never);

    const where = {
      type: ReceiptType.SALES_RECEIPT,
      medium: ReceiptMedium.MANUAL,
      voidedAt: null,
      issuedOn: {
        gte: new Date("2026-10-01T00:00:00.000Z"),
        lte: new Date("2026-10-14T00:00:00.000Z"),
      },
    };
    expect(prisma.receipt.count).toHaveBeenCalledWith({ where });
    expect(prisma.receipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 0, take: 20 }),
    );
    expect(result).toEqual({
      data: [
        expect.objectContaining({
          id: "receipt-1",
          issuedOn: "2026-10-13",
          total: "118.00",
          status: "ACTIVE",
          customer: { id: CUSTOMER_ID, name: "Bodega Azul" },
        }),
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });

  test("returns receipt detail with its sales, files, and audit users", async () => {
    const prisma = {
      receipt: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue(
          receiptRow({
            issuerSettingsVersion: {
              id: "settings-1",
              taxId: "20123456789",
              legalName: "Agua Clara SAC",
              fiscalAddress: "Av. Lima 123",
              taxRate: decimal("18.00"),
              receiptDocumentThreshold: decimal("700.00"),
            },
            voidedBy: null,
            sales: [
              {
                saleId: SALE_IDS[0],
                releasedAt: null,
                sale: {
                  soldAt: new Date("2026-10-12T16:00:00.000Z"),
                  total: decimal("118.00"),
                  location: { id: "location-1", name: "Local principal" },
                },
              },
            ],
            files: [
              { objectKey: "receipts/receipt-1/document.pdf", contentType: "application/pdf" },
            ],
            creditNotes: [
              {
                id: "credit-note-1",
                series: "BC01",
                number: "000001",
                medium: ReceiptMedium.MANUAL,
                voidedAt: new Date("2026-10-14T10:00:00.000Z"),
              },
            ],
          }),
        ),
      },
    };
    const service = new ReceiptsService(prisma as never);

    const result = await service.findOne("receipt-1");

    expect(result).toEqual(
      expect.objectContaining({
        id: "receipt-1",
        total: "118.00",
        status: "ACTIVE",
        issuerSettingsVersion: expect.objectContaining({
          taxRate: "18.00",
          receiptDocumentThreshold: "700.00",
        }),
        sales: [
          expect.objectContaining({
            id: SALE_IDS[0],
            total: "118.00",
            location: { id: "location-1", name: "Local principal" },
          }),
        ],
        files: [{ fileName: "document.pdf", contentType: "application/pdf" }],
        creditNotes: [
          {
            id: "credit-note-1",
            series: "BC01",
            number: "000001",
            medium: ReceiptMedium.MANUAL,
            status: "VOIDED",
          },
        ],
        createdBy: { id: "user-1", username: "vendedor" },
        voidedBy: null,
      }),
    );
  });

  test("classifies live sales as receipted, exempt, or available without hiding any class", async () => {
    const sales = [
      saleRow(SALE_IDS[0]!, "10.00", {
        soldAt: new Date("2026-10-11T15:00:00.000Z"),
        location: { id: "location-1", name: "Principal", customer: { id: CUSTOMER_ID } },
        receiptSales: [
          {
            receipt: {
              id: "receipt-1",
              type: ReceiptType.SALES_RECEIPT,
              series: "B001",
              number: "000001",
            },
          },
        ],
      }),
      saleRow(SALE_IDS[1]!, "20.00", {
        soldAt: new Date("2026-10-12T15:00:00.000Z"),
        location: { id: "location-1", name: "Principal", customer: { id: CUSTOMER_ID } },
        receiptExemptions: [{ id: "exemption-1", reason: "No solicita" }],
      }),
      saleRow(SALE_IDS[2]!, "30.00", {
        soldAt: new Date("2026-10-13T15:00:00.000Z"),
        location: { id: "location-1", name: "Principal", customer: { id: CUSTOMER_ID } },
      }),
    ];
    const prisma = {
      sale: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(3),
        findMany: jest.fn<() => Promise<unknown>>().mockResolvedValue(sales),
      },
      $transaction: jest.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
    };
    const service = new ReceiptsService(prisma as never);

    const result = await service.listSales({
      customerId: CUSTOMER_ID,
      page: 1,
      limit: 20,
    } as never);

    expect(prisma.sale.count).toHaveBeenCalledWith({
      where: {
        location: { customerId: CUSTOMER_ID },
        voidedAt: null,
        isOpeningBalance: false,
      },
    });
    expect(result.data.map((sale) => sale.status)).toEqual(["RECEIPTED", "EXEMPT", "AVAILABLE"]);
    expect(result.data[0]?.receipt).toEqual(
      expect.objectContaining({ id: "receipt-1", series: "B001" }),
    );
    expect(result.data[1]?.exemption).toEqual({ id: "exemption-1", reason: "No solicita" });
    expect(result.data[2]).toEqual(
      expect.objectContaining({ total: "30.00", receipt: null, exemption: null }),
    );
  });
});
