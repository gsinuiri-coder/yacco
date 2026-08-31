import request from "supertest";
import {
  ContainerMovementType,
  ContainerState,
  RouteStatus,
  StopOrigin,
  StopStatus,
} from "@prisma/client";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

// HU-17 (spec §2.4 Épica C): "Dado una ruta finalizada, cuando la liquido,
// entonces el sistema concilia: llenos salidos = entregados + vendidos
// completos + retornados; vacíos recogidos = descargados; total vendido =
// cobrado + fiado; y toda diferencia queda registrada." — never blocks on a
// mismatch, never blocks on a payment still PENDING.

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

let nextDayOffset = 0;
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
let containerTypeId: string;
let refillProductId: string;
let containerSaleProductId: string;
let adminUserId: string;
let cashPaymentMethodId: string;
let yapePaymentMethodId: string;

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

function messagesOf(response: { body: { message?: string | string[] } }): string {
  const { message } = response.body;
  return Array.isArray(message) ? message.join(" | ") : (message ?? "");
}

let customerSeq = 0;
async function createFreshLocation(): Promise<{ customerId: string; locationId: string }> {
  customerSeq += 1;
  const customer = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: `Cliente Liquidación ${customerSeq}`,
      phone: `98700${String(customerSeq).padStart(4, "0")}`,
      address: "Av. Liquidación 1",
      addressReference: "Casa celeste",
    })
    .expect(201);
  const location = await prisma.customerLocation.findFirstOrThrow({
    where: { customerId: customer.body.id },
  });
  return { customerId: customer.body.id, locationId: location.id };
}

let batchCounter = 0;
/**
 * Cada lote nace UN DÍA MÁS VIEJO que el anterior, a propósito. `POST
 * /routes/:id/loads` exige el lote más antiguo con unidades disponibles de
 * ese tipo de envase (FIFO), y estos tests comparten un único
 * `containerTypeId`: con una fecha fija, el sobrante de un test anterior
 * sería la cabeza del FIFO y toda carga posterior se rechazaría. Fechándolos
 * hacia atrás, el lote recién creado es siempre el que la regla manda cargar,
 * que es justo lo que cada test quiere decir al pedirlo.
 *
 * La aritmética va en UTC, igual que `parseBusinessDate`/`formatBusinessDate`
 * de la API: construirla con partes locales dejaría que la zona horaria de
 * quien corre los tests corriera el día.
 */
function nextBatchDate(): string {
  const base = Date.UTC(2026, 7, 1);
  return new Date(base - batchCounter * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
async function createBatchItem(producedQty: number): Promise<string> {
  batchCounter += 1;
  const response = await request(server())
    .post("/api/v1/production-batches")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      code: `LOTE-LIQUIDACION-${batchCounter}`,
      date: nextBatchDate(),
      items: [{ containerTypeId, producedQty }],
    })
    .expect(201);
  return response.body.items[0].id;
}

async function createRoute(): Promise<string> {
  const response = await request(server())
    .post("/api/v1/routes")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ driverId, date: nextDate(), zoneId })
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

async function addStop(routeId: string, locationId: string): Promise<string> {
  const response = await request(server())
    .post(`/api/v1/routes/${routeId}/stops`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ origin: StopOrigin.VAN_SALE, locationId })
    .expect(201);
  return response.body.id;
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

async function deliverStop(
  routeId: string,
  stopId: string,
  body: Record<string, unknown>,
): Promise<request.Test> {
  return request(server())
    .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: StopStatus.DELIVERED, ...body });
}

function getSettlement(routeId: string, token = adminToken): request.Test {
  return request(server())
    .get(`/api/v1/routes/${routeId}/settlement`)
    .set("Authorization", `Bearer ${token}`);
}

