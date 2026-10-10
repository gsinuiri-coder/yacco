import { randomBytes } from "node:crypto";
import { ValidationPipe } from "@nestjs/common";
import type { INestApplicationContext, Type } from "@nestjs/common";
import {
  ContainerMovementType,
  ContainerState,
  RouteStatus,
  StopOrigin,
  StopStatus,
  UserRole,
} from "@prisma/client";
import { ContainerMovementsService } from "../modules/container-movements/container-movements.service.js";
import { CreateContainerMovementDto } from "../modules/container-movements/dto/create-container-movement.dto.js";
import { ListContainerMovementsQueryDto } from "../modules/container-movements/dto/list-container-movements-query.dto.js";
import { CustomerLocationsService } from "../modules/customer-locations/customer-locations.service.js";
import { ListCustomerLocationsQueryDto } from "../modules/customer-locations/dto/list-customer-locations-query.dto.js";
import { CustomersService } from "../modules/customers/customers.service.js";
import { CreateCustomerDto } from "../modules/customers/dto/create-customer.dto.js";
import { ListCustomersQueryDto } from "../modules/customers/dto/list-customers-query.dto.js";
import { CreateOrderDto } from "../modules/orders/dto/create-order.dto.js";
import { ListOrdersQueryDto } from "../modules/orders/dto/list-orders-query.dto.js";
import { OrdersService } from "../modules/orders/orders.service.js";
import { ListPaymentMethodsQueryDto } from "../modules/payment-methods/dto/list-payment-methods-query.dto.js";
import { PaymentMethodsService } from "../modules/payment-methods/payment-methods.service.js";
import { CreateOfficePaymentDto } from "../modules/payments/dto/create-office-payment.dto.js";
import { PaymentsService } from "../modules/payments/payments.service.js";
import { CreateProductionBatchDto } from "../modules/production-batches/dto/create-production-batch.dto.js";
import { ListProductionBatchesQueryDto } from "../modules/production-batches/dto/list-production-batches-query.dto.js";
import { ProductionBatchesService } from "../modules/production-batches/production-batches.service.js";
import { ListProductsQueryDto } from "../modules/products/dto/list-products-query.dto.js";
import type { ProductResponseDto } from "../modules/products/dto/product-response.dto.js";
import { UpdateProductDto } from "../modules/products/dto/update-product.dto.js";
import { ProductsService } from "../modules/products/products.service.js";
import { CreateRouteSettlementDto } from "../modules/route-settlement/dto/create-route-settlement.dto.js";
import { RouteSettlementService } from "../modules/route-settlement/route-settlement.service.js";
import { CreateRouteLoadDto } from "../modules/routes/dto/create-route-load.dto.js";
import { CreateRouteDto } from "../modules/routes/dto/create-route.dto.js";
import { CreateRouteStopsBatchDto } from "../modules/routes/dto/create-route-stops-batch.dto.js";
import { ListRoutesQueryDto } from "../modules/routes/dto/list-routes-query.dto.js";
import { MarkRouteStopDto } from "../modules/routes/dto/mark-route-stop.dto.js";
import type { RouteResponseDto } from "../modules/routes/dto/route-response.dto.js";
import { RoutesService } from "../modules/routes/routes.service.js";
import type { RouteActor } from "../modules/routes/routes.service.js";
import { CreateUserDto } from "../modules/users/dto/create-user.dto.js";
import { UpdateUserDto } from "../modules/users/dto/update-user.dto.js";
import { UsersService } from "../modules/users/users.service.js";
import { ListZonesQueryDto } from "../modules/zones/dto/list-zones-query.dto.js";
import { CreateZoneDto } from "../modules/zones/dto/create-zone.dto.js";
import { UpdateZoneDto } from "../modules/zones/dto/update-zone.dto.js";
import { ZonesService } from "../modules/zones/zones.service.js";
import { planFifoLoads } from "./seed-demo-plan.js";
import {
  REFILL_PRODUCT_BY_CONTAINER,
  TEST_BATCH,
  TEST_BATCH_CODE,
  TEST_CASH_AT_DELIVERY,
  TEST_CUSTOMER,
  TEST_DRIVER_1,
  TEST_EMPTIES_RETURNED,
  TEST_FLEET_ENTRY,
  TEST_LIST_PRICES,
  TEST_ORDER,
  TEST_TRUCK_LOAD,
  TEST_USERS,
  TEST_YAPE_AMOUNT,
  TEST_YAPE_REQUEST_ID,
  TEST_ZONE_DAYS,
  limaToday,
  type TestContainerKey,
} from "./test-data-plan.js";

