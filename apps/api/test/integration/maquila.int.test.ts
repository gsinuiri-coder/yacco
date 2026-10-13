import request from "supertest";
import { MaquilaMovementType, ProductType, UserRole } from "@prisma/client";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

let ctx: TestAppContext;
let prisma: PrismaService;
let adminToken: string;
let sellerToken: string;
let supervisorToken: string;
let operatorAToken: string;
let operatorBToken: string;
let operatorAUserId: string;

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

async function createUser(
  username: string,
  roles: UserRole[],
): Promise<{ token: string; id: string }> {
  const password = `${username}-pass-1234`;
  const res = await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: `Usuario ${username}`,
      username,
      password,
      roles,
    })
    .expect(201);
  const token = await login(username, password);
  return { token, id: res.body.id };
}

beforeAll(async () => {
  ctx = await startTestApp();
  prisma = ctx.app.get(PrismaService);
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);

  const seller = await createUser("vendedor-maquila", [UserRole.SELLER]);
  sellerToken = seller.token;

  const supervisor = await createUser("supervisor-maquila", [UserRole.PLANT_SUPERVISOR]);
  supervisorToken = supervisor.token;

  const operatorA = await createUser("operador-a-maquila", [UserRole.PLANT_OPERATOR]);
  operatorAToken = operatorA.token;
  operatorAUserId = operatorA.id;

  const operatorB = await createUser("operador-b-maquila", [UserRole.PLANT_OPERATOR]);
  operatorBToken = operatorB.token;
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("Maquila Module Integration Tests", () => {
  let containerTypeSpigot: { id: string; name: string };
  let containerTypeNoSpigot: { id: string; name: string };
  let maquilaProductSpigot: { id: string };
  let yapePaymentMethod: { id: string };

  let customer1Id: string;
  let customer2Id: string;
  let customer3Id: string;

  beforeAll(async () => {
    // 1. Tipos de envase
    containerTypeSpigot = await prisma.containerType.findFirstOrThrow({
      where: { name: "Con caño", active: true },
      select: { id: true, name: true },
    });
    containerTypeNoSpigot = await prisma.containerType.findFirstOrThrow({
      where: { name: "Sin caño", active: true },
      select: { id: true, name: true },
    });

    // 2. Métodos de pago
    yapePaymentMethod = await prisma.paymentMethod.findFirstOrThrow({
      where: { name: { contains: "Yape" } },
      select: { id: true },
    });

    // 3. Crear producto de servicio de maquila para Con Caño (precio de lista: S/ 3.50)
    const productRes = await request(server())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Servicio Maquila Con Caño",
        type: ProductType.MAQUILA_SERVICE,
        containerTypeId: containerTypeSpigot.id,
        listPrice: "3.50",
      })
      .expect(201);
    maquilaProductSpigot = { id: productRes.body.id };

    // 4. Clientes de prueba
    const c1 = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Cliente Maquila 1 SAC",
        phone: "911222333",
        address: "Av. Las Palmeras 100",
        addressReference: "Frente al grifo",
      })
      .expect(201);
    customer1Id = c1.body.id;

    const c2 = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Cliente Maquila 2 EIRL",
        phone: "944555666",
        address: "Calle Los Pinos 200",
        addressReference: "Piso 2",
      })
      .expect(201);
    customer2Id = c2.body.id;

    const c3 = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Cliente Maquila 3 SRL",
        phone: "977888999",
        address: "Jr. Comercio 300",
        addressReference: "Esq. Mercado",
      })
      .expect(201);
    customer3Id = c3.body.id;

    // 5. Asignar precio pactado a Cliente 1 para el producto de maquila (S/ 2.50)
    await request(server())
      .post(`/api/v1/customers/${customer1Id}/prices`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        productId: maquilaProductSpigot.id,
        price: "2.50",
      })
      .expect(201);
  });

  it("Ciclo de punta a punta: recibe 10, llena 6, devuelve 4 con Yape, devuelve 2 al fiado", async () => {
    // Capturar estado inicial de tablas operacionales que NUNCA deben modificarse
    const initialContainerMovements = await prisma.containerMovement.count();
    const initialCustomerContainerBalances = await prisma.customerContainerBalance.count({
      where: { location: { customerId: customer1Id } },
    });
    const initialBatches = await prisma.productionBatch.count();
    const availableStock = async () =>
      (await prisma.batchItem.aggregate({ _sum: { availableQty: true } }))._sum.availableQty ?? 0;
    const initialAvailableStock = await availableStock();

    // 1. Recibe 10
    const recRes = await request(server())
      .post("/api/v1/maquila/receptions")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        customerId: customer1Id,
        containerTypeId: containerTypeSpigot.id,
        quantity: 10,
      })
      .expect(201);

    expect(recRes.body.type).toBe(MaquilaMovementType.RECEIVED);
    expect(recRes.body.quantity).toBe(10);

    // Afirmar saldos y deuda
    const bal1 = await prisma.maquilaBalance.findUniqueOrThrow({
      where: {
        customerId_containerTypeId: {
          customerId: customer1Id,
          containerTypeId: containerTypeSpigot.id,
        },
      },
    });
    expect(bal1.emptyAtPlant).toBe(10);
    expect(bal1.fullToReturn).toBe(0);

    const cust1 = await prisma.customer.findUniqueOrThrow({ where: { id: customer1Id } });
    expect(cust1.debtBalance.toFixed(2)).toBe("0.00");

    // Invariante: container_movements, balances de envases propios, y lotes NO cambiaron
    expect(await prisma.containerMovement.count()).toBe(initialContainerMovements);
    expect(
      await prisma.customerContainerBalance.count({
        where: { location: { customerId: customer1Id } },
      }),
    ).toBe(initialCustomerContainerBalances);
    expect(await prisma.productionBatch.count()).toBe(initialBatches);
    expect(await availableStock()).toBe(initialAvailableStock);

    // 2. Llena 6
    const fillRes = await request(server())
      .post("/api/v1/maquila/fillings")
      .set("Authorization", `Bearer ${operatorAToken}`)
      .send({
        customerId: customer1Id,
        containerTypeId: containerTypeSpigot.id,
        quantity: 6,
      })
      .expect(201);

    expect(fillRes.body.type).toBe(MaquilaMovementType.FILLED);
    expect(fillRes.body.quantity).toBe(6);

    const bal2 = await prisma.maquilaBalance.findUniqueOrThrow({
      where: {
        customerId_containerTypeId: {
          customerId: customer1Id,
          containerTypeId: containerTypeSpigot.id,
        },
      },
    });
    expect(bal2.emptyAtPlant).toBe(4);
    expect(bal2.fullToReturn).toBe(6);

    const cust2 = await prisma.customer.findUniqueOrThrow({ where: { id: customer1Id } });
    expect(cust2.debtBalance.toFixed(2)).toBe("0.00");

    expect(await prisma.containerMovement.count()).toBe(initialContainerMovements);
    expect(await prisma.productionBatch.count()).toBe(initialBatches);
    expect(await availableStock()).toBe(initialAvailableStock);

    // 3. Devuelve 4 pagando con Yape (S/ 2.50 pactado x 4 = S/ 10.00)
    // Yape requiere confirmación -> status PENDING -> la deuda en S/ aumenta en S/ 10.00
    const ret1Res = await request(server())
      .post("/api/v1/maquila/returns")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        customerId: customer1Id,
        containerTypeId: containerTypeSpigot.id,
        quantity: 4,
        payment: {
          paymentMethodId: yapePaymentMethod.id,
          amount: "10.00",
        },
      })
      .expect(201);

    expect(ret1Res.body.type).toBe(MaquilaMovementType.RETURNED);
    expect(ret1Res.body.quantity).toBe(4);
    expect(ret1Res.body.saleTotal).toBe("10.00");

    const bal3 = await prisma.maquilaBalance.findUniqueOrThrow({
      where: {
        customerId_containerTypeId: {
          customerId: customer1Id,
          containerTypeId: containerTypeSpigot.id,
        },
      },
    });
    expect(bal3.emptyAtPlant).toBe(4);
    expect(bal3.fullToReturn).toBe(2);

    const cust3 = await prisma.customer.findUniqueOrThrow({ where: { id: customer1Id } });
    expect(cust3.debtBalance.toFixed(2)).toBe("10.00");

    expect(await prisma.containerMovement.count()).toBe(initialContainerMovements);
    expect(await prisma.productionBatch.count()).toBe(initialBatches);
    expect(await availableStock()).toBe(initialAvailableStock);

    // 4. Devuelve 2 al fiado (S/ 2.50 x 2 = S/ 5.00)
    const ret2Res = await request(server())
      .post("/api/v1/maquila/returns")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customerId: customer1Id,
        containerTypeId: containerTypeSpigot.id,
        quantity: 2,
      })
      .expect(201);

    expect(ret2Res.body.type).toBe(MaquilaMovementType.RETURNED);
    expect(ret2Res.body.quantity).toBe(2);
    expect(ret2Res.body.saleTotal).toBe("5.00");

    const bal4 = await prisma.maquilaBalance.findUniqueOrThrow({
      where: {
        customerId_containerTypeId: {
          customerId: customer1Id,
          containerTypeId: containerTypeSpigot.id,
        },
      },
    });
    expect(bal4.emptyAtPlant).toBe(4);
    expect(bal4.fullToReturn).toBe(0);

    const cust4 = await prisma.customer.findUniqueOrThrow({ where: { id: customer1Id } });
    expect(cust4.debtBalance.toFixed(2)).toBe("15.00");

    // Invariante final
    expect(await prisma.containerMovement.count()).toBe(initialContainerMovements);
    expect(
      await prisma.customerContainerBalance.count({
        where: { location: { customerId: customer1Id } },
      }),
    ).toBe(initialCustomerContainerBalances);
    expect(await prisma.productionBatch.count()).toBe(initialBatches);
    expect(await availableStock()).toBe(initialAvailableStock);
  });

  it("Precio pactado contra precio de lista con dos clientes de precios distintos; sin precio se rechaza", async () => {
    // Cliente 1 tiene precio pactado S/ 2.50 (ya configurado)
    // Cliente 2 no tiene precio pactado -> debe usar precio de lista S/ 3.50
    // Cliente 3 usa containerTypeNoSpigot (sin producto MAQUILA_SERVICE creado) -> se rechaza con 400

    // Setup: Recibir y llenar para Cliente 2
    await request(server())
      .post("/api/v1/maquila/receptions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customerId: customer2Id,
        containerTypeId: containerTypeSpigot.id,
        quantity: 5,
      })
      .expect(201);

    await request(server())
      .post("/api/v1/maquila/fillings")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({
        customerId: customer2Id,
        containerTypeId: containerTypeSpigot.id,
        quantity: 5,
      })
      .expect(201);

    // Devolver Cliente 2: precio de lista S/ 3.50 * 2 = S/ 7.00
    const retCustomer2 = await request(server())
      .post("/api/v1/maquila/returns")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customerId: customer2Id,
        containerTypeId: containerTypeSpigot.id,
        quantity: 2,
      })
      .expect(201);

    expect(retCustomer2.body.saleTotal).toBe("7.00");
    const cust2 = await prisma.customer.findUniqueOrThrow({ where: { id: customer2Id } });
    expect(cust2.debtBalance.toFixed(2)).toBe("7.00");

    // Setup: Recibir y llenar para Cliente 3 con containerTypeNoSpigot
    await request(server())
      .post("/api/v1/maquila/receptions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customerId: customer3Id,
        containerTypeId: containerTypeNoSpigot.id,
        quantity: 3,
      })
      .expect(201);

    await request(server())
      .post("/api/v1/maquila/fillings")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({
        customerId: customer3Id,
        containerTypeId: containerTypeNoSpigot.id,
        quantity: 3,
      })
      .expect(201);

    // Devolver Cliente 3 sin precio de maquila para ese tipo de envase -> rechaza
    const errRes = await request(server())
      .post("/api/v1/maquila/returns")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customerId: customer3Id,
        containerTypeId: containerTypeNoSpigot.id,
        quantity: 3,
      })
      .expect(400);

    expect(errRes.body.message).toContain("Falta el precio de maquila de este cliente");
  });

  it("Rechazos: llenar 7 con 6 vacíos; devolver más de lo llenado", async () => {
    // Cliente 1 tiene hoy 4 vacíos en planta y 0 llenos
    // Intentar llenar 7 con solo 4 vacíos
    const errFill = await request(server())
      .post("/api/v1/maquila/fillings")
      .set("Authorization", `Bearer ${operatorAToken}`)
      .send({
        customerId: customer1Id,
        containerTypeId: containerTypeSpigot.id,
        quantity: 7,
      })
      .expect(400);

    expect(errFill.body.message).toContain("No hay suficientes vacíos en planta para llenar");

    // Intentar devolver 1 cuando hay 0 llenos
    const errReturn = await request(server())
      .post("/api/v1/maquila/returns")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customerId: customer1Id,
        containerTypeId: containerTypeSpigot.id,
        quantity: 1,
      })
      .expect(400);

    expect(errReturn.body.message).toContain("No hay suficientes llenos para devolver");
  });

  it("Anular el devuelto anula su venta y restaura saldos y deuda", async () => {
    // Usamos Cliente 2: devolvió 2 units (quedaron 3 llenos), deuda S/ 7.00
    // Buscamos el movimiento RETURNED de Cliente 2
    const movementsRes = await request(server())
      .get(
        `/api/v1/maquila/movements?customerId=${customer2Id}&type=${MaquilaMovementType.RETURNED}`,
      )
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const returnedMovement = movementsRes.body.data[0];
    expect(returnedMovement).toBeDefined();
    const movementId = returnedMovement.id;

    // Anular el movimiento devuelto
    const voidRes = await request(server())
      .post(`/api/v1/maquila/movements/${movementId}/void`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Cliente canceló el retiro de envases" })
      .expect(201);

    expect(voidRes.body.type).toBe(MaquilaMovementType.RETURNED_VOID);
    expect(voidRes.body.quantity).toBe(2);

    // Verificar que saldos volvieron (3 + 2 = 5 llenos por devolver)
    const bal = await prisma.maquilaBalance.findUniqueOrThrow({
      where: {
        customerId_containerTypeId: {
          customerId: customer2Id,
          containerTypeId: containerTypeSpigot.id,
        },
      },
    });
    expect(bal.fullToReturn).toBe(5);

    // Verificar que deuda volvió a S/ 0.00
    const cust = await prisma.customer.findUniqueOrThrow({ where: { id: customer2Id } });
    expect(cust.debtBalance.toFixed(2)).toBe("0.00");

    // Verificar que la venta asociada quedó con voidedAt
    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id: returnedMovement.saleId },
    });
    expect(sale.voidedAt).not.toBeNull();
    expect(sale.voidReason).toBe("Cliente canceló el retiro de envases");
  });

  it("Reconstrucción de saldos desde el libro con anulaciones de por medio", async () => {
    const recRes = await request(server())
      .get("/api/v1/maquila/reconciliation")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(recRes.body.isBalanced).toBe(true);
    expect(recRes.body.discrepancies).toHaveLength(0);
  });

  it("rechaza un customerId inválido antes de consultar Prisma", async () => {
    await request(server())
      .get("/api/v1/maquila/balances?customerId=no-es-un-uuid")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(400);
  });

  it("serializa llenados y devoluciones concurrentes sin saldos negativos ni errores 500", async () => {
    const customer = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Cliente Maquila Concurrente",
        phone: "900111222",
        address: "Av. Concurrente 10",
        addressReference: "Puerta verde",
      })
      .expect(201);

    await request(server())
      .post("/api/v1/maquila/receptions")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        customerId: customer.body.id,
        containerTypeId: containerTypeSpigot.id,
        quantity: 1,
      })
      .expect(201);

    const fills = await Promise.all(
      [1, 2].map(() =>
        request(server())
          .post("/api/v1/maquila/fillings")
          .set("Authorization", `Bearer ${operatorAToken}`)
          .send({
            customerId: customer.body.id,
            containerTypeId: containerTypeSpigot.id,
            quantity: 1,
          }),
      ),
    );
    expect(fills.map((response) => response.status).sort()).toEqual([201, 400]);
    expect(fills.find((response) => response.status === 400)?.body.message).toContain(
      "No hay suficientes vacíos en planta para llenar",
    );

    const returns = await Promise.all(
      [1, 2].map(() =>
        request(server())
          .post("/api/v1/maquila/returns")
          .set("Authorization", `Bearer ${sellerToken}`)
          .send({
            customerId: customer.body.id,
            containerTypeId: containerTypeSpigot.id,
            quantity: 1,
          }),
      ),
    );
    expect(returns.map((response) => response.status).sort()).toEqual([201, 400]);
    expect(returns.find((response) => response.status === 400)?.body.message).toContain(
      "No hay suficientes llenos para devolver",
    );

    const balance = await prisma.maquilaBalance.findUniqueOrThrow({
      where: {
        customerId_containerTypeId: {
          customerId: customer.body.id,
          containerTypeId: containerTypeSpigot.id,
        },
      },
    });
    expect(balance.emptyAtPlant).toBe(0);
    expect(balance.fullToReturn).toBe(0);
  });

  describe("Permisos por rol", () => {
    it("Operador llena y no puede recibir ni anular", async () => {
      // Operador puede llenar
      await request(server())
        .post("/api/v1/maquila/fillings")
        .set("Authorization", `Bearer ${operatorAToken}`)
        .send({
          customerId: customer1Id,
          containerTypeId: containerTypeSpigot.id,
          quantity: 1,
        })
        .expect(201);

      // Operador no puede recibir (403)
      await request(server())
        .post("/api/v1/maquila/receptions")
        .set("Authorization", `Bearer ${operatorAToken}`)
        .send({
          customerId: customer1Id,
          containerTypeId: containerTypeSpigot.id,
          quantity: 1,
        })
        .expect(403);

      // Operador no puede anular (403)
      await request(server())
        .post("/api/v1/maquila/movements/00000000-0000-0000-0000-000000000000/void")
        .set("Authorization", `Bearer ${operatorAToken}`)
        .send({ reason: "Intento no autorizado" })
        .expect(403);
    });

    it("Vendedor recibe y no puede llenar", async () => {
      // Vendedor puede recibir
      await request(server())
        .post("/api/v1/maquila/receptions")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
          customerId: customer1Id,
          containerTypeId: containerTypeSpigot.id,
          quantity: 2,
        })
        .expect(201);

      // Vendedor no puede llenar (403)
      await request(server())
        .post("/api/v1/maquila/fillings")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
          customerId: customer1Id,
          containerTypeId: containerTypeSpigot.id,
          quantity: 1,
        })
        .expect(403);
    });

    it("Operador ve solo sus llenados por la API", async () => {
      // Operador A llena 1
      const operatorAFill = await request(server())
        .post("/api/v1/maquila/fillings")
        .set("Authorization", `Bearer ${operatorAToken}`)
        .send({
          customerId: customer1Id,
          containerTypeId: containerTypeSpigot.id,
          quantity: 1,
        })
        .expect(201);

      await request(server())
        .post(`/api/v1/maquila/movements/${operatorAFill.body.id}/void`)
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({ reason: "Corrección del llenado para probar la lectura" })
        .expect(201);

      // Operador B llena 1
      await request(server())
        .post("/api/v1/maquila/fillings")
        .set("Authorization", `Bearer ${operatorBToken}`)
        .send({
          customerId: customer1Id,
          containerTypeId: containerTypeSpigot.id,
          quantity: 1,
        })
        .expect(201);

      // Operador A consulta movimientos
      const resA = await request(server())
        .get("/api/v1/maquila/movements")
        .set("Authorization", `Bearer ${operatorAToken}`)
        .expect(200);

      // Todos los movimientos que ve Operador A deben ser de él y de tipo FILLED
      for (const m of resA.body.data) {
        expect(m.recordedById).toBe(operatorAUserId);
        expect(m.type).toBe(MaquilaMovementType.FILLED);
      }

      // Supervisor consulta movimientos y ve todos los llenados, pero ninguna operación comercial
      const resSup = await request(server())
        .get("/api/v1/maquila/movements")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .expect(200);

      for (const movement of resSup.body.data) {
        expect([MaquilaMovementType.FILLED, MaquilaMovementType.FILLED_VOID]).toContain(
          movement.type,
        );
        expect(movement).not.toHaveProperty("saleId");
        expect(movement).not.toHaveProperty("saleTotal");
      }
      expect(
        resSup.body.data.some(
          (movement: { type: MaquilaMovementType }) =>
            movement.type === MaquilaMovementType.FILLED_VOID,
        ),
      ).toBe(true);
      const recordedByIds = new Set(
        resSup.body.data.map((m: { recordedById: string }) => m.recordedById),
      );
      expect(recordedByIds.size).toBeGreaterThan(1);
    });

    it("Roles de planta ven saldos físicos sin precios ni productos", async () => {
      const balances = await request(server())
        .get(`/api/v1/maquila/customers/${customer1Id}/balances`)
        .set("Authorization", `Bearer ${operatorAToken}`)
        .expect(200);

      expect(balances.body.length).toBeGreaterThan(0);
      for (const balance of balances.body) {
        expect(balance).not.toHaveProperty("unitPrice");
        expect(balance).not.toHaveProperty("productId");
      }

      const customers = await request(server())
        .get("/api/v1/maquila/customers")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .expect(200);
      for (const customer of customers.body) {
        for (const balance of customer.balances) {
          expect(balance).not.toHaveProperty("unitPrice");
          expect(balance).not.toHaveProperty("productId");
        }
      }
    });

    it("serializa el alta para conservar un solo servicio activo por tipo de envase", async () => {
      const create = (name: string) =>
        request(server())
          .post("/api/v1/products")
          .set("Authorization", `Bearer ${adminToken}`)
          .send({
            name,
            type: ProductType.MAQUILA_SERVICE,
            containerTypeId: containerTypeNoSpigot.id,
            listPrice: "3.25",
          });

      const responses = await Promise.all([
        create("Servicio maquila concurrente A"),
        create("Servicio maquila concurrente B"),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 400]);
      expect(responses.find((response) => response.status === 400)?.body.message).toContain(
        "Ya existe un servicio de maquila activo para este tipo de envase",
      );

      const count = await prisma.product.count({
        where: {
          type: ProductType.MAQUILA_SERVICE,
          containerTypeId: containerTypeNoSpigot.id,
          active: true,
        },
      });
      expect(count).toBe(1);
    });
  });
});
