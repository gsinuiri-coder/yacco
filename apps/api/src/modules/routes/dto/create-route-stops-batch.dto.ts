import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from "class-validator";

/** Same cap as a page of orders: the screen that builds the list never shows more. */
export const MAX_BATCH_STOPS = 100;

/**
 * Several ORDER stops at once, from the office's «Agregar pedidos pendientes».
 * The order of `orderIds` IS the order of the new stops. Every id goes through
 * exactly the same checks as `POST /routes/:id/stops` with origin ORDER, and
 * the batch is all or nothing — see RoutesService.addOrderStops.
 */
export class CreateRouteStopsBatchDto {
  @ApiProperty({
    type: [String],
    format: "uuid",
    maxItems: MAX_BATCH_STOPS,
    description: "Pedidos pendientes, en el orden en que van a quedar las paradas",
  })
  @IsArray({ message: "Los pedidos deben venir en una lista" })
  @ArrayNotEmpty({ message: "Elige al menos un pedido" })
  @ArrayMaxSize(MAX_BATCH_STOPS, {
    message: `No se pueden agregar más de ${MAX_BATCH_STOPS} paradas de una vez`,
  })
  @ArrayUnique({ message: "Un pedido no puede ir dos veces en el mismo lote" })
  @IsUUID("4", { each: true, message: "Cada pedido debe ser un identificador válido" })
  orderIds!: string[];
}
