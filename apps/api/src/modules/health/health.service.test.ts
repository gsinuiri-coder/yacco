import { ServiceUnavailableException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { HealthService } from "./health.service.js";

function buildPrismaMock() {
  return {
    $queryRaw: jest.fn<() => Promise<unknown>>(),
  };
}

describe("HealthService", () => {
  let service: HealthService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const moduleRef = await Test.createTestingModule({
      providers: [HealthService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(HealthService);
  });

  it("resolves when the database answers the query", async () => {
    prisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);

    await expect(service.checkDatabase()).resolves.toBeUndefined();
  });

  it("throws ServiceUnavailableException when the database is unreachable", async () => {
    prisma.$queryRaw.mockRejectedValue(new Error("connection refused"));

    await expect(service.checkDatabase()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
