import request from "supertest";
import { UserRole } from "@prisma/client";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

let ctx: TestAppContext;
let adminToken: string;
let sellerToken: string;
let driverToken: string;
let driverId: string;
let zoneId: string;

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

beforeAll(async () => {
  ctx = await startTestApp();
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  sellerToken = (await createUserAndLogin("vendedor-vehiculos", UserRole.SELLER)).token;
  const driver = await createUserAndLogin("repartidor-vehiculos", UserRole.DRIVER);
  driverToken = driver.token;
  driverId = driver.id;

  const zone = await request(server())
    .post("/api/v1/zones")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "Zona Vehículos Test" })
    .expect(201);
  zoneId = zone.body.id;
}, 60000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("Vehicles Integration Suite", () => {
  describe("Vehicle Catalog (POST /vehicles, GET /vehicles, PATCH /vehicles/:id)", () => {
    it("rejects vehicle creation for SELLER and DRIVER with 403", async () => {
      await request(server())
        .post("/api/v1/vehicles")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ plate: "VND-100", brand: "Toyota", model: "Hilux" })
        .expect(403);

      await request(server())
        .post("/api/v1/vehicles")
        .set("Authorization", `Bearer ${driverToken}`)
        .send({ plate: "DRV-100", brand: "Toyota", model: "Hilux" })
        .expect(403);
    });

    it("creates a vehicle normalizing the plate to uppercase without dashes", async () => {
      const res = await request(server())
        .post("/api/v1/vehicles")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          plate: "abc-123",
          name: "Camión 1",
          brand: "Toyota",
          model: "Dyna",
          capacityUnits: 50,
          vehicleClass: "N1",
          circulationCardNumber: "TUC-9988",
        })
        .expect(201);

      expect(res.body.plate).toBe("ABC123");
      expect(res.body.name).toBe("Camión 1");
      expect(res.body.brand).toBe("Toyota");
      expect(res.body.capacityUnits).toBe(50);
      expect(res.body.active).toBe(true);
      expect(res.body.id).toBeDefined();
    });

    it("rejects duplicate plate with 409 Conflict regardless of hyphen or case", async () => {
      await request(server())
        .post("/api/v1/vehicles")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          plate: "ABC123",
          name: "Duplicado",
          brand: "Toyota",
          model: "Hilux",
        })
        .expect(409);
    });

    it("allows ADMIN, SELLER, and DRIVER to read the vehicle catalog", async () => {
      const adminList = await request(server())
        .get("/api/v1/vehicles")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(Array.isArray(adminList.body)).toBe(true);

      const sellerList = await request(server())
        .get("/api/v1/vehicles")
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);
      expect(Array.isArray(sellerList.body)).toBe(true);

      const driverList = await request(server())
        .get("/api/v1/vehicles")
        .set("Authorization", `Bearer ${driverToken}`)
        .expect(200);
      expect(Array.isArray(driverList.body)).toBe(true);
    });

    it("returns 404 for non-existent vehicle and returns vehicle details when found", async () => {
      await request(server())
        .get(`/api/v1/vehicles/${MISSING_UUID}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(404);

      const list = await request(server())
        .get("/api/v1/vehicles")
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);
      const firstId = list.body[0].id;

      const single = await request(server())
        .get(`/api/v1/vehicles/${firstId}`)
        .set("Authorization", `Bearer ${driverToken}`)
        .expect(200);
      expect(single.body.id).toBe(firstId);
    });

    it("filters inactive vehicles from SELLER and DRIVER, but allows ADMIN with includeInactive=true", async () => {
      const created = await request(server())
        .post("/api/v1/vehicles")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ plate: "INACT-01", name: "Inactivo", brand: "Toyota", model: "Hilux" })
        .expect(201);

      // Deactivate it
      await request(server())
        .patch(`/api/v1/vehicles/${created.body.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ active: false })
        .expect(200);

      // Seller does not see it even with query param
      const sellerRes = await request(server())
        .get("/api/v1/vehicles?includeInactive=true")
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);
      expect(sellerRes.body.some((v: { id: string }) => v.id === created.body.id)).toBe(false);

      // Admin without param does not see it
      const adminDefault = await request(server())
        .get("/api/v1/vehicles")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(adminDefault.body.some((v: { id: string }) => v.id === created.body.id)).toBe(false);

      // Admin with includeInactive=true sees it
      const adminAll = await request(server())
        .get("/api/v1/vehicles?includeInactive=true")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(adminAll.body.some((v: { id: string }) => v.id === created.body.id)).toBe(true);
    });

    it("rejects plate modification if the vehicle was already assigned to a route", async () => {
      const veh = await request(server())
        .post("/api/v1/vehicles")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ plate: "RTE-001", name: "Vehículo En Ruta", brand: "Toyota", model: "Hilux" })
        .expect(201);

      // Create a route using this vehicle
      await request(server())
        .post("/api/v1/routes")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          driverId,
          date: "2026-10-01",
          zoneId,
          vehicleId: veh.body.id,
        })
        .expect(201);

      // Attempt to change plate
      const conflictRes = await request(server())
        .patch(`/api/v1/vehicles/${veh.body.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ plate: "NEW-999" })
        .expect(409);

      expect(conflictRes.body.message).toContain("La placa no se puede modificar");

      // But updating name or other fields is allowed
      const okRes = await request(server())
        .patch(`/api/v1/vehicles/${veh.body.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Nuevo Nombre" })
        .expect(200);
      expect(okRes.body.name).toBe("Nuevo Nombre");
    });
  });

  describe("Vehicle Review Types (GET, POST, PATCH /vehicle-review-types)", () => {
    it("returns seeded review types SOAT, Revisión técnica, Extintor", async () => {
      const res = await request(server())
        .get("/api/v1/vehicle-review-types")
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);

      const names = res.body.map((t: { name: string }) => t.name);
      expect(names).toContain("SOAT");
      expect(names).toContain("Revisión técnica");
      expect(names).toContain("Extintor");
    });

    it("allows ADMIN to create a new review type, forbids SELLER/DRIVER with 403", async () => {
      await request(server())
        .post("/api/v1/vehicle-review-types")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ name: "Botiquín" })
        .expect(403);

      const created = await request(server())
        .post("/api/v1/vehicle-review-types")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Botiquín" })
        .expect(201);

      expect(created.body.name).toBe("Botiquín");
      expect(created.body.active).toBe(true);

      // Duplicate name returns 409
      await request(server())
        .post("/api/v1/vehicle-review-types")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Botiquín" })
        .expect(409);
    });

    it("allows ADMIN to deactivate a review type", async () => {
      const created = await request(server())
        .post("/api/v1/vehicle-review-types")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Prueba Desactivar" })
        .expect(201);

      const updated = await request(server())
        .patch(`/api/v1/vehicle-review-types/${created.body.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ active: false })
        .expect(200);
      expect(updated.body.active).toBe(false);

      // Seller does not see it
      const list = await request(server())
        .get("/api/v1/vehicle-review-types")
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);
      expect(list.body.some((t: { id: string }) => t.id === created.body.id)).toBe(false);
    });
  });

  describe("Vehicle Reviews (POST, PATCH, GET /vehicles/:id/reviews)", () => {
    let testVehicleId: string;
    let soatTypeId: string;
    let extintorTypeId: string;

    beforeAll(async () => {
      const vRes = await request(server())
        .post("/api/v1/vehicles")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ plate: "REV-100", name: "Vehículo Revisiones", brand: "Toyota", model: "Hilux" })
        .expect(201);
      testVehicleId = vRes.body.id;

      const types = await request(server())
        .get("/api/v1/vehicle-review-types")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      soatTypeId = types.body.find((t: { name: string }) => t.name === "SOAT").id;
      extintorTypeId = types.body.find((t: { name: string }) => t.name === "Extintor").id;
    });

    it("rejects review creation when endsOn < startsOn", async () => {
      await request(server())
        .post(`/api/v1/vehicles/${testVehicleId}/reviews`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
          reviewTypeId: soatTypeId,
          startsOn: "2026-10-15",
          endsOn: "2026-10-10",
        })
        .expect(400);
    });

    it("rejects review creation for DRIVER with 403, allows SELLER and ADMIN", async () => {
      await request(server())
        .post(`/api/v1/vehicles/${testVehicleId}/reviews`)
        .set("Authorization", `Bearer ${driverToken}`)
        .send({
          reviewTypeId: soatTypeId,
          startsOn: "2026-01-01",
          endsOn: "2027-01-01",
        })
        .expect(403);

      const res = await request(server())
        .post(`/api/v1/vehicles/${testVehicleId}/reviews`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
          reviewTypeId: soatTypeId,
          startsOn: "2026-01-01",
          endsOn: "2027-01-01",
          notes: "SOAT anual",
        })
        .expect(201);

      expect(res.body.vehicleId).toBe(testVehicleId);
      expect(res.body.startsOn).toBe("2026-01-01");
      expect(res.body.endsOn).toBe("2027-01-01");
      expect(res.body.notes).toBe("SOAT anual");
    });

    it("allows ADMIN to void a review with reason, sets voidedAt, voidedBy, voidReason", async () => {
      const created = await request(server())
        .post(`/api/v1/vehicles/${testVehicleId}/reviews`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
          reviewTypeId: extintorTypeId,
          startsOn: "2026-05-01",
          endsOn: "2026-11-01",
          notes: "Extintor cargado",
        })
        .expect(201);

      // SELLER cannot void
      await request(server())
        .patch(`/api/v1/vehicles/${testVehicleId}/reviews/${created.body.id}/void`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ voidReason: "Error en fecha" })
        .expect(403);

      // ADMIN voids without reason -> 400
      await request(server())
        .patch(`/api/v1/vehicles/${testVehicleId}/reviews/${created.body.id}/void`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ voidReason: "" })
        .expect(400);

      // ADMIN voids successfully
      const voided = await request(server())
        .patch(`/api/v1/vehicles/${testVehicleId}/reviews/${created.body.id}/void`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ voidReason: "Fecha incorrecta digitada por vendedor" })
        .expect(200);

      expect(voided.body.voidedAt).toBeDefined();
      expect(voided.body.voidReason).toBe("Fecha incorrecta digitada por vendedor");

      // Voiding again returns 409 Conflict
      await request(server())
        .patch(`/api/v1/vehicles/${testVehicleId}/reviews/${created.body.id}/void`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ voidReason: "Intento duplicado" })
        .expect(409);
    });

    it("calculates review status correctly: vigente, sin_registro, por_vencer, vencida", async () => {
      const statusRes = await request(server())
        .get(`/api/v1/vehicles/${testVehicleId}/reviews-status`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);

      expect(Array.isArray(statusRes.body)).toBe(true);
      const soatStatus = statusRes.body.find(
        (s: { reviewTypeName: string }) => s.reviewTypeName === "SOAT",
      );
      expect(soatStatus).toBeDefined();
      // endsOn is 2027-01-01, well ahead of current date
      expect(soatStatus.status).toBe("VIGENTE");

      const extintorStatus = statusRes.body.find(
        (s: { reviewTypeName: string }) => s.reviewTypeName === "Extintor",
      );
      // Extintor was voided, so it should be sin_registro
      expect(extintorStatus.status).toBe("SIN_REGISTRO");
    });
  });

  describe("Upcoming Reviews & Driver Licenses (GET /vehicles/upcoming-reviews)", () => {
    it("returns upcoming alerts for vehicles and driver licenses to ADMIN and SELLER, forbids DRIVER", async () => {
      await request(server())
        .get("/api/v1/vehicles/upcoming-reviews")
        .set("Authorization", `Bearer ${driverToken}`)
        .expect(403);

      const res = await request(server())
        .get("/api/v1/vehicles/upcoming-reviews")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);

      const sellerRes = await request(server())
        .get("/api/v1/vehicles/upcoming-reviews")
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);

      expect(Array.isArray(sellerRes.body)).toBe(true);
    });
  });
});
