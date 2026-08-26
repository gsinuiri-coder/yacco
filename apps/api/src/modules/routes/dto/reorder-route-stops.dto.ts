import { ApiProperty } from "@nestjs/swagger";
import { ArrayMinSize, IsArray, IsUUID } from "class-validator";

/**
 * The full list of the route's stop ids, in the new order — not a partial
 * patch. RoutesService.reorderStops rejects a list that is missing a stop,
 * repeats one, or names one from another route.
 */
export class ReorderRouteStopsDto {
  @ApiProperty({ type: String, isArray: true, format: "uuid" })
  @IsArray()
  @ArrayMinSize(1, { message: "La lista de paradas no puede estar vacía" })
  @IsUUID("4", { each: true, message: "Cada parada debe ser un identificador válido" })
  stopIds!: string[];
}
