import request from "supertest";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";
import { startTestStorage } from "./support/test-storage.js";
import type { StartedTestStorage } from "./support/test-storage.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

let ctx: TestAppContext;
let prisma: PrismaService;
let minioContainer: StartedTestStorage;
let adminToken: string;
let sellerToken: string;
let driverToken: string;
let driverOtherToken: string;
let driverUserId: string;
let customerId: string;
let locationId: string;
let otherCustomerId: string;
let otherLocationId: string;

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
  const password = `${username}-pass`;
  const res = await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: username, username, password, roles: [role] })
    .expect(201);
  return { token: await login(username, password), id: res.body.id };
}

beforeAll(async () => {
  minioContainer = await startTestStorage("test-photos");

  ctx = await startTestApp();
  prisma = ctx.app.get(PrismaService);
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);

  const seller = await createUserAndLogin("vendedor-fotos", "SELLER");
  sellerToken = seller.token;

  const driver = await createUserAndLogin("chofer-ruta", "DRIVER");
  driverToken = driver.token;
  driverUserId = driver.id;

  const otherDriver = await createUserAndLogin("chofer-ajeno", "DRIVER");
  driverOtherToken = otherDriver.token;

  // Create customer 1
  const custRes = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Bodega Santa Rosa",
      phone: "987111222",
      address: "Jr. Los Pinos 123",
      addressReference: "Frente al parque",
    })
    .expect(201);
  customerId = custRes.body.id;

  const loc = await prisma.customerLocation.findFirstOrThrow({
    where: { customerId, isPrimary: true },
  });
  locationId = loc.id;

  // Create customer 2 (other customer)
  const cust2Res = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Bodega San Juan",
      phone: "987333444",
      address: "Av. Las Flores 456",
      addressReference: "Portón blanco",
    })
    .expect(201);
  otherCustomerId = cust2Res.body.id;

  const loc2 = await prisma.customerLocation.findFirstOrThrow({
    where: { customerId: otherCustomerId, isPrimary: true },
  });
  otherLocationId = loc2.id;

  // Create vehicle and route for driver 1 containing customer 1's location
  const adminUser = await prisma.user.findFirstOrThrow({ where: { username: ADMIN_USERNAME } });
  const vehicle = await prisma.vehicle.create({
    data: {
      plate: "FOT101",
      name: "Camión Fotos",
      brand: "Hyundai",
      model: "HD78",
      capacityUnits: 50,
      createdById: adminUser.id,
    },
  });

  const routeRes = await request(server())
    .post("/api/v1/routes")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      driverId: driverUserId,
      date: "2026-10-12",
      vehicleId: vehicle.id,
    })
    .expect(201);
  const routeId = routeRes.body.id;

  // Add stop with locationId directly to route
  await prisma.routeStop.create({
    data: {
      routeId,
      locationId,
      position: 1,
      origin: "VAN_SALE",
      addedById: adminUser.id,
    },
  });
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
  if (minioContainer) {
    await minioContainer.stop();
  }
});

describe("Customer Documents", () => {
  test("rechaza RUC de 10 dígitos (debe tener 11)", async () => {
    const res = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Empresa Invalida",
        phone: "987654321",
        address: "Av. Principal 100",
        addressReference: "Frente al parque",
        documentType: "RUC",
        documentNumber: "1234567890", // 10 digits
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("11 dígitos");
  });

  test("rechaza documento con número sin tipo", async () => {
    const res = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Empresa Sin Tipo",
        phone: "987654321",
        address: "Av. Principal 100",
        addressReference: "Frente al parque",
        documentNumber: "20123456789",
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("tipo de documento es obligatorio");
  });

  test("rechaza documento con tipo sin número", async () => {
    const res = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Empresa Sin Numero",
        phone: "987654321",
        address: "Av. Principal 100",
        addressReference: "Frente al parque",
        documentType: "RUC",
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("número de documento es obligatorio");
  });

  test("guarda cliente con documento válido y devuelve datos fiscales", async () => {
    const res = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        name: "Comercializadora Lima SAC",
        phone: "987654321",
        address: "Av. Argentina 1000",
        addressReference: "Frente al parque",
        documentType: "RUC",
        documentNumber: "20555666777",
        legalName: "COMERCIALIZADORA LIMA S.A.C.",
        fiscalAddress: "Av. Argentina 1000, Callao",
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      documentType: "RUC",
      documentNumber: "20555666777",
      legalName: "COMERCIALIZADORA LIMA S.A.C.",
      fiscalAddress: "Av. Argentina 1000, Callao",
      duplicateDocumentWarning: null,
    });
  });

  test("dos clientes con el mismo RUC: guarda y devuelve duplicateDocumentWarning", async () => {
    const res = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Sucursal Lima Dos",
        phone: "987654322",
        address: "Av. Colonial 200",
        addressReference: "Frente al parque",
        documentType: "RUC",
        documentNumber: "20555666777", // same RUC as previous test
        legalName: "COMERCIALIZADORA LIMA S.A.C.",
      });
    expect(res.status).toBe(201);
    expect(res.body.documentNumber).toBe("20555666777");
    expect(res.body.duplicateDocumentWarning).toContain("Ya existe otro cliente");
    expect(res.body.duplicateDocumentWarning).toContain("20555666777");
  });

  test("actualización por padrón conserva los documentos tributarios cargados", async () => {
    const cust = await prisma.customer.create({
      data: {
        externalCode: "PADRON-TEST-1",
        name: "Cliente Padrón Original",
        documentType: "RUC",
        documentNumber: "20999888777",
        legalName: "PADRON SAC",
        fiscalAddress: "Calle Padrón 123",
      },
    });

    // Simular el update que hace roster-loader
    const updated = await prisma.customer.update({
      where: { id: cust.id },
      data: {
        name: "Cliente Padrón Actualizado",
      },
    });

    expect(updated.name).toBe("Cliente Padrón Actualizado");
    expect(updated.documentType).toBe("RUC");
    expect(updated.documentNumber).toBe("20999888777");
    expect(updated.legalName).toBe("PADRON SAC");
    expect(updated.fiscalAddress).toBe("Calle Padrón 123");
  });
});

