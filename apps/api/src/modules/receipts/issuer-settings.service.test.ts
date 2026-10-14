import { jest } from "@jest/globals";
import { Prisma } from "@prisma/client";
import { IssuerSettingsService } from "./issuer-settings.service.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function buildPrismaMock() {
  return {
    issuerSettingsVersion: {
      create: jest.fn<() => Promise<unknown>>(),
      findFirst: jest.fn<() => Promise<unknown>>(),
    },
  };
}

describe("IssuerSettingsService", () => {
  test("creates an immutable settings version with decimal values and the actor", async () => {
    const prisma = buildPrismaMock();
    prisma.issuerSettingsVersion.create.mockResolvedValue({
      id: "settings-1",
      taxId: "20123456789",
      legalName: "Yacco S.A.C.",
      fiscalAddress: "Av. Planta 123",
      taxRate: new Prisma.Decimal("18.00"),
      receiptDocumentThreshold: new Prisma.Decimal("700.00"),
      createdById: USER_ID,
      createdAt: new Date("2026-10-14T07:00:00.000Z"),
    });
    const service = new IssuerSettingsService(prisma as never);

    const result = await service.create(
      {
        taxId: " 20123456789 ",
        legalName: " Yacco S.A.C. ",
        fiscalAddress: " Av. Planta 123 ",
        taxRate: "18.00",
        receiptDocumentThreshold: "700.00",
      },
      USER_ID,
    );

    expect(prisma.issuerSettingsVersion.create).toHaveBeenCalledWith({
      data: {
        taxId: "20123456789",
        legalName: "Yacco S.A.C.",
        fiscalAddress: "Av. Planta 123",
        taxRate: expect.any(Prisma.Decimal),
        receiptDocumentThreshold: expect.any(Prisma.Decimal),
        createdById: USER_ID,
      },
      include: { createdBy: { select: { id: true, username: true } } },
    });
    expect(result.taxRate).toBe("18.00");
    expect(result.receiptDocumentThreshold).toBe("700.00");
    expect(result).not.toHaveProperty("pricesIncludeTax");
  });

  test("returns the newest version without converting money to a JSON number", async () => {
    const prisma = buildPrismaMock();
    prisma.issuerSettingsVersion.findFirst.mockResolvedValue({
      id: "settings-2",
      taxId: "20123456789",
      legalName: "Yacco S.A.C.",
      fiscalAddress: "Av. Planta 456",
      taxRate: new Prisma.Decimal("18.00"),
      receiptDocumentThreshold: new Prisma.Decimal("700.00"),
      createdById: USER_ID,
      createdAt: new Date("2026-10-14T08:00:00.000Z"),
      createdBy: { id: USER_ID, username: "admin" },
    });
    const service = new IssuerSettingsService(prisma as never);

    const result = await service.getCurrent();

    expect(prisma.issuerSettingsVersion.findFirst).toHaveBeenCalledWith({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { createdBy: { select: { id: true, username: true } } },
    });
    expect(result?.taxRate).toBe("18.00");
    expect(result?.receiptDocumentThreshold).toBe("700.00");
  });
});
