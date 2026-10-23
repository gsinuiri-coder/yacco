import { randomUUID } from "node:crypto";
import request from "supertest";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

// Fase 3, fila 11 (goal 11a) y sync-protocol: lo que el celular del chofer
// manda sin señal se aplica una sola vez, en el orden en que lo hizo, por los
// mismos servicios que la web; lo que choca con el servidor va a cuarentena
// sin perderse y la oficina lo revisa.

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

let nextDayOffset = 0;
function nextDate(): string {
  const date = new Date(Date.UTC(2027, 0, 1) + nextDayOffset * 24 * 60 * 60 * 1000);
  nextDayOffset += 1;
  return date.toISOString().slice(0, 10);
}

let ctx: TestAppContext;
let prisma: PrismaService;
let adminToken: string;
let adminUserId: string;
let driverToken: string;
let driverId: string;
let otherDriverId: string;
let containerTypeId: string;
let refillProductId: string;
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
  const password = `${username}-clave-de-prueba`;
  const created = await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: `Nombre ${username}`, username, password, roles: [role] })
    .expect(201);
  return { token: await login(username, password), id: created.body.id };
}

let zoneSeq = 0;
async function createZone(): Promise<string> {
  zoneSeq += 1;
  const zone = await request(server())
    .post("/api/v1/zones")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: `Zona Sync ${zoneSeq}` })
    .expect(201);
  return zone.body.id;
}

let customerSeq = 0;
async function createLocation(
  zoneId?: string,
  position?: { latitude: string; longitude: string },
): Promise<string> {
  customerSeq += 1;
  const customer = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: `Cliente Sync ${customerSeq}`,
      phone: `98700${String(customerSeq).padStart(4, "0")}`,
      address: "Av. Sin Señal 1",
      addressReference: "Frente al parque",
      ...(zoneId !== undefined ? { zoneId } : {}),
    })
    .expect(201);
  const location = await prisma.customerLocation.findFirstOrThrow({
    where: { customerId: customer.body.id },
  });
  if (position !== undefined) {
    await prisma.customerLocation.update({ where: { id: location.id }, data: position });
  }
  return location.id;
}

let batchCounter = 0;
/** Cada lote un día más viejo, para que el recién creado sea la cabeza del FIFO. */
async function createBatchItem(
  producedQty: number,
  batchContainerTypeId = containerTypeId,
): Promise<string> {
  batchCounter += 1;
  const date = new Date(Date.UTC(2026, 8, 1) - batchCounter * 24 * 60 * 60 * 1000);
  const response = await request(server())
    .post("/api/v1/production-batches")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      code: `LOTE-SYNC-${batchCounter}`,
      date: date.toISOString().slice(0, 10),
      items: [{ containerTypeId: batchContainerTypeId, producedQty }],
    })
    .expect(201);
  return response.body.items[0].id;
}

