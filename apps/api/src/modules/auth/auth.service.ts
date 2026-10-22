import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { JwtSignOptions } from "@nestjs/jwt";
import { UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { UsersService } from "../users/users.service.js";
import type { LoginDto } from "./dto/login.dto.js";
import type { MobileSessionDto } from "./dto/mobile-session.dto.js";
import type { RefreshResponseDto } from "./dto/refresh-response.dto.js";
import type { JwtPayload } from "./types/jwt-payload.js";

const INVALID_CREDENTIALS = "Invalid credentials";
const MOBILE_DRIVERS_ONLY = "La app es solo para choferes";

/**
 * Fijo y no por variable de entorno: es una decisión del dueño (el chofer
 * no vuelve a ingresar en 30 días), no un parámetro de despliegue.
 */
export const MOBILE_REFRESH_EXPIRES_IN = "30d";
const MOBILE_ROLES: UserRole[] = [UserRole.DRIVER];

interface LoginTokens {
  accessToken: string;
  refreshCookieValue: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(dto: LoginDto): Promise<LoginTokens> {
    const { user, roles } = await this.verifyCredentials(dto);
    return {
      accessToken: this.signAccessToken(user.id, user.username, roles),
      refreshCookieValue: this.signRefreshToken(user.id, user.username, roles, user.tokenVersion),
    };
  }

  /**
   * El ingreso de la app del chofer: mismo usuario y contraseña, solo choferes,
   * y un refresh de 30 días que el celular guarda cifrado. Lo corta lo mismo
   * que corta la web: cambiar la contraseña o desactivar desde «Usuarios».
   */
  async loginMobile(dto: LoginDto): Promise<MobileSessionDto> {
    const { user, roles } = await this.verifyCredentials(dto);
    if (!roles.includes(UserRole.DRIVER)) {
      throw new ForbiddenException(MOBILE_DRIVERS_ONLY);
    }
    return {
      // Solo DRIVER aunque tenga más roles: un celular perdido abre 30 días
      // de app del chofer, no de oficina.
      accessToken: this.signAccessToken(user.id, user.username, MOBILE_ROLES),
      refreshToken: this.signRefreshToken(user.id, user.username, MOBILE_ROLES, user.tokenVersion, {
        client: "mobile",
        expiresIn: MOBILE_REFRESH_EXPIRES_IN,
      }),
    };
  }

  async refreshAccessToken(payload: JwtPayload): Promise<RefreshResponseDto> {
    const user = await this.usersService.findByIdWithPassword(payload.sub);
    if (!user || !user.active) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    // Cambiar la contraseña o desactivar sube la versión (D-024): un refresh
    // emitido antes ya no renueva nada, aunque su firma y su vencimiento valgan.
    if ((payload.tv ?? 0) !== user.tokenVersion) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const roles = user.roles.map((assignment) => assignment.role.name);
    // Si en estos 30 días le sacaron el rol de chofer, el celular deja de
    // renovar: la app es solo para choferes.
    if (payload.client === "mobile") {
      if (!roles.includes(UserRole.DRIVER)) {
        throw new ForbiddenException(MOBILE_DRIVERS_ONLY);
      }
      return { accessToken: this.signAccessToken(user.id, user.username, MOBILE_ROLES) };
    }
    return { accessToken: this.signAccessToken(user.id, user.username, roles) };
  }

  private async verifyCredentials(dto: LoginDto) {
    const user = await this.usersService.findByUsername(dto.username);
    if (!user || !user.active) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return { user, roles: user.roles.map((assignment) => assignment.role.name) };
  }

  /** Cuándo vence un refresh token recién firmado: la cookie vence con él. */
  refreshTokenExpiry(refreshToken: string): Date {
    const { exp } = this.jwtService.decode<{ exp: number }>(refreshToken);
    return new Date(exp * 1000);
  }

  private signAccessToken(sub: string, username: string, roles: UserRole[]): string {
    const payload: JwtPayload = { sub, username, roles, type: "access" };
    return this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>("JWT_ACCESS_SECRET"),
      // Operator-configured duration string (e.g. "15m"); jsonwebtoken's
      // StringValue template-literal type can't be verified from a plain env var.
      expiresIn: this.configService.getOrThrow<string>("JWT_ACCESS_EXPIRES_IN") as NonNullable<
        JwtSignOptions["expiresIn"]
      >,
    });
  }

  private signRefreshToken(
    sub: string,
    username: string,
    roles: UserRole[],
    tokenVersion: number,
    mobile?: { client: "mobile"; expiresIn: string },
  ): string {
    const payload: JwtPayload = {
      sub,
      username,
      roles,
      type: "refresh",
      tv: tokenVersion,
      ...(mobile !== undefined ? { client: mobile.client } : {}),
    };
    return this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>("JWT_REFRESH_SECRET"),
      expiresIn: (mobile?.expiresIn ??
        this.configService.getOrThrow<string>("JWT_REFRESH_EXPIRES_IN")) as NonNullable<
        JwtSignOptions["expiresIn"]
      >,
    });
  }
}