const CONTAINER_KEYS: readonly TestContainerKey[] = ["CON_CANO", "SIN_CANO"];

/**
 * Lo que la corrida hizo, para imprimirlo. `credentials` trae la contraseña
 * vigente de cada usuario PRUEBA: en cada corrida se pone una nueva.
 */
export interface TestDataReport {
  lines: string[];
  credentials: { name: string; username: string; password: string }[];
}

/**
 * La misma validación que un request HTTP: este script llama a los servicios
 * sin pasar por un controller, así que sin esto un dato mal formado entraría
 * a la base sin el control que la pantalla sí tiene.
 */
const validationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

async function validated<T extends object>(metatype: Type<T>, value: object): Promise<T> {
  return (await validationPipe.transform(value, { type: "body", metatype })) as T;
}

/**
 * Carga los datos de prueba del ítem K por los servicios de la app, nunca
 * con SQL. Cada paso mira primero si ya está hecho, así que una segunda
 * corrida no duplica nada y una que se cortó a la mitad sigue donde quedó.
 *
 * Quien la llama ya comprobó que la base es local (assertLocalDatabaseUrl).
 */
export class TestDataSeeder {
  private readonly lines: string[] = [];
  private readonly credentials: TestDataReport["credentials"] = [];
  private actor!: RouteActor;
  private productsByName = new Map<string, ProductResponseDto>();

  constructor(
    private readonly app: INestApplicationContext,
    private readonly adminUsername: string,
    private readonly now: Date = new Date(),
  ) {}

  async run(): Promise<TestDataReport> {
    await this.resolveActor();
    await this.setListPrices();
    const userIds = await this.ensureUsers();
    const parqueZoneId = await this.ensureZoneDays();
    const containerTypeIds = this.containerTypeIds();
    await this.ensureFleetEntry(containerTypeIds);
    await this.ensureBatch(containerTypeIds);
    const customerId = await this.ensureCustomer(parqueZoneId);
    await this.ensureDay(
      { customerId, driverId: userIds.get(TEST_DRIVER_1.username) as string, zoneId: parqueZoneId },
      containerTypeIds,
    );
    return { lines: this.lines, credentials: this.credentials };
  }

  private async resolveActor(): Promise<void> {
    const admin = await this.app.get(UsersService).findByUsername(this.adminUsername);
    if (admin === null || !admin.active) {
      throw new Error(
        `No existe un usuario activo "${this.adminUsername}" para registrar la carga.`,
      );
    }
    this.actor = { id: admin.id, roles: admin.roles.map((link) => link.role.name as UserRole) };
  }

  private async setListPrices(): Promise<void> {
    const products = this.app.get(ProductsService);
    const all = await products.findAll(await validated(ListProductsQueryDto, {}));
    this.productsByName = new Map(all.map((product) => [product.name, product]));
    let changed = 0;
    for (const [name, listPrice] of Object.entries(TEST_LIST_PRICES)) {
      const product = this.requireProduct(name);
      if (product.listPrice === listPrice) continue;
      const updated = await products.update(
        product.id,
        await validated(UpdateProductDto, { listPrice }),
        this.actor.id,
      );
      this.productsByName.set(name, updated);
      changed += 1;
    }
    this.lines.push(`Precios de lista: ${changed} cambiados, ${4 - changed} ya estaban.`);
  }