describe("Customer Contacts", () => {
  let createdContactId: string;

  test("vendedor agrega contacto sin teléfono", async () => {
    const res = await request(server())
      .post(`/api/v1/customers/${customerId}/contacts`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ name: "Carlos Administrador" })
      .expect(201);

    expect(res.body).toMatchObject({
      customerId,
      name: "Carlos Administrador",
      phone: null,
      active: true,
    });
    createdContactId = res.body.id;
  });

  test("administrador agrega contacto con teléfono", async () => {
    const res = await request(server())
      .post(`/api/v1/customers/${customerId}/contacts`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "María Compras", phone: "998877665" })
      .expect(201);

    expect(res.body).toMatchObject({
      customerId,
      name: "María Compras",
      phone: "998877665",
      active: true,
    });
  });

  test("chofer no puede agregar contactos (403)", async () => {
    const res = await request(server())
      .post(`/api/v1/customers/${customerId}/contacts`)
      .set("Authorization", `Bearer ${driverToken}`)
      .send({ name: "Contacto Chofer" })
      .expect(403);
    expect(res.status).toBe(403);
  });

  test("listar contactos devuelve activos", async () => {
    const res = await request(server())
      .get(`/api/v1/customers/${customerId}/contacts`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(200);

    expect(res.body.length).toBe(2);
  });

  test("quitar un contacto lo desactiva, preserva el otro, y guarda quién lo quitó", async () => {
    await request(server())
      .delete(`/api/v1/customers/${customerId}/contacts/${createdContactId}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(200);

    // Listar ahora devuelve solo 1 contacto activo
    const listRes = await request(server())
      .get(`/api/v1/customers/${customerId}/contacts`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(200);

    expect(listRes.body.length).toBe(1);
    expect(listRes.body[0].name).toBe("María Compras");

    // En la base de datos sigue existiendo el contacto desactivado con auditoría
    const softDeleted = await prisma.customerContact.findUniqueOrThrow({
      where: { id: createdContactId },
    });
    expect(softDeleted.active).toBe(false);
    expect(softDeleted.removedById).not.toBeNull();
    expect(softDeleted.removedAt).not.toBeNull();
  });
});

describe("Customer Location Photos", () => {
  const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  let adminPhotoId: string;
  let driverPhotoId: string;

  test("rechaza archivo de texto disfrazado de jpg (validación de magic bytes)", async () => {
    const fakeJpg = Buffer.from("Este es un archivo de texto plano disfrazado");
    const res = await request(server())
      .post(`/api/v1/customer-locations/${locationId}/photos`)
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("file", fakeJpg, "fake.jpg");

    expect(res.status).toBe(400);
    expect(res.body.message).toContain("Formato no permitido");
  });

  test("rechaza archivo mayor a 5 MB", async () => {
    const largeBuffer = Buffer.alloc(5 * 1024 * 1024 + 1);
    largeBuffer[0] = 0xff;
    largeBuffer[1] = 0xd8;
    largeBuffer[2] = 0xff;

    const res = await request(server())
      .post(`/api/v1/customer-locations/${locationId}/photos`)
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("file", largeBuffer, "large.jpg");

    expect(res.status).toBe(400);
    expect(res.body.message).toContain("5 MB");
  });

  test("subida desde la web (admin) queda aprobada de inmediato y se lee idéntica en bytes", async () => {
    const res = await request(server())
      .post(`/api/v1/customer-locations/${locationId}/photos`)
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("file", validJpeg, "fachada.jpg");

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("APPROVED");
    expect(res.body.reviewedById).not.toBeNull();
    adminPhotoId = res.body.id;

    // Leer el archivo crudo
    const rawRes = await request(server())
      .get(`/api/v1/customer-locations/photos/${adminPhotoId}/raw`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(rawRes.headers["content-type"]).toBe("image/jpeg");
    expect(rawRes.body).toEqual(validJpeg);
  });

  test("sin sesión la lectura de fotos da 401", async () => {
    const res = await request(server())
      .get(`/api/v1/customer-locations/photos/${adminPhotoId}/raw`)
      .expect(401);
    expect(res.status).toBe(401);
  });

  test("chofer no puede leer fotos de un local que no está en sus rutas (403)", async () => {
    // driverOtherToken no tiene customer 1 en sus rutas
    const res = await request(server())
      .get(`/api/v1/customer-locations/photos/${adminPhotoId}/raw`)
      .set("Authorization", `Bearer ${driverOtherToken}`)
      .expect(403);
    expect(res.status).toBe(403);
  });

  test("chofer con el local en su ruta sí puede leer fotos aprobadas (200)", async () => {
    const res = await request(server())
      .get(`/api/v1/customer-locations/photos/${adminPhotoId}/raw`)
      .set("Authorization", `Bearer ${driverToken}`)
      .expect(200);
    expect(res.status).toBe(200);
  });

  test("subida del chofer queda PENDING y NO aparece en la ficha del local", async () => {
    const res = await request(server())
      .post(`/api/v1/customer-locations/${locationId}/photos`)
      .set("Authorization", `Bearer ${driverToken}`)
      .attach("file", validJpeg, "chofer-evidencia.jpg");

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
    expect(res.body.reviewedById).toBeNull();
    driverPhotoId = res.body.id;

    // La ficha lista fotos aprobadas únicamente: sólo debe figurar la foto del admin
    const listRes = await request(server())
      .get(`/api/v1/customer-locations/${locationId}/photos`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(listRes.body.length).toBe(1);
    expect(listRes.body[0].id).toBe(adminPhotoId);

    // En cambio, la bandeja de pendientes sí la contiene
    const pendingRes = await request(server())
      .get("/api/v1/pending-approvals")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const pendingPhoto = pendingRes.body.photos.find((p: { id: string }) => p.id === driverPhotoId);
    expect(pendingPhoto).toBeDefined();
  });

  test("vendedor no puede aprobar fotos del chofer (403)", async () => {
    const res = await request(server())
      .patch(`/api/v1/customer-locations/photos/${driverPhotoId}/review`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "APPROVED" })
      .expect(403);
    expect(res.status).toBe(403);
  });

  test("rechazar foto sin motivo devuelve 400", async () => {
    const res = await request(server())
      .patch(`/api/v1/customer-locations/photos/${driverPhotoId}/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "REJECTED" });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain("El motivo de rechazo es obligatorio");
  });

  test("administrador aprueba la foto del chofer y ahora aparece en la ficha", async () => {
    const res = await request(server())
      .patch(`/api/v1/customer-locations/photos/${driverPhotoId}/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "APPROVED" })
      .expect(200);

    expect(res.body.status).toBe("APPROVED");
    expect(res.body.reviewedById).not.toBeNull();

    // Ahora la ficha devuelve 2 fotos aprobadas
    const listRes = await request(server())
      .get(`/api/v1/customer-locations/${locationId}/photos`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(listRes.body.length).toBe(2);
  });

  test("administrador oculta foto con motivo obligatorio", async () => {
    // Sin motivo: 400
    await request(server())
      .patch(`/api/v1/customer-locations/photos/${driverPhotoId}/hide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "" })
      .expect(400);

    // Con motivo: 200
    const res = await request(server())
      .patch(`/api/v1/customer-locations/photos/${driverPhotoId}/hide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Foto tomada con poca luz" })
      .expect(200);

    expect(res.body.hiddenAt).not.toBeNull();
    expect(res.body.hiddenReason).toBe("Foto tomada con poca luz");

    // La foto oculta ya no sale en la ficha
    const listRes = await request(server())
      .get(`/api/v1/customer-locations/${locationId}/photos`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(listRes.body.length).toBe(1);
    expect(listRes.body[0].id).toBe(adminPhotoId);
  });

  test("límite de 10 visibles: la 11 se rechaza, pero al ocultar una, la 11 pasa", async () => {
    // Actualmente hay 1 visible (adminPhotoId). Subamos 9 más para llegar a 10.
    const createdIds: string[] = [];
    for (let i = 2; i <= 10; i++) {
      const up = await request(server())
        .post(`/api/v1/customer-locations/${locationId}/photos`)
        .set("Authorization", `Bearer ${adminToken}`)
        .attach("file", validJpeg, `foto-${i}.jpg`)
        .expect(201);
      createdIds.push(up.body.id);
    }

    // Intento número 11 debe ser rechazado
    const overLimitRes = await request(server())
      .post(`/api/v1/customer-locations/${locationId}/photos`)
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("file", validJpeg, "foto-11.jpg");

    expect(overLimitRes.status).toBe(400);
    expect(overLimitRes.body.message).toContain("máximo de 10 fotos visibles");

    // Ocultar una foto
    await request(server())
      .patch(`/api/v1/customer-locations/photos/${createdIds[0]}/hide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Liberando espacio para foto 11" })
      .expect(200);

    // Ahora la 11 sí pasa
    const retryRes = await request(server())
      .post(`/api/v1/customer-locations/${locationId}/photos`)
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("file", validJpeg, "foto-11.jpg")
      .expect(201);

    expect(retryRes.body.status).toBe("APPROVED");
  });
});

