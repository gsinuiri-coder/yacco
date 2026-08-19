import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { JwtSignOptions } from "@nestjs/jwt";
import type { UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { UsersService } from "../users/users.service.js";
import type { AuthTokensDto } from "./dto/auth-tokens.dto.js";
import type { LoginDto } from "./dto/login.dto.js";
import type { RefreshResponseDto } from "./dto/refresh-response.dto.js";
import type { JwtPayload } from "./types/jwt-payload.js";

const INVALID_CREDENTIALS = "Invalid credentials";

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(dto: LoginDto): Promise<AuthTokensDto> {
    const user = await this.usersService.findByUsername(dto.username);
    if (!user || !user.active) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const roles = user.roles.map((assignment) => assignment.role.name);
    return {
      accessToken: this.signAccessToken(user.id, user.username, roles),
      refreshToken: this.signRefreshToken(user.id, user.username, roles),
    };
  }

  async refreshAccessToken(payload: JwtPayload): Promise<RefreshResponseDto> {
    const user = await this.usersService.findByIdWithPassword(payload.sub);
    if (!user || !user.active) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const roles = user.roles.map((assignment) => assignment.role.name);
    return { accessToken: this.signAccessToken(user.id, user.username, roles) };
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

  private signRefreshToken(sub: string, username: string, roles: UserRole[]): string {
    const payload: JwtPayload = { sub, username, roles, type: "refresh" };
    return this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>("JWT_REFRESH_SECRET"),
      expiresIn: this.configService.getOrThrow<string>("JWT_REFRESH_EXPIRES_IN") as NonNullable<
        JwtSignOptions["expiresIn"]
      >,
    });
  }
}