  private requireProduct(name: string): ProductResponseDto {
    const product = this.productsByName.get(name);
    if (product === undefined) {
      throw new Error(`Falta el producto "${name}". Corré "pnpm db:seed" primero.`);
    }
    return product;
  }

  /**
   * Crea los que faltan y a los que ya existen les pone una contraseña nueva:
   * así el archivo de credenciales siempre sirve para entrar, aunque el de la
   * corrida anterior se haya perdido. Cambiar la contraseña corta las sesiones
   * abiertas de ese usuario (D-024), igual que desde «Usuarios».
   */
  private async ensureUsers(): Promise<Map<string, string>> {
    const users = this.app.get(UsersService);
    const idByUsername = new Map<string, string>();
    for (const plan of TEST_USERS) {
      const password = randomBytes(12).toString("base64url");
      const existing = await users.findByUsername(plan.username);
      if (existing === null) {
        const created = await users.create(
          await validated(CreateUserDto, {
            name: plan.name,
            username: plan.username,
            password,
            roles: [plan.role],
          }),
        );
        idByUsername.set(plan.username, created.id);
        this.lines.push(`Usuario ${plan.name}: creado.`);
      } else {
        await users.update(
          existing.id,
          await validated(UpdateUserDto, { password }),
          this.actor.id,
        );
        idByUsername.set(plan.username, existing.id);
        this.lines.push(`Usuario ${plan.name}: ya existía, contraseña nueva.`);
      }
      this.credentials.push({ name: plan.name, username: plan.username, password });
    }
    return idByUsername;
  }

  /** Crea la zona si falta y le pone sus días. Devuelve el id de Parque. */
  private async ensureZoneDays(): Promise<string> {
    const zones = this.app.get(ZonesService);
    const all = await zones.findAll(await validated(ListZonesQueryDto, {}));
    const idByName = new Map(all.map((zone) => [zone.name, zone]));
    for (const [name, deliveryDays] of Object.entries(TEST_ZONE_DAYS)) {
      const zone = idByName.get(name);
      if (zone === undefined) {
        const created = await zones.create(await validated(CreateZoneDto, { name, deliveryDays }));
        idByName.set(name, created);
        this.lines.push(`Zona ${name}: creada con sus días.`);
      } else if (zone.deliveryDays.join() === deliveryDays.join()) {
        this.lines.push(`Zona ${name}: ya tenía sus días.`);
      } else {
        await zones.update(zone.id, await validated(UpdateZoneDto, { deliveryDays }));
        this.lines.push(`Zona ${name}: días de reparto puestos.`);
      }
    }
    return (idByName.get(TEST_CUSTOMER.zoneName) as { id: string }).id;
  }

  private containerTypeIds(): Record<TestContainerKey, string> {
    return {
      CON_CANO: this.requireProduct(REFILL_PRODUCT_BY_CONTAINER.CON_CANO).containerType.id,
      SIN_CANO: this.requireProduct(REFILL_PRODUCT_BY_CONTAINER.SIN_CANO).containerType.id,
    };
  }

  /** «Con caño» / «Sin caño», en minúscula para la frase. */
  private containerTypeName(key: TestContainerKey): string {
    return this.requireProduct(REFILL_PRODUCT_BY_CONTAINER[key]).containerType.name.toLowerCase();
  }

