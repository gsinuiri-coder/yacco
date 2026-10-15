import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

let ctx: TestAppContext;
let prisma: PrismaClient;
let userId: string;
let customerId: string;
let locationId: string;
let saleId: string;
let issuerSettingsVersionId: string;

beforeAll(async () => {
  ctx = await startTestApp();
  prisma = new PrismaClient({ datasourceUrl: ctx.container.getConnectionUri() });

  const user = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  userId = user.id;

  const customer = await prisma.customer.create({
    data: {
      name: "Cliente esquema comprobantes",
      locations: {
        create: {
          name: "Principal",
          address: "Av. Prueba 123",
          addressReference: "Puerta azul",
          phone: "900000001",
          isPrimary: true,
        },
      },
    },
    include: { locations: true },
  });
  customerId = customer.id;
  locationId = customer.locations[0]!.id;

  const sale = await prisma.sale.create({
    data: {
      locationId,
      soldAt: new Date("2026-10-14T15:00:00.000Z"),
      total: "118.00",
      recordedById: userId,
    },
  });
  saleId = sale.id;

  issuerSettingsVersionId = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "issuer_settings_versions" (
      "id", "tax_id", "legal_name", "fiscal_address", "tax_rate",
      "receipt_document_threshold", "created_by"
    ) VALUES (
      ${issuerSettingsVersionId}::uuid, '20123456789', 'Yacco S.A.C.',
      'Av. Planta 456', 18.00, 700.00, ${userId}::uuid
    )
  `;
}, 180000);

afterAll(async () => {
  await prisma?.$disconnect();
  await stopTestApp(ctx);
});

async function createReceipt(): Promise<string> {
  const receiptId = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "receipts" (
      "id", "type", "medium", "series", "number", "issued_on",
      "customer_id", "issuer_settings_version_id", "taxable_amount",
      "tax_amount", "total", "created_by"
    ) VALUES (
      ${receiptId}::uuid, 'SALES_RECEIPT', 'MANUAL',
      ${`B${receiptId.slice(0, 7)}`}, ${receiptId.slice(9, 17)}, '2026-10-14',
      ${customerId}::uuid, ${issuerSettingsVersionId}::uuid, 100.00,
      18.00, 118.00, ${userId}::uuid
    )
  `;
  return receiptId;
}

test("issuer settings no longer stores a prices-include-tax option", async () => {
  const columns = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'issuer_settings_versions'
  `;

  expect(columns.map(({ column_name }) => column_name)).not.toContain("prices_include_tax");
});

test("receipt and exemption release markers have their authorized partial indexes", async () => {
  const rows = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'receipt_sales_active_sale_key',
        'sale_receipt_exemptions_active_sale_key'
      )
    ORDER BY indexname
  `;

  expect(rows).toEqual([
    expect.objectContaining({
      indexname: "receipt_sales_active_sale_key",
      indexdef: expect.stringContaining("WHERE (released_at IS NULL)"),
    }),
    expect.objectContaining({
      indexname: "sale_receipt_exemptions_active_sale_key",
      indexdef: expect.stringContaining("WHERE (released_at IS NULL)"),
    }),
  ]);
});

test("receipt void fields and both release groups are all-or-none", async () => {
  const receiptId = await createReceipt();
  await prisma.$executeRaw`
    INSERT INTO "receipt_sales" ("receipt_id", "sale_id")
    VALUES (${receiptId}::uuid, ${saleId}::uuid)
  `;

  await expect(
    prisma.$executeRaw`
      UPDATE "receipts"
      SET "voided_at" = CURRENT_TIMESTAMP, "voided_by" = ${userId}::uuid
      WHERE "id" = ${receiptId}::uuid
    `,
  ).rejects.toThrow(/receipts_void_check/);

  await expect(
    prisma.$executeRaw`
      UPDATE "receipt_sales"
      SET "released_at" = CURRENT_TIMESTAMP
      WHERE "receipt_id" = ${receiptId}::uuid AND "sale_id" = ${saleId}::uuid
    `,
  ).rejects.toThrow(/receipt_sales_release_check/);

  const exemptionId = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "sale_receipt_exemptions" (
      "id", "sale_id", "reason", "created_by"
    ) VALUES (
      ${exemptionId}::uuid, ${saleId}::uuid, 'Cliente no solicita comprobante',
      ${userId}::uuid
    )
  `;

  await expect(
    prisma.$executeRaw`
      UPDATE "sale_receipt_exemptions"
      SET "released_at" = CURRENT_TIMESTAMP, "released_by" = ${userId}::uuid
      WHERE "id" = ${exemptionId}::uuid
    `,
  ).rejects.toThrow(/sale_receipt_exemptions_release_check/);
});

test("the two partial indexes allow a replacement only after release", async () => {
  const replacementSale = await prisma.sale.create({
    data: {
      locationId,
      soldAt: new Date("2026-10-14T16:00:00.000Z"),
      total: "59.00",
      recordedById: userId,
    },
  });
  const replacementSaleId = replacementSale.id;
  const firstReceiptId = await createReceipt();
  const secondReceiptId = await createReceipt();
  await prisma.$executeRaw`
    INSERT INTO "receipt_sales" ("receipt_id", "sale_id")
    VALUES (${firstReceiptId}::uuid, ${replacementSaleId}::uuid)
  `;

  await expect(
    prisma.$executeRaw`
      INSERT INTO "receipt_sales" ("receipt_id", "sale_id")
      VALUES (${secondReceiptId}::uuid, ${replacementSaleId}::uuid)
    `,
  ).rejects.toThrow(/already exists/);

  await prisma.$executeRaw`
    UPDATE "receipt_sales"
    SET "released_at" = CURRENT_TIMESTAMP, "released_by" = ${userId}::uuid
    WHERE "receipt_id" = ${firstReceiptId}::uuid
      AND "sale_id" = ${replacementSaleId}::uuid
  `;
  await expect(
    prisma.$executeRaw`
      INSERT INTO "receipt_sales" ("receipt_id", "sale_id")
      VALUES (${secondReceiptId}::uuid, ${replacementSaleId}::uuid)
    `,
  ).resolves.toBe(1);

  const firstExemptionId = randomUUID();
  const secondExemptionId = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "sale_receipt_exemptions" (
      "id", "sale_id", "reason", "created_by"
    ) VALUES (
      ${firstExemptionId}::uuid, ${replacementSaleId}::uuid, 'Primera marca',
      ${userId}::uuid
    )
  `;
  await expect(
    prisma.$executeRaw`
      INSERT INTO "sale_receipt_exemptions" (
        "id", "sale_id", "reason", "created_by"
      ) VALUES (
        ${secondExemptionId}::uuid, ${replacementSaleId}::uuid, 'Segunda marca',
        ${userId}::uuid
      )
    `,
  ).rejects.toThrow(/already exists/);

  await prisma.$executeRaw`
    UPDATE "sale_receipt_exemptions"
    SET "released_at" = CURRENT_TIMESTAMP,
        "released_by" = ${userId}::uuid,
        "release_reason" = 'Se registrará comprobante'
    WHERE "id" = ${firstExemptionId}::uuid
  `;
  await expect(
    prisma.$executeRaw`
      INSERT INTO "sale_receipt_exemptions" (
        "id", "sale_id", "reason", "created_by"
      ) VALUES (
        ${secondExemptionId}::uuid, ${replacementSaleId}::uuid, 'Segunda marca',
        ${userId}::uuid
      )
    `,
  ).resolves.toBe(1);
});
