import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import { jest } from "@jest/globals";
import bcrypt from "bcryptjs";
import { UsersService } from "../users/users.service.js";
import { AuthService } from "./auth.service.js";

// Gherkin quoted from spec §2.4, HU-23:
// "Dado un usuario activo, cuando inicia sesión con credenciales válidas,
// entonces accede solo a las funciones de sus roles; con credenciales
// inválidas, el acceso se rechaza."

const CONFIG_VALUES = {
  JWT_ACCESS_SECRET: "access-secret",
  JWT_ACCESS_EXPIRES_IN: "15m",
  JWT_REFRESH_SECRET: "refresh-secret",
  JWT_REFRESH_EXPIRES_IN: "30d",
} as const satisfies Record<string, string>;

type ConfigKey = keyof typeof CONFIG_VALUES;

function buildActiveUser(overrides: Partial<{ active: boolean; passwordHash: string }> = {}) {
  return {
    id: "user-1",
    name: "Admin",
    username: "admin",
    active: overrides.active ?? true,
    passwordHash: overrides.passwordHash ?? "hashed-password",
    roles: [{ role: { name: UserRole.ADMIN } }],
  };
}

describe("AuthService", () => {
  let service: AuthService;
  let usersService: {
    findByUsername: ReturnType<typeof jest.fn<() => Promise<unknown>>>;
    findByIdWithPassword: ReturnType<typeof jest.fn<() => Promise<unknown>>>;
  };
  let jwtService: JwtService;

  beforeEach(async () => {
    usersService = {
      findByUsername: jest.fn<() => Promise<unknown>>(),
      findByIdWithPassword: jest.fn<() => Promise<unknown>>(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: new JwtService() },
        {
          provide: ConfigService,
          useValue: { getOrThrow: (key: ConfigKey) => CONFIG_VALUES[key] },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    jwtService = moduleRef.get(JwtService);
  });

  describe("login", () => {
    it("HU-23 E1: valid credentials for an active user return tokens scoped to their roles", async () => {
      const passwordHash = await bcrypt.hash("correct-password", 4);
      usersService.findByUsername.mockResolvedValue(buildActiveUser({ passwordHash }));

      const tokens = await service.login({ username: "admin", password: "correct-password" });

      const accessPayload = jwtService.verify(tokens.accessToken, {
        secret: CONFIG_VALUES.JWT_ACCESS_SECRET,
      });
      expect(accessPayload).toMatchObject({
        sub: "user-1",
        username: "admin",
        roles: [UserRole.ADMIN],
        type: "access",
      });

      const refreshPayload = jwtService.verify(tokens.refreshToken, {
        secret: CONFIG_VALUES.JWT_REFRESH_SECRET,
      });
      expect(refreshPayload).toMatchObject({ sub: "user-1", type: "refresh" });
    });

    it("HU-23 E1: wrong password is rejected", async () => {
      const passwordHash = await bcrypt.hash("correct-password", 4);
      usersService.findByUsername.mockResolvedValue(buildActiveUser({ passwordHash }));

      await expect(
        service.login({ username: "admin", password: "wrong-password" }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("HU-23 E1: an unknown username is rejected", async () => {
      usersService.findByUsername.mockResolvedValue(null);

      await expect(
        service.login({ username: "ghost", password: "whatever" }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("rejects an inactive user even with the correct password", async () => {
      const passwordHash = await bcrypt.hash("correct-password", 4);
      usersService.findByUsername.mockResolvedValue(
        buildActiveUser({ passwordHash, active: false }),
      );

      await expect(
        service.login({ username: "admin", password: "correct-password" }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe("refreshAccessToken", () => {
    it("issues a fresh access token for a still-active user", async () => {
      usersService.findByIdWithPassword.mockResolvedValue(buildActiveUser());

      const result = await service.refreshAccessToken({
        sub: "user-1",
        username: "admin",
        roles: [UserRole.ADMIN],
        type: "refresh",
      });

      const accessPayload = jwtService.verify(result.accessToken, {
        secret: CONFIG_VALUES.JWT_ACCESS_SECRET,
      });
      expect(accessPayload).toMatchObject({ sub: "user-1", type: "access" });
    });

    it("rejects the refresh when the user has since been deactivated", async () => {
      usersService.findByIdWithPassword.mockResolvedValue(buildActiveUser({ active: false }));

      await expect(
        service.refreshAccessToken({
          sub: "user-1",
          username: "admin",
          roles: [UserRole.ADMIN],
          type: "refresh",
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("rejects the refresh when the user no longer exists", async () => {
      usersService.findByIdWithPassword.mockResolvedValue(null);

      await expect(
        service.refreshAccessToken({
          sub: "user-1",
          username: "admin",
          roles: [UserRole.ADMIN],
          type: "refresh",
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
