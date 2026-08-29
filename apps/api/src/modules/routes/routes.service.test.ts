import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  ContainerMovementType,
  ContainerState,
  OrderStatus,
  RouteStatus,
  StopOrigin,
  StopStatus,
  UserRole,
} from "@prisma/client";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ContainerMovementsService } from "../container-movements/container-movements.service.js";
import { SalesService } from "../sales/sales.service.js";
import type { RegisterStopDeliveryResult } from "../sales/sales.service.js";
import { RoutesService } from "./routes.service.js";
import type { RouteActor } from "./routes.service.js";
import { DEFAULT_LIMIT, DEFAULT_PAGE } from "./dto/list-routes-query.dto.js";

// Gherkin quoted from spec §2.4, HU-10 (this PR covers only the skeleton —
// creating the route and its stops; FIFO cargo and the pedido -> ON_ROUTE
// transition belong to the loading PR that follows):
// "Dado pedidos pendientes y stock de llenos por lote, cuando creo la ruta
// con sus paradas y carga, entonces la carga se descuenta comenzando por el
// lote más antiguo (FIFO) y los pedidos asignados pasan a «en ruta»."

const ROUTE_ID = "11111111-1111-4111-8111-111111111111";
const DRIVER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_DRIVER_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const SELLER_ID = "55555555-5555-4555-8555-555555555555";
const ZONE_ID = "66666666-6666-4666-8666-666666666666";
const LOCATION_ID = "77777777-7777-4777-8777-777777777777";
const CUSTOMER_ID = "7c7c7c7c-7c7c-47c7-87c7-7c7c7c7c7c7c";
const ORDER_ID = "88888888-8888-4888-8888-888888888888";
const STOP_ID = "99999999-9999-4999-8999-999999999999";
const OTHER_STOP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN_STOP_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BATCH_ITEM_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONTAINER_TYPE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const BATCH_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LOAD_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const adminActor: RouteActor = { id: ADMIN_ID, roles: [UserRole.ADMIN] };
const sellerActor: RouteActor = { id: SELLER_ID, roles: [UserRole.SELLER] };
const driverActor: RouteActor = { id: DRIVER_ID, roles: [UserRole.DRIVER] };
const otherDriverActor: RouteActor = { id: OTHER_DRIVER_ID, roles: [UserRole.DRIVER] };

function buildRoute(overrides: Record<string, unknown> = {}) {
  return {
    id: ROUTE_ID,
    date: new Date(Date.UTC(2026, 7, 25)),
    driverId: DRIVER_ID,
    zoneId: ZONE_ID,
    status: RouteStatus.PLANNED,
    createdById: ADMIN_ID,
    createdAt: new Date("2026-08-20T15:00:00.000Z"),
    driver: { id: DRIVER_ID, name: "Juan Chofer" },
    zone: { id: ZONE_ID, name: "Zona Norte" },
    stops: [],
    ...overrides,
  };
}

function buildStop(overrides: Record<string, unknown> = {}) {
  return {
    id: STOP_ID,
    routeId: ROUTE_ID,
    locationId: LOCATION_ID,
    position: 1,
    origin: StopOrigin.VAN_SALE,
    orderId: null,
    status: StopStatus.PENDING,
    failureReason: null,
    location: {
      id: LOCATION_ID,
      name: "Principal",
      address: "Av. Los Alamos 452",
      customer: { id: CUSTOMER_ID, name: "Bodega Santa Rosa" },
    },
    ...overrides,
  };
}

/** create() selects `active` and the role assignments; the mock must carry both. */
function activeDriver(overrides: Record<string, unknown> = {}) {
  return {
    id: DRIVER_ID,
    name: "Juan Chofer",
    active: true,
    roles: [{ role: { name: UserRole.DRIVER } }],
    ...overrides,
  };
}

function buildBatchItem(overrides: Record<string, unknown> = {}) {
  return { id: BATCH_ITEM_ID, batchId: BATCH_ID, containerTypeId: CONTAINER_TYPE_ID, ...overrides };
}

function buildLoad(overrides: Record<string, unknown> = {}) {
  return {
    id: LOAD_ID,
    routeId: ROUTE_ID,
    batchItemId: BATCH_ITEM_ID,
    quantity: 50,
    batchItem: {
      id: BATCH_ITEM_ID,
      containerTypeId: CONTAINER_TYPE_ID,
      containerType: { id: CONTAINER_TYPE_ID, name: "Bidón 20L" },
      batchId: BATCH_ID,
      batch: { id: BATCH_ID, code: "L-001" },
    },
    ...overrides,
  };
}

