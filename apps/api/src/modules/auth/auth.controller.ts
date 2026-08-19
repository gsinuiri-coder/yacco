import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiResponse, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import { AuthService } from "./auth.service.js";
import { AuthTokensDto } from "./dto/auth-tokens.dto.js";
import { LoginDto } from "./dto/login.dto.js";
import { RefreshResponseDto } from "./dto/refresh-response.dto.js";
import { JwtRefreshGuard } from "./guards/jwt-refresh.guard.js";
import type { AuthenticatedRequest } from "./types/authenticated-request.js";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiResponse({ status: HttpStatus.OK, type: AuthTokensDto })
  @ApiUnauthorizedResponse({ description: "Invalid credentials or inactive user" })
  @HttpCode(HttpStatus.OK)
  @Post("login")
  login(@Body() dto: LoginDto): Promise<AuthTokensDto> {
    return this.authService.login(dto);
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
}