function postSettlement(
  routeId: string,
  body: Record<string, unknown>,
  token = adminToken,
): request.Test {
  return request(server())
    .post(`/api/v1/routes/${routeId}/settlement`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

/**
 * Cuántos vacíos de ese tipo quedan en camión, según el libro: todo lo que
 * entró a EMPTY_ON_ROUTE menos todo lo que salió. Los tests que lo usan crean
 * su propio tipo de envase, así que el número es solo suyo.
 *
 * Puede dar NEGATIVO, y eso es justamente lo que un test comprueba: liquidar
 * emite desde lo contado en la puerta, no desde el libro.
 */
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

function emptiesOnRoute(typeId: string): Promise<number> {
  return netInState(typeId, ContainerState.EMPTY_ON_ROUTE);
}

/** Lo mismo para los llenos: así se ve que un movimiento de anulación los
 * devuelve al camión sin que nadie lea su `type`. */
function fullsOnRoute(typeId: string): Promise<number> {
  return netInState(typeId, ContainerState.FULL_ON_ROUTE);
}

let extraTypeSeq = 0;
/** Un tipo de envase propio del test, para que su parque no lo mueva nadie más. */
async function createContainerType(): Promise<string> {
  extraTypeSeq += 1;
  const response = await request(server())
    .post("/api/v1/container-types")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: `Bidón liquidación ${extraTypeSeq}` })
    .expect(201);
  return response.body.id;
}

/** A fresh FINISHED route with one delivered stop and no payment — enough
 * to settle, without caring about the exact money/container numbers. */
async function freshFinishedRoute(): Promise<{ routeId: string }> {
  const { locationId } = await createFreshLocation();
  const batchItemId = await createBatchItem(5);
  const routeId = await createRoute();
  await addLoad(routeId, batchItemId, 5);
  const stopId = await addStop(routeId, locationId);
  await startRoute(routeId);
  await deliverStop(routeId, stopId, { items: [{ productId: refillProductId, quantity: 2 }] }).then(
    (r) => expect(r.status).toBe(200),
  );
  await finishRoute(routeId);
  return { routeId };
}