  /**
   * El ingreso de envases es un movimiento del libro, que no tiene nota: lo
   * que lo identifica es su tipo, su envase y su cantidad exacta.
   */
  private async ensureFleetEntry(
    containerTypeIds: Record<TestContainerKey, string>,
  ): Promise<void> {
    const movements = this.app.get(ContainerMovementsService);
    for (const key of CONTAINER_KEYS) {
      const quantity = TEST_FLEET_ENTRY[key];
      const existing = await movements.findAll(
        await validated(ListContainerMovementsQueryDto, {
          type: ContainerMovementType.FLEET_ENTRY,
          containerTypeId: containerTypeIds[key],
          limit: 100,
        }),
      );
      if (existing.data.some((movement) => movement.quantity === quantity)) {
        this.lines.push(
          `Ingreso de ${quantity} envases ${this.containerTypeName(key)}: ya estaba.`,
        );
        continue;
      }
      await movements.create(
        await validated(CreateContainerMovementDto, {
          type: ContainerMovementType.FLEET_ENTRY,
          containerTypeId: containerTypeIds[key],
          quantity,
          toState: ContainerState.EMPTY_AT_PLANT,
        }),
        this.actor.id,
      );
      this.lines.push(`Ingreso de ${quantity} envases ${this.containerTypeName(key)}: registrado.`);
    }
  }

  private async ensureBatch(containerTypeIds: Record<TestContainerKey, string>): Promise<void> {
    const batches = this.app.get(ProductionBatchesService);
    const existing = await batches.findAll(
      await validated(ListProductionBatchesQueryDto, { limit: 100 }),
    );
    if (existing.data.some((batch) => batch.code === TEST_BATCH_CODE)) {
      this.lines.push(`Lote ${TEST_BATCH_CODE}: ya estaba.`);
      return;
    }
    await batches.create(
      await validated(CreateProductionBatchDto, {
        code: TEST_BATCH_CODE,
        date: limaToday(this.now),
        notes: "Lote de prueba (pnpm demo:prueba).",
        items: CONTAINER_KEYS.map((key) => ({
          containerTypeId: containerTypeIds[key],
          producedQty: TEST_BATCH[key],
        })),
      }),
      this.actor.id,
    );
    this.lines.push(`Lote ${TEST_BATCH_CODE}: registrado.`);
  }

  private async ensureCustomer(zoneId: string): Promise<string> {
    const customers = this.app.get(CustomersService);
    const found = await customers.findAll(
      await validated(ListCustomersQueryDto, { search: TEST_CUSTOMER.name }),
    );
    const existing = found.data.find((customer) => customer.name === TEST_CUSTOMER.name);
    if (existing !== undefined) {
      this.lines.push(`Cliente ${TEST_CUSTOMER.name}: ya estaba.`);
      return existing.id;
    }
    const created = await customers.create(
      await validated(CreateCustomerDto, {
        name: TEST_CUSTOMER.name,
        phone: TEST_CUSTOMER.phone,
        address: TEST_CUSTOMER.address,
        addressReference: TEST_CUSTOMER.addressReference,
        zoneId,
      }),
    );
    this.lines.push(`Cliente ${TEST_CUSTOMER.name}: creado en ${TEST_CUSTOMER.zoneName}.`);
    return created.id;
  }

  /**
   * El día completo: pedido → ruta con carga → entrega → cobros →
   * liquidación. El estado de la ruta dice qué falta, así que cada corrida
   * retoma desde ahí y una ruta ya liquidada no se toca.
   */
  private async ensureDay(
    { customerId, driverId, zoneId }: { customerId: string; driverId: string; zoneId: string },
    containerTypeIds: Record<TestContainerKey, string>,
  ): Promise<void> {
    const orderId = await this.ensureOrder(customerId);
    const order = await this.app.get(OrdersService).findOne(orderId);
    let route = await this.ensureRoute(driverId, order.deliveryDate, zoneId);

    if (route.status === RouteStatus.PLANNED) {
      route = await this.planRoute(route, orderId, containerTypeIds);
    }
    if (route.status === RouteStatus.IN_PROGRESS) {
      route = await this.deliverAndFinish(route, containerTypeIds);
    }
    await this.ensureYape(customerId);
    if (route.status === RouteStatus.FINISHED) {
      await this.settle(route.id, containerTypeIds);
    } else {
      this.lines.push("Liquidación: ya estaba.");
    }
  }

