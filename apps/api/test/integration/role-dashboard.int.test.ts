import request from "supertest";
import { OrderStatus, PaymentStatus, ProductType, RouteStatus, UserRole } from "@prisma/client";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

/** El día de Lima de un instante, como lo calcula el Panel. */
const limaDay = (at: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(at);
const TODAY = limaDay(new Date());
const YESTERDAY = limaDay(new Date(Date.now() - 24 * 60 * 60 * 1000));
/** Mediodía de Lima de un día: lejos de los bordes, cae en ese día y no en otro. */
const limaNoon = (day: string) => new Date(`${day}T12:00:00-05:00`);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

const MONEY_KEYS = ["salesToday", "paymentsToday", "totalDebt", "pendingPayments"];

let ctx: TestAppContext;
let prisma: PrismaService;
let adminToken: string;
let adminId: string;
const tokens: Record<string, string> = {};
let containerType: { id: string; name: string };

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

async function createUser(username: string, roles: UserRole[]): Promise<string> {
  const password = `${username}-pass-1234`;
  await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: `Usuario ${username}`, username, password, roles })
    .expect(201);
  return login(username, password);
}

async function dashboardOf(token: string) {
  const response = await request(server())
    .get("/api/v1/reports/dashboard")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);
  return response.body;
}

async function fill(token: string, date: string, producedQty: number) {
  await request(server())
    .post("/api/v1/production-batches")
    .set("Authorization", `Bearer ${token}`)
    .send({ date, items: [{ containerTypeId: containerType.id, producedQty }] })
    .expect(201);
}

async function plantInventory(state: string): Promise<number> {
  const response = await request(server())
    .get("/api/v1/container-movements/inventory")
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200);
  return response.body.find(
    (row: { containerTypeId: string; state: string }) =>
      row.containerTypeId === containerType.id && row.state === state,
  ).quantity;
}

const lineOf = (lines: Array<{ containerType: { id: string }; quantity: number }>) =>
  lines.find((line) => line.containerType.id === containerType.id)?.quantity;