beforeAll(async () => {
  ctx = await startTestApp();
  prisma = ctx.app.get(PrismaService);
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: ADMIN_USERNAME } });
  adminUserId = admin.id;
  sellerToken = (await createUserAndLogin("vendedor-liquidacion", "SELLER")).token;
  const driver = await createUserAndLogin("repartidor-liquidacion", "DRIVER");
  driverToken = driver.token;
  driverId = driver.id;

  const zone = await request(server())
    .post("/api/v1/zones")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "Zona Liquidación" })
    .expect(201);
  zoneId = zone.body.id;

  const containerType = await prisma.containerType.findFirstOrThrow({
    where: { name: "Con caño" },
  });
  containerTypeId = containerType.id;
  const refill = await prisma.product.create({
    data: {
      containerTypeId,
      name: "Recarga 20L (liquidación)",
      type: "REFILL",
      listPrice: "8.00",
    },
  });
  refillProductId = refill.id;
  const containerSale = await prisma.product.create({
    data: {
      containerTypeId,
      name: "Bidón 20L (liquidación)",
      type: "CONTAINER_SALE",
      listPrice: "30.00",
    },
  });
  containerSaleProductId = containerSale.id;

  cashPaymentMethodId = (
    await prisma.paymentMethod.findFirstOrThrow({ where: { name: "Efectivo" } })
  ).id;
  yapePaymentMethodId = (await prisma.paymentMethod.findFirstOrThrow({ where: { name: "Yape" } }))
    .id;
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("full reconciliation: LOAN_DELIVERY + FULL_SALE + a rejected payment", () => {
  test("cuadra exacto: differences en cero, la identidad de envases se cumple, y REJECTED no cuenta", async () => {
    const a = await createFreshLocation();
    const b = await createFreshLocation();
    const c = await createFreshLocation();
    const batchItemId = await createBatchItem(10);
    const routeId = await createRoute();
    await addLoad(routeId, batchItemId, 10);
    const stopA = await addStop(routeId, a.locationId);
    const stopB = await addStop(routeId, b.locationId);
    const stopC = await addStop(routeId, c.locationId);
    await startRoute(routeId);

    // Stop A: 3 refills at a price override (8.33 instead of 8.00, so the
    // totals below are never round numbers), canje completo (3 returned),
    // paid partially in cash (20.00 of 24.99) -> CONFIRMED.
    const deliverA = await deliverStop(routeId, stopA, {
      items: [{ productId: refillProductId, quantity: 3, unitPrice: "8.33" }],
      priceOverrideAuthorizedById: adminUserId,
      containersReturned: [{ containerTypeId, quantity: 3 }],
      payment: { paymentMethodId: cashPaymentMethodId, amount: "20.00" },
    });
    expect(deliverA.status).toBe(200);
    expect(deliverA.body.sale.total).toBe("24.99");

    // Stop B: 2 bidones (FULL_SALE, leaves the fleet) at list price, paid by
    // Yape -> PENDING, still counts in totalCollected but not in cash.
    const deliverB = await deliverStop(routeId, stopB, {
      items: [{ productId: containerSaleProductId, quantity: 2 }],
      payment: { paymentMethodId: yapePaymentMethodId, amount: "60.00" },
    });
    expect(deliverB.status).toBe(200);
    expect(deliverB.body.payment.status).toBe("PENDING");

    // Stop C: 1 refill, no canje (envase queda de deuda), paid by Yape ->
    // PENDING, then REJECTED before the route even finishes: this money
    // never counts anywhere in the settlement.
    const deliverC = await deliverStop(routeId, stopC, {
      items: [{ productId: refillProductId, quantity: 1 }],
      payment: { paymentMethodId: yapePaymentMethodId, amount: "8.00" },
    });
    expect(deliverC.status).toBe(200);
    await request(server())
      .post(`/api/v1/payments/${deliverC.body.payment.id}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "El Yape nunca llegó a la cuenta" })
      .expect(200);

    await finishRoute(routeId);

    // La vista previa tiene que decir 3 vacíos según el libro ANTES de que
    // nadie cuente nada: es el número contra el que se cuenta en la puerta.
    const preview = await getSettlement(routeId);
    expect(preview.body.expected.emptiesPickedUp).toBe(3);

    // fullOut=10, fullDelivered=3(A)+1(C)=4, fullSold=2(B) -> fullReturned=4
    // for the identity to hold exactly. emptiesCollected ledger = 3 (only A
    // returned containers) -> entering 3 matches exactly too.
    const response = await postSettlement(routeId, {
      fullReturned: 4,
      emptiesCollected: [{ containerTypeId, quantity: 3 }],
    });

    expect(response.status).toBe(201);
    expect(response.body.differences).toMatchObject({ containers: 0, empties: 0 });
    expect(response.body.differences.emptiesByType).toEqual([
      { containerTypeId, containerTypeName: "Con caño", difference: 0 },
    ]);

    const settlement = response.body.settlement;
    expect(settlement.fullOut).toBe(10);
    expect(settlement.fullDelivered).toBe(4);
    expect(settlement.fullSold).toBe(2);
    expect(settlement.fullReturned).toBe(4);
    expect(settlement.emptiesCollected).toBe(3);
    // 24.99 + 60.00 + 8.00 (the rejected sale still happened and still counts
    // as sold, even though its payment does not)
    expect(settlement.totalSold).toBe("92.99");
    // 20.00 cash + 60.00 Yape-pending; the REJECTED 8.00 never lands here
    expect(settlement.totalCollected).toBe("80.00");
    expect(settlement.totalCashCollected).toBe("20.00");
    expect(settlement.totalPendingConfirmation).toBe("60.00");
    expect(settlement.totalOnCredit).toBe("12.99");
    expect(settlement.settledById).toBe(adminUserId);
    // totalSold = totalCollected + totalOnCredit, exactly, with cents
    expect((Number(settlement.totalCollected) + Number(settlement.totalOnCredit)).toFixed(2)).toBe(
      settlement.totalSold,
    );

    const route = await prisma.route.findUniqueOrThrow({ where: { id: routeId } });
    expect(route.status).toBe(RouteStatus.SETTLED);
  });
});

describe("a container shortfall settles anyway and reports it", () => {
  test("liquida igual con un faltante de envases", async () => {
    const { locationId } = await createFreshLocation();
    const batchItemId = await createBatchItem(5);
    const routeId = await createRoute();
    await addLoad(routeId, batchItemId, 5);
    const stopId = await addStop(routeId, locationId);
    await startRoute(routeId);
    await deliverStop(routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 3 }],
    }).then((r) => expect(r.status).toBe(200));
    await finishRoute(routeId);

    // fullOut=5, fullDelivered=3, fullSold=0 -> a matching fullReturned would
    // be 2; entering 0 leaves a shortfall of 2 unaccounted for.
    const response = await postSettlement(routeId, { fullReturned: 0, emptiesCollected: [] });

    expect(response.status).toBe(201);
    expect(response.body.differences.containers).toBe(2);

    const route = await prisma.route.findUniqueOrThrow({ where: { id: routeId } });
    expect(route.status).toBe(RouteStatus.SETTLED);
  });
});

/**
 * Liquidar es lo que devuelve los vacíos al galpón: hasta que existió este
 * productor, todo lo que el chofer recogía se quedaba en EMPTY_ON_ROUTE para
 * siempre. Estos tests miran el ledger, que es donde eso se ve.
 */
describe("liquidar descarga los vacíos al galpón (EMPTY_UNLOAD)", () => {
  /** Una ruta terminada que recogió estos vacíos, listos para descargar. */
  async function routeWithPickups(
    containersReturned: { containerTypeId: string; quantity: number }[],
  ): Promise<string> {
    const { locationId } = await createFreshLocation();
    const batchItemId = await createBatchItem(5);
    const routeId = await createRoute();
    await addLoad(routeId, batchItemId, 5);
    const stopId = await addStop(routeId, locationId);
    await startRoute(routeId);
    await deliverStop(routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 1 }],
      containersReturned,
    }).then((r) => expect(r.status).toBe(200));
    await finishRoute(routeId);
    return routeId;
  }

  function unloadsOf(routeId: string) {
    return prisma.containerMovement.findMany({
      where: { routeId, type: ContainerMovementType.EMPTY_UNLOAD },
      orderBy: { quantity: "desc" },
    });
  }

  test("emite un EMPTY_UNLOAD por tipo contado, de EMPTY_ON_ROUTE a EMPTY_AT_PLANT", async () => {
    const typeA = await createContainerType();
    const typeB = await createContainerType();
    const routeId = await routeWithPickups([
      { containerTypeId: typeA, quantity: 3 },
      { containerTypeId: typeB, quantity: 2 },
    ]);

    const response = await postSettlement(routeId, {
      fullReturned: 4,
      emptiesCollected: [
        { containerTypeId: typeA, quantity: 3 },
        { containerTypeId: typeB, quantity: 2 },
      ],
    });

    expect(response.status).toBe(201);
    const unloads = await unloadsOf(routeId);
    expect(unloads).toHaveLength(2);
    for (const movement of unloads) {
      expect(movement.fromState).toBe(ContainerState.EMPTY_ON_ROUTE);
      expect(movement.toState).toBe(ContainerState.EMPTY_AT_PLANT);
      // La descarga es de la ruta entera y no toca "en cliente": ni parada ni
      // ubicación.
      expect(movement.stopId).toBeNull();
      expect(movement.locationId).toBeNull();
      expect(movement.recordedById).toBe(adminUserId);
    }
    expect(unloads.map((m) => [m.containerTypeId, m.quantity])).toEqual([
      [typeA, 3],
      [typeB, 2],
    ]);
    // Lo que entró al camión salió de vuelta al galpón.
    expect(await emptiesOnRoute(typeA)).toBe(0);
    expect(await emptiesOnRoute(typeB)).toBe(0);
  });

  // El test que fija la decisión del dueño: se emite lo CONTADO, no lo que
  // dice el libro. Si el chofer trae más de lo que alguien registró, el parque
  // queda negativo — y ese negativo es la información, no un error a corregir.
  test("emite lo contado aunque el libro diga menos, y el parque queda negativo", async () => {
    const typeId = await createContainerType();
    const routeId = await routeWithPickups([{ containerTypeId: typeId, quantity: 2 }]);
    expect(await emptiesOnRoute(typeId)).toBe(2);

    const response = await postSettlement(routeId, {
      fullReturned: 4,
      emptiesCollected: [{ containerTypeId: typeId, quantity: 5 }],
    });

    expect(response.status).toBe(201);
    const unloads = await unloadsOf(routeId);
    expect(unloads).toHaveLength(1);
    expect(unloads[0]?.quantity).toBe(5);
    expect(await emptiesOnRoute(typeId)).toBe(-3);
    expect(response.body.differences.empties).toBe(-3);
    expect(response.body.differences.emptiesByType).toEqual([
      expect.objectContaining({ containerTypeId: typeId, difference: -3 }),
    ]);
  });

  test("una línea en cero no emite nada, y un tipo que no se contó queda como diferencia", async () => {
    const counted = await createContainerType();
    const zeroed = await createContainerType();
    const uncounted = await createContainerType();
    const routeId = await routeWithPickups([
      { containerTypeId: counted, quantity: 2 },
      { containerTypeId: uncounted, quantity: 1 },
    ]);

    const response = await postSettlement(routeId, {
      fullReturned: 4,
      emptiesCollected: [
        { containerTypeId: counted, quantity: 2 },
        { containerTypeId: zeroed, quantity: 0 },
      ],
    });

    expect(response.status).toBe(201);
    const unloads = await unloadsOf(routeId);
    expect(unloads).toHaveLength(1);
    expect(unloads[0]?.containerTypeId).toBe(counted);
    expect(response.body.settlement.emptiesCollected).toBe(2);
    // El tipo recogido que nadie contó no se descarta: es el hallazgo.
    expect(response.body.differences.emptiesByType).toContainEqual(
      expect.objectContaining({ containerTypeId: uncounted, difference: 1 }),
    );
    expect(await emptiesOnRoute(uncounted)).toBe(1);
  });

  // Retirar un tipo es "no entregar más", nunca "no puede volver": el envase
  // que ya está afuera tiene que poder llegar al galpón.
  test("un tipo de envase retirado se descarga igual", async () => {
    const typeId = await createContainerType();
    const routeId = await routeWithPickups([{ containerTypeId: typeId, quantity: 2 }]);
    await request(server())
      .patch(`/api/v1/container-types/${typeId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ active: false })
      .expect(200);

    const response = await postSettlement(routeId, {
      fullReturned: 4,
      emptiesCollected: [{ containerTypeId: typeId, quantity: 2 }],
    });

    expect(response.status).toBe(201);
    expect(await unloadsOf(routeId)).toHaveLength(1);
    expect(await emptiesOnRoute(typeId)).toBe(0);
  });

  // La única prueba de por qué el desglose existe: el total dice que cuadró y
  // esconde dos hallazgos distintos.
  test("dos tipos que se compensan: el total da cero y el desglose no", async () => {
    const typeA = await createContainerType();
    const typeB = await createContainerType();
    const routeId = await routeWithPickups([
      { containerTypeId: typeA, quantity: 5 },
      { containerTypeId: typeB, quantity: 2 },
    ]);

    const response = await postSettlement(routeId, {
      fullReturned: 4,
      emptiesCollected: [
        { containerTypeId: typeA, quantity: 2 },
        { containerTypeId: typeB, quantity: 5 },
      ],
    });

    expect(response.status).toBe(201);
    expect(response.body.differences.empties).toBe(0);
    const byType = response.body.differences.emptiesByType as {
      containerTypeId: string;
      difference: number;
    }[];
    expect(byType.find((row) => row.containerTypeId === typeA)?.difference).toBe(3);
    expect(byType.find((row) => row.containerTypeId === typeB)?.difference).toBe(-3);
  });

  test("un segundo intento de liquidar no agrega movimientos", async () => {
    const typeId = await createContainerType();
    const routeId = await routeWithPickups([{ containerTypeId: typeId, quantity: 2 }]);
    const body = { fullReturned: 4, emptiesCollected: [{ containerTypeId: typeId, quantity: 2 }] };

    await postSettlement(routeId, body).then((r) => expect(r.status).toBe(201));
    const second = await postSettlement(routeId, body);

    expect(second.status).toBe(409);
    expect(await unloadsOf(routeId)).toHaveLength(1);
    expect(await emptiesOnRoute(typeId)).toBe(0);
  });

  test("la vista de una ruta liquidada trae lo contado por tipo, reconstruido del libro", async () => {
    const typeId = await createContainerType();
    const routeId = await routeWithPickups([{ containerTypeId: typeId, quantity: 3 }]);
    await postSettlement(routeId, {
      fullReturned: 4,
      emptiesCollected: [{ containerTypeId: typeId, quantity: 3 }],
    }).then((r) => expect(r.status).toBe(201));

    const view = await getSettlement(routeId);

    expect(view.status).toBe(200);
    expect(view.body.settlement.emptiesCollected).toBe(3);
    expect(view.body.settlement.emptiesCollectedByType).toEqual([
      expect.objectContaining({ containerTypeId: typeId, quantity: 3 }),
    ]);
    expect(view.body.expected.emptiesPickedUpByType).toEqual([
      expect.objectContaining({ containerTypeId: typeId, quantity: 3 }),
    ]);
  });

  // La invariante que pide la skill de dominio: el saldo materializado sigue
  // siendo reconstruible del ledger después de liquidar.
  test("la reconciliación de envases sigue cuadrando después de liquidar", async () => {
    const typeId = await createContainerType();
    const routeId = await routeWithPickups([{ containerTypeId: typeId, quantity: 3 }]);
    await postSettlement(routeId, {
      fullReturned: 4,
      emptiesCollected: [{ containerTypeId: typeId, quantity: 3 }],
    }).then((r) => expect(r.status).toBe(201));

    const reconciliation = await request(server())
      .get("/api/v1/container-reconciliation")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const finding = reconciliation.body.discrepancies.find(
      (row: { containerTypeId: string }) => row.containerTypeId === typeId,
    );
    expect(finding).toBeUndefined();
  });
});

