import request from "supertest";
import { ContainerMovementType, ContainerState, StopOrigin, StopStatus } from "@prisma/client";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

let nextDayOffset = 100;
function nextDate(): string {
  const date = new Date(Date.UTC(2026, 10, 1) + nextDayOffset * 24 * 60 * 60 * 1000);
  nextDayOffset += 1;
  return date.toISOString().slice(0, 10);
}

let ctx: TestAppContext;
let prisma: PrismaService;
let adminToken: string;
let sellerToken: string;
let driverToken: string;
let driverId: string;
let zoneId: string;
let cashPaymentMethodId: string;
let vehicleId: string;

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
  const created = await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: username, username, password, roles: [role] })
    .expect(201);
  return { token: await login(username, password), id: created.body.id };
}

let customerSeq = 0;
async function createFreshLocation(): Promise<{ customerId: string; locationId: string }> {
  customerSeq += 1;
  const customer = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: `Cliente Pit Stop ${customerSeq}`,
      phone: `98711${String(customerSeq).padStart(4, "0")}`,
      address: "Av. Pit Stop 1",
      addressReference: "Frente al parque",
    })
    .expect(201);
  const location = await prisma.customerLocation.findFirstOrThrow({
    where: { customerId: customer.body.id },
  });
  return { customerId: customer.body.id, locationId: location.id };
}

let typeSeq = 0;
async function createContainerType(namePrefix = "Bidon Pit"): Promise<string> {
  typeSeq += 1;
  const response = await request(server())
    .post("/api/v1/container-types")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: `${namePrefix} ${typeSeq}` })
    .expect(201);
  return response.body.id;
}

async function createRefillProduct(containerTypeId: string, price = "10.00"): Promise<string> {
  const product = await prisma.product.create({
    data: {
      containerTypeId,
      name: `Recarga Pit ${typeSeq}`,
      type: "REFILL",
      listPrice: price,
    },
  });
  return product.id;
}

let batchSeq = 0;
function nextBatchDate(daysAgo: number): string {
  const base = Date.UTC(2026, 6, 1);
  return new Date(base - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function createBatchItem(
  containerTypeId: string,
  producedQty: number,
  daysAgo: number,
): Promise<string> {
  batchSeq += 1;
  const response = await request(server())
    .post("/api/v1/production-batches")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      code: `LOTE-PIT-${batchSeq}`,
      date: nextBatchDate(daysAgo),
      items: [{ containerTypeId, producedQty }],
    })
    .expect(201);
  const item = response.body.items.find(
    (it: { containerTypeId: string }) => it.containerTypeId === containerTypeId,
  );
  if (!item) {
    throw new Error(`Item for container type "${containerTypeId}" not found in response`);
  }
  return item.id;
}

async function createRoute(): Promise<string> {
  const response = await request(server())
    .post("/api/v1/routes")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ driverId, date: nextDate(), zoneId, vehicleId })
    .expect(201);
  return response.body.id;
}

async function addLoad(routeId: string, batchItemId: string, quantity: number): Promise<void> {
  await request(server())
    .post(`/api/v1/routes/${routeId}/loads`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ batchItemId, quantity })
    .expect(201);
}

async function startRoute(routeId: string): Promise<void> {
  await request(server())
    .patch(`/api/v1/routes/${routeId}/start`)
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200);
}

async function finishRoute(routeId: string): Promise<void> {
  await request(server())
    .patch(`/api/v1/routes/${routeId}/finish`)
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200);
}

async function addStop(routeId: string, locationId: string): Promise<string> {
  const response = await request(server())
    .post(`/api/v1/routes/${routeId}/stops`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ origin: StopOrigin.VAN_SALE, locationId })
    .expect(201);
  return response.body.id;
}

async function deliverStop(
  routeId: string,
  stopId: string,
  body: Record<string, unknown>,
): Promise<void> {
  await request(server())
    .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: StopStatus.DELIVERED, ...body })
    .expect(200);
}

async function netInState(typeId: string, state: ContainerState): Promise<number> {
  const [into, outOf] = await Promise.all([
    prisma.containerMovement.aggregate({
      where: { containerTypeId: typeId, toState: state },
      _sum: { quantity: true },
    }),
    prisma.containerMovement.aggregate({
      where: { containerTypeId: typeId, fromState: state },
      _sum: { quantity: true },
    }),
  ]);
  return (into._sum.quantity ?? 0) - (outOf._sum.quantity ?? 0);
}