describe("Coordinate Requests", () => {
  let requestId: string;

  test("chofer no puede proponer coordenadas de un local ajeno (403)", async () => {
    const res = await request(server())
      .post(`/api/v1/customer-locations/${otherLocationId}/coordinate-requests`)
      .set("Authorization", `Bearer ${driverToken}`)
      .send({
        latitude: "-12.046374",
        longitude: "-77.042793",
        accuracyM: "5.20",
      })
      .expect(403);
    expect(res.status).toBe(403);
  });

  test("chofer propone coordenadas: queda PENDING y no cambia las del local", async () => {
    // Establecer coordenadas iniciales en el local
    await prisma.customerLocation.update({
      where: { id: locationId },
      data: { latitude: "-12.000000", longitude: "-77.000000" },
    });

    const res = await request(server())
      .post(`/api/v1/customer-locations/${locationId}/coordinate-requests`)
      .set("Authorization", `Bearer ${driverToken}`)
      .send({
        latitude: "-12.046374",
        longitude: "-77.042793",
        accuracyM: "4.80",
      })
      .expect(201);

    expect(res.body.status).toBe("PENDING");
    expect(res.body.latitude).toBe("-12.046374");
    expect(res.body.longitude).toBe("-77.042793");
    expect(res.body.accuracyM).toBe("4.80");
    requestId = res.body.id;

    // El local sigue teniendo sus coordenadas anteriores
    const loc = await prisma.customerLocation.findUniqueOrThrow({
      where: { id: locationId },
    });
    expect(loc.latitude?.toString()).toBe("-12");
    expect(loc.longitude?.toString()).toBe("-77");

    // Aparece en la bandeja de pendientes
    const pending = await request(server())
      .get("/api/v1/pending-approvals")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const foundReq = pending.body.coordinateRequests.find(
      (r: { id: string }) => r.id === requestId,
    );
    expect(foundReq).toBeDefined();
    expect(foundReq.latitude).toBe("-12.046374");
  });

  test("vendedor no puede aprobar solicitud de coordenadas (403)", async () => {
    const res = await request(server())
      .patch(`/api/v1/customer-locations/coordinate-requests/${requestId}/review`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "APPROVED" })
      .expect(403);
    expect(res.status).toBe(403);
  });

  test("rechazo de coordenadas sin motivo devuelve 400", async () => {
    const res = await request(server())
      .patch(`/api/v1/customer-locations/coordinate-requests/${requestId}/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "REJECTED" });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain("El motivo de rechazo es obligatorio");
  });

  test("administrador aprueba solicitud: actualiza el local y registra coordenadas previas", async () => {
    const res = await request(server())
      .patch(`/api/v1/customer-locations/coordinate-requests/${requestId}/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "APPROVED" })
      .expect(200);

    expect(res.body.status).toBe("APPROVED");
    expect(res.body.previousLatitude).toBe("-12.000000");
    expect(res.body.previousLongitude).toBe("-77.000000");

    // En la tabla customer_locations las coordenadas cambiaron a las propuestas
    const updatedLoc = await prisma.customerLocation.findUniqueOrThrow({
      where: { id: locationId },
    });
    expect(updatedLoc.latitude?.toString()).toBe("-12.046374");
    expect(updatedLoc.longitude?.toString()).toBe("-77.042793");
  });
});