describe("idempotency and route state guards", () => {
  test("a second POST is rejected with 409 and only one settlement row exists", async () => {
    const { routeId } = await freshFinishedRoute();

    const first = await postSettlement(routeId, { fullReturned: 0, emptiesCollected: [] });
    expect(first.status).toBe(201);

    const second = await postSettlement(routeId, { fullReturned: 0, emptiesCollected: [] });
    expect(second.status).toBe(409);

    const count = await prisma.routeSettlement.count({ where: { routeId } });
    expect(count).toBe(1);
  });

  test("a route still IN_PROGRESS is rejected with 409", async () => {
    const { locationId } = await createFreshLocation();
    const routeId = await createRoute();
    await addStop(routeId, locationId);
    await startRoute(routeId);

    const response = await postSettlement(routeId, { fullReturned: 0, emptiesCollected: [] });

    expect(response.status).toBe(409);
    expect(messagesOf(response)).toContain("IN_PROGRESS");
  });

  test("a route still PLANNED is rejected with 409", async () => {
    const routeId = await createRoute();

    const response = await postSettlement(routeId, { fullReturned: 0, emptiesCollected: [] });

    expect(response.status).toBe(409);
    expect(messagesOf(response)).toContain("PLANNED");
  });

  test("an unknown route is rejected with 404 on both GET and POST", async () => {
    const getResponse = await getSettlement(MISSING_UUID);
    expect(getResponse.status).toBe(404);

    const postResponse = await postSettlement(MISSING_UUID, {
      fullReturned: 0,
      emptiesCollected: [],
    });
    expect(postResponse.status).toBe(404);
  });
});

