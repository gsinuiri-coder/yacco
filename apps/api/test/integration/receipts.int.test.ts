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

test("ADMIN versiona los datos de facturación y la oficina ejecuta el flujo auditable (HU-26 E5: adjunto con y sin sesión)", async () => {
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

function creditNoteBody(medium: ReceiptMedium, number: string) {
  return {
    medium,
    series: "BC01",
    number,
    issuedOn: "2026-10-14",
    reason: "El cliente devolvió el pedido",
  };
}

async function receiptRows(receiptId: string) {
  const [receipt] = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "receipts" WHERE "id" = ${receiptId}::uuid
  `;
  const sales = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "receipt_sales" WHERE "receipt_id" = ${receiptId}::uuid ORDER BY "sale_id"
  `;
  return { receipt, sales };
}

test("anular una nota de crédito manual solo la marca: el original y sus ventas no se tocan", async () => {
  await configureIssuerSettings();
  const firstSaleId = await createSale("23.60", "2026-10-14T19:00:00.000Z");
  const secondSaleId = await createSale("8.10", "2026-10-14T19:10:00.000Z");
  const original = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(
      receiptBody(firstSaleId, {
        series: "B010",
        number: "000123",
        saleIds: [firstSaleId, secondSaleId],
      }),
    )
    .expect(201);
  const creditNote = await request(server())
    .post(`/api/v1/receipts/${original.body.id}/credit-notes`)
    .set("Authorization", `Bearer ${sellerToken}`)
    .send(creditNoteBody(ReceiptMedium.MANUAL, "000010"))
    .expect(201);
  const before = await receiptRows(original.body.id);
  expect(before.receipt).toMatchObject({ voided_at: expect.any(Date) });
  expect(before.sales).toHaveLength(2);

  await request(server())
    .patch(`/api/v1/receipts/${creditNote.body.id}/void`)
    .set("Authorization", `Bearer ${sellerToken}`)
    .send({ reason: "Se anotó la nota equivocada" })
    .expect(403);
  await request(server())
    .patch(`/api/v1/receipts/${creditNote.body.id}/void`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ reason: "Se anotó la nota equivocada" })
    .expect(200);

  const voidedNote = await request(server())
    .get(`/api/v1/receipts/${creditNote.body.id}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200);
  expect(voidedNote.body).toMatchObject({
    status: "VOIDED",
    voidReason: "Se anotó la nota equivocada",
  });
  expect(await receiptRows(original.body.id)).toEqual(before);
});

test("una nota de crédito electrónica no se anula", async () => {
  await configureIssuerSettings();
  const saleId = await createSale("17.70", "2026-10-14T19:20:00.000Z");
  const original = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(receiptBody(saleId, { medium: ReceiptMedium.EXTERNAL_ELECTRONIC, series: "B011" }))
    .expect(201);
  const creditNote = await request(server())
    .post(`/api/v1/receipts/${original.body.id}/credit-notes`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send(creditNoteBody(ReceiptMedium.EXTERNAL_ELECTRONIC, "000011"))
    .expect(201);

  const rejected = await request(server())
    .patch(`/api/v1/receipts/${creditNote.body.id}/void`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ reason: "Se anotó la nota equivocada" })
    .expect(409);
  expect(rejected.body.message).toBe("Una nota de crédito electrónica no se puede anular");
  expect(
    (await prisma.receipt.findUniqueOrThrow({ where: { id: creditNote.body.id } })).voidedAt,
  ).toBeNull();
});

test("volver a registrar el original crea uno nuevo con el mismo número, las mismas ventas y sus adjuntos", async () => {
  await configureIssuerSettings();
  const firstSaleId = await createSale("30.68", "2026-10-14T19:30:00.000Z");
  const secondSaleId = await createSale("4.72", "2026-10-14T19:40:00.000Z");
  const paper = { series: "B012", number: "000456" };
  const original = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(receiptBody(firstSaleId, { ...paper, saleIds: [firstSaleId, secondSaleId] }))
    .expect(201);
  const pdf = Buffer.from("%PDF-1.7\ntalonario original");
  const uploaded = await request(server())
    .post(`/api/v1/receipts/${original.body.id}/files`)
    .set("Authorization", `Bearer ${adminToken}`)
    .attach("file", pdf, "talonario.pdf")
    .expect(201);
  const creditNote = await request(server())
    .post(`/api/v1/receipts/${original.body.id}/credit-notes`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send(creditNoteBody(ReceiptMedium.MANUAL, "000012"))
    .expect(201);
  await request(server())
    .patch(`/api/v1/receipts/${creditNote.body.id}/void`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ reason: "La nota no se llegó a entregar" })
    .expect(200);
  const originalDetail = await request(server())
    .get(`/api/v1/receipts/${original.body.id}`)
    .set("Authorization", `Bearer ${sellerToken}`)
    .expect(200);
  expect(originalDetail.body).toMatchObject({
    status: "VOIDED",
    canRegisterAgain: true,
    registeredAgainId: null,
    creditNotes: [
      {
        id: creditNote.body.id,
        series: "BC01",
        number: "000012",
        medium: ReceiptMedium.MANUAL,
        status: "VOIDED",
      },
    ],
  });

  const restored = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send(
      receiptBody(firstSaleId, {
        ...paper,
        saleIds: [firstSaleId, secondSaleId],
        filesFromReceiptId: original.body.id,
      }),
    )
    .expect(201);
  expect(restored.body).toMatchObject({ ...paper, total: "35.40", voidedAt: null });
  expect(restored.body.id).not.toBe(original.body.id);
  for (const voidedId of [original.body.id, creditNote.body.id]) {
    const voided = await request(server())
      .get(`/api/v1/receipts/${voidedId}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(200);
    expect(voided.body).toMatchObject({
      canRegisterAgain: false,
      registeredAgainId: restored.body.id,
    });
  }

  const detail = await request(server())
    .get(`/api/v1/receipts/${restored.body.id}`)
    .set("Authorization", `Bearer ${sellerToken}`)
    .expect(200);
  expect(detail.body.sales.map(({ id }: { id: string }) => id)).toEqual([
    firstSaleId,
    secondSaleId,
  ]);
  expect(detail.body.files).toEqual([
    { fileName: uploaded.body.fileName, contentType: "application/pdf" },
  ]);
  const [originalFile, restoredFile] = await prisma.$queryRaw<
    { receipt_id: string; object_key: string; created_by: string }[]
  >`
    SELECT "receipt_id", "object_key", "created_by" FROM "receipt_files"
    WHERE "receipt_id" IN (${original.body.id}::uuid, ${restored.body.id}::uuid)
    ORDER BY "created_at"
  `;
  expect(originalFile).toMatchObject({ receipt_id: original.body.id, created_by: adminId });
  expect(restoredFile).toMatchObject({
    receipt_id: restored.body.id,
    object_key: originalFile!.object_key,
    created_by: sellerId,
  });
  const raw = await request(server())
    .get(`/api/v1/receipts/${restored.body.id}/files/${uploaded.body.fileName}/raw`)
    .set("Authorization", `Bearer ${sellerToken}`)
    .expect(200);
  expect(raw.body).toEqual(pdf);
});

test("volver a registrar el original se rechaza si una de sus ventas ya está en otro comprobante", async () => {
  await configureIssuerSettings();
  const reusedSaleId = await createSale("11.80", "2026-10-14T19:50:00.000Z");
  const paper = { series: "B013", number: "000789" };
  const original = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(receiptBody(reusedSaleId, paper))
    .expect(201);
  const creditNote = await request(server())
    .post(`/api/v1/receipts/${original.body.id}/credit-notes`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send(creditNoteBody(ReceiptMedium.MANUAL, "000013"))
    .expect(201);
  await request(server())
    .patch(`/api/v1/receipts/${creditNote.body.id}/void`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ reason: "La nota no se llegó a entregar" })
    .expect(200);
  await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(receiptBody(reusedSaleId, { series: "B014", number: "000001" }))
    .expect(201);

  const rejected = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(receiptBody(reusedSaleId, { ...paper, filesFromReceiptId: original.body.id }))
    .expect(409);
  expect(rejected.body.message).toBe("Una o más ventas ya tienen un comprobante vigente");
});

test("volver a registrar el original libera la marca «No lleva comprobante» de una de sus ventas", async () => {
  await configureIssuerSettings();
  const markedSaleId = await createSale("5.90", "2026-10-14T20:00:00.000Z");
  const freeSaleId = await createSale("2.36", "2026-10-14T20:10:00.000Z");
  const paper = { series: "B015", number: "000101", saleIds: [markedSaleId, freeSaleId] };
  const original = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(receiptBody(markedSaleId, paper))
    .expect(201);
  await request(server())
    .patch(`/api/v1/receipts/${original.body.id}/void`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ reason: "Se cargó con la fecha equivocada" })
    .expect(200);
  await request(server())
    .post("/api/v1/receipts/exemptions")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send({ customerId, saleIds: [markedSaleId], reason: "Consumo interno" })
    .expect(201);

  await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send(receiptBody(markedSaleId, { ...paper, filesFromReceiptId: original.body.id }))
    .expect(201);

  const [exemption] = await prisma.saleReceiptExemption.findMany({
    where: { saleId: markedSaleId },
  });
  expect(exemption).toMatchObject({
    releasedById: sellerId,
    releaseReason: "Se registró el comprobante B015-000101",
  });
  expect(exemption!.releasedAt).toEqual(expect.any(Date));
});