  /**
   * El pedido se busca por cliente, sin fecha: una corrida otro día sigue con
   * el mismo pedido y su ruta en vez de armar un segundo día.
   */
  private async ensureOrder(customerId: string): Promise<string> {
    const orders = this.app.get(OrdersService);
    const found = await orders.findAll(await validated(ListOrdersQueryDto, { customerId }));
    const existing = found.data[0];
    if (existing !== undefined) {
      this.lines.push(`Pedido de ${TEST_CUSTOMER.name}: ya estaba.`);
      return existing.id;
    }
    const created = await orders.create(
      await validated(CreateOrderDto, {
        customerId,
        deliveryDate: limaToday(this.now),
        items: CONTAINER_KEYS.map((key) => {
          const product = this.requireProduct(REFILL_PRODUCT_BY_CONTAINER[key]);
          return { productId: product.id, quantity: TEST_ORDER[key], unitPrice: product.listPrice };
        }),
      }),
      this.actor.id,
    );
    this.lines.push(`Pedido de ${TEST_CUSTOMER.name}: registrado para el ${created.deliveryDate}.`);
    return created.id;
  }

  private async ensureRoute(
    driverId: string,
    date: string,
    zoneId: string,
  ): Promise<RouteResponseDto> {
    const routes = this.app.get(RoutesService);
    const found = await routes.findAll(
      await validated(ListRoutesQueryDto, { driverId, date }),
      this.actor,
    );
    const existing = found.data[0];
    if (existing !== undefined) {
      this.lines.push(`Ruta de ${TEST_DRIVER_1.name} del ${date}: ya estaba.`);
      return routes.findOne(existing.id, this.actor);
    }
    const created = await routes.create(
      await validated(CreateRouteDto, { driverId, date, zoneId }),
      this.actor.id,
    );
    this.lines.push(`Ruta de ${TEST_DRIVER_1.name} del ${date}: creada.`);
    return routes.findOne(created.id, this.actor);
  }

  /** Carga (FIFO, como la pantalla), la parada del pedido y la salida. */
  private async planRoute(
    route: RouteResponseDto,
    orderId: string,
    containerTypeIds: Record<TestContainerKey, string>,
  ): Promise<RouteResponseDto> {
    const routes = this.app.get(RoutesService);
    const loads = await routes.listLoads(route.id, this.actor);
    if (loads.length === 0) {
      for (const key of CONTAINER_KEYS) {
        const withStock = await this.app
          .get(ProductionBatchesService)
          .findAll(await validated(ListProductionBatchesQueryDto, { withStock: true, limit: 100 }));
        for (const line of planFifoLoads(
          withStock.data,
          containerTypeIds[key],
          TEST_TRUCK_LOAD[key],
        )) {
          await routes.addLoad(route.id, await validated(CreateRouteLoadDto, line), this.actor);
        }
      }
      this.lines.push("Carga del camión: registrada.");
    }
    if (route.stops.length === 0) {
      await routes.addOrderStops(
        route.id,
        await validated(CreateRouteStopsBatchDto, { orderIds: [orderId] }),
        this.actor,
      );
      this.lines.push("Parada del pedido: agregada.");
    }
    await routes.start(route.id, this.actor);
    this.lines.push("Ruta: en reparto.");
    return routes.findOne(route.id, this.actor);
  }