describe("validation", () => {
  test("a negative fullReturned is rejected with 400", async () => {
    const { routeId } = await freshFinishedRoute();

    const response = await postSettlement(routeId, { fullReturned: -1, emptiesCollected: [] });

    expect(response.status).toBe(400);
  });

  test("a non-integer quantity in a line is rejected with 400", async () => {
    const { routeId } = await freshFinishedRoute();

    const response = await postSettlement(routeId, {
      fullReturned: 0,
      emptiesCollected: [{ containerTypeId, quantity: 2.5 }],
    });

    expect(response.status).toBe(400);
  });

  test("repeating a container type in the empties list is rejected with 400", async () => {
    const { routeId } = await freshFinishedRoute();

    const response = await postSettlement(routeId, {
      fullReturned: 0,
      emptiesCollected: [
        { containerTypeId, quantity: 2 },
        { containerTypeId, quantity: 3 },
      ],
    });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("no puede repetir un tipo de envase");
    // Ni la ruta ni el libro se tocaron: la lista se rechaza antes de todo.
    const route = await prisma.route.findUniqueOrThrow({ where: { id: routeId } });
    expect(route.status).toBe(RouteStatus.FINISHED);
    expect(
      await prisma.containerMovement.count({
        where: { routeId, type: ContainerMovementType.EMPTY_UNLOAD },
      }),
    ).toBe(0);
  });
});