test("volver a registrar un original con su nota de crédito vigente se rechaza en la API", async () => {
  await configureIssuerSettings();
  const saleId = await createSale("14.16", "2026-10-14T20:20:00.000Z");
  const paper = { series: "B016", number: "000202" };
  const original = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(receiptBody(saleId, paper))
    .expect(201);
  await request(server())
    .post(`/api/v1/receipts/${original.body.id}/credit-notes`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send(creditNoteBody(ReceiptMedium.MANUAL, "000016"))
    .expect(201);

  for (const body of [
    receiptBody(saleId, paper),
    receiptBody(saleId, { ...paper, series: "b016", filesFromReceiptId: original.body.id }),
  ]) {
    const rejected = await request(server())
      .post("/api/v1/receipts")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send(body)
      .expect(409);
    expect(rejected.body.message).toBe(
      "Ese comprobante tiene una nota de crédito vigente: no se puede volver a registrar",
    );
  }
  expect(await prisma.receipt.count({ where: { series: "B016", number: "000202" } })).toBe(1);
  const detail = await request(server())
    .get(`/api/v1/receipts/${original.body.id}`)
    .set("Authorization", `Bearer ${sellerToken}`)
    .expect(200);
  expect(detail.body).toMatchObject({ canRegisterAgain: false, registeredAgainId: null });
});

test("los adjuntos solo se vuelven a asociar desde el mismo papel anulado", async () => {
  await configureIssuerSettings();
  const firstSaleId = await createSale("3.54", "2026-10-14T20:30:00.000Z");
  const secondSaleId = await createSale("1.18", "2026-10-14T20:40:00.000Z");
  const photographed = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(receiptBody(firstSaleId, { series: "B017", number: "000001" }))
    .expect(201);
  await request(server())
    .post(`/api/v1/receipts/${photographed.body.id}/files`)
    .set("Authorization", `Bearer ${adminToken}`)
    .attach("file", Buffer.from("%PDF-1.7\notro papel"), "talonario.pdf")
    .expect(201);
  const other = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(receiptBody(secondSaleId, { series: "B017", number: "000002" }))
    .expect(201);
  for (const receipt of [photographed, other]) {
    await request(server())
      .patch(`/api/v1/receipts/${receipt.body.id}/void`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Se cargó con la fecha equivocada" })
      .expect(200);
  }

  const rejected = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send(
      receiptBody(secondSaleId, {
        series: "B017",
        number: "000002",
        filesFromReceiptId: photographed.body.id,
      }),
    )
    .expect(400);
  expect(rejected.body.message).toBe(
    "Los adjuntos solo se vuelven a asociar desde un comprobante anulado del mismo cliente, con el mismo tipo, serie y número",
  );
  expect(
    await prisma.receipt.count({ where: { series: "B017", number: "000002", voidedAt: null } }),
  ).toBe(0);
});

async function createCustomer(
  name: string,
  document: { documentType: "DNI" | "RUC"; documentNumber: string } | null,
): Promise<{ id: string; locationId: string }> {
  const customer = await prisma.customer.create({
    data: {
      name,
      ...(document ?? {}),
      locations: {
        create: {
          name: "Principal",
          address: "Av. Prueba 456",
          addressReference: "Portón verde",
          phone: "900000002",
          isPrimary: true,
        },
      },
    },
    include: { locations: true },
  });
  return { id: customer.id, locationId: customer.locations[0]!.id };
}

async function createSaleAt(saleLocationId: string, total: string, soldAt: string) {
  const sale = await prisma.sale.create({
    data: { locationId: saleLocationId, total, soldAt: new Date(soldAt), recordedById: adminId },
  });
  return sale.id;
}

async function salesByStatus(ownerId: string, status: string): Promise<string[]> {
  const response = await request(server())
    .get(`/api/v1/receipts/sales?customerId=${ownerId}&status=${status}`)
    .set("Authorization", `Bearer ${sellerToken}`)
    .expect(200);
  return response.body.data.map(({ id }: { id: string }) => id).sort();
}

test("HU-26 E1: tres ventas de montos distintos cuadran total, base e IGV y quedan comprobadas", async () => {
  await configureIssuerSettings();
  const owner = await createCustomer("Cliente E1", {
    documentType: "DNI",
    documentNumber: "40000001",
  });
  const saleIds = [
    await createSaleAt(owner.locationId, "1.00", "2026-10-14T13:00:00.000Z"),
    await createSaleAt(owner.locationId, "1.01", "2026-10-14T13:10:00.000Z"),
    await createSaleAt(owner.locationId, "1.04", "2026-10-14T13:20:00.000Z"),
  ];

  const created = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send(receiptBody(saleIds[0]!, { customerId: owner.id, saleIds, number: "000901" }))
    .expect(201);

  // Base por renglón: 0.85 + 0.86 + 0.88 = 2.59; el IGV cuadra el total.
  expect(created.body).toMatchObject({
    total: "3.05",
    taxableAmount: "2.59",
    taxAmount: "0.46",
  });
  expect(await salesByStatus(owner.id, "RECEIPTED")).toEqual([...saleIds].sort());
  expect(await salesByStatus(owner.id, "AVAILABLE")).toEqual([]);
});

test("HU-26 E2: una venta comprobada no entra en otro comprobante; ventas de dos clientes se rechazan", async () => {
  await configureIssuerSettings();
  const owner = await createCustomer("Cliente E2", {
    documentType: "DNI",
    documentNumber: "40000002",
  });
  const other = await createCustomer("Otro cliente E2", {
    documentType: "DNI",
    documentNumber: "40000003",
  });
  const saleId = await createSaleAt(owner.locationId, "20.00", "2026-10-14T13:30:00.000Z");
  const otherSaleId = await createSaleAt(other.locationId, "15.00", "2026-10-14T13:40:00.000Z");
  await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send(receiptBody(saleId, { customerId: owner.id, number: "000902" }))
    .expect(201);

  const again = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send(receiptBody(saleId, { customerId: owner.id, number: "000903" }))
    .expect(409);
  expect(again.body.message).toBe("Una o más ventas ya tienen un comprobante vigente");

  const mixed = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send(
      receiptBody(otherSaleId, {
        customerId: other.id,
        number: "000904",
        saleIds: [
          otherSaleId,
          await createSaleAt(owner.locationId, "3.00", "2026-10-14T13:50:00.000Z"),
        ],
      }),
    )
    .expect(400);
  expect(mixed.body.message).toBe("Todas las ventas deben ser del mismo cliente");
});

test("la factura exige RUC y la boleta exige documento desde el monto configurado", async () => {
  await configureIssuerSettings();
  const anonymous = await createCustomer("Cliente sin documento", null);
  const below = await createSaleAt(anonymous.locationId, "699.99", "2026-10-14T14:00:00.000Z");
  const atThreshold = await createSaleAt(
    anonymous.locationId,
    "700.00",
    "2026-10-14T14:10:00.000Z",
  );
  const dniOwner = await createCustomer("Cliente con DNI", {
    documentType: "DNI",
    documentNumber: "40000004",
  });
  const dniSale = await createSaleAt(dniOwner.locationId, "10.00", "2026-10-14T14:20:00.000Z");

  await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send(receiptBody(below, { customerId: anonymous.id, number: "000905" }))
    .expect(201);
  const overThreshold = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send(receiptBody(atThreshold, { customerId: anonymous.id, number: "000906" }))
    .expect(400);
  expect(overThreshold.body.message).toBe(
    "La boleta por este monto requiere documento del cliente",
  );
  const invoice = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send(
      receiptBody(dniSale, {
        type: ReceiptType.INVOICE,
        series: "F001",
        customerId: dniOwner.id,
        number: "000907",
      }),
    )
    .expect(400);
  expect(invoice.body.message).toBe("La factura requiere que el cliente tenga RUC");
});

test("HU-26 E3: anular libera todas las ventas una sola vez, con quién y cuándo", async () => {
  await configureIssuerSettings();
  const owner = await createCustomer("Cliente E3", {
    documentType: "DNI",
    documentNumber: "40000005",
  });
  const saleIds = [
    await createSaleAt(owner.locationId, "9.00", "2026-10-14T14:30:00.000Z"),
    await createSaleAt(owner.locationId, "6.00", "2026-10-14T14:40:00.000Z"),
  ];
  const created = await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send(receiptBody(saleIds[0]!, { customerId: owner.id, saleIds, number: "000908" }))
    .expect(201);

  await request(server())
    .patch(`/api/v1/receipts/${created.body.id}/void`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ reason: "Se cargó con la fecha equivocada" })
    .expect(200);
  const released = await prisma.receiptSale.findMany({ where: { receiptId: created.body.id } });
  expect(released).toHaveLength(2);
  for (const row of released) {
    expect(row.releasedById).toBe(adminId);
    expect(row.releasedAt).toEqual(expect.any(Date));
  }

  const twice = await request(server())
    .patch(`/api/v1/receipts/${created.body.id}/void`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ reason: "Otra vez" })
    .expect(409);
  expect(twice.body.message).toBe("El comprobante ya fue anulado");
  await request(server())
    .post(`/api/v1/receipts/${created.body.id}/credit-notes`)
    .set("Authorization", `Bearer ${sellerToken}`)
    .send(creditNoteBody(ReceiptMedium.MANUAL, "000908"))
    .expect(409);
  expect(await prisma.receiptSale.findMany({ where: { receiptId: created.body.id } })).toEqual(
    released,
  );
  expect(await salesByStatus(owner.id, "AVAILABLE")).toEqual([...saleIds].sort());
});