function buildPrismaMock() {
  return {
    route: {
      create: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
      count: jest.fn<() => Promise<unknown>>(),
      updateMany: jest.fn<() => Promise<unknown>>(),
    },
    routeStop: {
      create: jest.fn<() => Promise<unknown>>(),
      // Solo lo usa la rama desambiguadora de `finish`, para decir cuántas
      // paradas quedaron sin resolver.
      count: jest.fn<() => Promise<unknown>>(),
      delete: jest.fn<() => Promise<unknown>>(),
      findFirst: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
      findUniqueOrThrow: jest.fn<() => Promise<unknown>>(),
      updateMany: jest.fn<() => Promise<unknown>>(),
      update: jest.fn<() => Promise<unknown>>(),
    },
    batchItem: {
      findUnique: jest.fn<() => Promise<unknown>>(),
      // Solo lo usa el guard de FIFO de addLoad; cada test de carga decide
      // cuál es el lote más antiguo con stock.
      findFirst: jest.fn<() => Promise<unknown>>(),
      updateMany: jest.fn<() => Promise<unknown>>(),
      update: jest.fn<() => Promise<unknown>>(),
    },
    routeLoad: {
      create: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
      findFirst: jest.fn<() => Promise<unknown>>(),
      delete: jest.fn<() => Promise<unknown>>(),
    },
    user: { findUnique: jest.fn<() => Promise<unknown>>() },
    zone: { findUnique: jest.fn<() => Promise<unknown>>() },
    order: {
      findUnique: jest.fn<() => Promise<unknown>>(),
      // El pedido sigue a su parada (HU-10 E1): `addStop` lo mueve con un
      // `updateMany` guardado por PENDING, y las otras tres operaciones con
      // `update`.
      updateMany: jest.fn<() => Promise<unknown>>(),
      update: jest.fn<() => Promise<unknown>>(),
    },
    customerLocation: { findUnique: jest.fn<() => Promise<unknown>>() },
    // Only reached by throwAlreadyMarkedConflict, to name the date/who of an
    // already-DELIVERED stop; defaults to "no sale on file" so every markStop
    // test not concerned with that message keeps working unmodified.
    sale: { findFirst: jest.fn<() => Promise<unknown>>() },
    $transaction: jest.fn<(arg: unknown) => Promise<unknown>>(),
  };
}

function buildContainerMovementsMock() {
  return { createWithinTransaction: jest.fn<() => Promise<unknown>>() };
}

function buildSalesMock() {
  return { registerStopDeliveryWithinTransaction: jest.fn<() => Promise<unknown>>() };
}

function buildDeliveryResult(
  overrides: Partial<RegisterStopDeliveryResult> = {},
): RegisterStopDeliveryResult {
  return {
    sale: { id: "sale-1", total: "12.50", creditLimitExceeded: false },
    payment: null,
    containerBalances: [],
    ...overrides,
  };
}

