import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";
import { RouteLocationPointInputDto } from "../../route-locations/dto/create-route-location-points.dto.js";

/**
 * `ROUTE_LOCATION_POINT` versión 1: dónde estaba el celular, tomado en segundo
 * plano con la ruta en curso (Fase 3, fila 11c). Es el mismo punto que recibe
 * `POST /routes/:id/location-points`, con sus mismas validaciones, más de qué
 * ruta es: por la cola sobrevive a la falta de señal.
 */
export class RouteLocationPointPayloadV1Dto extends RouteLocationPointInputDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "La ruta debe ser un identificador válido" })
  routeId!: string;
}
