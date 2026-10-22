import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { JwtPayload } from "../types/jwt-payload.js";

/**
 * El refresh de la app del chofer viaja en el cuerpo (`refreshToken`): el
 * celular no tiene un navegador que guarde la cookie, y lo guarda él en su
 * almacenamiento seguro. Misma firma que el de la web; solo acepta los que
 * nacieron para el celular.
 */
@Injectable()
export class JwtMobileRefreshStrategy extends PassportStrategy(Strategy, "jwt-mobile-refresh") {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromBodyField("refreshToken"),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>("JWT_REFRESH_SECRET"),
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    if (payload.type !== "refresh" || payload.client !== "mobile") {
      throw new UnauthorizedException("Invalid token type");
    }
    return payload;
  }
}
