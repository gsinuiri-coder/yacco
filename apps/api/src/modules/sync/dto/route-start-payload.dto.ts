import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

/**
 * `ROUTE_START` versión 1: el chofer empieza su ruta desde el celular, también
 * sin señal (decisión de Giancarlo, 2026-10-23). Es el mismo paso que
 * `PATCH /routes/:id/start` de la oficina.
 */
export class RouteStartPayloadV1Dto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "La ruta debe ser un identificador válido" })
  routeId!: string;
}
