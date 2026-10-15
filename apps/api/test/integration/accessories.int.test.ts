import request from "supertest";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

let ctx: TestAppContext;
let adminToken: string;
let sellerToken: string;
let driverToken: string;
let driverId: string;

function server() {
  return ctx.app.getHttpServer();
}

async function login(username: string, password: string): Promise<string> {
  const response = await request(server())
    .post("/api/v1/auth/login")
    .send({ username, password })
    .expect(200);
  return response.body.accessToken;
}

async function createUserAndLogin(
  username: string,
  role: string,
): Promise<{ token: string; id: string }> {
  const password = `${username}-password`;
  const res = await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: username, username, password, roles: [role] })
    .expect(201);
  return { token: await login(username, password), id: res.body.id };
}

beforeAll(async () => {
  ctx = await startTestApp();
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  const seller = await createUserAndLogin("vendedor-accesorios", "SELLER");
  sellerToken = seller.token;
  const driver = await createUserAndLogin("repartidor-accesorios", "DRIVER");
  driverToken = driver.token;
  driverId = driver.id;
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("Accessories Module Integration Tests", () => {
  let accessoryId: string;
  let customerId: string;
  let loc1Id: string;
  let loc2Id: string;

  beforeAll(async () => {
    // Create customer with primary location and secondary location
    const customerRes = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Cliente Prueba Accesorios S.A.C.",
        phone: "999888777",
        address: "Av. Central 123",
        addressReference: "Frente al parque",
      })
      .expect(201);

    customerId = customerRes.body.id;

    const prisma = ctx.app.get(PrismaService);
    const primary = await prisma.customerLocation.findFirstOrThrow({
      where: { customerId, isPrimary: true },
    });
    loc1Id = primary.id;

    const secondary = await prisma.customerLocation.create({
      data: {
        customerId,
        name: "Sede Norte",
        address: "Av. Norte 456",
        addressReference: "Esquina",
        phone: "999888778",
      },
    });
    loc2Id = secondary.id;
  });

  describe("Product creation constraints", () => {
    test("rejects creating non-accessory without containerTypeId", async () => {
      await request(server())
        .post("/api/v1/products")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Agua 20L",
          type: "REFILL",
          listPrice: "10.00",
        })
        .expect(400);
    });

    test("rejects creating accessory with containerTypeId", async () => {
      const prisma = ctx.app.get(PrismaService);
      const ct = await prisma.containerType.findFirstOrThrow();
      await request(server())
        .post("/api/v1/products")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Surtidor Invalido",
          type: "ACCESSORY",
          containerTypeId: ct.id,
          listPrice: "25.00",
        })
        .expect(400);
    });

    test("successfully creates accessory without containerTypeId and initializes stock at 0", async () => {
      const res = await request(server())
        .post("/api/v1/products")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Surtidor Eléctrico",
          type: "ACCESSORY",
          listPrice: "35.00",
        })
        .expect(201);

      accessoryId = res.body.id;
      expect(res.body.name).toBe("Surtidor Eléctrico");
      expect(res.body.type).toBe("ACCESSORY");
      expect(res.body.containerType).toBeNull();
      expect(res.body.listPrice).toBe("35.00");

      const prisma = ctx.app.get(PrismaService);
      const stock = await prisma.accessoryStock.findUnique({ where: { productId: accessoryId } });
      expect(stock?.quantity).toBe(0);
    });
  });

  describe("Plant Stock Operations (entries, write-offs, counting)", () => {
    test("SELLER cannot record entries or write-offs", async () => {
      await request(server())
        .post(`/api/v1/accessories/${accessoryId}/entries`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ quantity: 10 })
        .expect(403);

      await request(server())
        .post(`/api/v1/accessories/${accessoryId}/write-offs`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ quantity: 2, reason: "Dañado" })
        .expect(403);
    });

    test("ADMIN registers entry of 10 units", async () => {
      const res = await request(server())
        .post(`/api/v1/accessories/${accessoryId}/entries`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ quantity: 10 })
        .expect(201);

      expect(res.body.type).toBe("ENTRY");
      expect(res.body.quantity).toBe(10);

      const listRes = await request(server())
        .get("/api/v1/accessories")
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);

      const item = listRes.body.find((a: { id: string }) => a.id === accessoryId);
      expect(item.stock).toBe(10);
      expect(item.totalBorrowed).toBe(0);
    });

    test("ADMIN registers write-off of 2 units with reason", async () => {
      await request(server())
        .post(`/api/v1/accessories/${accessoryId}/write-offs`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ quantity: 2, reason: "" })
        .expect(400);

      const res = await request(server())
        .post(`/api/v1/accessories/${accessoryId}/write-offs`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ quantity: 2, reason: "Dañado en transporte" })
        .expect(201);

      expect(res.body.type).toBe("WRITE_OFF");
      expect(res.body.quantity).toBe(2);

      const prisma = ctx.app.get(PrismaService);
      const stock = await prisma.accessoryStock.findUnique({ where: { productId: accessoryId } });
      expect(stock?.quantity).toBe(8);
    });

    test("ADMIN counts plant stock: delta requires reason and adjusts stock", async () => {
      // Expected is 8, counting 7 without reason fails
      await request(server())
        .post(`/api/v1/accessories/${accessoryId}/count`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ countedQuantity: 7 })
        .expect(400);

      // Counting 7 with reason succeeds, adjusting stock to 7 and emitting COUNT_ADJUSTMENT (-1)
      const countRes = await request(server())
        .post(`/api/v1/accessories/${accessoryId}/count`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ countedQuantity: 7, reason: "Rotura durante almacenamiento" })
        .expect(201);

      expect(countRes.body.expectedQty).toBe(8);
      expect(countRes.body.countedQty).toBe(7);
      expect(countRes.body.reason).toBe("Rotura durante almacenamiento");

      const prisma = ctx.app.get(PrismaService);
      const stock = await prisma.accessoryStock.findUnique({ where: { productId: accessoryId } });
      expect(stock?.quantity).toBe(7);

      const adj = await prisma.accessoryMovement.findFirst({
        where: { productId: accessoryId, type: "COUNT_ADJUSTMENT" },
      });
      expect(adj?.quantity).toBe(-1);

      // Counting matching expected (7) succeeds without reason and does not emit movement
      const countMatchRes = await request(server())
        .post(`/api/v1/accessories/${accessoryId}/count`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ countedQuantity: 7 })
        .expect(201);

      expect(countMatchRes.body.expectedQty).toBe(7);
      expect(countMatchRes.body.countedQty).toBe(7);
    });
  });

  describe("Customer loans and returns", () => {
    test("loans 3 to loc1 and 1 to loc2", async () => {
      // Loan 3 to loc1
      const loan1 = await request(server())
        .post(`/api/v1/customer-locations/${loc1Id}/accessories/loans`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ productId: accessoryId, quantity: 3 })
        .expect(201);

      expect(loan1.body.type).toBe("LOAN");
      expect(loan1.body.quantity).toBe(3);

      // Loan 1 to loc2
      const loan2 = await request(server())
        .post(`/api/v1/customer-locations/${loc2Id}/accessories/loans`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ productId: accessoryId, quantity: 1 })
        .expect(201);

      expect(loan2.body.type).toBe("LOAN");
      expect(loan2.body.quantity).toBe(1);

      // Check balances
      const loc1Balances = await request(server())
        .get(`/api/v1/customer-locations/${loc1Id}/accessories`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);

      expect(loc1Balances.body).toHaveLength(1);
      expect(loc1Balances.body[0].quantity).toBe(3);

      const prisma = ctx.app.get(PrismaService);
      const stock = await prisma.accessoryStock.findUnique({ where: { productId: accessoryId } });
      // 7 - 3 - 1 = 3 in plant
      expect(stock?.quantity).toBe(3);
    });

    test("returns 1 from loc1 to plant", async () => {
      const retRes = await request(server())
        .post(`/api/v1/customer-locations/${loc1Id}/accessories/returns`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ productId: accessoryId, quantity: 1 })
        .expect(201);

      expect(retRes.body.type).toBe("LOAN_RETURN");
      expect(retRes.body.quantity).toBe(1);

      const loc1Balances = await request(server())
        .get(`/api/v1/customer-locations/${loc1Id}/accessories`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);

      expect(loc1Balances.body[0].quantity).toBe(2);

      const prisma = ctx.app.get(PrismaService);
      const stock = await prisma.accessoryStock.findUnique({ where: { productId: accessoryId } });
      // 3 + 1 = 4 in plant
      expect(stock?.quantity).toBe(4);
    });

    test("rejects returning more than borrowed balance", async () => {
      const res = await request(server())
        .post(`/api/v1/customer-locations/${loc1Id}/accessories/returns`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ productId: accessoryId, quantity: 5 })
        .expect(400);

      expect(res.body.message).toContain("No se puede devolver más accesorios");
    });
  });

  describe("Charging borrowed accessories and voiding charge", () => {
    let chargeMovementId: string;

    test("SELLER cannot charge; ADMIN charges 1 borrowed accessory with reason", async () => {
      // SELLER forbidden
      await request(server())
        .post(`/api/v1/customer-locations/${loc1Id}/accessories/charges`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ productId: accessoryId, quantity: 1, reason: "Extraviado" })
        .expect(403);

      // ADMIN missing reason -> 400
      await request(server())
        .post(`/api/v1/customer-locations/${loc1Id}/accessories/charges`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ productId: accessoryId, quantity: 1, reason: "" })
        .expect(400);

      // ADMIN charges 1 unit
      const chargeRes = await request(server())
        .post(`/api/v1/customer-locations/${loc1Id}/accessories/charges`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          productId: accessoryId,
          quantity: 1,
          reason: "Cliente extravió el surtidor y solicita comprarlo",
        })
        .expect(201);

      chargeMovementId = chargeRes.body.id;
      expect(chargeRes.body.type).toBe("LOAN_CHARGE");
      expect(chargeRes.body.quantity).toBe(1);
      expect(chargeRes.body.saleId).toBeTruthy();

      // Location balance decreased from 2 to 1
      const loc1Balances = await request(server())
        .get(`/api/v1/customer-locations/${loc1Id}/accessories`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);
      expect(loc1Balances.body[0].quantity).toBe(1);

      // Plant stock is UNTOUCHED (remains 4)
      const prisma = ctx.app.get(PrismaService);
      const stock = await prisma.accessoryStock.findUnique({ where: { productId: accessoryId } });
      expect(stock?.quantity).toBe(4);

      // Customer debt increased by S/ 35.00
      const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
      expect(customer.debtBalance.toFixed(2)).toBe("35.00");

      // Verify container_movements is completely untouched
      const containerMovs = await prisma.containerMovement.count({
        where: { locationId: loc1Id },
      });
      expect(containerMovs).toBe(0);
    });

    test("rejects charging more than borrowed balance", async () => {
      await request(server())
        .post(`/api/v1/customer-locations/${loc1Id}/accessories/charges`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ productId: accessoryId, quantity: 5, reason: "Cobro excesivo" })
        .expect(400);
    });

    test("SELLER cannot void charge; ADMIN voids charge with reason restoring balance and debt", async () => {
      // SELLER forbidden
      await request(server())
        .post(`/api/v1/accessories/movements/${chargeMovementId}/void`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ reason: "Corrección" })
        .expect(403);

      // ADMIN voids charge
      const voidRes = await request(server())
        .post(`/api/v1/accessories/movements/${chargeMovementId}/void`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "Cliente encontró el surtidor" })
        .expect(201);

      expect(voidRes.body.type).toBe("LOAN_CHARGE_VOID");
      expect(voidRes.body.quantity).toBe(1);
      expect(voidRes.body.reversesMovementId).toBe(chargeMovementId);

      // Location balance restored from 1 to 2
      const loc1Balances = await request(server())
        .get(`/api/v1/customer-locations/${loc1Id}/accessories`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);
      expect(loc1Balances.body[0].quantity).toBe(2);

      // Customer debt restored to 0.00
      const prisma = ctx.app.get(PrismaService);
      const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
      expect(customer.debtBalance.toFixed(2)).toBe("0.00");

      // Sale is marked voided
      const sale = await prisma.sale.findFirstOrThrow({ where: { id: voidRes.body.saleId! } });
      expect(sale.voidedAt).toBeTruthy();
      expect(sale.voidReason).toBe("Cliente encontró el surtidor");

      // Cannot void twice
      await request(server())
        .post(`/api/v1/accessories/movements/${chargeMovementId}/void`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "Intento de segunda anulación" })
        .expect(400);
    });

    test("un cobro cuya venta tiene comprobante vigente no se anula hasta anular el comprobante", async () => {
      const prisma = ctx.app.get(PrismaService);
      const chargeRes = await request(server())
        .post(`/api/v1/customer-locations/${loc1Id}/accessories/charges`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ productId: accessoryId, quantity: 1, reason: "Cliente rompió el surtidor" })
        .expect(201);
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
      const receipt = await request(server())
        .post("/api/v1/receipts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          type: "SALES_RECEIPT",
          medium: "MANUAL",
          series: "B001",
          number: "000501",
          issuedOn: "2026-10-14",
          customerId,
          saleIds: [chargeRes.body.saleId],
        })
        .expect(201);
      const debtBefore = (await prisma.customer.findUniqueOrThrow({ where: { id: customerId } }))
        .debtBalance;

      const rejected = await request(server())
        .post(`/api/v1/accessories/movements/${chargeRes.body.id}/void`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "Se cobró por error" })
        .expect(409);
      expect(rejected.body.message).toBe("Anulá primero el comprobante vigente de la venta");
      const sale = await prisma.sale.findUniqueOrThrow({ where: { id: chargeRes.body.saleId } });
      expect(sale.voidedAt).toBeNull();
      expect(
        await prisma.accessoryMovement.count({ where: { reversesMovementId: chargeRes.body.id } }),
      ).toBe(0);
      expect(
        (await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).debtBalance,
      ).toEqual(debtBefore);

      await request(server())
        .patch(`/api/v1/receipts/${receipt.body.id}/void`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "El cobro fue un error" })
        .expect(200);
      await request(server())
        .post(`/api/v1/accessories/movements/${chargeRes.body.id}/void`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "Se cobró por error" })
        .expect(201);
      expect(
        (
          await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })
        ).debtBalance.toFixed(2),
      ).toBe(debtBefore.minus(35).toFixed(2));
    });
  });

  describe("Reconciliation & Reporting", () => {
    test("reconciliation verifies ledger == materialized stock and balances", async () => {
      const reconRes = await request(server())
        .get("/api/v1/accessories/reconciliation")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(reconRes.body.isBalanced).toBe(true);
      expect(reconRes.body.stockDiscrepancies).toHaveLength(0);
      expect(reconRes.body.customerBalanceDiscrepancies).toHaveLength(0);
    });

    test("borrowed-report lists active loans across customer locations", async () => {
      const reportRes = await request(server())
        .get("/api/v1/accessories/borrowed-report")
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);

      const items = reportRes.body.filter(
        (item: { productId: string }) => item.productId === accessoryId,
      );
      // loc1 has 2, loc2 has 1
      expect(items).toHaveLength(2);
      const loc1Item = items.find((i: { locationId: string }) => i.locationId === loc1Id);
      const loc2Item = items.find((i: { locationId: string }) => i.locationId === loc2Id);
      expect(loc1Item.quantity).toBe(2);
      expect(loc2Item.quantity).toBe(1);
    });
  });

  describe("Stop delivery sale and reversal of accessory", () => {
    test("stop delivery sells accessory: decrements plant stock, increases customer debt, leaves containers untouched", async () => {
      const prisma = ctx.app.get(PrismaService);
      const admin = await prisma.user.findFirstOrThrow({ where: { username: ADMIN_USERNAME } });
      const vehicle = await prisma.vehicle.create({
        data: {
          plate: "ACC101",
          name: "Camión Accesorios",
          brand: "Toyota",
          model: "Dyna",
          capacityUnits: 50,
          createdById: admin.id,
        },
      });
      const zone = await prisma.zone.create({
        data: { name: "Zona Accesorios" },
      });

      // Create and start route
      const routeRes = await request(server())
        .post("/api/v1/routes")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          driverId,
          vehicleId: vehicle.id,
          zoneId: zone.id,
          date: "2026-10-30",
        })
        .expect(201);
      const routeId = routeRes.body.id;

      // Add VAN_SALE stop to loc1
      const stopRes = await request(server())
        .post(`/api/v1/routes/${routeId}/stops`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ origin: "VAN_SALE", locationId: loc1Id })
        .expect(201);
      const stopId = stopRes.body.id;

      await request(server())
        .patch(`/api/v1/routes/${routeId}/start`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      const stockBefore = await prisma.accessoryStock.findUniqueOrThrow({
        where: { productId: accessoryId },
      });

      // Deliver stop with 1 accessory sold (plant stock currently 4)
      const deliverRes = await request(server())
        .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: "DELIVERED",
          items: [{ productId: accessoryId, quantity: 1 }],
        })
        .expect(200);

      expect(deliverRes.body.status).toBe("DELIVERED");
      expect(deliverRes.body.sale.total).toBe("35.00");

      // Plant stock decremented by 1
      const stockAfter = await prisma.accessoryStock.findUniqueOrThrow({
        where: { productId: accessoryId },
      });
      expect(stockAfter.quantity).toBe(stockBefore.quantity - 1);

      // Customer debt increased by 35.00
      const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
      expect(customer.debtBalance.toFixed(2)).toBe("35.00");

      // Container movements are 0 for this stop
      const containerMovCount = await prisma.containerMovement.count({
        where: { stopId },
      });
      expect(containerMovCount).toBe(0);

      // Correct stop to FAILED: reverses sale and restores accessory stock
      await request(server())
        .patch(`/api/v1/routes/${routeId}/stops/${stopId}/correction`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: "FAILED",
          failureReason: "Cliente no recibió el accesorio",
          correctionReason: "Error en registro de parada",
        })
        .expect(200);

      // Plant stock restored
      const stockRestored = await prisma.accessoryStock.findUniqueOrThrow({
        where: { productId: accessoryId },
      });
      expect(stockRestored.quantity).toBe(stockBefore.quantity);

      // Customer debt restored
      const customerRestored = await prisma.customer.findUniqueOrThrow({
        where: { id: customerId },
      });
      expect(customerRestored.debtBalance.toFixed(2)).toBe("0.00");
    });

    it("el repartidor no tiene permiso para consultar accesorios (403)", async () => {
      await request(server())
        .get("/api/v1/accessories")
        .set("Authorization", `Bearer ${driverToken}`)
        .expect(403);
    });
  });
});