describe("roles", () => {
  test("a DRIVER is refused with 403 on POST", async () => {
    const { routeId } = await freshFinishedRoute();

    const response = await postSettlement(
      routeId,
      { fullReturned: 0, emptiesCollected: [] },
      driverToken,
    );

    expect(response.status).toBe(403);
  });

  test("a SELLER can read the settlement screen but not settle it", async () => {
    const { routeId } = await freshFinishedRoute();

    const read = await getSettlement(routeId, sellerToken);
    expect(read.status).toBe(200);

    const write = await postSettlement(
      routeId,
      { fullReturned: 0, emptiesCollected: [] },
      sellerToken,
    );
    expect(write.status).toBe(403);
  });
});

describe("GET .../settlement before and after settling", () => {
  test("before: expected is populated and settlement is null; after: both are", async () => {
    const { routeId } = await freshFinishedRoute();

    const before = await getSettlement(routeId);
    expect(before.status).toBe(200);
    expect(before.body.settlement).toBeNull();
    expect(before.body.expected.fullOut).toBe(5);
    expect(before.body.expected.fullDelivered).toBe(2);
    // Sin vacíos devueltos en esta entrega, el libro dice 0: es contra ese
    // número que se cuentan los vacíos al descargar el camión.
    expect(before.body.expected.emptiesPickedUp).toBe(0);

    await postSettlement(routeId, { fullReturned: 3, emptiesCollected: [] }).then((r) =>
      expect(r.status).toBe(201),
    );

    const after = await getSettlement(routeId);
    expect(after.status).toBe(200);
    expect(after.body.settlement).not.toBeNull();
    expect(after.body.settlement.fullReturned).toBe(3);
    expect(after.body.expected.fullOut).toBe(5);
  });

  test("unresolvedStops counts PENDING stops on the route", async () => {
    const a = await createFreshLocation();
    const b = await createFreshLocation();
    const batchItemId = await createBatchItem(5);
    const routeId = await createRoute();
    await addLoad(routeId, batchItemId, 5);
    const stopA = await addStop(routeId, a.locationId);
    await addStop(routeId, b.locationId);
    await startRoute(routeId);
    await deliverStop(routeId, stopA, {
      items: [{ productId: refillProductId, quantity: 1 }],
    }).then((r) => expect(r.status).toBe(200));

    const response = await getSettlement(routeId);

    expect(response.status).toBe(200);
    expect(response.body.unresolvedStops).toBe(1);
  });
});

