import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { UsersModule } from "../users/users.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { JwtAccessGuard } from "./guards/jwt-access.guard.js";
import { JwtRefreshGuard } from "./guards/jwt-refresh.guard.js";
import { JwtAccessStrategy } from "./strategies/jwt-access.strategy.js";
import { JwtRefreshStrategy } from "./strategies/jwt-refresh.strategy.js";

@Module({
  imports: [UsersModule, PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, JwtAccessStrategy, JwtRefreshStrategy, JwtAccessGuard, JwtRefreshGuard],
  exports: [JwtAccessGuard],
})
export class AuthModule {}
