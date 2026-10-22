import { randomUUID } from "node:crypto";
import request from "supertest";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

// Fase 3, fila 11b (decisión de Giancarlo, 2026-10-22): la app del chofer lee
// todo lo que necesita para trabajar sin señal de UN endpoint suyo. Lee la
// deuda, los envases y los accesorios de los locales de SU ruta —y de los que
// puede visitar en venta en ruta—, nada de los de otra ruta, y los endpoints
// de la oficina le siguen cerrados. Dos choferes con una ruta cada uno, en
// zonas distintas, para que «ajeno» exista.

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
const LIMA_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" });

// Un punto en Lima y dos locales: uno a ~300 m y otro a ~1,17 km en diagonal.
// El lejano cae DENTRO de la caja de ±1 km por eje que filtra la base: así lo
// descarta la distancia de verdad y no la caja.
const DRIVER_POSITION = { latitude: "-12.046374", longitude: "-77.042793" };
const NEAR_POSITION = { latitude: "-12.044000", longitude: "-77.041000" };
const FAR_POSITION = { latitude: "-12.038874", longitude: "-77.035293" };

let ctx: TestAppContext;
let prisma: PrismaService;
let adminToken: string;
let driverAToken: string;
let driverBToken: string;
let driverCToken: string;
let routeAId: string;
let routeBId: string;
let routeCId: string;
let refillProductId: string;
let accessoryId: string;
let orderedLocationId: string;
let orderedCustomerId: string;
let soldLocationId: string;
let soldCustomerId: string;
let zoneOnlyLocationId: string;
let otherRouteLocationId: string;
let nearLocationId: string;
let farLocationId: string;

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

async function createDriver(username: string): Promise<{ token: string; id: string }> {
  const password = `${username}-clave-de-prueba`;
  const created = await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: `Nombre ${username}`, username, password, roles: ["DRIVER"] })
    .expect(201);
  return { token: await login(username, password), id: created.body.id };
}

async function createZone(name: string): Promise<string> {
  const zone = await request(server())
    .post("/api/v1/zones")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name })
    .expect(201);
  return zone.body.id;
}

let customerSeq = 0;
async function createCustomer(
  zoneId: string | undefined,
  position?: { latitude: string; longitude: string },
): Promise<{ customerId: string; locationId: string }> {
  customerSeq += 1;
  const customer = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: `Cliente Snapshot ${customerSeq}`,
      phone: `98800${String(customerSeq).padStart(4, "0")}`,
      address: "Av. Sin Señal 2",
      addressReference: "Al lado del grifo",
      ...(zoneId !== undefined ? { zoneId } : {}),
    })
    .expect(201);
  const location = await prisma.customerLocation.findFirstOrThrow({
    where: { customerId: customer.body.id },
  });
  if (position !== undefined) {
    await prisma.customerLocation.update({ where: { id: location.id }, data: position });
  }
  return { customerId: customer.body.id, locationId: location.id };
}

async function createRoute(driverId: string, date: string, zoneId?: string): Promise<string> {
  const vehicle = await prisma.vehicle.create({
    data: {
      plate: `SNP${String(customerSeq).padStart(3, "0")}${date.slice(8)}`,
      name: "Camión Snapshot",
      brand: "Toyota",
      model: "Dyna",
      capacityUnits: 60,
      createdById: (await prisma.user.findUniqueOrThrow({ where: { username: ADMIN_USERNAME } }))
        .id,
    },
  });
  const route = await request(server())
    .post("/api/v1/routes")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ driverId, date, vehicleId: vehicle.id, ...(zoneId !== undefined ? { zoneId } : {}) })
    .expect(201);
  return route.body.id;
}