/**
 * Quien ESCRIBE una anulación es la operación de corrección, que todavía no
 * existe: acá los movimientos de anulación y las columnas de la venta se
 * escriben a mano. Es legítimo justamente porque lo que se prueba es la
 * aritmética de quien LEE el libro. El INSERT en el ledger es el mismo que
 * hará esa operación; el UPDATE sobre `sales` es lo único que ningún código
 * de producción tiene permitido hacer.
 */
describe("la liquidación no cuenta lo anulado", () => {
  test("una entrega, una recogida y una venta anuladas salen netas del expected", async () => {
    const { locationId } = await createFreshLocation();
    const batchItemId = await createBatchItem(10);
    const routeId = await createRoute();
    await addLoad(routeId, batchItemId, 10);
    const stopId = await addStop(routeId, locationId);
    await startRoute(routeId);
    const delivered = await deliverStop(routeId, stopId, {
      // 4 recargas (LOAN_DELIVERY 4) y 2 bidones vendidos (FULL_SALE 2),
      // con 3 vacíos recogidos.
      items: [
        { productId: refillProductId, quantity: 4 },
        { productId: containerSaleProductId, quantity: 2 },
      ],
      containersReturned: [{ containerTypeId, quantity: 3 }],
      payment: { paymentMethodId: cashPaymentMethodId, amount: "10.00" },
    });
    expect(delivered.status).toBe(200);
    await finishRoute(routeId);

    const before = await getSettlement(routeId);
    expect(before.status).toBe(200);
    expect(before.body.expected.fullDelivered).toBe(4);
    expect(before.body.expected.fullSold).toBe(2);
    expect(before.body.expected.emptiesPickedUp).toBe(3);
    const soldBefore = before.body.expected.totalSold;
    expect(before.body.expected.totalCashCollected).toBe("10.00");

    // La corrección: se anota que 1 de las 4 entregas, 1 de las 2 ventas y 1
    // de las 3 recogidas nunca pasaron, y se anulan la venta y su cobro.
    await prisma.containerMovement.createMany({
      data: [
        {
          routeId,
          type: ContainerMovementType.LOAN_DELIVERY_VOID,
          containerTypeId,
          quantity: 1,
          fromState: ContainerState.WITH_CUSTOMER,
          toState: ContainerState.FULL_ON_ROUTE,
          occurredAt: new Date(),
          recordedById: adminUserId,
        },
        {
          routeId,
          type: ContainerMovementType.FULL_SALE_VOID,
          containerTypeId,
          quantity: 1,
          fromState: null,
          toState: ContainerState.FULL_ON_ROUTE,
          occurredAt: new Date(),
          recordedById: adminUserId,
        },
        {
          routeId,
          type: ContainerMovementType.EMPTY_PICKUP_VOID,
          containerTypeId,
          quantity: 1,
          fromState: ContainerState.EMPTY_ON_ROUTE,
          toState: ContainerState.WITH_CUSTOMER,
          occurredAt: new Date(),
          recordedById: adminUserId,
        },
      ],
    });
    const voided = {
      voidedAt: new Date(),
      voidedById: adminUserId,
      voidReason: "Se anotó la parada equivocada",
    };
    await prisma.sale.update({ where: { id: delivered.body.sale.id }, data: voided });
    await prisma.payment.update({ where: { id: delivered.body.payment.id }, data: voided });

    const after = await getSettlement(routeId);

    expect(after.status).toBe(200);
    expect(after.body.expected.fullDelivered).toBe(3);
    expect(after.body.expected.fullSold).toBe(1);
    expect(after.body.expected.emptiesPickedUp).toBe(2);
    // Lo que salió del galpón salió: anular no descarga el camión.
    expect(after.body.expected.fullOut).toBe(10);
    // Y la plata anulada deja de pedírsele al chofer en la puerta.
    expect(soldBefore).not.toBe("0.00");
    expect(after.body.expected.totalSold).toBe("0.00");
    expect(after.body.expected.totalCollected).toBe("0.00");
    expect(after.body.expected.totalCashCollected).toBe("0.00");
  });

  test("un tipo recogido y anulado entero conserva su línea en cero", async () => {
    const typeId = await createContainerType();
    const { locationId } = await createFreshLocation();
    const batchItemId = await createBatchItem(5);
    const routeId = await createRoute();
    await addLoad(routeId, batchItemId, 5);
    const stopId = await addStop(routeId, locationId);
    await startRoute(routeId);
    await deliverStop(routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 1 }],
      containersReturned: [{ containerTypeId: typeId, quantity: 2 }],
    }).then((r) => expect(r.status).toBe(200));
    await finishRoute(routeId);

    await prisma.containerMovement.create({
      data: {
        routeId,
        type: ContainerMovementType.EMPTY_PICKUP_VOID,
        containerTypeId: typeId,
        quantity: 2,
        fromState: ContainerState.EMPTY_ON_ROUTE,
        toState: ContainerState.WITH_CUSTOMER,
        occurredAt: new Date(),
        recordedById: adminUserId,
      },
    });

    const response = await getSettlement(routeId);

    expect(response.status).toBe(200);
    // La línea SE CONSERVA en cero: que se haya recogido y anulado entero es
    // información. Sin ella sería indistinguible de un tipo que nunca pasó por
    // la ruta, porque la diferencia por tipo lee la ausencia como cero.
    const line = (
      response.body.expected.emptiesPickedUpByType as {
        containerTypeId: string;
        quantity: number;
      }[]
    ).find((row) => row.containerTypeId === typeId);
    expect(line).toBeDefined();
    expect(line?.quantity).toBe(0);
    expect(response.body.expected.emptiesPickedUp).toBe(0);
  });

  test("los llenos vuelven al camión solos: el stock se lee por estados, no por tipo", async () => {
    const typeId = await createContainerType();
    const before = await fullsOnRoute(typeId);

    await prisma.containerMovement.create({
      data: {
        type: ContainerMovementType.LOAN_DELIVERY_VOID,
        containerTypeId: typeId,
        quantity: 6,
        fromState: ContainerState.WITH_CUSTOMER,
        toState: ContainerState.FULL_ON_ROUTE,
        occurredAt: new Date(),
        recordedById: adminUserId,
      },
    });

    // getRouteFullStock e inventory() no saben que estos tipos existen y no
    // hizo falta que lo supieran: calculan por fromState/toState.
    expect(await fullsOnRoute(typeId)).toBe(before + 6);
  });
});

describe("auth", () => {
  test("an unauthenticated request is refused with 401", async () => {
    const response = await request(server()).get(`/api/v1/routes/${MISSING_UUID}/settlement`);

    expect(response.status).toBe(401);
  });
});
