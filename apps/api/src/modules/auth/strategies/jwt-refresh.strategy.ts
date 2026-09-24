import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { readRefreshCookie } from "../refresh-cookie.js";
import type { JwtPayload } from "../types/jwt-payload.js";

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, "jwt-refresh") {
  constructor(configService: ConfigService) {
    super({
      // La cookie httpOnly primero (D-024); el header queda para un cliente
      // anterior al cambio, hasta que se retire (contract).
      jwtFromRequest: ExtractJwt.fromExtractors([
        readRefreshCookie,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>("JWT_REFRESH_SECRET"),
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    if (payload.type !== "refresh") {
      throw new UnauthorizedException("Invalid token type");
    }
    return payload;
  }
}