/** Una ruta en curso del chofer, cargada, con `stopCount` paradas de venta en camión. */
async function startedRoute(
  routeDriverId: string,
  stopCount: number,
  zoneId?: string,
): Promise<{ routeId: string; stopIds: string[] }> {
  const route = await request(server())
    .post("/api/v1/routes")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      driverId: routeDriverId,
      date: nextDate(),
      vehicleId,
      ...(zoneId !== undefined ? { zoneId } : {}),
    })
    .expect(201);
  const routeId = route.body.id as string;
  // Cada id se resuelve ANTES de armar el request: supertest levanta y cierra
  // el servidor por request, y otro request en el medio se lo cierra a este.
  const batchItemId = await createBatchItem(10);
  await request(server())
    .post(`/api/v1/routes/${routeId}/loads`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ batchItemId, quantity: 10 })
    .expect(201);
  const stopIds: string[] = [];
  for (let index = 0; index < stopCount; index += 1) {
    const locationId = await createLocation();
    const stop = await request(server())
      .post(`/api/v1/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ origin: "VAN_SALE", locationId })
      .expect(201);
    stopIds.push(stop.body.id);
  }
  await request(server())
    .patch(`/api/v1/routes/${routeId}/start`)
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200);
  return { routeId, stopIds };
}

function failedMark(routeId: string, stopId: string, clientTimestamp = new Date()) {
  return {
    id: randomUUID(),
    type: "STOP_MARK",
    version: 1,
    clientTimestamp: clientTimestamp.toISOString(),
    payload: { routeId, stopId, status: "FAILED", failureReason: "Local cerrado" },
  };
}

function deliveredMark(routeId: string, stopId: string, clientTimestamp = new Date()) {
  return {
    id: randomUUID(),
    type: "STOP_MARK",
    version: 1,
    clientTimestamp: clientTimestamp.toISOString(),
    payload: {
      routeId,
      stopId,
      status: "DELIVERED",
      items: [{ productId: refillProductId, quantity: 2 }],
      payment: { paymentMethodId: cashPaymentMethodId, amount: "16.00" },
    },
  };
}

function vanSale(
  routeId: string,
  locationId: string,
  markedAt?: { latitude: string; longitude: string },
  clientTimestamp = new Date(),
) {
  return {
    id: randomUUID(),
    type: "STOP_ADD_VAN_SALE",
    version: 1,
    clientTimestamp: clientTimestamp.toISOString(),
    payload: {
      routeId,
      locationId,
      items: [{ productId: refillProductId, quantity: 2 }],
      payment: { paymentMethodId: cashPaymentMethodId, amount: "16.00" },
      ...(markedAt !== undefined
        ? {
            markedLatitude: markedAt.latitude,
            markedLongitude: markedAt.longitude,
            markedAccuracyM: "8.00",
          }
        : {}),
    },
  };
}

type Envelope = ReturnType<typeof failedMark> | ReturnType<typeof vanSale>;

function send(operations: Envelope[], token = driverToken) {
  return request(server())
    .post("/api/v1/sync/operations")
    .set("Authorization", `Bearer ${token}`)
    .send({ operations });
}

async function routeLedger(routeId: string) {
  const stops = await prisma.routeStop.findMany({ where: { routeId }, select: { id: true } });
  const stopIds = stops.map((stop) => stop.id);
  return {
    sales: await prisma.sale.count({ where: { stopId: { in: stopIds } } }),
    payments: await prisma.payment.count({ where: { stopId: { in: stopIds } } }),
    movements: await prisma.containerMovement.count({ where: { stopId: { in: stopIds } } }),
  };
}

async function stopStatus(stopId: string): Promise<string> {
  return (await prisma.routeStop.findUniqueOrThrow({ where: { id: stopId } })).status;
}

describe("POST /api/v1/sync/operations (integration)", () => {
  beforeAll(async () => {
    ctx = await startTestApp();
    prisma = ctx.app.get(PrismaService);
    adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
    adminUserId = (await prisma.user.findUniqueOrThrow({ where: { username: ADMIN_USERNAME } })).id;
    const driver = await createUserAndLogin("chofer-sync", "DRIVER");
    driverToken = driver.token;
    driverId = driver.id;
    otherDriverId = (await createUserAndLogin("otro-chofer-sync", "DRIVER")).id;

    containerTypeId = (await prisma.containerType.findFirstOrThrow({ where: { name: "Con caño" } }))
      .id;
    refillProductId = (
      await prisma.product.findFirstOrThrow({ where: { name: "Recarga 20L con caño" } })
    ).id;
    cashPaymentMethodId = (
      await prisma.paymentMethod.findFirstOrThrow({ where: { name: "Efectivo" } })
    ).id;
    vehicleId = (
      await prisma.vehicle.create({
        data: {
          plate: "SYN101",
          name: "Camión Sync",
          brand: "Toyota",
          model: "Dyna",
          capacityUnits: 60,
          createdById: adminUserId,
        },
      })
    ).id;
  }, 180000);

  afterAll(async () => {
    await stopTestApp(ctx);
  });

  it("applies a batch of three operations through the same services as the web", async () => {
    const { routeId, stopIds } = await startedRoute(driverId, 3);
    const markedAt = new Date(Date.now() - 30 * 60 * 1000);
    const batch = [
      failedMark(routeId, stopIds[0]!),
      deliveredMark(routeId, stopIds[1]!, markedAt),
      failedMark(routeId, stopIds[2]!),
    ];

    const response = await send(batch).expect(200);

    expect(response.body.results.map((result: { status: string }) => result.status)).toEqual([
      "APPLIED",
      "APPLIED",
      "APPLIED",
    ]);
    expect(await stopStatus(stopIds[0]!)).toBe("FAILED");
    expect(await stopStatus(stopIds[1]!)).toBe("DELIVERED");
    expect(await stopStatus(stopIds[2]!)).toBe("FAILED");
    const sale = await prisma.sale.findFirstOrThrow({ where: { stopId: stopIds[1]! } });
    expect(sale.total.toFixed(2)).toBe("16.00");
    // La venta queda con la hora en que el chofer marcó, no con la de llegada.
    expect(sale.soldAt.toISOString()).toBe(markedAt.toISOString());
    expect(sale.recordedById).toBe(driverId);

    const stored = await prisma.syncOperation.findUniqueOrThrow({ where: { id: batch[1]!.id } });
    expect(stored).toMatchObject({
      status: "APPLIED",
      userId: driverId,
      operationType: "STOP_MARK",
      envelopeVersion: 1,
      attempts: 1,
      quarantinedAt: null,
    });
    expect(stored.clientTimestamp.toISOString()).toBe(markedAt.toISOString());
    expect(stored.receivedAt).not.toBeNull();
  });

  it("answers DUPLICATE to the same batch sent twice and applies nothing again", async () => {
    const { routeId, stopIds } = await startedRoute(driverId, 3);
    const batch = [
      deliveredMark(routeId, stopIds[0]!),
      deliveredMark(routeId, stopIds[1]!),
      failedMark(routeId, stopIds[2]!),
    ];
    await send(batch).expect(200);
    const afterFirst = await routeLedger(routeId);
    expect(afterFirst.sales).toBe(2);
    expect(afterFirst.payments).toBe(2);
    expect(afterFirst.movements).toBeGreaterThan(0);

    const resent = await send(batch).expect(200);

    expect(resent.body.results.map((result: { status: string }) => result.status)).toEqual([
      "DUPLICATE",
      "DUPLICATE",
      "DUPLICATE",
    ]);
    expect(await routeLedger(routeId)).toEqual(afterFirst);
  });

  it("applies the same batch sent twice at once only once", async () => {
    const { routeId, stopIds } = await startedRoute(driverId, 2);
    const batch = [deliveredMark(routeId, stopIds[0]!), deliveredMark(routeId, stopIds[1]!)];

    const responses = await Promise.all([send(batch), send(batch)]);

    const statuses = responses
      .flatMap((response) =>
        response.body.results.map((result: { status: string }) => result.status),
      )
      .sort();
    expect(statuses).toEqual(["APPLIED", "APPLIED", "DUPLICATE", "DUPLICATE"]);
    expect((await routeLedger(routeId)).sales).toBe(2);
    const rows = await prisma.syncOperation.findMany({
      where: { id: { in: batch.map((operation) => operation.id) } },
    });
    expect(rows.map((row) => row.status)).toEqual(["APPLIED", "APPLIED"]);
  });

  it("undoes everything a rejected operation had already written, and the rest of the batch applies", async () => {
    const { routeId, stopIds } = await startedRoute(driverId, 2);
    // Más de lo cargado: la parada ya pasó a entregada cuando la venta
    // descubre que no hay stock. Solo el SAVEPOINT deshace ese cambio.
    const overstock = {
      ...deliveredMark(routeId, stopIds[0]!),
      payload: {
        routeId,
        stopId: stopIds[0]!,
        status: "DELIVERED",
        items: [{ productId: refillProductId, quantity: 20 }],
      },
    };

    const response = await send([overstock, failedMark(routeId, stopIds[1]!)]).expect(200);

    expect(response.body.results[0]).toMatchObject({ status: "REJECTED", quarantined: false });
    expect(response.body.results[0].reason).toContain("Stock insuficiente");
    expect(response.body.results[1].status).toBe("APPLIED");
    expect(await stopStatus(stopIds[0]!)).toBe("PENDING");
    expect(await stopStatus(stopIds[1]!)).toBe("FAILED");
    expect(await routeLedger(routeId)).toEqual({ sales: 0, payments: 0, movements: 0 });
  });

  it("rejects the whole batch when an operation's time has no zone", async () => {
    const { routeId, stopIds } = await startedRoute(driverId, 1);

    await send([{ ...failedMark(routeId, stopIds[0]!), clientTimestamp: "2026-10-22" }]).expect(
      400,
    );
    expect(await stopStatus(stopIds[0]!)).toBe("PENDING");
  });

  it("applies in the order the driver made them, not the order they arrived", async () => {
    const { routeId, stopIds } = await startedRoute(driverId, 1);
    const first = failedMark(routeId, stopIds[0]!, new Date(Date.now() - 60_000));
    const second = deliveredMark(routeId, stopIds[0]!, new Date());

    const response = await send([second, first]).expect(200);

    const byId = new Map(
      response.body.results.map((result: { id: string; status: string }) => [
        result.id,
        result.status,
      ]),
    );
    expect(byId.get(first.id)).toBe("APPLIED");
    expect(byId.get(second.id)).toBe("REJECTED");
    expect(await stopStatus(stopIds[0]!)).toBe("FAILED");
  });

  it("sends an operation that fails validation twice to quarantine, and the rest of the batch applies", async () => {
    const { routeId, stopIds } = await startedRoute(driverId, 3);
    const invalid = {
      ...deliveredMark(routeId, stopIds[0]!),
      payload: { routeId, stopId: stopIds[0]!, status: "DELIVERED" },
    };

    const first = await send([invalid, failedMark(routeId, stopIds[1]!)]).expect(200);

    expect(first.body.results[0]).toMatchObject({
      id: invalid.id,
      status: "REJECTED",
      quarantined: false,
    });
    expect(first.body.results[0].reason).toContain("ítems");
    expect(first.body.results[1].status).toBe("APPLIED");
    expect(await stopStatus(stopIds[1]!)).toBe("FAILED");

    const second = await send([invalid, failedMark(routeId, stopIds[2]!)]).expect(200);

    expect(second.body.results[0]).toMatchObject({ status: "REJECTED", quarantined: true });
    expect(second.body.results[1].status).toBe("APPLIED");
    expect(await stopStatus(stopIds[0]!)).toBe("PENDING");
    const stored = await prisma.syncOperation.findUniqueOrThrow({ where: { id: invalid.id } });
    expect(stored.attempts).toBe(2);
    expect(stored.quarantinedAt).not.toBeNull();

    // Ya en cuarentena no se vuelve a intentar: contesta lo mismo.
    const third = await send([invalid]).expect(200);
    expect(third.body.results[0]).toMatchObject({ status: "REJECTED", quarantined: true });
    expect(
      (await prisma.syncOperation.findUniqueOrThrow({ where: { id: invalid.id } })).attempts,
    ).toBe(2);
  });

  it("quarantines at once a mark on a stop the office already corrected, leaving the server untouched", async () => {
    const { routeId, stopIds } = await startedRoute(driverId, 1);
    const stopId = stopIds[0]!;
    await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "FAILED", failureReason: "No contestó" })
      .expect(200);
    await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${stopId}/correction`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "FAILED",
        failureReason: "Se mudó",
        correctionReason: "El chofer llamó para avisar",
      })
      .expect(200);
    const before = await routeLedger(routeId);

    const response = await send([deliveredMark(routeId, stopId)]).expect(200);

    expect(response.body.results[0]).toMatchObject({ status: "REJECTED", quarantined: true });
    expect(response.body.results[0].reason).toContain("ya está");
    expect(await stopStatus(stopId)).toBe("FAILED");
    expect(await routeLedger(routeId)).toEqual(before);
  });

  it("does not let a driver send operations for another driver's route", async () => {
    const { routeId, stopIds } = await startedRoute(otherDriverId, 1);

    const response = await send([deliveredMark(routeId, stopIds[0]!)]).expect(200);

    expect(response.body.results[0]).toMatchObject({ status: "REJECTED", quarantined: true });
    expect(await stopStatus(stopIds[0]!)).toBe("PENDING");
    expect((await routeLedger(routeId)).sales).toBe(0);
  });

  it("does not let a driver who is also office touch another driver's route from the app", async () => {
    const both = await createUserAndLogin("chofer-y-oficina-sync", "DRIVER");
    await prisma.userRoleAssignment.create({
      data: {
        userId: both.id,
        roleId: (await prisma.role.findUniqueOrThrow({ where: { name: "ADMIN" } })).id,
      },
    });
    const bothToken = await login("chofer-y-oficina-sync", "chofer-y-oficina-sync-clave-de-prueba");
    const { routeId, stopIds } = await startedRoute(otherDriverId, 1);

    const response = await send([failedMark(routeId, stopIds[0]!)], bothToken).expect(200);

    expect(response.body.results[0]).toMatchObject({ status: "REJECTED", quarantined: true });
    expect(await stopStatus(stopIds[0]!)).toBe("PENDING");
  });

  it("rejects an envelope version the server does not know, without applying it", async () => {
    const { routeId, stopIds } = await startedRoute(driverId, 1);
    const future = { ...failedMark(routeId, stopIds[0]!), version: 99 };

    const response = await send([future]).expect(200);

    expect(response.body.results[0]).toMatchObject({ status: "REJECTED", quarantined: false });
    expect(response.body.results[0].reason).toContain("versión 99");
    expect(await stopStatus(stopIds[0]!)).toBe("PENDING");
  });

  it("rejects a batch that repeats an id, and is closed to everyone but drivers", async () => {
    const { routeId, stopIds } = await startedRoute(driverId, 1);
    const operation = failedMark(routeId, stopIds[0]!);

    await send([operation, operation]).expect(400);
    await send([operation], adminToken).expect(403);
    expect(await stopStatus(stopIds[0]!)).toBe("PENDING");
  });

  it("delivers something other than what was ordered: the sale and the containers follow the delivery, the order keeps what was asked", async () => {
    const otherType = await prisma.containerType.findFirstOrThrow({ where: { name: "Sin caño" } });
    const otherProduct = await prisma.product.findFirstOrThrow({
      where: { name: "Recarga 20L sin caño" },
    });
    const locationId = await createLocation();
    const { customerId } = await prisma.customerLocation.findUniqueOrThrow({
      where: { id: locationId },
    });
    // El precio del cliente difiere del de lista: la venta tiene que usar este.
    await request(server())
      .post(`/api/v1/customers/${customerId}/prices`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ productId: otherProduct.id, price: "9.50" })
      .expect(201);
    const date = nextDate();
    const order = await request(server())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customerId,
        deliveryDate: date,
        items: [{ productId: refillProductId, quantity: 3, unitPrice: "8.00" }],
      })
      .expect(201);
    const route = await request(server())
      .post("/api/v1/routes")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ driverId, date, vehicleId })
      .expect(201);
    const routeId = route.body.id as string;
    const otherBatchItemId = await createBatchItem(10, otherType.id);
    await request(server())
      .post(`/api/v1/routes/${routeId}/loads`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ batchItemId: otherBatchItemId, quantity: 10 })
      .expect(201);
    const stop = await request(server())
      .post(`/api/v1/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ origin: "ORDER", orderId: order.body.id })
      .expect(201);
    await request(server())
      .patch(`/api/v1/routes/${routeId}/start`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const operation = {
      ...deliveredMark(routeId, stop.body.id),
      payload: {
        routeId,
        stopId: stop.body.id,
        status: "DELIVERED",
        items: [{ productId: otherProduct.id, quantity: 5 }],
      },
    };

    const response = await send([operation]).expect(200);

    expect(response.body.results[0]).toMatchObject({ status: "APPLIED" });
    const sale = await prisma.sale.findFirstOrThrow({
      where: { stopId: stop.body.id },
      include: { items: true },
    });
    expect(sale.total.toFixed(2)).toBe("47.50");
    expect(sale.items).toMatchObject([{ productId: otherProduct.id, quantity: 5 }]);
    const movements = await prisma.containerMovement.findMany({
      where: { stopId: stop.body.id },
      select: { containerTypeId: true, quantity: true },
    });
    expect(movements.length).toBeGreaterThan(0);
    expect(movements.every((movement) => movement.containerTypeId === otherType.id)).toBe(true);
    expect(movements.some((movement) => movement.quantity === 5)).toBe(true);
    const storedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.body.id },
      include: { items: true },
    });
    expect(storedOrder.status).toBe("DELIVERED");
    expect(storedOrder.items).toMatchObject([{ productId: refillProductId, quantity: 3 }]);

    // «Pedido» y «entregado» lado a lado, en el detalle del pedido y en el de
    // la parada. Después se corrige a 4: la venta de 5 queda anulada y lo
    // entregado tiene que ser lo de la vigente, no lo de la anulada.
    const readBoth = async () => {
      const detail = await request(server())
        .get(`/api/v1/orders/${order.body.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const routeDetail = await request(server())
        .get(`/api/v1/routes/${routeId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const routeStop = routeDetail.body.stops.find(
        (candidate: { id: string }) => candidate.id === stop.body.id,
      );
      return { order: detail.body, stop: routeStop };
    };
    const ordered = [{ productId: refillProductId, quantity: 3 }];
    const delivered = await readBoth();
    expect(delivered.order.items).toMatchObject(ordered);
    expect(delivered.order.deliveredItems).toEqual([
      {
        productId: otherProduct.id,
        product: { id: otherProduct.id, name: otherProduct.name },
        quantity: 5,
      },
    ]);
    expect(delivered.stop.orderedItems).toMatchObject(ordered);
    expect(delivered.stop.deliveredItems).toMatchObject([
      { productId: otherProduct.id, quantity: 5 },
    ]);

    await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${stop.body.id}/correction`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "DELIVERED",
        items: [{ productId: otherProduct.id, quantity: 4 }],
        correctionReason: "Eran 4, no 5",
      })
      .expect(200);

    const corrected = await readBoth();
    expect(corrected.order.deliveredItems).toMatchObject([
      { productId: otherProduct.id, quantity: 4 },
    ]);
    expect(corrected.stop.deliveredItems).toMatchObject([
      { productId: otherProduct.id, quantity: 4 },
    ]);
  });

  describe("venta en ruta (STOP_ADD_VAN_SALE)", () => {
    const STOP_SPOT = { latitude: "-12.050000", longitude: "-77.040000" };
    // ~2,2 km al sur de la parada.
    const FAR_FROM_STOP = { latitude: "-12.070000", longitude: "-77.040000" };

    async function vanSaleStops(routeId: string) {
      return prisma.routeStop.findMany({
        where: { routeId, origin: "VAN_SALE", status: "DELIVERED" },
        include: { sales: true },
      });
    }

    // HU-14 E1: «Dado carga disponible, cuando registro una venta a un cliente
    // existente [...], entonces se descuenta de mi carga y aplican las mismas
    // reglas de canje, precio y cobro.» Cobra 6.00 de 16.00 para que la deuda
    // se mueva: pagada entera, una deuda sin actualizar pasaría igual.
    it("adds a delivered stop with its sale and movements at a location of the route's zone, once even if sent twice (HU-14 E1)", async () => {
      const zoneId = await createZone();
      const { routeId } = await startedRoute(driverId, 0, zoneId);
      const locationId = await createLocation(zoneId);
      const soldAt = new Date(Date.now() - 20 * 60 * 1000);
      const operation = vanSale(routeId, locationId, undefined, soldAt);
      operation.payload.payment = { paymentMethodId: cashPaymentMethodId, amount: "6.00" };

      const first = await send([operation]).expect(200);
      const resent = await send([operation]).expect(200);

      expect(first.body.results[0]).toMatchObject({ status: "APPLIED" });
      expect(resent.body.results[0]).toMatchObject({ status: "DUPLICATE" });
      const stops = await vanSaleStops(routeId);
      expect(stops).toHaveLength(1);
      expect(stops[0]).toMatchObject({ locationId, addedById: driverId, orderId: null });
      expect(stops[0]!.sales).toHaveLength(1);
      expect(stops[0]!.sales[0]!.total.toFixed(2)).toBe("16.00");
      expect(stops[0]!.sales[0]!.soldAt.toISOString()).toBe(soldAt.toISOString());
      const ledger = await routeLedger(routeId);
      expect(ledger).toMatchObject({ sales: 1, payments: 1 });
      expect(ledger.movements).toBeGreaterThan(0);

      // Se descuenta de la carga: 10 cargados, 2 recargas entregadas.
      const truckStock = await request(server())
        .get(`/api/v1/routes/${routeId}/truck-stock`)
        .set("Authorization", `Bearer ${driverToken}`)
        .expect(200);
      expect(truckStock.body).toEqual([
        {
          containerType: { id: containerTypeId, name: expect.any(String) },
          loaded: 10,
          onBoard: 8,
        },
      ]);
      // Las mismas reglas de canje y cobro: las 2 recargas quedan prestadas al
      // local y la deuda sube lo que no se cobró, una sola vez.
      const { customerId } = await prisma.customerLocation.findUniqueOrThrow({
        where: { id: locationId },
      });
      const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
      expect(customer.debtBalance.toFixed(2)).toBe("10.00");
      const balance = await prisma.customerContainerBalance.findUniqueOrThrow({
        where: { locationId_containerTypeId: { locationId, containerTypeId } },
      });
      expect(balance.quantity).toBe(2);
    });

    /** Una ruta en curso de otra zona, con una parada en `STOP_SPOT`. */
    async function routeWithStopAtSpot(): Promise<string> {
      const { routeId } = await startedRoute(driverId, 0, await createZone());
      const stopLocationId = await createLocation(undefined, STOP_SPOT);
      await request(server())
        .post(`/api/v1/routes/${routeId}/stops`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ origin: "VAN_SALE", locationId: stopLocationId })
        .expect(201);
      return routeId;
    }

    // Decisión de Giancarlo (2026-10-23 08:17): el radio se mide desde las
    // paradas de la ruta, nunca desde donde el celular dice que está.
    it("accepts a location of another zone within 1 km of one of the route's stops, wherever the driver marked it", async () => {
      const routeId = await routeWithStopAtSpot();
      // ~445 m al sur de la parada, y de otra zona.
      const locationId = await createLocation(await createZone(), {
        latitude: "-12.054000",
        longitude: "-77.040000",
      });

      const response = await send([vanSale(routeId, locationId, FAR_FROM_STOP)]).expect(200);

      expect(response.body.results[0]).toMatchObject({ status: "APPLIED" });
      expect(await vanSaleStops(routeId)).toHaveLength(1);
    });

    it("rejects a location of another zone farther than 1 km from every stop, even marked right at it, writing nothing", async () => {
      const routeId = await routeWithStopAtSpot();
      const locationId = await createLocation(await createZone(), FAR_FROM_STOP);

      const response = await send([vanSale(routeId, locationId, FAR_FROM_STOP)]).expect(200);

      expect(response.body.results[0]).toMatchObject({ status: "REJECTED", quarantined: false });
      expect(response.body.results[0].reason).toContain("1 km");
      expect(await vanSaleStops(routeId)).toHaveLength(0);
      expect(await routeLedger(routeId)).toEqual({ sales: 0, payments: 0, movements: 0 });
    });

    it("quarantines at once a van sale at a location the office deactivated meanwhile", async () => {
      const zoneId = await createZone();
      const { routeId } = await startedRoute(driverId, 0, zoneId);
      const locationId = await createLocation(zoneId);
      await prisma.customerLocation.update({ where: { id: locationId }, data: { active: false } });

      const response = await send([vanSale(routeId, locationId)]).expect(200);

      expect(response.body.results[0]).toMatchObject({ status: "REJECTED", quarantined: true });
      expect(await prisma.routeStop.count({ where: { routeId } })).toBe(0);
    });

    it("does not let a driver add a van sale to another driver's route", async () => {
      const zoneId = await createZone();
      const { routeId } = await startedRoute(otherDriverId, 0, zoneId);
      const locationId = await createLocation(zoneId);

      const response = await send([vanSale(routeId, locationId)]).expect(200);

      expect(response.body.results[0]).toMatchObject({ status: "REJECTED", quarantined: true });
      expect(await prisma.routeStop.count({ where: { routeId } })).toBe(0);
    });
  });

  describe("Operaciones en revisión", () => {
    it("lists what the driver wanted to do, and the office resolves it once", async () => {
      const { routeId, stopIds } = await startedRoute(driverId, 1);
      const stopId = stopIds[0]!;
      await request(server())
        .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "FAILED", failureReason: "Cerrado" })
        .expect(200);
      const quarantined = deliveredMark(routeId, stopId);
      await send([quarantined]).expect(200);

      const inbox = await request(server())
        .get("/api/v1/sync/operations/in-review")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      const item = inbox.body.find((entry: { id: string }) => entry.id === quarantined.id);
      expect(item).toMatchObject({
        type: "STOP_MARK",
        version: 1,
        driverName: "Nombre chofer-sync",
        attempts: 1,
        payload: { status: "DELIVERED", stopId },
        stop: { routeId, stopId, stopStatus: "FAILED", customerName: expect.any(String) },
      });
      expect(item.stop.routeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.rejectionReason).toContain("ya está");

      await request(server())
        .get("/api/v1/sync/operations/in-review")
        .set("Authorization", `Bearer ${driverToken}`)
        .expect(403);

      const resolved = await request(server())
        .patch(`/api/v1/sync/operations/${quarantined.id}/resolution`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ note: "Se corrigió la parada como entregada" })
        .expect(200);
      expect(resolved.body.resolutionNote).toBe("Se corrigió la parada como entregada");

      const after = await request(server())
        .get("/api/v1/sync/operations/in-review")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(after.body.some((entry: { id: string }) => entry.id === quarantined.id)).toBe(false);
      const stored = await prisma.syncOperation.findUniqueOrThrow({
        where: { id: quarantined.id },
      });
      expect(stored).toMatchObject({ status: "REJECTED", resolvedById: adminUserId });

      await request(server())
        .patch(`/api/v1/sync/operations/${quarantined.id}/resolution`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ note: "Otra vez" })
        .expect(409);
    });

    it("does not resolve an operation that is not in review", async () => {
      const { routeId, stopIds } = await startedRoute(driverId, 1);
      const applied = failedMark(routeId, stopIds[0]!);
      await send([applied]).expect(200);

      await request(server())
        .patch(`/api/v1/sync/operations/${applied.id}/resolution`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ note: "Nada que revisar" })
        .expect(404);
      await request(server())
        .patch(`/api/v1/sync/operations/${applied.id}/resolution`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ note: "   " })
        .expect(400);
    });
  });
});
