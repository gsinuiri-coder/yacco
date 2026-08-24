import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsUUID, Min } from "class-validator";

/**
 * `countedAt` is absent on purpose, same reason and same shape as
 * `occurredAt` on `CreateContainerMovementDto`: this route captures a count
 * at the moment it is registered, so the service stamps `now()`. Backdating
 * exists only internally, for the customer-roster loader's retroactive
 * counts (see `ContainerCountsService.create`); a caller of this public
 * route can never set it.
 */
export class CreateContainerCountDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "La locación debe ser un identificador válido" })
  locationId!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El tipo de envase debe ser un identificador válido" })
  containerTypeId!: string;

  @ApiProperty({ minimum: 0, example: 12 })
  @IsInt({ message: "La cantidad contada debe ser un número entero" })
  @Min(0, { message: "La cantidad contada no puede ser negativa" })
  countedQuantity!: number;
}