test("HU-26 E4: marcar dos ventas y comprobar una libera solo su marca; la lista coincide con las uniones vivas", async () => {
  await configureIssuerSettings();
  const owner = await createCustomer("Cliente E4", {
    documentType: "DNI",
    documentNumber: "40000006",
  });
  const receiptedSale = await createSaleAt(owner.locationId, "12.00", "2026-10-14T15:00:00.000Z");
  const exemptSale = await createSaleAt(owner.locationId, "7.00", "2026-10-14T15:10:00.000Z");
  const freeSale = await createSaleAt(owner.locationId, "4.00", "2026-10-14T15:20:00.000Z");

  await request(server())
    .post("/api/v1/receipts/exemptions")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send({ customerId: owner.id, saleIds: [receiptedSale, exemptSale], reason: "Consumo interno" })
    .expect(201);
  await request(server())
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send(receiptBody(receiptedSale, { customerId: owner.id, number: "000909" }))
    .expect(201);

  const exemptions = await prisma.saleReceiptExemption.findMany({
    where: { saleId: { in: [receiptedSale, exemptSale] } },
  });
  expect(exemptions.find((row) => row.saleId === receiptedSale)).toMatchObject({
    releasedById: sellerId,
    releaseReason: "Se registró el comprobante B001-000909",
  });
  expect(exemptions.find((row) => row.saleId === exemptSale)).toMatchObject({
    releasedAt: null,
  });

  await request(server())
    .post("/api/v1/receipts/exemptions")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send({ customerId: owner.id, saleIds: [receiptedSale], reason: "Consumo interno" })
    .expect(409);

  expect(await salesByStatus(owner.id, "RECEIPTED")).toEqual([receiptedSale]);
  expect(await salesByStatus(owner.id, "EXEMPT")).toEqual([exemptSale]);
  expect(await salesByStatus(owner.id, "AVAILABLE")).toEqual([freeSale]);
  const reconstructed = await prisma.$queryRaw<{ id: string }[]>`
    SELECT s."id" FROM "sales" s
    JOIN "customer_locations" l ON l."id" = s."location_id"
    WHERE l."customer_id" = ${owner.id}::uuid AND s."voided_at" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "receipt_sales" rs
                      WHERE rs."sale_id" = s."id" AND rs."released_at" IS NULL)
      AND NOT EXISTS (SELECT 1 FROM "sale_receipt_exemptions" e
                      WHERE e."sale_id" = s."id" AND e."released_at" IS NULL)
  `;
  expect(reconstructed.map(({ id }) => id)).toEqual([freeSale]);

  const exemption = exemptions.find((row) => row.saleId === exemptSale)!;
  await request(server())
    .patch(`/api/v1/receipts/exemptions/${exemption.id}/release`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ reason: "Ahora pide boleta" })
    .expect(200);
  const releasedTwice = await request(server())
    .patch(`/api/v1/receipts/exemptions/${exemption.id}/release`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ reason: "Otra vez" })
    .expect(409);
  expect(releasedTwice.body.message).toBe("La marca ya fue liberada");
  expect(await salesByStatus(owner.id, "AVAILABLE")).toEqual([exemptSale, freeSale].sort());
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