  private async deliverAndFinish(
    route: RouteResponseDto,
    containerTypeIds: Record<TestContainerKey, string>,
  ): Promise<RouteResponseDto> {
    const routes = this.app.get(RoutesService);
    const cash = await this.paymentMethodId("Efectivo");
    for (const stop of route.stops) {
      if (stop.status !== StopStatus.PENDING || stop.origin !== StopOrigin.ORDER) continue;
      await routes.markStop(
        route.id,
        stop.id,
        await validated(MarkRouteStopDto, {
          status: StopStatus.DELIVERED,
          items: CONTAINER_KEYS.map((key) => ({
            productId: this.requireProduct(REFILL_PRODUCT_BY_CONTAINER[key]).id,
            quantity: TEST_ORDER[key],
          })),
          containersReturned: CONTAINER_KEYS.map((key) => ({
            containerTypeId: containerTypeIds[key],
            quantity: TEST_EMPTIES_RETURNED[key],
          })),
          payment: { paymentMethodId: cash, amount: TEST_CASH_AT_DELIVERY },
        }),
        this.actor,
      );
      this.lines.push(`Entrega: registrada, con S/ ${TEST_CASH_AT_DELIVERY} en efectivo.`);
    }
    await routes.finish(route.id, this.actor);
    this.lines.push("Ruta: terminada.");
    return routes.findOne(route.id, this.actor);
  }

  /** Clave de idempotencia fija: una segunda corrida devuelve el mismo cobro. */
  private async ensureYape(customerId: string): Promise<void> {
    const result = await this.app.get(PaymentsService).createOfficePayment(
      await validated(CreateOfficePaymentDto, {
        customerId,
        locationId: await this.primaryLocationId(customerId),
        paymentMethodId: await this.paymentMethodId("Yape"),
        amount: TEST_YAPE_AMOUNT,
        idempotencyKey: TEST_YAPE_REQUEST_ID,
      }),
      this.actor.id,
    );
    this.lines.push(
      result.created
        ? `Cobro por Yape de S/ ${TEST_YAPE_AMOUNT}: registrado.`
        : `Cobro por Yape de S/ ${TEST_YAPE_AMOUNT}: ya estaba.`,
    );
  }

  /**
   * Liquida con lo que la propia vista espera: cuadra por construcción. Los
   * llenos que vuelven van por tipo, como los manda la pantalla: con dos
   * tipos en el camión, un total solo no se puede atribuir y la API no
   * los baja a la planta.
   */
  private async settle(
    routeId: string,
    containerTypeIds: Record<TestContainerKey, string>,
  ): Promise<void> {
    const settlements = this.app.get(RouteSettlementService);
    const view = await settlements.getSettlementView(routeId);
    const { fullOut, fullDelivered, fullSold, emptiesPickedUpByType } = view.expected;
    await settlements.settle(
      routeId,
      await validated(CreateRouteSettlementDto, {
        fullReturned: fullOut - fullDelivered - fullSold,
        fullReturnedByType: CONTAINER_KEYS.map((key) => ({
          containerTypeId: containerTypeIds[key],
          quantity: TEST_TRUCK_LOAD[key] - TEST_ORDER[key],
        })),
        emptiesCollected: emptiesPickedUpByType.map((line) => ({
          containerTypeId: line.containerTypeId,
          quantity: line.quantity,
        })),
      }),
      this.actor.id,
    );
    this.lines.push("Liquidación: registrada, sin diferencias.");
  }

  private async primaryLocationId(customerId: string): Promise<string> {
    const locations = await this.app
      .get(CustomerLocationsService)
      .findAll(customerId, await validated(ListCustomerLocationsQueryDto, {}));
    const primary = locations.find((location) => location.isPrimary);
    if (primary === undefined) {
      throw new Error(`${TEST_CUSTOMER.name} no tiene ubicación principal.`);
    }
    return primary.id;
  }

  private async paymentMethodId(name: string): Promise<string> {
    const methods = await this.app
      .get(PaymentMethodsService)
      .findAll(await validated(ListPaymentMethodsQueryDto, {}));
    const method = methods.find((candidate) => candidate.name === name);
    if (method === undefined) {
      throw new Error(`Falta el medio de cobro "${name}". Corré "pnpm db:seed" primero.`);
    }
    return method.id;
  }
}
