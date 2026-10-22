import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";
import { MarkRouteStopDto } from "../../routes/dto/mark-route-stop.dto.js";

/**
 * `STOP_MARK` versión 1: lo mismo que «Mi ruta» de la web manda en el PATCH
 * de la parada, más cuál parada es. Hereda las validaciones del DTO de la web
 * para que la app y la web no puedan divergir en lo que aceptan.
 */
export class StopMarkPayloadV1Dto extends MarkRouteStopDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "La ruta debe ser un identificador válido" })
  routeId!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "La parada debe ser un identificador válido" })
  stopId!: string;
}
