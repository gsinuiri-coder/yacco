import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ZonesService } from "./zones.service.js";

const ZONE_ID = "11111111-1111-4111-8111-111111111111";

function buildZone(overrides: Record<string, unknown> = {}) {
  return { id: ZONE_ID, name: "Norte", deliveryDays: [], active: true, ...overrides };
}

function prismaError(code: string) {
  return Object.assign(new Error(`prisma ${code}`), { code });
}

function buildPrismaMock() {
  return {
    zone: {
      create: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
      update: jest.fn<() => Promise<unknown>>(),
    },
  };
}

describe("ZonesService", () => {
  let service: ZonesService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    const moduleRef = await Test.createTestingModule({
      providers: [ZonesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ZonesService);
  });

  describe("findAll", () => {
    it("defaults to active-only, so a form never offers a withdrawn zone", async () => {
      prisma.zone.findMany.mockResolvedValue([]);

      await service.findAll({});

      expect(prisma.zone.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { active: true } }),
      );
    });

    it("passes an explicit active:false through instead of defaulting it", async () => {
      prisma.zone.findMany.mockResolvedValue([]);

      await service.findAll({ active: false });

      expect(prisma.zone.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { active: false } }),
      );
    });
  });

  describe("create", () => {
    it("stores an empty deliveryDays when none are given: the decision is not made yet", async () => {
      prisma.zone.create.mockResolvedValue(buildZone());

      const result = await service.create({ name: "Norte" });

      expect(prisma.zone.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { name: "Norte", deliveryDays: [] } }),
      );
      expect(result).toEqual(buildZone());
    });

    it("stores the delivery days when given", async () => {
      prisma.zone.create.mockResolvedValue(buildZone({ deliveryDays: ["MONDAY"] }));

      await service.create({ name: "Norte", deliveryDays: ["MONDAY"] });

      expect(prisma.zone.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { name: "Norte", deliveryDays: ["MONDAY"] } }),
      );
    });

    it("translates a duplicate name (P2002) into a clear Spanish BadRequest", async () => {
      prisma.zone.create.mockRejectedValue(prismaError("P2002"));

      await expect(service.create({ name: "Norte" })).rejects.toThrow(
        new BadRequestException('Ya existe una zona con el nombre "Norte"'),
      );
    });

    it("rethrows anything that is not a known unique violation", async () => {
      prisma.zone.create.mockRejectedValue(new Error("connection lost"));

      await expect(service.create({ name: "Norte" })).rejects.toThrow("connection lost");
    });
  });

  describe("findOne", () => {
    it("returns the row", async () => {
      prisma.zone.findUnique.mockResolvedValue(buildZone());

      await expect(service.findOne(ZONE_ID)).resolves.toEqual(buildZone());
    });

    it("throws NotFound for an unknown id", async () => {
      prisma.zone.findUnique.mockResolvedValue(null);

      await expect(service.findOne(ZONE_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("update", () => {
    it("only sends the fields present in the body", async () => {
      prisma.zone.update.mockResolvedValue(buildZone({ active: false }));

      await service.update(ZONE_ID, { active: false });

      expect(prisma.zone.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ZONE_ID }, data: { active: false } }),
      );
    });

    it("replaces the delivery days list when it comes in the body", async () => {
      prisma.zone.update.mockResolvedValue(buildZone({ deliveryDays: ["TUESDAY", "FRIDAY"] }));

      await service.update(ZONE_ID, { deliveryDays: ["TUESDAY", "FRIDAY"] });

      expect(prisma.zone.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { deliveryDays: ["TUESDAY", "FRIDAY"] } }),
      );
    });

    it("throws NotFound when Prisma reports the row missing (P2025)", async () => {
      prisma.zone.update.mockRejectedValue(prismaError("P2025"));

      await expect(service.update(ZONE_ID, { name: "X" })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("translates renaming onto an existing name (P2002) into a clear BadRequest", async () => {
      prisma.zone.update.mockRejectedValue(prismaError("P2002"));

      await expect(service.update(ZONE_ID, { name: "Sur" })).rejects.toThrow(
        new BadRequestException('Ya existe una zona con el nombre "Sur"'),
      );
    });
  });
});
