import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

@Injectable()
export class JwtMobileRefreshGuard extends AuthGuard("jwt-mobile-refresh") {}
