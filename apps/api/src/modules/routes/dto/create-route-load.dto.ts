import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsUUID, Min } from "class-validator";

/**
 * `route_loads` has no CHECK on quantity of its own; `@Min` here is what
 * turns a caller's mistake into a message instead of a raw insert failing
 * downstream (or worse, silently loading 0).
 */
export class CreateRouteLoadDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El ítem de lote debe ser un identificador válido" })
  batchItemId!: string;

  @ApiProperty({ minimum: 1, example: 50 })
  @IsInt({ message: "La cantidad debe ser un número entero" })
  @Min(1, { message: "La cantidad debe ser mayor que 0" })
  quantity!: number;
}
