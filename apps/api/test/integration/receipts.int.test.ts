import { randomUUID } from "node:crypto";
import request from "supertest";
import { ReceiptMedium, ReceiptType, UserRole } from "@prisma/client";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { SalesService } from "../../src/modules/sales/sales.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";
import { startTestStorage } from "./support/test-storage.js";
import type { StartedTestStorage } from "./support/test-storage.js";
import { holdSaleLock, startAndCheckBlocked } from "./support/hold-lock.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

let context: TestAppContext;
let storage: StartedTestStorage;
let prisma: PrismaService;
let salesService: SalesService;
let adminToken: string;
let adminId: string;
let sellerToken: string;
let sellerId: string;
let driverToken: string;
let customerId: string;
let locationId: string;

function server() {
  return context.app.getHttpServer();
}

async function login(username: string, password: string): Promise<string> {
  const response = await request(server())
    .post("/api/v1/auth/login")
    .send({ username, password })
    .expect(200);
  return response.body.accessToken;
}

async function createUser(username: string, role: UserRole): Promise<string> {
  const password = `${username}-pass-1234`;
  await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: username, username, password, roles: [role] })
    .expect(201);
  return login(username, password);
}

async function createSale(total: string, soldAt: string): Promise<string> {
  const sale = await prisma.sale.create({
    data: { locationId, total, soldAt: new Date(soldAt), recordedById: adminId },
  });
  return sale.id;
}

async function configureIssuerSettings(): Promise<void> {
  await request(server())
    .post("/api/v1/issuer-settings")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      taxId: "20123456789",
      legalName: "Yacco S.A.C.",
      fiscalAddress: "Av. Planta 456",
      taxRate: "18.00",
      receiptDocumentThreshold: "700.00",
    })
    .expect(201);
}

function receiptBody(saleId: string, overrides: Record<string, unknown> = {}) {
  return {
    type: ReceiptType.SALES_RECEIPT,
    medium: ReceiptMedium.MANUAL,
    series: "B001",
    number: saleId.slice(0, 8),
    issuedOn: "2026-10-14",
    customerId,
    saleIds: [saleId],
    ...overrides,
  };
}

