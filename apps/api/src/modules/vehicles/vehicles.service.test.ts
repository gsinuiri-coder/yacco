import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PrismaService } from "../../prisma/prisma.service.js";
import { VehiclesService } from "./vehicles.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockFn = jest.Mock<(...args: any[]) => Promise<unknown>>;

type MockPrisma = {
  vehicle: {
    findUnique: MockFn;
    findFirst: MockFn;
    findMany: MockFn;
    create: MockFn;
    update: MockFn;
  };
  vehicleReviewType: {
    findUnique: MockFn;
    findFirst: MockFn;
    findMany: MockFn;
    create: MockFn;
    update: MockFn;
  };
  vehicleReview: {
    findUnique: MockFn;
    findMany: MockFn;
    create: MockFn;
    update: MockFn;
  };
  routeVehicleAssignment: {
    count: MockFn;
  };
  route: {
    findFirst: MockFn;
  };
  user: {
    findMany: MockFn;
    findUnique: MockFn;
  };
};

describe("VehiclesService", () => {
  let service: VehiclesService;
  let prisma: MockPrisma;

  const ADMIN_ID = "admin-uuid";
  const VEHICLE_ID = "vehicle-uuid";
  const REVIEW_TYPE_ID = "review-type-uuid";
  const REVIEW_ID = "review-uuid";

  beforeEach(() => {
    prisma = {
      vehicle: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      vehicleReviewType: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      vehicleReview: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      routeVehicleAssignment: {
        count: jest.fn(),
      },
      route: {
        findFirst: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    service = new VehiclesService(prisma as unknown as PrismaService);
  });

  describe("createVehicle", () => {
    it("crea un vehículo normalizando la placa en mayúsculas sin guiones ni espacios", async () => {
      prisma.vehicle.findFirst.mockResolvedValue(null);
      prisma.vehicle.create.mockResolvedValue({
        id: VEHICLE_ID,
        plate: "ABC123",
        name: "Camión 1",
        brand: "Toyota",
        model: "Dyna",
        capacityUnits: 80,
        vehicleClass: "N2",
        circulationCardNumber: "TUC-123",
        active: true,
        createdById: ADMIN_ID,
        createdAt: new Date(),
        updatedById: null,
        updatedAt: null,
      });

      const result = await service.createVehicle(
        {
          plate: "abc- 123",
          name: "Camión 1",
          brand: "Toyota",
          model: "Dyna",
          capacityUnits: 80,
          vehicleClass: "N2",
          circulationCardNumber: "TUC-123",
        },
        ADMIN_ID,
      );

      expect(prisma.vehicle.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          plate: "ABC123",
          createdById: ADMIN_ID,
        }),
      });
      expect(result.plate).toBe("ABC123");
    });

    it("lanza ConflictException si ya existe un vehículo con esa placa", async () => {
      prisma.vehicle.findFirst.mockResolvedValue({ id: "existing-id", plate: "ABC123" });

      await expect(
        service.createVehicle(
          {
            plate: "ABC-123",
            name: "Camión 2",
            brand: "Toyota",
            model: "Dyna",
          },
          ADMIN_ID,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("updateVehicle", () => {
    it("lanza ConflictException si se intenta cambiar la placa de un vehículo que ya estuvo en una ruta", async () => {
      prisma.vehicle.findUnique.mockResolvedValue({
        id: VEHICLE_ID,
        plate: "ABC123",
        name: "Camión 1",
      });
      prisma.routeVehicleAssignment.count.mockResolvedValue(1);

      await expect(
        service.updateVehicle(VEHICLE_ID, { plate: "XYZ-999" }, ADMIN_ID),
      ).rejects.toThrow(ConflictException);
    });

    it("permite cambiar la placa si el vehículo nunca estuvo en una ruta", async () => {
      prisma.vehicle.findUnique.mockResolvedValue({
        id: VEHICLE_ID,
        plate: "ABC123",
        name: "Camión 1",
      });
      prisma.routeVehicleAssignment.count.mockResolvedValue(0);
      prisma.vehicle.findFirst.mockResolvedValue(null);
      prisma.vehicle.update.mockResolvedValue({
        id: VEHICLE_ID,
        plate: "XYZ999",
        name: "Camión 1",
        brand: "Toyota",
        model: "Dyna",
        capacityUnits: 80,
        vehicleClass: null,
        circulationCardNumber: null,
        active: true,
        createdById: ADMIN_ID,
        createdAt: new Date(),
        updatedById: ADMIN_ID,
        updatedAt: new Date(),
      });

      const result = await service.updateVehicle(VEHICLE_ID, { plate: "xyz-999" }, ADMIN_ID);
      expect(result.plate).toBe("XYZ999");
    });
  });

  describe("createReview", () => {
    it("lanza BadRequestException si endsOn es anterior a startsOn", async () => {
      await expect(
        service.createReview(
          VEHICLE_ID,
          {
            reviewTypeId: REVIEW_TYPE_ID,
            startsOn: "2026-10-15",
            endsOn: "2026-10-10",
          },
          ADMIN_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("lanza NotFoundException si el vehículo no existe", async () => {
      prisma.vehicle.findUnique.mockResolvedValue(null);

      await expect(
        service.createReview(
          VEHICLE_ID,
          {
            reviewTypeId: REVIEW_TYPE_ID,
            startsOn: "2026-10-10",
            endsOn: "2026-10-15",
          },
          ADMIN_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("voidReview", () => {
    it("lanza BadRequestException si el motivo de anulación está vacío", async () => {
      await expect(
        service.voidReview(VEHICLE_ID, REVIEW_ID, { voidReason: "   " }, ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it("lanza ConflictException si la revisión ya está anulada", async () => {
      prisma.vehicleReview.findUnique.mockResolvedValue({
        id: REVIEW_ID,
        vehicleId: VEHICLE_ID,
        voidedAt: new Date(),
      });

      await expect(
        service.voidReview(VEHICLE_ID, REVIEW_ID, { voidReason: "Error" }, ADMIN_ID),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("getVehicleReviewsStatus", () => {
    it("calcula vigencia, por vencer, vencida y sin registro considerando la última no anulada", async () => {
      prisma.vehicle.findUnique.mockResolvedValue({ id: VEHICLE_ID });
      prisma.vehicleReviewType.findMany.mockResolvedValue([
        { id: "type-soat", name: "SOAT", active: true },
        { id: "type-extintor", name: "Extintor", active: true },
        { id: "type-tec", name: "Revisión técnica", active: true },
        { id: "type-sin-reg", name: "Frenos", active: true },
      ]);

      // Supongamos que hoy es 2026-10-12
      // - SOAT: vence en 2026-11-12 (> 15 días) -> VIGENTE
      // - Extintor: vence en 2026-10-20 (8 días) -> POR_VENCER
      // - Revisión técnica: una anulada vence en 2027, pero la vigente previa venció 2026-10-01 -> VENCIDA
      // - Frenos: sin registros -> SIN_REGISTRO
      prisma.vehicleReview.findMany.mockResolvedValue([
        {
          id: "r-soat",
          vehicleId: VEHICLE_ID,
          reviewTypeId: "type-soat",
          reviewType: { id: "type-soat", name: "SOAT" },
          startsOn: new Date("2026-01-01T00:00:00Z"),
          endsOn: new Date("2026-11-12T00:00:00Z"),
          notes: null,
          recordedById: ADMIN_ID,
          recordedBy: { id: ADMIN_ID, name: "Admin" },
          createdAt: new Date("2026-01-01T12:00:00Z"),
          voidedAt: null,
          voidedById: null,
          voidedBy: null,
          voidReason: null,
        },
        {
          id: "r-extintor",
          vehicleId: VEHICLE_ID,
          reviewTypeId: "type-extintor",
          reviewType: { id: "type-extintor", name: "Extintor" },
          startsOn: new Date("2026-01-01T00:00:00Z"),
          endsOn: new Date("2026-10-20T00:00:00Z"),
          notes: null,
          recordedById: ADMIN_ID,
          recordedBy: { id: ADMIN_ID, name: "Admin" },
          createdAt: new Date("2026-01-01T12:00:00Z"),
          voidedAt: null,
          voidedById: null,
          voidedBy: null,
          voidReason: null,
        },
        {
          id: "r-tec-anulada",
          vehicleId: VEHICLE_ID,
          reviewTypeId: "type-tec",
          reviewType: { id: "type-tec", name: "Revisión técnica" },
          startsOn: new Date("2026-10-01T00:00:00Z"),
          endsOn: new Date("2027-10-01T00:00:00Z"),
          notes: null,
          recordedById: ADMIN_ID,
          recordedBy: { id: ADMIN_ID, name: "Admin" },
          createdAt: new Date("2026-10-02T12:00:00Z"),
          voidedAt: new Date("2026-10-02T13:00:00Z"),
          voidedById: ADMIN_ID,
          voidedBy: { id: ADMIN_ID, name: "Admin" },
          voidReason: "Documento erróneo",
        },
        {
          id: "r-tec-vencida",
          vehicleId: VEHICLE_ID,
          reviewTypeId: "type-tec",
          reviewType: { id: "type-tec", name: "Revisión técnica" },
          startsOn: new Date("2025-10-01T00:00:00Z"),
          endsOn: new Date("2026-10-01T00:00:00Z"),
          notes: null,
          recordedById: ADMIN_ID,
          recordedBy: { id: ADMIN_ID, name: "Admin" },
          createdAt: new Date("2025-10-01T12:00:00Z"),
          voidedAt: null,
          voidedById: null,
          voidedBy: null,
          voidReason: null,
        },
      ]);

      const statuses = await service.getVehicleReviewsStatus(VEHICLE_ID, "2026-10-12");

      const soat = statuses.find((s) => s.reviewTypeName === "SOAT");
      expect(soat?.status).toBe("VIGENTE");
      expect(soat?.daysRemaining).toBe(31);

      const extintor = statuses.find((s) => s.reviewTypeName === "Extintor");
      expect(extintor?.status).toBe("POR_VENCER");
      expect(extintor?.daysRemaining).toBe(8);

      const tec = statuses.find((s) => s.reviewTypeName === "Revisión técnica");
      expect(tec?.status).toBe("VENCIDA");
      expect(tec?.daysRemaining).toBe(-11);

      const sinReg = statuses.find((s) => s.reviewTypeName === "Frenos");
      expect(sinReg?.status).toBe("SIN_REGISTRO");
      expect(sinReg?.daysRemaining).toBeNull();
    });

    it("evalúa correctamente el borde de horario a las 23:30 en America/Lima", async () => {
      // 2026-10-12 a las 23:30 en Lima (UTC-5) es 2026-10-13 04:30 UTC
      const instantAt2330 = new Date("2026-10-13T04:30:00.000Z");
      // Debe resolver hoy en Lima como 2026-10-12
      const today = service.getTodayLima(instantAt2330);
      expect(today).toBe("2026-10-12");
    });
  });

  describe("findAllVehicles & findOneVehicle", () => {
    it("lista solo activos por defecto y todos si includeInactive es true", async () => {
      prisma.vehicle.findMany.mockResolvedValue([
        {
          id: VEHICLE_ID,
          plate: "ABC123",
          name: "Camión 1",
          brand: "Toyota",
          model: "Dyna",
          capacityUnits: 80,
          vehicleClass: null,
          circulationCardNumber: null,
          active: true,
          createdById: ADMIN_ID,
          createdAt: new Date(),
          updatedById: null,
          updatedAt: null,
        },
      ]);

      const activeOnly = await service.findAllVehicles(false);
      expect(prisma.vehicle.findMany).toHaveBeenCalledWith({
        where: { active: true },
        orderBy: [{ active: "desc" }, { plate: "asc" }],
      });
      expect(activeOnly.length).toBe(1);

      await service.findAllVehicles(true);
      expect(prisma.vehicle.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ active: "desc" }, { plate: "asc" }],
      });
    });

    it("findOneVehicle devuelve el vehículo o lanza NotFoundException", async () => {
      prisma.vehicle.findUnique.mockResolvedValueOnce({
        id: VEHICLE_ID,
        plate: "ABC123",
        name: "Camión 1",
        brand: "Toyota",
        model: "Dyna",
        capacityUnits: 80,
        vehicleClass: null,
        circulationCardNumber: null,
        active: true,
        createdById: ADMIN_ID,
        createdAt: new Date(),
        updatedById: null,
        updatedAt: null,
      });

      const found = await service.findOneVehicle(VEHICLE_ID);
      expect(found.id).toBe(VEHICLE_ID);

      prisma.vehicle.findUnique.mockResolvedValueOnce(null);
      await expect(service.findOneVehicle("invalid-id")).rejects.toThrow(NotFoundException);
    });
  });

  describe("vehicleReviewTypes", () => {
    it("crea un tipo de revisión y lista tipos de revisión", async () => {
      prisma.vehicleReviewType.findFirst.mockResolvedValue(null);
      prisma.vehicleReviewType.create.mockResolvedValue({
        id: REVIEW_TYPE_ID,
        name: "Seguro Todo Riesgo",
        active: true,
        createdById: ADMIN_ID,
        createdAt: new Date(),
      });

      const created = await service.createReviewType({ name: "Seguro Todo Riesgo" }, ADMIN_ID);
      expect(created.name).toBe("Seguro Todo Riesgo");

      prisma.vehicleReviewType.findFirst.mockResolvedValue({
        id: "dup",
        name: "Seguro Todo Riesgo",
      });
      await expect(
        service.createReviewType({ name: "Seguro Todo Riesgo" }, ADMIN_ID),
      ).rejects.toThrow(ConflictException);

      await expect(service.createReviewType({ name: "   " }, ADMIN_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("actualiza un tipo de revisión (activar/desactivar)", async () => {
      prisma.vehicleReviewType.findUnique.mockResolvedValueOnce({
        id: REVIEW_TYPE_ID,
        name: "SOAT",
        active: true,
      });
      prisma.vehicleReviewType.update.mockResolvedValue({
        id: REVIEW_TYPE_ID,
        name: "SOAT",
        active: false,
        createdById: ADMIN_ID,
        createdAt: new Date(),
      });

      const updated = await service.updateReviewType(REVIEW_TYPE_ID, { active: false });
      expect(updated.active).toBe(false);

      prisma.vehicleReviewType.findUnique.mockResolvedValueOnce(null);
      await expect(service.updateReviewType("missing", { active: false })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("getUpcomingReviewAlerts", () => {
    it("encuentra revisiones por vencer/vencidas de vehículos y licencias de choferes", async () => {
      prisma.vehicle.findMany.mockResolvedValue([{ id: "v-1", plate: "ABC123", name: "Camión 1" }]);
      prisma.vehicle.findUnique.mockResolvedValue({ id: "v-1" });
      prisma.vehicleReviewType.findMany.mockResolvedValue([
        { id: "rt-soat", name: "SOAT", active: true },
      ]);
      prisma.vehicleReview.findMany.mockResolvedValue([
        {
          id: "rev-1",
          vehicleId: "v-1",
          reviewTypeId: "rt-soat",
          reviewType: { id: "rt-soat", name: "SOAT" },
          startsOn: new Date("2026-01-01T00:00:00Z"),
          endsOn: new Date("2026-10-20T00:00:00Z"),
          notes: null,
          recordedById: ADMIN_ID,
          recordedBy: { id: ADMIN_ID, name: "Admin" },
          createdAt: new Date(),
          voidedAt: null,
          voidedById: null,
          voidedBy: null,
          voidReason: null,
        },
      ]);

      prisma.user.findMany.mockResolvedValue([
        {
          id: "u-driver",
          name: "Juan Chofer",
          licenseNumber: "Q12345678",
          licenseCategory: "A-IIb",
          licenseExpiresOn: new Date("2026-10-01T00:00:00Z"),
        },
      ]);

      const alerts = await service.getUpcomingReviewAlerts("2026-10-12");
      expect(alerts.length).toBe(2);

      // Juan Chofer venció el 2026-10-01 (VENCIDA) -> primero
      expect(alerts[0]!.type).toBe("DRIVER_LICENSE");
      expect(alerts[0]!.status).toBe("VENCIDA");
      expect(alerts[0]!.targetName).toBe("Juan Chofer");

      // Camión 1 vence el 2026-10-20 (POR_VENCER) -> segundo
      expect(alerts[1]!.type).toBe("VEHICLE_REVIEW");
      expect(alerts[1]!.status).toBe("POR_VENCER");
      expect(alerts[1]!.targetName).toBe("ABC123 (Camión 1)");
    });
  });

  describe("findAllReviewsByVehicle", () => {
    it("devuelve las revisiones de un vehículo ordenadas", async () => {
      prisma.vehicleReview.findMany.mockResolvedValueOnce([
        {
          id: "r-1",
          vehicleId: VEHICLE_ID,
          reviewTypeId: REVIEW_TYPE_ID,
          reviewType: { id: REVIEW_TYPE_ID, name: "SOAT" },
          startsOn: new Date("2026-01-01T00:00:00Z"),
          endsOn: new Date("2027-01-01T00:00:00Z"),
          notes: "Nota",
          recordedById: ADMIN_ID,
          recordedBy: { id: ADMIN_ID, name: "Admin" },
          createdAt: new Date(),
          voidedAt: null,
          voidedById: null,
          voidedBy: null,
          voidReason: null,
        },
      ]);
      const res = await service.findAllReviewsByVehicle(VEHICLE_ID);
      expect(res.length).toBe(1);
      expect(res[0]!.id).toBe("r-1");
    });
  });

  describe("calculateVehicleAndDriverWarnings", () => {
    it("genera advertencias para revisión vencida, licencia por vencer y vehículo en otra ruta", async () => {
      // Las advertencias se miden contra hoy en Lima: sin fijarlo, la licencia
      // del 2026-10-20 pasa de «por vencer» a «vencida» con el calendario.
      jest.spyOn(service, "getTodayLima").mockReturnValue("2026-10-12");
      prisma.vehicle.findUnique.mockResolvedValue({ id: VEHICLE_ID });
      prisma.vehicleReviewType.findMany.mockResolvedValue([
        { id: REVIEW_TYPE_ID, name: "SOAT", active: true },
      ]);
      prisma.vehicleReview.findMany.mockResolvedValue([
        {
          id: "rev-vencida",
          vehicleId: VEHICLE_ID,
          reviewTypeId: REVIEW_TYPE_ID,
          reviewType: { id: REVIEW_TYPE_ID, name: "SOAT" },
          startsOn: new Date("2025-01-01T00:00:00Z"),
          endsOn: new Date("2026-01-01T00:00:00Z"),
          notes: null,
          recordedById: ADMIN_ID,
          recordedBy: { id: ADMIN_ID, name: "Admin" },
          createdAt: new Date(),
          voidedAt: null,
          voidedById: null,
          voidedBy: null,
          voidReason: null,
        },
      ]);
      prisma.user.findUnique.mockResolvedValue({
        id: "driver-id",
        licenseExpiresOn: new Date("2026-10-20T00:00:00Z"),
      });
      prisma.route.findFirst.mockResolvedValue({ id: "other-route-id" });

      const warnings = await service.calculateVehicleAndDriverWarnings(
        VEHICLE_ID,
        "driver-id",
        "2026-10-12",
      );
      expect(warnings).toContain('El vehículo tiene la revisión "SOAT" vencida');
      expect(warnings).toContain("La licencia de conducir del chofer está por vencer");
      expect(warnings).toContain(
        "El vehículo ya se encuentra en uso en otra ruta en curso el día de hoy",
      );
    });
  });
});