beforeAll(async () => {
  ctx = await startTestApp();
  prisma = ctx.app.get(PrismaService);
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  adminId = (await prisma.user.findUniqueOrThrow({ where: { username: ADMIN_USERNAME } })).id;
  containerType = await prisma.containerType.findFirstOrThrow({
    where: { name: "Con caño", active: true },
    select: { id: true, name: true },
  });

  tokens.seller = await createUser("panel-vendedor", [UserRole.SELLER]);
  tokens.supervisor = await createUser("panel-supervisor", [UserRole.PLANT_SUPERVISOR]);
  tokens.operatorA = await createUser("panel-operador-a", [UserRole.PLANT_OPERATOR]);
  tokens.operatorB = await createUser("panel-operador-b", [UserRole.PLANT_OPERATOR]);
  tokens.sellerOperator = await createUser("panel-vendedor-operador", [
    UserRole.SELLER,
    UserRole.PLANT_OPERATOR,
  ]);
  tokens.supervisorOperator = await createUser("panel-supervisor-operador", [
    UserRole.PLANT_SUPERVISOR,
    UserRole.PLANT_OPERATOR,
  ]);
  tokens.driver = await createUser("panel-chofer", [UserRole.DRIVER]);

  // Vacíos en planta para poder llenar sin dejar el inventario en negativo.
  await request(server())
    .post("/api/v1/container-movements")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      type: "FLEET_ENTRY",
      containerTypeId: containerType.id,
      quantity: 100,
      toState: "EMPTY_AT_PLANT",
    })
    .expect(201);

  // Llenadas de dos días: las de ayer no son «del día».
  await fill(tokens.operatorA, YESTERDAY, 5);
  await fill(tokens.operatorA, TODAY, 12);
  await fill(tokens.operatorB, TODAY, 28);
  await fill(tokens.supervisorOperator, TODAY, 3);

  // Maquila de un cliente, hoy y por la API: recibe 10, llena 6, devuelve 4
  // con Yape (pendiente) y 1 en efectivo (confirmado). Precio pactado S/ 2.50.
  const product = await request(server())
    .post("/api/v1/products")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Maquila Panel",
      type: ProductType.MAQUILA_SERVICE,
      containerTypeId: containerType.id,
      listPrice: "3.50",
    })
    .expect(201);
  const customer = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Bodega Panel",
      phone: "911000111",
      address: "Av. Panel 1",
      addressReference: "Frente al parque",
    })
    .expect(201);
  const customerId: string = customer.body.id;
  await request(server())
    .post(`/api/v1/customers/${customerId}/prices`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ productId: product.body.id, price: "2.50" })
    .expect(201);
  const yape = await prisma.paymentMethod.findFirstOrThrow({
    where: { name: { contains: "Yape" } },
  });
  const cash = await prisma.paymentMethod.findFirstOrThrow({
    where: { requiresConfirmation: false },
  });
  const maquila = (path: string, body: object) =>
    request(server())
      .post(`/api/v1/maquila/${path}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ customerId, containerTypeId: containerType.id, ...body })
      .expect(201);
  await maquila("receptions", { quantity: 10 });
  await maquila("fillings", { quantity: 6 });
  await maquila("returns", {
    quantity: 4,
    payment: { paymentMethodId: yape.id, amount: "10.00" },
  });
  await maquila("returns", {
    quantity: 1,
    payment: { paymentMethodId: cash.id, amount: "2.50" },
  });

  // Lo que la API no deja registrar con otra fecha, o ya anulado de entrada, se
  // inserta acá; la deuda materializada sigue a su libro como lo haría el
  // servicio. Ayer: una venta y un cobro que no son del día. Hoy: un saldo
  // inicial y una venta anulada, que no son ventas del día; un abono de
  // apertura y un cobro anulado, que no son cobros del día; y un Yape
  // pendiente pero anulado, que no está por confirmar.
  const location = await prisma.customerLocation.findFirstOrThrow({ where: { customerId } });
  const voided = {
    voidedAt: limaNoon(TODAY),
    voidedById: adminId,
    voidReason: "Mal anotado",
  };
  await prisma.$transaction([
    prisma.payment.create({
      data: {
        customerId,
        paymentMethodId: cash.id,
        paidAt: limaNoon(TODAY),
        confirmedAt: limaNoon(TODAY),
        amount: "9.00",
        status: PaymentStatus.CONFIRMED,
        isOpeningBalance: true,
        recordedById: adminId,
      },
    }),
    prisma.payment.create({
      data: {
        customerId,
        paymentMethodId: cash.id,
        paidAt: limaNoon(TODAY),
        confirmedAt: limaNoon(TODAY),
        amount: "7.00",
        status: PaymentStatus.CONFIRMED,
        recordedById: adminId,
        ...voided,
      },
    }),
    prisma.payment.create({
      data: {
        customerId,
        paymentMethodId: yape.id,
        paidAt: limaNoon(TODAY),
        amount: "4.00",
        status: PaymentStatus.PENDING,
        recordedById: adminId,
        ...voided,
      },
    }),
    prisma.sale.create({
      data: {
        locationId: location.id,
        soldAt: limaNoon(YESTERDAY),
        total: "100.00",
        recordedById: adminId,
      },
    }),
    prisma.payment.create({
      data: {
        customerId,
        paymentMethodId: cash.id,
        paidAt: limaNoon(YESTERDAY),
        confirmedAt: limaNoon(YESTERDAY),
        amount: "40.00",
        status: PaymentStatus.CONFIRMED,
        recordedById: adminId,
      },
    }),
    prisma.sale.create({
      data: {
        locationId: location.id,
        soldAt: limaNoon(TODAY),
        total: "30.00",
        isOpeningBalance: true,
        recordedById: adminId,
      },
    }),
    prisma.sale.create({
      data: {
        locationId: location.id,
        soldAt: limaNoon(TODAY),
        total: "50.00",
        recordedById: adminId,
        ...voided,
      },
    }),
    // +100 −40 +30 −9: lo que mueven las filas vivas de arriba.
    prisma.customer.update({
      where: { id: customerId },
      data: { debtBalance: { increment: "81.00" } },
    }),
  ]);

  // Otro cliente con saldo a favor: no descuenta la deuda de nadie.
  const inCredit = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Bodega A Favor",
      phone: "911000222",
      address: "Av. Panel 2",
      addressReference: "Esquina",
    })
    .expect(201);
  await prisma.$transaction([
    prisma.payment.create({
      data: {
        customerId: inCredit.body.id,
        paymentMethodId: cash.id,
        paidAt: limaNoon(YESTERDAY),
        confirmedAt: limaNoon(YESTERDAY),
        amount: "25.00",
        status: PaymentStatus.CONFIRMED,
        recordedById: adminId,
      },
    }),
    prisma.customer.update({
      where: { id: inCredit.body.id },
      data: { debtBalance: { decrement: "25.00" } },
    }),
  ]);

  // Pedidos de dos días: hoy uno vivo y uno anulado; ayer uno vivo y uno no entregado.
  const order = (deliveryDay: string, status: OrderStatus) =>
    prisma.order.create({
      data: {
        locationId: location.id,
        deliveryDate: asDate(deliveryDay),
        status,
        createdById: adminId,
      },
    });
  await order(TODAY, OrderStatus.PENDING);
  await order(TODAY, OrderStatus.CANCELLED);
  await order(YESTERDAY, OrderStatus.PENDING);
  await order(YESTERDAY, OrderStatus.FAILED);
  // Un no entregado de ayer ya reprogramado para hoy: no cuenta como no entregado.
  const rescheduled = await order(YESTERDAY, OrderStatus.FAILED);
  await prisma.order.create({
    data: {
      locationId: location.id,
      deliveryDate: asDate(TODAY),
      status: OrderStatus.PENDING,
      rescheduledFromOrderId: rescheduled.id,
      createdById: adminId,
    },
  });

  // Una ruta en curso y una planificada.
  const driver = await prisma.user.findUniqueOrThrow({ where: { username: "panel-chofer" } });
  await prisma.route.create({
    data: {
      date: asDate(TODAY),
      driverId: driver.id,
      status: RouteStatus.IN_PROGRESS,
      createdById: adminId,
    },
  });
  await prisma.route.create({
    data: {
      date: asDate(TODAY),
      driverId: adminId,
      status: RouteStatus.PLANNED,
      createdById: adminId,
    },
  });
}, 240000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("Panel por rol — GET /reports/dashboard", () => {
  test("el administrador recibe ventas y cobros del día, la deuda total y las rutas en curso", async () => {
    const panel = await dashboardOf(adminToken);
    const debtReport = await request(server())
      .get("/api/v1/reports/debt")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(panel.today).toBe(TODAY);
    // 10.00 + 2.50 de maquila; ni la de ayer, ni el saldo inicial, ni la anulada.
    expect(panel.salesToday).toBe("12.50");
    // Solo el efectivo de hoy: el Yape está pendiente y el cobro de 40 fue ayer.
    expect(panel.paymentsToday).toBe("2.50");
    expect(panel.totalDebt).toBe(debtReport.body.total);
    expect(panel.routesInProgress).toBe(1);
    expect(panel).not.toHaveProperty("ordersToday");
    expect(panel).not.toHaveProperty("plantStock");
    expect(panel).not.toHaveProperty("myFillingsToday");
  });

  test("el vendedor recibe pedidos del día, no entregados, rutas en curso y cobros por confirmar", async () => {
    const panel = await dashboardOf(tokens.seller);

    // El vivo de hoy y el reprogramado para hoy; ni el anulado ni los de ayer.
    expect(panel.ordersToday).toBe(2);
    expect(panel.undeliveredOrders).toBe(1);
    expect(panel.routesInProgress).toBe(1);
    expect(panel.pendingPayments).toEqual({ count: 1, amount: "10.00" });
    expect(panel).not.toHaveProperty("salesToday");
    expect(panel).not.toHaveProperty("totalDebt");
    expect(panel).not.toHaveProperty("producedToday");
  });

  test("el supervisor recibe producción del día, stock en planta y maquila, y ningún monto", async () => {
    const panel = await dashboardOf(tokens.supervisor);

    // 12 + 28 + 3 de hoy; las 5 de ayer no.
    expect(lineOf(panel.producedToday)).toBe(43);
    const stock = panel.plantStock.find(
      (row: { containerType: { id: string } }) => row.containerType.id === containerType.id,
    );
    expect(stock.empty).toBe(await plantInventory("EMPTY_AT_PLANT"));
    expect(stock.full).toBe(await plantInventory("FULL_AT_PLANT"));
    expect(panel.maquilaPending).toEqual({ emptyToFill: 4, fullToReturn: 1 });
    for (const key of [...MONEY_KEYS, "routesInProgress", "ordersToday", "myFillingsToday"]) {
      expect(panel).not.toHaveProperty(key);
    }
    expect(JSON.stringify(panel)).not.toMatch(/"\d+\.\d{2}"/);
  });

  test("dos operadores que llenan el mismo día: cada uno recibe solo lo suyo, sin montos", async () => {
    const panelA = await dashboardOf(tokens.operatorA);
    const panelB = await dashboardOf(tokens.operatorB);

    expect(lineOf(panelA.myFillingsToday)).toBe(12);
    expect(lineOf(panelB.myFillingsToday)).toBe(28);
    const empty = await plantInventory("EMPTY_AT_PLANT");
    expect(lineOf(panelA.emptyToFill)).toBe(empty);
    for (const panel of [panelA, panelB]) {
      for (const key of [...MONEY_KEYS, "producedToday", "plantStock", "maquilaPending"]) {
        expect(panel).not.toHaveProperty(key);
      }
      expect(JSON.stringify(panel)).not.toMatch(/"\d+\.\d{2}"/);
    }
  });

  test("vendedor y operador a la vez recibe la suma de los dos resúmenes", async () => {
    const panel = await dashboardOf(tokens.sellerOperator);

    expect(panel.ordersToday).toBe(2);
    expect(panel.pendingPayments).toEqual({ count: 1, amount: "10.00" });
    expect(panel.myFillingsToday).toEqual([]);
    expect(lineOf(panel.emptyToFill)).toBe(await plantInventory("EMPTY_AT_PLANT"));
    expect(panel).not.toHaveProperty("salesToday");
    expect(panel).not.toHaveProperty("plantStock");
  });

  test("supervisor y operador a la vez: los vacíos viajan una vez, en el stock de planta", async () => {
    const panel = await dashboardOf(tokens.supervisorOperator);

    expect(lineOf(panel.myFillingsToday)).toBe(3);
    expect(lineOf(panel.producedToday)).toBe(43);
    expect(panel.plantStock.length).toBeGreaterThan(0);
    expect(panel).not.toHaveProperty("emptyToFill");
  });

  test("el chofer no tiene Panel de oficina ni de planta", async () => {
    await request(server())
      .get("/api/v1/reports/dashboard")
      .set("Authorization", `Bearer ${tokens.driver}`)
      .expect(403);
  });
});