describe("RoutePitStops (integration)", () => {
  beforeAll(async () => {
    ctx = await startTestApp();
    prisma = ctx.app.get(PrismaService);
    adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
    sellerToken = (await createUserAndLogin("vendedor-pit", "SELLER")).token;
    const driver = await createUserAndLogin("chofer-pit", "DRIVER");
    driverToken = driver.token;
    driverId = driver.id;

    const zone = await request(server())
      .post("/api/v1/zones")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Zona Pit" })
      .expect(201);
    zoneId = zone.body.id;

    cashPaymentMethodId = (
      await prisma.paymentMethod.findFirstOrThrow({ where: { name: "Efectivo" } })
    ).id;

    const adminUser = await prisma.user.findFirstOrThrow({ where: { username: ADMIN_USERNAME } });
    const vehicle = await prisma.vehicle.create({
      data: {
        plate: "PIT101",
        name: "Camión Pit",
        brand: "Toyota",
        model: "Dyna",
        capacityUnits: 60,
        createdById: adminUser.id,
      },
    });
    vehicleId = vehicle.id;
  }, 180000);

  afterAll(async () => {
    await stopTestApp(ctx);
  });

  describe("Roles y permisos", () => {
    it("el chofer no puede registrar ni anular un pit; el vendedor puede registrar pero no anular; el admin puede ambos", async () => {
      const typeId = await createContainerType();
      const batchItemId = await createBatchItem(typeId, 10, 5);
      const routeId = await createRoute();
      await addLoad(routeId, batchItemId, 5);
      await startRoute(routeId);

      const pitPayload = {
        counts: [{ containerTypeId: typeId, countedFull: 5, countedEmpty: 0 }],
      };

      // 1. Chofer intenta registrar pit -> 403
      await request(server())
        .post(`/api/v1/routes/${routeId}/pit-stops`)
        .set("Authorization", `Bearer ${driverToken}`)
        .send(pitPayload)
        .expect(403);

      // 2. Vendedor registra pit -> 201
      const sellerRes = await request(server())
        .post(`/api/v1/routes/${routeId}/pit-stops`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send(pitPayload)
        .expect(201);
      const pitId = sellerRes.body.id;

      // 3. Chofer intenta anular pit -> 403
      await request(server())
        .patch(`/api/v1/routes/${routeId}/pit-stops/${pitId}/void`)
        .set("Authorization", `Bearer ${driverToken}`)
        .send({ voidReason: "Chofer intentando anular" })
        .expect(403);

      // 4. Vendedor intenta anular pit -> 403
      await request(server())
        .patch(`/api/v1/routes/${routeId}/pit-stops/${pitId}/void`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ voidReason: "Vendedor intentando anular" })
        .expect(403);

      // 5. Admin anula pit -> 200
      await request(server())
        .patch(`/api/v1/routes/${routeId}/pit-stops/${pitId}/void`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ voidReason: "Error en el conteo registrado por el vendedor" })
        .expect(200);
    });

    it("el chofer puede consultar el listado de su propia ruta pero no de otra ni el preview", async () => {
      const routeId = await createRoute();
      await startRoute(routeId);

      // Chofer no puede ver preview -> 403
      await request(server())
        .get(`/api/v1/routes/${routeId}/pit-stops/preview`)
        .set("Authorization", `Bearer ${driverToken}`)
        .expect(403);

      // Chofer puede ver listado de su propia ruta -> 200
      await request(server())
        .get(`/api/v1/routes/${routeId}/pit-stops`)
        .set("Authorization", `Bearer ${driverToken}`)
        .expect(200);

      // Otra ruta con otro chofer
      const otherDriver = await createUserAndLogin("otro-chofer", "DRIVER");
      const otherRouteRes = await request(server())
        .post("/api/v1/routes")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ driverId: otherDriver.id, date: nextDate(), zoneId, vehicleId })
        .expect(201);
      const otherRouteId = otherRouteRes.body.id;

      // Chofer intenta ver listado de otra ruta -> 403
      await request(server())
        .get(`/api/v1/routes/${otherRouteId}/pit-stops`)
        .set("Authorization", `Bearer ${driverToken}`)
        .expect(403);
    });
  });

  describe("Flujo completo de punta a punta", () => {
    it("planifica con carga, sale, entrega, pit con FIFO y cuadre y efectivo, entrega 2, pit 2, termina y liquida", async () => {
      // Dos tipos de envase para comprobar que se manejan independientemente
      const typeA = await createContainerType("Bidon A");
      const typeB = await createContainerType("Bidon B");
      const prodA = await createRefillProduct(typeA, "10.00");

      // Dos lotes para typeA para comprobar FIFO estricto
      // Batch 1 es más viejo (daysAgo = 20) que Batch 2 (daysAgo = 10)
      const batch1A = await createBatchItem(typeA, 10, 20);
      const batch2A = await createBatchItem(typeA, 10, 10);
      const batch1B = await createBatchItem(typeB, 10, 15);

      const routeId = await createRoute();

      // Carga inicial al planificar: 5 de typeA (del batch1A) y 5 de typeB (del batch1B)
      await addLoad(routeId, batch1A, 5);
      await addLoad(routeId, batch1B, 5);

      // Iniciar ruta
      await startRoute(routeId);

      // Camión tiene: typeA: 5 full, 0 empty. typeB: 5 full, 0 empty.
      expect(await netInState(typeA, ContainerState.FULL_ON_ROUTE)).toBe(5);
      expect(await netInState(typeB, ContainerState.FULL_ON_ROUTE)).toBe(5);

      // Entrega 1: vende 2 recargas de typeA (cobra 20.00 en efectivo, recibe 2 vacíos de typeA)
      const { locationId: loc1 } = await createFreshLocation();
      const stop1Id = await addStop(routeId, loc1);
      await deliverStop(routeId, stop1Id, {
        items: [{ productId: prodA, quantity: 2 }],
        payment: { amount: "20.00", paymentMethodId: cashPaymentMethodId },
        containersReturned: [{ containerTypeId: typeA, quantity: 2 }],
      });

      // Camión tiene ahora:
      // typeA: 3 full, 2 empty. typeB: 5 full, 0 empty. Efectivo cobrado: 20.00.
      expect(await netInState(typeA, ContainerState.FULL_ON_ROUTE)).toBe(3);
      expect(await netInState(typeA, ContainerState.EMPTY_ON_ROUTE)).toBe(2);
      expect(await netInState(typeB, ContainerState.FULL_ON_ROUTE)).toBe(5);

      // Pit Stop 1:
      // Consultar preview
      const preview1 = await request(server())
        .get(`/api/v1/routes/${routeId}/pit-stops/preview`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(preview1.body.cash.cashExpected).toBe("20.00");
      const prevA = preview1.body.containers.find(
        (c: { containerTypeId: string }) => c.containerTypeId === typeA,
      );
      const prevB = preview1.body.containers.find(
        (c: { containerTypeId: string }) => c.containerTypeId === typeB,
      );
      expect(prevA).toMatchObject({ expectedFull: 3, expectedEmpty: 2 });
      expect(prevB).toMatchObject({ expectedFull: 5, expectedEmpty: 0 });

      // Registrar Pit Stop 1:
      // - Cuadre: typeA coincide (3 full, 2 empty).
      //   typeB tiene diferencia: cuenta 4 full, 1 empty. (Motivo obligatorio).
      // - Descarga: descarga los 2 vacíos de typeA.
      // - Carga: sube 8 full de typeA.
      //   El stock disponible en planta de typeA es:
      //   - batch1A le quedan 5 unidades (10 - 5 de la carga inicial).
      //   - batch2A le quedan 10 unidades.
      //   Por FIFO debe consumir 5 de batch1A y 3 de batch2A.
      // - Efectivo: entrega 15.00 de los 20.00 esperados (se queda con 5.00 para vuelto, no pide motivo).
      const pit1Res = await request(server())
        .post(`/api/v1/routes/${routeId}/pit-stops`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          notes: "Primera parada en planta",
          counts: [
            { containerTypeId: typeA, countedFull: 3, countedEmpty: 2 },
            {
              containerTypeId: typeB,
              countedFull: 4,
              countedEmpty: 1,
              differenceReason: "Se vació un bidón por rotura de caño",
            },
          ],
          unloadEmpties: [{ containerTypeId: typeA, quantity: 2 }],
          loads: [
            { batchItemId: batch1A, quantity: 5 },
            { batchItemId: batch2A, quantity: 3 },
          ],
          cashDelivered: "15.00",
        })
        .expect(201);
      expect(pit1Res.body.cashDelivered).toBe("15.00");
      expect(pit1Res.body.cashExpected).toBe("20.00");

      expect(await netInState(typeA, ContainerState.FULL_ON_ROUTE)).toBe(11);
      expect(await netInState(typeA, ContainerState.EMPTY_ON_ROUTE)).toBe(0);
      expect(await netInState(typeB, ContainerState.FULL_ON_ROUTE)).toBe(5);
      expect(await netInState(typeB, ContainerState.EMPTY_ON_ROUTE)).toBe(0);

      // Entrega 2:
      // Vende 3 recargas de typeA (cobra 30.00 en efectivo, recoge 3 vacíos de typeA)
      const { locationId: loc2 } = await createFreshLocation();
      const stop2Id = await addStop(routeId, loc2);
      await deliverStop(routeId, stop2Id, {
        items: [{ productId: prodA, quantity: 3 }],
        payment: { amount: "30.00", paymentMethodId: cashPaymentMethodId },
        containersReturned: [{ containerTypeId: typeA, quantity: 3 }],
      });

      // Camión tiene ahora:
      // typeA: 11 - 3 = 8 full, 3 empty.
      // Total cobrado en efectivo por la ruta: 20.00 + 30.00 = 50.00.
      // Ya entregado en pit 1: 15.00.
      // Efectivo esperado en Pit 2: 50.00 - 15.00 = 35.00.

      // Pit Stop 2: preview
      const preview2 = await request(server())
        .get(`/api/v1/routes/${routeId}/pit-stops/preview`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(preview2.body.cash.cashExpected).toBe("35.00");

      // Registrar Pit Stop 2:
      // Entrega 25.00 de efectivo.
      const pit2Res = await request(server())
        .post(`/api/v1/routes/${routeId}/pit-stops`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          notes: "Segunda parada en planta",
          counts: [
            { containerTypeId: typeA, countedFull: 8, countedEmpty: 3 },
            { containerTypeId: typeB, countedFull: 5, countedEmpty: 0 },
          ],
          cashDelivered: "25.00",
        })
        .expect(201);
      const pit2Id = pit2Res.body.id;

      // Terminar ruta
      await finishRoute(routeId);

      // Liquidación: vista previa
      const settView = await request(server())
        .get(`/api/v1/routes/${routeId}/settlement`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      // En dinero: total cobrado en efectivo = 50.00.
      // Entregado en pits = 15.00 + 25.00 = 40.00.
      expect(settView.body.expected.totalCashCollected).toBe("50.00");
      expect(settView.body.expected.totalCashDeliveredInPits).toBe("40.00");

      // En bidones:
      // fullOut = 5 (typeA inicial) + 5 (typeB inicial) + 8 (typeA pit 1) = 18.
      // fullDelivered = 2 (stop 1) + 3 (stop 2) = 5.
      // fullReturned esperado = 18 - 5 = 13 (8 de typeA + 5 de typeB).
      expect(settView.body.expected.fullOut).toBe(18);
      expect(settView.body.expected.fullDelivered).toBe(5);

      // Liquidar ruta
      const settleRes = await request(server())
        .post(`/api/v1/routes/${routeId}/settlement`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          fullReturned: 13,
          emptiesCollected: [
            { containerTypeId: typeA, quantity: 3 },
            { containerTypeId: typeB, quantity: 0 },
          ],
        })
        .expect(201);

      expect(settleRes.body.settlement.totalCashDeliveredInPits).toBe("40.00");

      // Comprobar que no se puede anular un pit de una ruta ya liquidada
      await request(server())
        .patch(`/api/v1/routes/${routeId}/pit-stops/${pit2Id}/void`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ voidReason: "Intentando anular con ruta liquidada" })
        .expect(409);
    });

    it("anular solo permite el último no anulado, emite inversos y deja de contar su efectivo", async () => {
      const typeId = await createContainerType("Bidon Anulacion");
      const batchItem = await createBatchItem(typeId, 20, 30);
      const routeId = await createRoute();
      await addLoad(routeId, batchItem, 6);
      await startRoute(routeId);

      // Pit 1: entrega 30.00 de efectivo (con motivo porque 30.00 supera lo esperado 0.00)
      const pit1 = await request(server())
        .post(`/api/v1/routes/${routeId}/pit-stops`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          counts: [{ containerTypeId: typeId, countedFull: 6, countedEmpty: 0 }],
          cashDelivered: "30.00",
          cashReason: "Aporte inicial para caja chica",
        })
        .expect(201);

      // Pit 2: sube 4 bidones y entrega 50.00 de efectivo
      const pit2 = await request(server())
        .post(`/api/v1/routes/${routeId}/pit-stops`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          counts: [{ containerTypeId: typeId, countedFull: 6, countedEmpty: 0 }],
          loads: [{ batchItemId: batchItem, quantity: 4 }],
          cashDelivered: "50.00",
          cashReason: "Entrega adicional",
        })
        .expect(201);

      // Stock en camión: 6 + 4 = 10
      expect(await netInState(typeId, ContainerState.FULL_ON_ROUTE)).toBe(10);

      // 1. Intentar anular Pit 1 (no es el último) -> 409
      const invalidVoid = await request(server())
        .patch(`/api/v1/routes/${routeId}/pit-stops/${pit1.body.id}/void`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ voidReason: "Intentando anular el primero teniendo un segundo activo" })
        .expect(409);
      expect(invalidVoid.body.message).toContain("Solo se puede anular la última parada en planta");

      // 2. Intentar anular Pit 2 sin motivo -> 400
      await request(server())
        .patch(`/api/v1/routes/${routeId}/pit-stops/${pit2.body.id}/void`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ voidReason: "  " })
        .expect(400);

      // 3. Anular Pit 2 correctamente -> 200
      const voidRes = await request(server())
        .patch(`/api/v1/routes/${routeId}/pit-stops/${pit2.body.id}/void`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ voidReason: "El chofer no cargó los 4 bidones ni entregó 50 soles" })
        .expect(200);

      expect(voidRes.body.voidedAt).not.toBeNull();
      expect(voidRes.body.voidReason).toBe("El chofer no cargó los 4 bidones ni entregó 50 soles");

      // Stock en camión se revirtió: 10 - 4 = 6
      expect(await netInState(typeId, ContainerState.FULL_ON_ROUTE)).toBe(6);

      // Movimiento inverso ROUTE_LOAD_VOID fue emitido
      const voidMovement = await prisma.containerMovement.findFirst({
        where: {
          pitStopId: pit2.body.id,
          type: ContainerMovementType.ROUTE_LOAD_VOID,
        },
      });
      expect(voidMovement).not.toBeNull();
      expect(voidMovement?.quantity).toBe(4);

      // El efectivo del pit 2 ya no se cuenta: preview de pit debe descontar solo pit 1 (30.00)
      const preview = await request(server())
        .get(`/api/v1/routes/${routeId}/pit-stops/preview`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(preview.body.cash.cashDeliveredInPreviousPits).toBe("30.00");

      // Pit 2 sigue en el listado, pero marcado como anulado
      const listRes = await request(server())
        .get(`/api/v1/routes/${routeId}/pit-stops`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(listRes.body).toHaveLength(2);
      const voidedItem = listRes.body.find((p: { id: string }) => p.id === pit2.body.id);
      expect(voidedItem.voidedAt).not.toBeNull();

      // 4. Intentar anular Pit 2 nuevamente -> 409 (ya fue anulado)
      await request(server())
        .patch(`/api/v1/routes/${routeId}/pit-stops/${pit2.body.id}/void`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ voidReason: "Intentando anular de nuevo" })
        .expect(409);

      // 5. Ahora Pit 1 sí es el último no anulado, y se puede anular
      await request(server())
        .patch(`/api/v1/routes/${routeId}/pit-stops/${pit1.body.id}/void`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ voidReason: "Anulando también el primero" })
        .expect(200);
    });
  });
});
