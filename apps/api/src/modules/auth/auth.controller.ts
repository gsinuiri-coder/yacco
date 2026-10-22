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
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { Response } from "express";
import { AuthService } from "./auth.service.js";
import { AuthTokensDto } from "./dto/auth-tokens.dto.js";
import { LoginDto } from "./dto/login.dto.js";
import { MobileRefreshDto, MobileSessionDto } from "./dto/mobile-session.dto.js";
import { RefreshResponseDto } from "./dto/refresh-response.dto.js";
import { SessionUserDto } from "./dto/session-user.dto.js";
import { JwtAccessGuard } from "./guards/jwt-access.guard.js";
import { JwtMobileRefreshGuard } from "./guards/jwt-mobile-refresh.guard.js";
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
    response.cookie(
      REFRESH_COOKIE,
      tokens.refreshCookieValue,
      refreshCookieOptions(this.authService.refreshTokenExpiry(tokens.refreshCookieValue)),
    );
    return { accessToken: tokens.accessToken };
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

  @ApiResponse({ status: HttpStatus.OK, type: MobileSessionDto })
  @ApiUnauthorizedResponse({ description: "Invalid credentials or inactive user" })
  @ApiForbiddenResponse({ description: "The user is not a driver" })
  @HttpCode(HttpStatus.OK)
  @Post("mobile/login")
  loginMobile(@Body() dto: LoginDto): Promise<MobileSessionDto> {
    return this.authService.loginMobile(dto);
  }

  // `MobileRefreshDto` no se lee: el token lo saca del cuerpo la estrategia.
  // Va declarado para que el ValidationPipe y Swagger conozcan la forma.
  @ApiResponse({ status: HttpStatus.OK, type: RefreshResponseDto })
  @ApiUnauthorizedResponse({ description: "Invalid, expired, revoked or non-mobile refresh token" })
  @UseGuards(JwtMobileRefreshGuard)
  @HttpCode(HttpStatus.OK)
  @Post("mobile/refresh")
  refreshMobile(
    @Body() _dto: MobileRefreshDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<RefreshResponseDto> {
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