beforeAll(async () => {
  storage = await startTestStorage("test-receipts");
  context = await startTestApp();
  prisma = context.app.get(PrismaService);
  salesService = context.app.get(SalesService);
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  adminId = (await prisma.user.findUniqueOrThrow({ where: { username: ADMIN_USERNAME } })).id;
  sellerToken = await createUser("vendedor-comprobantes", UserRole.SELLER);
  sellerId = (await prisma.user.findUniqueOrThrow({ where: { username: "vendedor-comprobantes" } }))
    .id;
  driverToken = await createUser("chofer-comprobantes", UserRole.DRIVER);

  const customer = await prisma.customer.create({
    data: {
      name: "Cliente comprobantes integrados",
      documentType: "DNI",
      documentNumber: "12345678",
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
}, 180000);

afterAll(async () => {
  await stopTestApp(context);
  await storage?.stop();
});

test("cada endpoint de comprobantes rechaza chofer y los datos fiscales son solo ADMIN", async () => {
  const id = randomUUID();
  const fileName = `${randomUUID()}.pdf`;
  const saleId = randomUUID();
  const preview = { type: ReceiptType.SALES_RECEIPT, customerId, saleIds: [saleId] };

  await request(server()).get("/api/v1/receipts").expect(401);
  await request(server()).get("/api/v1/issuer-settings/current").expect(401);
  await request(server())
    .get("/api/v1/issuer-settings/current")
    .set("Authorization", `Bearer ${sellerToken}`)
    .expect(403);

  const driverRequests = [
    () => request(server()).get("/api/v1/receipts"),
    () => request(server()).get(`/api/v1/receipts/sales?customerId=${customerId}`),
    () => request(server()).get(`/api/v1/receipts/${id}`),
    () => request(server()).post("/api/v1/receipts/preview").send(preview),
    () => request(server()).post("/api/v1/receipts").send(receiptBody(saleId)),
    () =>
      request(server())
        .post("/api/v1/receipts/exemptions")
        .send({ customerId, saleIds: [saleId], reason: "No solicita" }),
    () => request(server()).patch(`/api/v1/receipts/${id}/void`).send({ reason: "Corrección" }),
    () =>
      request(server())
        .patch(`/api/v1/receipts/exemptions/${id}/release`)
        .send({ reason: "Ahora solicita" }),
    () =>
      request(server()).post(`/api/v1/receipts/${id}/credit-notes`).send({
        medium: ReceiptMedium.MANUAL,
        series: "BC01",
        number: "000001",
        issuedOn: "2026-10-14",
        reason: "Operación anulada",
      }),
    () =>
      request(server())
        .post(`/api/v1/receipts/${id}/files`)
        .attach("file", Buffer.from("%PDF-1.7"), "document.pdf"),
    () => request(server()).get(`/api/v1/receipts/${id}/files/${fileName}/raw`),
  ];
  for (const buildRequest of driverRequests) {
    await buildRequest().set("Authorization", `Bearer ${driverToken}`).expect(403);
  }

  await request(server())
    .patch(`/api/v1/receipts/${id}/void`)
    .set("Authorization", `Bearer ${sellerToken}`)
    .send({ reason: "Corrección" })
    .expect(403);
  await request(server())
    .patch(`/api/v1/receipts/exemptions/${id}/release`)
    .set("Authorization", `Bearer ${sellerToken}`)
    .send({ reason: "Ahora solicita" })
    .expect(403);
});

test("ADMIN versiona los datos de facturación y la oficina ejecuta el flujo auditable", async () => {
  await configureIssuerSettings();

  const receiptedSaleId = await createSale("118.00", "2026-10-14T14:00:00.000Z");
  const exemptSaleId = await createSale("25.00", "2026-10-14T15:00:00.000Z");
  const creditNoteSaleId = await createSale("59.00", "2026-10-14T16:00:00.000Z");

  const preview = await request(server())
    .post("/api/v1/receipts/preview")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send({
      type: ReceiptType.SALES_RECEIPT,
      customerId,
      saleIds: [receiptedSaleId],
    })
    .expect(200);
  expect(preview.body).toMatchObject({
    taxableAmount: "100.00",
    taxAmount: "18.00",
    total: "118.00",
  });

  const created = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(receiptBody(receiptedSaleId))
    .expect(201);
  const receiptId = created.body.id as string;

  const list = await request(server())
    .get(
      "/api/v1/receipts?type=SALES_RECEIPT&medium=MANUAL&status=ACTIVE&issuedFrom=2026-10-14&issuedTo=2026-10-14",
    )
    .set("Authorization", `Bearer ${sellerToken}`)
    .expect(200);
  expect(list.body.data).toEqual([
    expect.objectContaining({ id: receiptId, total: "118.00", status: "ACTIVE" }),
  ]);

  const detail = await request(server())
    .get(`/api/v1/receipts/${receiptId}`)
    .set("Authorization", `Bearer ${sellerToken}`)
    .expect(200);
  expect(detail.body.sales).toEqual([
    expect.objectContaining({ id: receiptedSaleId, total: "118.00" }),
  ]);

  const receiptSales = await request(server())
    .get(`/api/v1/receipts/sales?customerId=${customerId}&status=RECEIPTED`)
    .set("Authorization", `Bearer ${sellerToken}`)
    .expect(200);
  expect(receiptSales.body.data.map(({ id }: { id: string }) => id)).toContain(receiptedSaleId);

  await expect(
    prisma.$transaction((tx) =>
      salesService.voidSaleWithinTransaction(tx, {
        saleId: receiptedSaleId,
        voidedById: adminId,
        voidReason: "Venta equivocada",
      }),
    ),
  ).rejects.toThrow("Anulá primero el comprobante vigente de la venta");
  expect(
    (await prisma.sale.findUniqueOrThrow({ where: { id: receiptedSaleId } })).voidedAt,
  ).toBeNull();

  const pdf = Buffer.from("%PDF-1.7\ncomprobante integrado");
  const uploaded = await request(server())
    .post(`/api/v1/receipts/${receiptId}/files`)
    .set("Authorization", `Bearer ${sellerToken}`)
    .attach("file", pdf, "comprobante.pdf")
    .expect(201);
  const uploadedFileName = uploaded.body.fileName as string;
  const [storedFile] = await prisma.$queryRaw<{ created_at: Date; created_by: string }[]>`
    SELECT "created_at", "created_by"
    FROM "receipt_files"
    WHERE "receipt_id" = ${receiptId}::uuid
  `;
  expect(storedFile).toEqual(
    expect.objectContaining({
      created_at: expect.any(Date),
      created_by: sellerId,
    }),
  );
  expect(storedFile!.created_at.getTime()).toBeGreaterThan(
    new Date(created.body.createdAt).getTime(),
  );
  const raw = await request(server())
    .get(`/api/v1/receipts/${receiptId}/files/${uploadedFileName}/raw`)
    .set("Authorization", `Bearer ${sellerToken}`)
    .expect(200);
  expect(raw.headers["content-type"]).toBe("application/pdf");
  expect(raw.body).toEqual(pdf);
  await request(server())
    .get(`/api/v1/receipts/${receiptId}/files/${uploadedFileName}/raw`)
    .expect(401);

  await request(server())
    .post("/api/v1/receipts/exemptions")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send({ customerId, saleIds: [exemptSaleId], reason: "El cliente no solicita" })
    .expect(201);
  const exemptSales = await request(server())
    .get(`/api/v1/receipts/sales?customerId=${customerId}&status=EXEMPT`)
    .set("Authorization", `Bearer ${sellerToken}`)
    .expect(200);
  const exemption = exemptSales.body.data.find(({ id }: { id: string }) => id === exemptSaleId);
  expect(exemption).toMatchObject({ status: "EXEMPT" });
  await request(server())
    .patch(`/api/v1/receipts/exemptions/${exemption.exemption.id}/release`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ reason: "El cliente pidió comprobante" })
    .expect(200);

  const creditReceipt = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(
      receiptBody(creditNoteSaleId, {
        medium: ReceiptMedium.EXTERNAL_ELECTRONIC,
        series: "B002",
      }),
    )
    .expect(201);
  await request(server())
    .post(`/api/v1/receipts/${creditReceipt.body.id}/credit-notes`)
    .set("Authorization", `Bearer ${sellerToken}`)
    .send({
      medium: ReceiptMedium.EXTERNAL_ELECTRONIC,
      series: "BC01",
      number: "000001",
      issuedOn: "2026-10-14",
      reason: "Operación anulada",
    })
    .expect(201);

  await request(server())
    .patch(`/api/v1/receipts/${receiptId}/void`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ reason: "Se registró una serie equivocada" })
    .expect(200);

  const available = await request(server())
    .get(`/api/v1/receipts/sales?customerId=${customerId}&status=AVAILABLE`)
    .set("Authorization", `Bearer ${sellerToken}`)
    .expect(200);
  expect(available.body.data.map(({ id }: { id: string }) => id)).toEqual(
    expect.arrayContaining([receiptedSaleId, exemptSaleId, creditNoteSaleId]),
  );
});

test("tipo, serie y número son únicos solo entre los vigentes: anular y volver a registrar el mismo papel pasa", async () => {
  const firstSaleId = await createSale("47.20", "2026-10-14T18:00:00.000Z");
  const secondSaleId = await createSale("12.40", "2026-10-14T18:30:00.000Z");
  const paper = { series: "B009", number: "000777" };
  await configureIssuerSettings();

  const wrong = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send(receiptBody(firstSaleId, { ...paper, saleIds: [firstSaleId, secondSaleId] }))
    .expect(201);

  await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send(
      receiptBody(firstSaleId, {
        ...paper,
        medium: ReceiptMedium.EXTERNAL_ELECTRONIC,
        saleIds: [await createSale("5.00", "2026-10-14T18:45:00.000Z")],
      }),
    )
    .expect(409);

  await request(server())
    .patch(`/api/v1/receipts/${wrong.body.id}/void`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ reason: "Se cargó con una venta de más" })
    .expect(200);

  const corrected = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send(receiptBody(firstSaleId, paper))
    .expect(201);
  expect(corrected.body).toMatchObject({ ...paper, total: "47.20", voidedAt: null });

  const voided = await request(server())
    .get(`/api/v1/receipts/${wrong.body.id}`)
    .set("Authorization", `Bearer ${sellerToken}`)
    .expect(200);
  expect(voided.body).toMatchObject({ ...paper, status: "VOIDED" });
});

test("el alta de un comprobante gana el lock y evita que una anulación concurrente deje ambos vigentes", async () => {
  const saleId = await createSale("35.00", "2026-10-14T17:00:00.000Z");
  const held = await holdSaleLock(prisma, saleId);
  const creating = await startAndCheckBlocked(() =>
    request(server())
      .post("/api/v1/receipts")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send(receiptBody(saleId)),
  );
  expect(creating.finishedWhileLocked).toBe(false);

  const voiding = await startAndCheckBlocked(() =>
    prisma.$transaction((tx) =>
      salesService.voidSaleWithinTransaction(tx, {
        saleId,
        voidedById: adminId,
        voidReason: "Venta equivocada",
      }),
    ),
  );
  expect(voiding.finishedWhileLocked).toBe(false);

  await held.release();
  expect((await creating.result).status).toBe(201);
  await expect(voiding.result).rejects.toThrow("Anulá primero el comprobante vigente de la venta");
  expect((await prisma.sale.findUniqueOrThrow({ where: { id: saleId } })).voidedAt).toBeNull();
});