async function addStop(routeId: string, body: Record<string, unknown>): Promise<string> {
  const stop = await request(server())
    .post(`/api/v1/routes/${routeId}/stops`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send(body)
    .expect(201);
  return stop.body.id;
}

function snapshot(token: string, query: Record<string, string> = {}) {
  return request(server())
    .get("/api/v1/sync/route-snapshot")
    .query(query)
    .set("Authorization", `Bearer ${token}`);
}

type SnapshotLocation = {
  id: string;
  onRoute: boolean;
  debtBalance: string;
  containerBalances: { containerType: { id: string }; quantity: number }[];
  loanedAccessories: { product: { id: string }; quantity: number }[];
  prices: { product: { id: string }; price: string; source: string }[];
};

function locationIn(body: { locations: SnapshotLocation[] }, id: string) {
  return body.locations.find((location) => location.id === id);
}

beforeAll(async () => {
  ctx = await startTestApp();
  prisma = ctx.app.get(PrismaService);
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  const driverA = await createDriver("chofer-snapshot-a");
  const driverB = await createDriver("chofer-snapshot-b");
  const driverC = await createDriver("chofer-snapshot-c");
  driverAToken = driverA.token;
  driverBToken = driverB.token;
  driverCToken = driverC.token;

  const containerTypeId = (
    await prisma.containerType.findFirstOrThrow({ where: { name: "Con caño" } })
  ).id;
  refillProductId = (
    await prisma.product.findFirstOrThrow({ where: { name: "Recarga 20L con caño" } })
  ).id;
  const accessory = await request(server())
    .post("/api/v1/products")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "Dispensador Snapshot", type: "ACCESSORY", listPrice: "30.00" })
    .expect(201);
  accessoryId = accessory.body.id;
  await request(server())
    .post(`/api/v1/accessories/${accessoryId}/entries`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ quantity: 5 })
    .expect(201);

  const zoneA = await createZone("Zona Snapshot A");
  const zoneB = await createZone("Zona Snapshot B");
  ({ customerId: orderedCustomerId, locationId: orderedLocationId } = await createCustomer(zoneA));
  ({ customerId: soldCustomerId, locationId: soldLocationId } = await createCustomer(zoneA));
  ({ locationId: zoneOnlyLocationId } = await createCustomer(zoneA));
  ({ locationId: otherRouteLocationId } = await createCustomer(zoneB));
  ({ locationId: nearLocationId } = await createCustomer(undefined, NEAR_POSITION));
  ({ locationId: farLocationId } = await createCustomer(undefined, FAR_POSITION));

  // Lo pactado con el cliente del pedido, y un dispensador prestado a su local.
  await request(server())
    .post(`/api/v1/customers/${orderedCustomerId}/prices`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ productId: refillProductId, price: "7.00" })
    .expect(201);
  await request(server())
    .post(`/api/v1/customer-locations/${orderedLocationId}/accessories/loans`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ productId: accessoryId, quantity: 1 })
    .expect(201);

  // La ruta del chofer A: en curso, con un pedido (3 recargas y un
  // dispensador) y una venta en ruta que se entrega al fiado por la cola.
  routeAId = await createRoute(driverA.id, "2027-03-01", zoneA);
  const order = await request(server())
    .post("/api/v1/orders")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      customerId: orderedCustomerId,
      deliveryDate: "2027-03-01",
      items: [
        { productId: refillProductId, quantity: 3, unitPrice: "7.00" },
        { productId: accessoryId, quantity: 1, unitPrice: "30.00" },
      ],
    })
    .expect(201);
  await addStop(routeAId, { origin: "ORDER", orderId: order.body.id });
  const soldStopId = await addStop(routeAId, { origin: "VAN_SALE", locationId: soldLocationId });
  const batch = await request(server())
    .post("/api/v1/production-batches")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      code: "LOTE-SNAPSHOT-1",
      date: "2026-08-01",
      items: [{ containerTypeId, producedQty: 10 }],
    })
    .expect(201);
  await request(server())
    .post(`/api/v1/routes/${routeAId}/loads`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ batchItemId: batch.body.items[0].id, quantity: 10 })
    .expect(201);
  await request(server())
    .patch(`/api/v1/routes/${routeAId}/start`)
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200);
  const delivered = await request(server())
    .post("/api/v1/sync/operations")
    .set("Authorization", `Bearer ${driverAToken}`)
    .send({
      operations: [
        {
          id: randomUUID(),
          type: "STOP_MARK",
          version: 1,
          clientTimestamp: new Date().toISOString(),
          payload: {
            routeId: routeAId,
            stopId: soldStopId,
            status: "DELIVERED",
            items: [{ productId: refillProductId, quantity: 2 }],
          },
        },
      ],
    })
    .expect(200);
  expect(delivered.body.results[0].status).toBe("APPLIED");

  // La del chofer B: otra zona, planificada para otro día.
  routeBId = await createRoute(driverB.id, "2027-03-02", zoneB);
  await addStop(routeBId, { origin: "VAN_SALE", locationId: otherRouteLocationId });

  // La del chofer C: planificada para HOY, sin zona.
  routeCId = await createRoute(driverC.id, LIMA_DAY.format(new Date()));
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("GET /api/v1/sync/route-snapshot (integration)", () => {
  test("el chofer lee lo de los locales de su ruta y no lo de un local de otra ruta", async () => {
    const response = await snapshot(driverAToken).expect(200);

    expect(response.body.route.id).toBe(routeAId);
    const ids = response.body.locations.map((location: SnapshotLocation) => location.id);
    expect(ids).toEqual(expect.arrayContaining([orderedLocationId, soldLocationId]));
    expect(ids).not.toContain(otherRouteLocationId);
    expect(locationIn(response.body, orderedLocationId)?.onRoute).toBe(true);

    const ordered = locationIn(response.body, orderedLocationId)!;
    expect(ordered.loanedAccessories).toEqual([
      { product: { id: accessoryId, name: "Dispensador Snapshot" }, quantity: 1 },
    ]);
    expect(ordered.prices).toContainEqual({
      product: { id: refillProductId, name: "Recarga 20L con caño" },
      price: "7.00",
      source: "CUSTOMER",
    });
    // El otro cliente no tiene precio pactado: el de lista, no el del vecino.
    const sold = locationIn(response.body, soldLocationId)!;
    expect(sold.prices.find((price) => price.product.id === refillProductId)?.source).toBe("LIST");

    const [order] = response.body.orders;
    expect(order.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productType: "REFILL", quantity: 3, unitPrice: "7.00" }),
        expect.objectContaining({ productType: "ACCESSORY", quantity: 1, unitPrice: "30.00" }),
      ]),
    );
    expect(response.body.truckStock[0]).toMatchObject({ loaded: 10, onBoard: 8 });
    expect(response.body.paymentMethods.map((method: { name: string }) => method.name)).toContain(
      "Efectivo",
    );
  });

  test("la deuda y los envases coinciden con los de la ficha del cliente", async () => {
    const response = await snapshot(driverAToken).expect(200);
    const sold = locationIn(response.body, soldLocationId)!;

    const customer = await request(server())
      .get(`/api/v1/customers/${soldCustomerId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const balances = await request(server())
      .get("/api/v1/container-balances")
      .query({ customerId: soldCustomerId })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(sold.debtBalance).toBe("16.00");
    expect(sold.debtBalance).toBe(customer.body.debtBalance);
    expect(
      sold.containerBalances.map(({ containerType, quantity }) => [containerType.id, quantity]),
    ).toEqual(
      balances.body.data[0].containers.map(
        ({ containerType, quantity }: { containerType: { id: string }; quantity: number }) => [
          containerType.id,
          quantity,
        ],
      ),
    );
    expect(sold.containerBalances[0]?.quantity).toBe(2);
  });

  test("ofrece para venta en ruta los locales de la zona y, con posición, los de menos de 1 km", async () => {
    const withoutPosition = await snapshot(driverAToken).expect(200);
    expect(locationIn(withoutPosition.body, zoneOnlyLocationId)?.onRoute).toBe(false);
    expect(locationIn(withoutPosition.body, nearLocationId)).toBeUndefined();

    const withPosition = await snapshot(driverAToken, DRIVER_POSITION).expect(200);
    expect(locationIn(withPosition.body, nearLocationId)?.onRoute).toBe(false);
    expect(locationIn(withPosition.body, farLocationId)).toBeUndefined();
  });

  test("otro chofer recibe 403 por la ruta ajena y 404 si no tiene ruta hoy", async () => {
    await snapshot(driverBToken, { routeId: routeAId }).expect(403);
    // La suya es de otro día y no está en curso: el celular no la guarda.
    await snapshot(driverBToken).expect(404);
    await snapshot(driverBToken, { routeId: routeBId }).expect(404);
  });

  test("sin ruta en curso, la de hoy", async () => {
    const response = await snapshot(driverCToken).expect(200);
    expect(response.body.route.id).toBe(routeCId);
  });

  test("el ADMIN abre la de cualquiera para probarla", async () => {
    const response = await snapshot(adminToken, { routeId: routeBId }).expect(200);
    expect(locationIn(response.body, otherRouteLocationId)?.onRoute).toBe(true);
  });

  test("los endpoints de la oficina le siguen dando 403 al chofer", async () => {
    const officePaths = [
      "/api/v1/container-balances",
      `/api/v1/customers/${soldCustomerId}`,
      `/api/v1/customers/${soldCustomerId}/account-statement`,
      "/api/v1/accessories",
      `/api/v1/customer-locations/${orderedLocationId}/accessories`,
    ];
    for (const path of officePaths) {
      const response = await request(server())
        .get(path)
        .set("Authorization", `Bearer ${driverAToken}`);
      expect({ path, status: response.status }).toEqual({ path, status: 403 });
    }
  });
});
