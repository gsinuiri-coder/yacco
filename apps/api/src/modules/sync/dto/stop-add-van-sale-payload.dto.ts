import { ApiProperty, OmitType } from "@nestjs/swagger";
import { IsUUID } from "class-validator";
import { MarkRouteStopDto } from "../../routes/dto/mark-route-stop.dto.js";

/**
 * `STOP_ADD_VAN_SALE` versión 1: una venta en ruta hecha desde el celular, a
 * un local que no tenía parada. Es la entrega de «Mi ruta» —ítems, cobro,
 * envases recogidos, ubicación— sin `status` ni `failureReason`: una venta en
 * ruta solo existe entregada. Hereda las validaciones del DTO de la web por la
 * misma razón que `StopMarkPayloadV1Dto`.
 */
export class StopAddVanSalePayloadV1Dto extends OmitType(MarkRouteStopDto, [
  "status",
  "failureReason",
] as const) {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "La ruta debe ser un identificador válido" })
  routeId!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El local debe ser un identificador válido" })
  locationId!: string;
}