describe("RoutesService", () => {
  let service: RoutesService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let containerMovements: ReturnType<typeof buildContainerMovementsMock>;
  let sales: ReturnType<typeof buildSalesMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    // create()'s try/catch and addStop()/addLoad()/removeLoad() pass a
    // callback; findAll()/reorderStops() pass an array.
    prisma.$transaction.mockImplementation((arg) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma),
    );
    prisma.sale.findFirst.mockResolvedValue(null);
    // Por defecto no quedan paradas pendientes: los tests de `finish` que van
    // sobre esa rama lo dicen explícitamente.
    prisma.routeStop.count.mockResolvedValue(0);
    // Por defecto, el lote pedido ES el más antiguo con stock: así los tests
    // de carga que no van sobre el FIFO no tienen que decirlo cada vez.
    prisma.batchItem.findFirst.mockResolvedValue({
      id: BATCH_ITEM_ID,
      batch: { code: "LOTE-001" },
    });
    containerMovements = buildContainerMovementsMock();
    sales = buildSalesMock();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RoutesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ContainerMovementsService, useValue: containerMovements },
        { provide: SalesService, useValue: sales },
      ],
    }).compile();

    service = moduleRef.get(RoutesService);
  });

  describe("create", () => {
    it("plans a route, born PLANNED, for an active driver", async () => {
      prisma.user.findUnique.mockResolvedValue(activeDriver());
      prisma.route.create.mockResolvedValue(buildRoute());

      const result = await service.create(
        { driverId: DRIVER_ID, date: "2026-08-25", zoneId: ZONE_ID },
        ADMIN_ID,
      );

      expect(result.status).toBe(RouteStatus.PLANNED);
      expect(result.date).toBe("2026-08-25");
      expect(result.createdById).toBe(ADMIN_ID);
    });

    it("refuses a driver id that does not exist", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ driverId: DRIVER_ID, date: "2026-08-25" }, ADMIN_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.route.create).not.toHaveBeenCalled();
    });

    it("refuses a user who does not have the DRIVER role", async () => {
      prisma.user.findUnique.mockResolvedValue(
        activeDriver({ roles: [{ role: { name: UserRole.SELLER } }] }),
      );

      await expect(
        service.create({ driverId: DRIVER_ID, date: "2026-08-25" }, ADMIN_ID),
      ).rejects.toThrow("no tiene el rol de chofer");
      expect(prisma.route.create).not.toHaveBeenCalled();
    });

    it("refuses a deactivated driver", async () => {
      prisma.user.findUnique.mockResolvedValue(activeDriver({ active: false }));

      await expect(
        service.create({ driverId: DRIVER_ID, date: "2026-08-25" }, ADMIN_ID),
      ).rejects.toThrow("desactivado");
      expect(prisma.route.create).not.toHaveBeenCalled();
    });

    it("refuses an unknown zone", async () => {
      prisma.user.findUnique.mockResolvedValue(activeDriver());
      prisma.zone.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ driverId: DRIVER_ID, date: "2026-08-25", zoneId: ZONE_ID }, ADMIN_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.route.create).not.toHaveBeenCalled();
    });

    it("translates a duplicate driver+date (P2002) into a clear message, not a raw constraint error", async () => {
      prisma.user.findUnique.mockResolvedValue(activeDriver());
      prisma.route.create.mockRejectedValue(
        Object.assign(new Error("Unique constraint"), { code: "P2002" }),
      );

      const attempt = service.create({ driverId: DRIVER_ID, date: "2026-08-25" }, ADMIN_ID);

      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create({ driverId: DRIVER_ID, date: "2026-08-25" }, ADMIN_ID),
      ).rejects.toThrow("ya tiene una ruta planificada");
    });

    // La web muestra el mensaje del backend tal cual: si acá sale en ISO, el
    // usuario ve dos formatos de fecha en la misma pantalla.
    it("escribe la fecha del mensaje como la lee una persona, no como viaja en el cable", async () => {
      prisma.user.findUnique.mockResolvedValue(activeDriver());
      prisma.route.create.mockRejectedValue(
        Object.assign(new Error("Unique constraint"), { code: "P2002" }),
      );

      const attempt = service.create({ driverId: DRIVER_ID, date: "2026-08-25" }, ADMIN_ID);

      await expect(attempt).rejects.toThrow("para el 25/08/2026");
      await expect(
        service.create({ driverId: DRIVER_ID, date: "2026-08-25" }, ADMIN_ID),
      ).rejects.not.toThrow("2026-08-25");
    });
  });

  describe("findAll", () => {
    it("paginates for a privileged actor", async () => {
      prisma.route.count.mockResolvedValue(3);
      prisma.route.findMany.mockResolvedValue([buildRoute()]);

      const result = await service.findAll(
        { page: DEFAULT_PAGE, limit: DEFAULT_LIMIT },
        adminActor,
      );

      expect(prisma.route.count).toHaveBeenCalledWith({ where: {} });
      expect(result.total).toBe(3);
    });

    it("scopes a DRIVER's list to their own routes, ignoring a different ?driverId", async () => {
      prisma.route.count.mockResolvedValue(1);
      prisma.route.findMany.mockResolvedValue([buildRoute()]);

      await service.findAll(
        { page: DEFAULT_PAGE, limit: DEFAULT_LIMIT, driverId: OTHER_DRIVER_ID },
        driverActor,
      );

      expect(prisma.route.count).toHaveBeenCalledWith({ where: { driverId: DRIVER_ID } });
    });

    it("does not scope a SELLER's list", async () => {
      prisma.route.count.mockResolvedValue(1);
      prisma.route.findMany.mockResolvedValue([buildRoute()]);

      await service.findAll(
        { page: DEFAULT_PAGE, limit: DEFAULT_LIMIT, driverId: OTHER_DRIVER_ID },
        sellerActor,
      );

      expect(prisma.route.count).toHaveBeenCalledWith({ where: { driverId: OTHER_DRIVER_ID } });
    });

    it("filters by date, zone and status", async () => {
      prisma.route.count.mockResolvedValue(0);
      prisma.route.findMany.mockResolvedValue([]);

      await service.findAll(
        {
          page: DEFAULT_PAGE,
          limit: DEFAULT_LIMIT,
          date: "2026-08-25",
          zoneId: ZONE_ID,
          status: RouteStatus.PLANNED,
        },
        adminActor,
      );

      expect(prisma.route.count).toHaveBeenCalledWith({
        where: {
          date: new Date(Date.UTC(2026, 7, 25)),
          zoneId: ZONE_ID,
          status: RouteStatus.PLANNED,
        },
      });
    });
  });

  describe("findOne", () => {
    it("returns the route with its stops", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ stops: [buildStop()] }));

      const result = await service.findOne(ROUTE_ID, adminActor);

      expect(result.id).toBe(ROUTE_ID);
      expect(result.stops).toHaveLength(1);
    });

    // Sin el cliente, toda parada se lee "Principal": el nombre que lleva la
    // locación principal de cualquier cliente.
    it("carries the location's customer, so a stop names who it is for", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ stops: [buildStop()] }));

      const result = await service.findOne(ROUTE_ID, adminActor);

      expect(result.stops[0]?.location.customer).toEqual({
        id: CUSTOMER_ID,
        name: "Bodega Santa Rosa",
      });
      expect(prisma.route.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            stops: expect.objectContaining({
              include: {
                location: {
                  select: {
                    id: true,
                    name: true,
                    address: true,
                    customer: { select: { id: true, name: true } },
                  },
                },
              },
            }) as unknown,
          }) as unknown,
        }),
      );
    });

    it("throws NotFoundException for an unknown id", async () => {
      prisma.route.findUnique.mockResolvedValue(null);

      await expect(service.findOne(ROUTE_ID, adminActor)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("lets the assigned driver see their own route", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());

      await expect(service.findOne(ROUTE_ID, driverActor)).resolves.toMatchObject({ id: ROUTE_ID });
    });

    it("refuses a driver looking at another driver's route", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());

      await expect(service.findOne(ROUTE_ID, otherDriverActor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("filters stops by stopStatus, so the office sees what's left to resolve", async () => {
      prisma.route.findUnique.mockResolvedValue(
        buildRoute({
          stops: [
            buildStop({ id: STOP_ID, status: StopStatus.DELIVERED }),
            buildStop({ id: OTHER_STOP_ID, status: StopStatus.PENDING }),
          ],
        }),
      );

      const result = await service.findOne(ROUTE_ID, adminActor, {
        stopStatus: StopStatus.PENDING,
      });

      expect(result.stops).toHaveLength(1);
      expect(result.stops[0]?.id).toBe(OTHER_STOP_ID);
    });
  });

  describe("start", () => {
    it("PLANNED -> IN_PROGRESS, guarding the status inside the WHERE clause", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.IN_PROGRESS }));
      prisma.route.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.start(ROUTE_ID, adminActor);

      expect(prisma.route.updateMany).toHaveBeenCalledWith({
        where: { id: ROUTE_ID, status: RouteStatus.PLANNED },
        data: { status: RouteStatus.IN_PROGRESS },
      });
      expect(result.status).toBe(RouteStatus.IN_PROGRESS);
    });

    it("refuses to start a route that is not PLANNED", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.IN_PROGRESS }));
      prisma.route.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.start(ROUTE_ID, adminActor)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.start(ROUTE_ID, adminActor)).rejects.toThrow(RouteStatus.IN_PROGRESS);
    });

    it("refuses to start a FINISHED route", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.FINISHED }));
      prisma.route.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.start(ROUTE_ID, adminActor)).rejects.toThrow(RouteStatus.FINISHED);
    });

    it("refuses a driver starting a route that isn't theirs", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());

      await expect(service.start(ROUTE_ID, otherDriverActor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.route.updateMany).not.toHaveBeenCalled();
    });

    it("throws NotFoundException for an unknown route", async () => {
      prisma.route.findUnique.mockResolvedValue(null);

      await expect(service.start(ROUTE_ID, adminActor)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // Estos unitarios mockean `route.updateMany` y devuelven `{ count: 0 }` a
  // mano, así que NO pueden probar que la base rechace terminar con paradas
  // pendientes: lo único que fijan acá es la forma del WHERE y qué mensaje sale
  // de cada rama. La prueba de verdad es de integración, contra Postgres
  // (`routes.int.test.ts`).
  describe("finish", () => {
    it("IN_PROGRESS -> FINISHED, con «ninguna parada PENDING» dentro del WHERE", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.FINISHED }));
      prisma.route.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.finish(ROUTE_ID, adminActor);

      expect(prisma.route.updateMany).toHaveBeenCalledWith({
        where: {
          id: ROUTE_ID,
          status: RouteStatus.IN_PROGRESS,
          stops: { none: { status: StopStatus.PENDING } },
        },
        data: { status: RouteStatus.FINISHED },
      });
      expect(result.status).toBe(RouteStatus.FINISHED);
    });

    it("refuses to finish a route that is still PLANNED", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.PLANNED }));
      prisma.route.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.finish(ROUTE_ID, adminActor)).rejects.toThrow(RouteStatus.PLANNED);
    });

    it("refuses to finish an already FINISHED route", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.FINISHED }));
      prisma.route.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.finish(ROUTE_ID, adminActor)).rejects.toBeInstanceOf(ConflictException);
    });

    // La rama desambiguadora: la ruta SÍ está en curso, así que lo que sobró
    // son paradas, y el mensaje tiene que decir cuántas en vez de repetir el
    // de estado.
    it("con la ruta en curso, el 409 cuenta las paradas que faltan (singular)", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.IN_PROGRESS }));
      prisma.route.updateMany.mockResolvedValue({ count: 0 });
      prisma.routeStop.count.mockResolvedValue(1);

      await expect(service.finish(ROUTE_ID, adminActor)).rejects.toThrow(
        "No se puede terminar la ruta: queda 1 parada sin resolver. Cada parada tiene que quedar marcada (entregada o no entregada) o quitarse de la ruta.",
      );
      expect(prisma.routeStop.count).toHaveBeenCalledWith({
        where: { routeId: ROUTE_ID, status: StopStatus.PENDING },
      });
    });

    it("con la ruta en curso y varias paradas, el 409 va en plural y no nombra ningún enum", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.IN_PROGRESS }));
      prisma.route.updateMany.mockResolvedValue({ count: 0 });
      prisma.routeStop.count.mockResolvedValue(3);

      const attempt = service.finish(ROUTE_ID, adminActor);

      await expect(attempt).rejects.toThrow(
        "No se puede terminar la ruta: quedan 3 paradas sin resolver. Cada parada tiene que quedar marcada (entregada o no entregada) o quitarse de la ruta.",
      );
      await expect(service.finish(ROUTE_ID, adminActor)).rejects.not.toThrow(StopStatus.PENDING);
    });
  });

  describe("addStop", () => {
    it("ORDER origin: derives locationId from the pending order", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.PENDING,
        locationId: LOCATION_ID,
        routeStop: null,
      });
      prisma.routeStop.findFirst.mockResolvedValue(null);
      prisma.routeStop.create.mockResolvedValue(
        buildStop({ origin: StopOrigin.ORDER, orderId: ORDER_ID, position: 1 }),
      );
      // HU-10 E1: la asignación mueve el pedido a ON_ROUTE en la misma
      // transacción que crea la parada.
      prisma.order.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.addStop(
        ROUTE_ID,
        { origin: StopOrigin.ORDER, orderId: ORDER_ID },
        adminActor,
      );

      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: ORDER_ID, status: OrderStatus.PENDING },
        data: { status: OrderStatus.ON_ROUTE },
      });

      expect(prisma.routeStop.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            locationId: LOCATION_ID,
            orderId: ORDER_ID,
            position: 1,
          }),
        }),
      );
      expect(result.origin).toBe(StopOrigin.ORDER);
    });

    it("VAN_SALE origin: takes locationId directly and never touches an order", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.customerLocation.findUnique.mockResolvedValue({ id: LOCATION_ID });
      prisma.routeStop.findFirst.mockResolvedValue({ position: 2 });
      prisma.routeStop.create.mockResolvedValue(buildStop({ position: 3 }));

      await service.addStop(
        ROUTE_ID,
        { origin: StopOrigin.VAN_SALE, locationId: LOCATION_ID },
        adminActor,
      );

      expect(prisma.order.findUnique).not.toHaveBeenCalled();
      expect(prisma.routeStop.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ position: 3, orderId: null }) }),
      );
    });

    it("assigns position 1 to the first stop of a route", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.customerLocation.findUnique.mockResolvedValue({ id: LOCATION_ID });
      prisma.routeStop.findFirst.mockResolvedValue(null);
      prisma.routeStop.create.mockResolvedValue(buildStop({ position: 1 }));

      await service.addStop(
        ROUTE_ID,
        { origin: StopOrigin.VAN_SALE, locationId: LOCATION_ID },
        adminActor,
      );

      expect(prisma.routeStop.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ position: 1 }) }),
      );
    });

    it("rejects ORDER origin with no orderId", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());

      await expect(
        service.addStop(ROUTE_ID, { origin: StopOrigin.ORDER }, adminActor),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects VAN_SALE origin with no locationId", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());

      await expect(
        service.addStop(ROUTE_ID, { origin: StopOrigin.VAN_SALE }, adminActor),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects a VAN_SALE locationId that does not exist", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.customerLocation.findUnique.mockResolvedValue(null);

      await expect(
        service.addStop(
          ROUTE_ID,
          { origin: StopOrigin.VAN_SALE, locationId: LOCATION_ID },
          adminActor,
        ),
      ).rejects.toThrow(`La ubicación "${LOCATION_ID}" no existe`);
    });

    it("refuses an order that is not PENDING", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CANCELLED,
        locationId: LOCATION_ID,
        routeStop: null,
      });

      await expect(
        service.addStop(ROUTE_ID, { origin: StopOrigin.ORDER, orderId: ORDER_ID }, adminActor),
      ).rejects.toThrow("no está pendiente");
    });

    it("refuses an order already assigned to another stop", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.PENDING,
        locationId: LOCATION_ID,
        routeStop: { id: OTHER_STOP_ID },
      });

      await expect(
        service.addStop(ROUTE_ID, { origin: StopOrigin.ORDER, orderId: ORDER_ID }, adminActor),
      ).rejects.toThrow("ya está asignado a otra parada");
      expect(prisma.routeStop.create).not.toHaveBeenCalled();
    });

    it("translates a P2002 race on order_id into the same clear message", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.PENDING,
        locationId: LOCATION_ID,
        routeStop: null,
      });
      prisma.routeStop.findFirst.mockResolvedValue(null);
      prisma.routeStop.create.mockRejectedValue(
        Object.assign(new Error("Unique constraint"), { code: "P2002" }),
      );

      await expect(
        service.addStop(ROUTE_ID, { origin: StopOrigin.ORDER, orderId: ORDER_ID }, adminActor),
      ).rejects.toThrow("ya está asignado a otra parada");
    });

    it("refuses to add a stop to a FINISHED route", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.FINISHED }));

      await expect(
        service.addStop(
          ROUTE_ID,
          { origin: StopOrigin.VAN_SALE, locationId: LOCATION_ID },
          adminActor,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.routeStop.create).not.toHaveBeenCalled();
    });

    it("refuses a driver adding a stop to another driver's route", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());

      await expect(
        service.addStop(
          ROUTE_ID,
          { origin: StopOrigin.VAN_SALE, locationId: LOCATION_ID },
          otherDriverActor,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("removeStop", () => {
    it("deletes a PENDING stop and closes the gap its position left", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.routeStop.findFirst.mockResolvedValue(buildStop({ position: 2 }));

      await service.removeStop(ROUTE_ID, STOP_ID, adminActor);

      expect(prisma.routeStop.delete).toHaveBeenCalledWith({ where: { id: STOP_ID } });
      expect(prisma.routeStop.updateMany).toHaveBeenCalledWith({
        where: { routeId: ROUTE_ID, position: { gt: 2 } },
        data: { position: { decrement: 1 } },
      });
    });

    // Una parada resuelta tiene venta, movimientos y quizá cobro colgando:
    // borrarla sería editar el libro.
    it("refuses to remove a stop that was already delivered", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.IN_PROGRESS }));
      prisma.routeStop.findFirst.mockResolvedValue(buildStop({ status: StopStatus.DELIVERED }));

      await expect(service.removeStop(ROUTE_ID, STOP_ID, adminActor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.routeStop.delete).not.toHaveBeenCalled();
    });

    it("refuses to remove a stop from a FINISHED route", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.FINISHED }));

      await expect(service.removeStop(ROUTE_ID, STOP_ID, adminActor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.routeStop.delete).not.toHaveBeenCalled();
    });

    it("throws NotFoundException for a stop that does not belong to the route", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.routeStop.findFirst.mockResolvedValue(null);

      await expect(
        service.removeStop(ROUTE_ID, FOREIGN_STOP_ID, adminActor),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("refuses a driver removing a stop from another driver's route", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());

      await expect(service.removeStop(ROUTE_ID, STOP_ID, otherDriverActor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.routeStop.delete).not.toHaveBeenCalled();
    });
  });

  describe("markStop", () => {
    const deliveryItems = [{ productId: "product-1", quantity: 2 }];

    it("marks a PENDING stop DELIVERED, delegating the whole delivery to SalesService", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.IN_PROGRESS }));
      prisma.routeStop.updateMany.mockResolvedValue({ count: 1 });
      prisma.routeStop.findUniqueOrThrow.mockResolvedValue(
        buildStop({ status: StopStatus.DELIVERED }),
      );
      const delivery = buildDeliveryResult({
        sale: { id: "sale-1", total: "25.00", creditLimitExceeded: false },
      });
      sales.registerStopDeliveryWithinTransaction.mockResolvedValue(delivery);

      const result = await service.markStop(
        ROUTE_ID,
        STOP_ID,
        { status: StopStatus.DELIVERED, items: deliveryItems },
        driverActor,
      );

      expect(prisma.routeStop.updateMany).toHaveBeenCalledWith({
        where: { id: STOP_ID, routeId: ROUTE_ID, status: StopStatus.PENDING },
        data: { status: StopStatus.DELIVERED },
      });
      expect(sales.registerStopDeliveryWithinTransaction).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          routeId: ROUTE_ID,
          stopId: STOP_ID,
          locationId: LOCATION_ID,
          items: deliveryItems,
          containersReturned: [],
          recordedById: DRIVER_ID,
        }),
      );
      expect(result.status).toBe(StopStatus.DELIVERED);
      expect(result.sale).toEqual(delivery.sale);
    });

    it("rejects DELIVERED with no items", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.IN_PROGRESS }));

      await expect(
        service.markStop(ROUTE_ID, STOP_ID, { status: StopStatus.DELIVERED }, driverActor),
      ).rejects.toThrow("items");
      expect(prisma.routeStop.updateMany).not.toHaveBeenCalled();
    });

    it("rejects DELIVERED with an empty items array", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.IN_PROGRESS }));

      await expect(
        service.markStop(
          ROUTE_ID,
          STOP_ID,
          { status: StopStatus.DELIVERED, items: [] },
          driverActor,
        ),
      ).rejects.toThrow("items");
    });

    it("passes containersReturned, payment and priceOverrideAuthorizedById through", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.IN_PROGRESS }));
      prisma.routeStop.updateMany.mockResolvedValue({ count: 1 });
      prisma.routeStop.findUniqueOrThrow.mockResolvedValue(
        buildStop({ status: StopStatus.DELIVERED }),
      );
      sales.registerStopDeliveryWithinTransaction.mockResolvedValue(buildDeliveryResult());

      const containersReturned = [{ containerTypeId: CONTAINER_TYPE_ID, quantity: 1 }];
      const payment = { paymentMethodId: "pm-1", amount: "12.50" };
      await service.markStop(
        ROUTE_ID,
        STOP_ID,
        {
          status: StopStatus.DELIVERED,
          items: deliveryItems,
          containersReturned,
          payment,
          priceOverrideAuthorizedById: ADMIN_ID,
        },
        driverActor,
      );

      expect(sales.registerStopDeliveryWithinTransaction).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          containersReturned,
          payment,
          priceOverrideAuthorizedById: ADMIN_ID,
        }),
      );
    });

    it("rejects FAILED carrying delivery data", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.IN_PROGRESS }));

      await expect(
        service.markStop(
          ROUTE_ID,
          STOP_ID,
          { status: StopStatus.FAILED, failureReason: "x", items: deliveryItems },
          driverActor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.routeStop.updateMany).not.toHaveBeenCalled();
    });

    it("reports the date and who recorded it when a stop was already DELIVERED", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.IN_PROGRESS }));
      prisma.routeStop.updateMany.mockResolvedValue({ count: 0 });
      prisma.routeStop.findFirst.mockResolvedValue({ status: StopStatus.DELIVERED });
      prisma.sale.findFirst.mockResolvedValue({
        soldAt: new Date("2026-08-25T15:00:00.000Z"),
        recordedBy: { name: "Juan Chofer" },
      });

      await expect(
        service.markStop(
          ROUTE_ID,
          STOP_ID,
          { status: StopStatus.DELIVERED, items: deliveryItems },
          driverActor,
        ),
      ).rejects.toThrow("Juan Chofer");
      expect(sales.registerStopDeliveryWithinTransaction).not.toHaveBeenCalled();
    });

    it("marks a PENDING stop FAILED with a reason", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.IN_PROGRESS }));
      prisma.routeStop.updateMany.mockResolvedValue({ count: 1 });
      prisma.routeStop.findUniqueOrThrow.mockResolvedValue(
        buildStop({ status: StopStatus.FAILED, failureReason: "Cliente cerrado" }),
      );

      const result = await service.markStop(
        ROUTE_ID,
        STOP_ID,
        { status: StopStatus.FAILED, failureReason: "Cliente cerrado" },
        driverActor,
      );

      expect(result.failureReason).toBe("Cliente cerrado");
    });

    it("rejects FAILED with no reason", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.IN_PROGRESS }));

      await expect(
        service.markStop(ROUTE_ID, STOP_ID, { status: StopStatus.FAILED }, driverActor),
      ).rejects.toThrow("motivo");
      expect(prisma.routeStop.updateMany).not.toHaveBeenCalled();
    });

    it("rejects FAILED with a blank reason", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.IN_PROGRESS }));

      await expect(
        service.markStop(
          ROUTE_ID,
          STOP_ID,
          { status: StopStatus.FAILED, failureReason: "   " },
          driverActor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects DELIVERED carrying a failureReason", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.IN_PROGRESS }));

      await expect(
        service.markStop(
          ROUTE_ID,
          STOP_ID,
          { status: StopStatus.DELIVERED, failureReason: "no debería ir" },
          driverActor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.routeStop.updateMany).not.toHaveBeenCalled();
    });

    it("refuses to mark a stop on a route that is not IN_PROGRESS", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.PLANNED }));

      await expect(
        service.markStop(ROUTE_ID, STOP_ID, { status: StopStatus.DELIVERED }, driverActor),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("refuses to re-mark a stop that is no longer PENDING", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.IN_PROGRESS }));
      prisma.routeStop.updateMany.mockResolvedValue({ count: 0 });
      prisma.routeStop.findFirst.mockResolvedValue({ status: StopStatus.DELIVERED });

      await expect(
        service.markStop(
          ROUTE_ID,
          STOP_ID,
          { status: StopStatus.FAILED, failureReason: "x" },
          driverActor,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("throws NotFoundException for a stop that does not belong to the route", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.IN_PROGRESS }));
      prisma.routeStop.updateMany.mockResolvedValue({ count: 0 });
      prisma.routeStop.findFirst.mockResolvedValue(null);

      await expect(
        service.markStop(
          ROUTE_ID,
          STOP_ID,
          { status: StopStatus.DELIVERED, items: deliveryItems },
          driverActor,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(sales.registerStopDeliveryWithinTransaction).not.toHaveBeenCalled();
    });

    it("refuses a driver marking a stop on another driver's route", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.IN_PROGRESS }));

      await expect(
        service.markStop(ROUTE_ID, STOP_ID, { status: StopStatus.DELIVERED }, otherDriverActor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.routeStop.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("reorderStops", () => {
    it("reassigns positions 1..N in the requested order", async () => {
      prisma.route.findUnique.mockResolvedValueOnce(buildRoute()).mockResolvedValueOnce(
        buildRoute({
          stops: [buildStop({ id: OTHER_STOP_ID, position: 1 }), buildStop({ position: 2 })],
        }),
      );
      prisma.routeStop.findMany.mockResolvedValue([{ id: STOP_ID }, { id: OTHER_STOP_ID }]);

      await service.reorderStops(ROUTE_ID, { stopIds: [OTHER_STOP_ID, STOP_ID] }, adminActor);

      expect(prisma.routeStop.update).toHaveBeenCalledWith({
        where: { id: OTHER_STOP_ID },
        data: { position: 1 },
      });
      expect(prisma.routeStop.update).toHaveBeenCalledWith({
        where: { id: STOP_ID },
        data: { position: 2 },
      });
    });

    it("rejects an incomplete list (missing a stop)", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.routeStop.findMany.mockResolvedValue([{ id: STOP_ID }, { id: OTHER_STOP_ID }]);

      await expect(
        service.reorderStops(ROUTE_ID, { stopIds: [STOP_ID] }, adminActor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.routeStop.update).not.toHaveBeenCalled();
    });

    it("rejects a list with an id from another route", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.routeStop.findMany.mockResolvedValue([{ id: STOP_ID }, { id: OTHER_STOP_ID }]);

      await expect(
        service.reorderStops(ROUTE_ID, { stopIds: [STOP_ID, FOREIGN_STOP_ID] }, adminActor),
      ).rejects.toThrow(FOREIGN_STOP_ID);
      expect(prisma.routeStop.update).not.toHaveBeenCalled();
    });

    it("rejects a list that repeats an id", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.routeStop.findMany.mockResolvedValue([{ id: STOP_ID }, { id: OTHER_STOP_ID }]);

      await expect(
        service.reorderStops(ROUTE_ID, { stopIds: [STOP_ID, STOP_ID] }, adminActor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.routeStop.update).not.toHaveBeenCalled();
    });

    it("refuses to reorder a FINISHED route", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.FINISHED }));

      await expect(
        service.reorderStops(ROUTE_ID, { stopIds: [STOP_ID] }, adminActor),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.routeStop.findMany).not.toHaveBeenCalled();
    });

    it("refuses a driver reordering another driver's route", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());

      await expect(
        service.reorderStops(ROUTE_ID, { stopIds: [STOP_ID] }, otherDriverActor),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("addLoad", () => {
    it("decrements availableQty atomically and records a ROUTE_LOAD movement with the route's id", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.batchItem.findUnique.mockResolvedValue(buildBatchItem());
      prisma.batchItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.routeLoad.create.mockResolvedValue(buildLoad());

      const result = await service.addLoad(
        ROUTE_ID,
        { batchItemId: BATCH_ITEM_ID, quantity: 50 },
        adminActor,
      );

      expect(prisma.batchItem.updateMany).toHaveBeenCalledWith({
        where: { id: BATCH_ITEM_ID, availableQty: { gte: 50 } },
        data: { availableQty: { decrement: 50 } },
      });
      expect(containerMovements.createWithinTransaction).toHaveBeenCalledWith(
        prisma,
        {
          type: ContainerMovementType.ROUTE_LOAD,
          containerTypeId: CONTAINER_TYPE_ID,
          quantity: 50,
          fromState: ContainerState.FULL_AT_PLANT,
          toState: ContainerState.FULL_ON_ROUTE,
        },
        ADMIN_ID,
        { batchId: BATCH_ID, routeId: ROUTE_ID },
      );
      expect(result.quantity).toBe(50);
    });

    it("a second load of the same batchItem on the same route creates a NEW row, not an increment", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.batchItem.findUnique.mockResolvedValue(buildBatchItem());
      prisma.batchItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.routeLoad.create.mockResolvedValue(
        buildLoad({ id: "11111111-2222-4222-8222-333333333333" }),
      );

      await service.addLoad(ROUTE_ID, { batchItemId: BATCH_ITEM_ID, quantity: 10 }, adminActor);

      expect(prisma.routeLoad.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { routeId: ROUTE_ID, batchItemId: BATCH_ITEM_ID, quantity: 10 },
        }),
      );
    });

    it("rejects insufficient stock via the guarded UPDATE, never a prior read-then-write", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.batchItem.findUnique.mockResolvedValue(buildBatchItem());
      prisma.batchItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.addLoad(ROUTE_ID, { batchItemId: BATCH_ITEM_ID, quantity: 999 }, adminActor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.routeLoad.create).not.toHaveBeenCalled();
      expect(containerMovements.createWithinTransaction).not.toHaveBeenCalled();
    });

    it("rejects an unknown batchItemId", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.batchItem.findUnique.mockResolvedValue(null);

      await expect(
        service.addLoad(ROUTE_ID, { batchItemId: BATCH_ITEM_ID, quantity: 10 }, adminActor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.batchItem.updateMany).not.toHaveBeenCalled();
    });

    it("refuses to load a FINISHED route", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.FINISHED }));

      await expect(
        service.addLoad(ROUTE_ID, { batchItemId: BATCH_ITEM_ID, quantity: 10 }, adminActor),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.batchItem.findUnique).not.toHaveBeenCalled();
    });

    // La invariante FIFO de CLAUDE.md, ahora sostenida por el servidor y no
    // por el reparto que hace la web.
    it("busca el lote más antiguo con stock del MISMO tipo de envase, por fecha y luego código", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.batchItem.findUnique.mockResolvedValue(buildBatchItem());
      prisma.batchItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.routeLoad.create.mockResolvedValue(buildLoad());

      await service.addLoad(ROUTE_ID, { batchItemId: BATCH_ITEM_ID, quantity: 10 }, adminActor);

      expect(prisma.batchItem.findFirst).toHaveBeenCalledWith({
        where: { containerTypeId: CONTAINER_TYPE_ID, availableQty: { gt: 0 } },
        orderBy: [{ batch: { date: "asc" } }, { batch: { code: "asc" } }],
        select: { id: true, batch: { select: { code: true } } },
      });
    });

    it("rechaza un lote que no es el más antiguo con stock, y nombra el que sí lo es", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.batchItem.findUnique.mockResolvedValue(buildBatchItem());
      prisma.batchItem.findFirst.mockResolvedValue({
        id: "aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        batch: { code: "LOTE-VIEJO" },
      });

      await expect(
        service.addLoad(ROUTE_ID, { batchItemId: BATCH_ITEM_ID, quantity: 10 }, adminActor),
      ).rejects.toThrow("LOTE-VIEJO");
      expect(prisma.batchItem.updateMany).not.toHaveBeenCalled();
      expect(containerMovements.createWithinTransaction).not.toHaveBeenCalled();
      expect(prisma.routeLoad.create).not.toHaveBeenCalled();
    });

    // Sin ningún lote con stock, el problema no es el orden sino el stock:
    // lo reporta el UPDATE guardado, con su propio mensaje.
    it("sin ningún lote con stock deja pasar el guard y falla por stock insuficiente", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.batchItem.findUnique.mockResolvedValue(buildBatchItem());
      prisma.batchItem.findFirst.mockResolvedValue(null);
      prisma.batchItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.addLoad(ROUTE_ID, { batchItemId: BATCH_ITEM_ID, quantity: 10 }, adminActor),
      ).rejects.toThrow("Stock insuficiente");
    });
  });

  describe("listLoads", () => {
    it("returns the route's loads", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.routeLoad.findMany.mockResolvedValue([buildLoad()]);

      const result = await service.listLoads(ROUTE_ID, adminActor);

      expect(result).toHaveLength(1);
      expect(result[0]?.batchItem.containerType.name).toBe("Bidón 20L");
    });

    it("lets the assigned driver read their own route's loads", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());
      prisma.routeLoad.findMany.mockResolvedValue([]);

      await expect(service.listLoads(ROUTE_ID, driverActor)).resolves.toEqual([]);
    });

    it("refuses a driver reading another driver's route", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute());

      await expect(service.listLoads(ROUTE_ID, otherDriverActor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe("removeLoad", () => {
    it("returns the stock to the batchItem and records the inverse FULL_RETURN movement", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.PLANNED }));
      prisma.routeLoad.findFirst.mockResolvedValue(buildLoad());

      await service.removeLoad(ROUTE_ID, LOAD_ID, adminActor);

      expect(prisma.batchItem.update).toHaveBeenCalledWith({
        where: { id: BATCH_ITEM_ID },
        data: { availableQty: { increment: 50 } },
      });
      expect(containerMovements.createWithinTransaction).toHaveBeenCalledWith(
        prisma,
        {
          type: ContainerMovementType.FULL_RETURN,
          containerTypeId: CONTAINER_TYPE_ID,
          quantity: 50,
          fromState: ContainerState.FULL_ON_ROUTE,
          toState: ContainerState.FULL_AT_PLANT,
        },
        ADMIN_ID,
        { batchId: BATCH_ID, routeId: ROUTE_ID },
      );
      expect(prisma.routeLoad.delete).toHaveBeenCalledWith({ where: { id: LOAD_ID } });
    });

    it("refuses to correct a load once the route is no longer PLANNED", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.IN_PROGRESS }));

      await expect(service.removeLoad(ROUTE_ID, LOAD_ID, adminActor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.routeLoad.findFirst).not.toHaveBeenCalled();
    });

    it("throws NotFoundException for a load that does not belong to the route", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.PLANNED }));
      prisma.routeLoad.findFirst.mockResolvedValue(null);

      await expect(service.removeLoad(ROUTE_ID, LOAD_ID, adminActor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.batchItem.update).not.toHaveBeenCalled();
    });

    it("refuses a driver removing a load from another driver's route", async () => {
      prisma.route.findUnique.mockResolvedValue(buildRoute({ status: RouteStatus.PLANNED }));

      await expect(service.removeLoad(ROUTE_ID, LOAD_ID, otherDriverActor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.routeLoad.findFirst).not.toHaveBeenCalled();
    });
  });
});
