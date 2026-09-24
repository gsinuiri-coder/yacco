import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiResponse, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import type { Response } from "express";
import { AuthService } from "./auth.service.js";
import { AuthTokensDto } from "./dto/auth-tokens.dto.js";
import { LoginDto } from "./dto/login.dto.js";
import { RefreshResponseDto } from "./dto/refresh-response.dto.js";
import { SessionUserDto } from "./dto/session-user.dto.js";
import { JwtAccessGuard } from "./guards/jwt-access.guard.js";
import { JwtRefreshGuard } from "./guards/jwt-refresh.guard.js";
import {
  REFRESH_COOKIE,
  clearRefreshCookieOptions,
  refreshCookieOptions,
} from "./refresh-cookie.js";
import type { AuthenticatedRequest } from "./types/authenticated-request.js";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiResponse({ status: HttpStatus.OK, type: AuthTokensDto })
  @ApiUnauthorizedResponse({ description: "Invalid credentials or inactive user" })
  @HttpCode(HttpStatus.OK)
  @Post("login")
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthTokensDto> {
    const tokens = await this.authService.login(dto);
    // El web lee el refresh de la cookie (D-024). El cuerpo lo sigue trayendo
    // por un cliente anterior al cambio; se retira en el paso contract.
    response.cookie(
      REFRESH_COOKIE,
      tokens.refreshToken,
      refreshCookieOptions(this.authService.refreshTokenExpiry(tokens.refreshToken)),
    );
    return tokens;
  }

  @ApiBearerAuth()
  @ApiResponse({ status: HttpStatus.OK, type: RefreshResponseDto })
  @ApiUnauthorizedResponse({ description: "Invalid, expired, or wrong-type refresh token" })
  @UseGuards(JwtRefreshGuard)
  @HttpCode(HttpStatus.OK)
  @Post("refresh")
  refresh(@Req() request: AuthenticatedRequest): Promise<RefreshResponseDto> {
    return this.authService.refreshAccessToken(request.user);
  }

  // Sin @Roles: cualquier token de acceso válido, de cualquier rol. Es el GET
  // autenticado más chico que hay, y el que usa el smoke del deploy con la
  // cuenta VIEWER. No toca la base: devuelve lo que el token ya dice.
  @ApiBearerAuth()
  @ApiResponse({ status: HttpStatus.OK, type: SessionUserDto })
  @ApiUnauthorizedResponse({ description: "Missing, invalid or expired access token" })
  @UseGuards(JwtAccessGuard)
  @Get("me")
  me(@Req() request: AuthenticatedRequest): SessionUserDto {
    const { sub, username, roles } = request.user;
    return { id: sub, username, roles };
  }

  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: "La cookie del refresh se borró" })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post("logout")
  logout(@Res({ passthrough: true }) response: Response): void {
    // Sin guard a propósito: borrar la cookie no le da nada a nadie, y quien
    // cierra sesión con el acceso ya vencido igual tiene que poder hacerlo.
    response.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions());
  }
}
