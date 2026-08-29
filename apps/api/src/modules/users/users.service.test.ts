import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { UsersService } from "./users.service.js";

/** Actor por defecto de los tests: un id que no es el del usuario editado. */
const ADMIN_ACTOR = "actor-admin";

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

      const error = await service
        .create({
          name: "Duplicado",
          username: "admin",
          password: "s3cr3t-password",
          roles: [UserRole.ADMIN],
        })
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(ConflictException);
      // El texto se fija, no solo la clase: la web lo muestra tal cual, así
      // que el idioma del mensaje es una decisión de producto (ver el
      // docblock de UsersService).
      expect((error as Error).message).toBe(
        'Ya existe un usuario con el nombre de usuario "admin"',
      );
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

      const users = await service.findAll({});

      expect(users).toHaveLength(1);
      expect(users[0]).not.toHaveProperty("passwordHash");
      expect(users[0]?.roles).toEqual([UserRole.ADMIN]);
    });

    it("without filters, defaults the where to active: true and no roles clause", async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.findAll({});

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { active: true } }),
      );
    });

    it("role=DRIVER filters by the roles.some clause", async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.findAll({ role: UserRole.DRIVER });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { active: true, roles: { some: { role: { name: UserRole.DRIVER } } } },
        }),
      );
    });

    it("active=false overrides the default and lists deactivated users", async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.findAll({ active: false });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { active: false } }),
      );
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

      const result = await service.update("user-1", { roles: [UserRole.ADMIN] }, ADMIN_ACTOR);

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

      await expect(
        service.update("missing", { active: false }, ADMIN_ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    /*
     * Nadie puede cerrarse la puerta desde adentro. Las dos mitades son la
     * misma guarda: hasta ahora la de desactivar vivía solo en la web
     * (`users-page.tsx` no ofrece "Desactivar" en la propia fila) y Swagger o
     * un `curl` la salteaban.
     *
     * Lo que estos tests fijan además de los dos rechazos: que la guarda mira
     * SOLO al actor, sin contar administradores. Si nadie puede quitarse a sí
     * mismo, siempre queda al menos quien está haciendo el cambio.
     */
    describe("guarda de auto-degradación", () => {
      it("el actor no puede desactivarse a sí mismo", async () => {
        const error = await service
          .update(ADMIN_ACTOR, { active: false }, ADMIN_ACTOR)
          .catch((thrown: unknown) => thrown);

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as Error).message).toBe("No puedes desactivar tu propio usuario");
        expect(prisma.user.update).not.toHaveBeenCalled();
      });

      it("el actor no puede quitarse a sí mismo el rol ADMIN", async () => {
        const error = await service
          .update(ADMIN_ACTOR, { roles: [UserRole.SELLER] }, ADMIN_ACTOR)
          .catch((thrown: unknown) => thrown);

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as Error).message).toBe("No puedes quitarte a ti mismo la administración");
        expect(prisma.userRoleAssignment.deleteMany).not.toHaveBeenCalled();
      });

      it("el actor sí puede cambiarse otras cosas: nombre, contraseña y roles que conserven ADMIN", async () => {
        prisma.user.update.mockResolvedValue({
          id: ADMIN_ACTOR,
          name: "Nuevo Nombre",
          username: "admin",
          active: true,
        });
        prisma.role.findMany.mockResolvedValue([
          { id: "role-admin", name: UserRole.ADMIN },
          { id: "role-driver", name: UserRole.DRIVER },
        ]);
        prisma.userRoleAssignment.deleteMany.mockResolvedValue({ count: 1 });
        prisma.userRoleAssignment.createMany.mockResolvedValue({ count: 2 });

        const result = await service.update(
          ADMIN_ACTOR,
          { name: "Nuevo Nombre", roles: [UserRole.ADMIN, UserRole.DRIVER] },
          ADMIN_ACTOR,
        );

        expect(result.roles).toEqual([UserRole.ADMIN, UserRole.DRIVER]);
      });

      it("la guarda mira al actor, no al rol: desactivar a otro administrador se permite", async () => {
        prisma.user.update.mockResolvedValue({
          id: "otro-admin",
          name: "Otro Admin",
          username: "otro",
          active: false,
        });
        prisma.userRoleAssignment.findMany.mockResolvedValue([{ role: { name: UserRole.ADMIN } }]);

        const result = await service.update("otro-admin", { active: false }, ADMIN_ACTOR);

        expect(result.active).toBe(false);
      });
    });
  });
});
