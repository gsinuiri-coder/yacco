import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { UsersService } from "./users.service.js";

// Gherkin quoted from spec §2.4, HU-22:
// "Dado el rol administrador, cuando creo un usuario con los roles vendedor y
// repartidor, entonces ese usuario accede a las funciones de ambos."

function buildPrismaMock() {
  return {
    user: {
      create: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
      update: jest.fn<() => Promise<unknown>>(),
    },
    role: {
      findMany: jest.fn<() => Promise<unknown>>(),
    },
    userRoleAssignment: {
      deleteMany: jest.fn<() => Promise<unknown>>(),
      createMany: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
    },
    $transaction: jest.fn<(callback: (tx: unknown) => Promise<unknown>) => Promise<unknown>>(),
  };
}

describe("UsersService", () => {
  let service: UsersService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    prisma.$transaction.mockImplementation((callback) => callback(prisma));

    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  describe("create", () => {
    it("HU-22 E1: creating a user with roles SELLER and DRIVER assigns both roles", async () => {
      const sellerRole = { id: "role-seller", name: UserRole.SELLER };
      const driverRole = { id: "role-driver", name: UserRole.DRIVER };
      prisma.role.findMany.mockResolvedValue([sellerRole, driverRole]);
      prisma.user.create.mockResolvedValue({
        id: "user-1",
        name: "Juana Pérez",
        username: "jperez",
        active: true,
      });
      prisma.userRoleAssignment.createMany.mockResolvedValue({ count: 2 });

      const result = await service.create({
        name: "Juana Pérez",
        username: "jperez",
        password: "s3cr3t-password",
        roles: [UserRole.SELLER, UserRole.DRIVER],
      });

      expect(prisma.role.findMany).toHaveBeenCalledWith({
        where: { name: { in: [UserRole.SELLER, UserRole.DRIVER] } },
      });
      expect(prisma.userRoleAssignment.createMany).toHaveBeenCalledWith({
        data: [
          { userId: "user-1", roleId: "role-seller" },
          { userId: "user-1", roleId: "role-driver" },
        ],
      });
      expect(result.roles).toEqual(expect.arrayContaining([UserRole.SELLER, UserRole.DRIVER]));
    });

    it("throws ConflictException when the username is already taken", async () => {
      prisma.role.findMany.mockResolvedValue([{ id: "role-admin", name: UserRole.ADMIN }]);
      prisma.user.create.mockRejectedValue(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );

      await expect(
        service.create({
          name: "Duplicado",
          username: "admin",
          password: "s3cr3t-password",
          roles: [UserRole.ADMIN],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("findAll / toSafeUser", () => {
    it("never includes passwordHash in the returned shape", async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          id: "user-1",
          name: "Admin",
          username: "admin",
          passwordHash: "hashed-secret",
          active: true,
          roles: [{ role: { name: UserRole.ADMIN } }],
        },
      ]);

      const users = await service.findAll();

      expect(users).toHaveLength(1);
      expect(users[0]).not.toHaveProperty("passwordHash");
      expect(users[0]?.roles).toEqual([UserRole.ADMIN]);
    });
  });

  describe("update", () => {
    it("replaces the role set instead of merging it", async () => {
      prisma.user.update.mockResolvedValue({
        id: "user-1",
        name: "Juana Pérez",
        username: "jperez",
        active: true,
      });
      prisma.role.findMany.mockResolvedValue([{ id: "role-admin", name: UserRole.ADMIN }]);
      prisma.userRoleAssignment.deleteMany.mockResolvedValue({ count: 2 });
      prisma.userRoleAssignment.createMany.mockResolvedValue({ count: 1 });

      const result = await service.update("user-1", { roles: [UserRole.ADMIN] });

      expect(prisma.userRoleAssignment.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
      });
      expect(prisma.userRoleAssignment.createMany).toHaveBeenCalledWith({
        data: [{ userId: "user-1", roleId: "role-admin" }],
      });
      expect(result.roles).toEqual([UserRole.ADMIN]);
    });

    it("throws NotFoundException for an unknown id", async () => {
      prisma.user.update.mockRejectedValue(
        Object.assign(new Error("Record not found"), { code: "P2025" }),
      );

      await expect(service.update("missing", { active: false })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
