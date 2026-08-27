import { ApiPropertyOptional, ApiProperty } from "@nestjs/swagger";
import { ContainerMovementType, ContainerState } from "@prisma/client";
import { IsEnum, IsInt, IsOptional, IsUUID, Min } from "class-validator";

/**
 * `occurredAt` is absent on purpose: this route captures a movement at the
 * moment it is registered (office entry), so the service stamps `now()` —
 * same as `createdAt` elsewhere. Backdating exists only internally, for the
 * customer-roster loader's OPENING_BALANCE entries (see
 * `ContainerMovementsService.createWithinTransaction`); a caller of this
 * public route can never set it.
 *
 * `fromState`/`toState` are both optional here (validated as a pair against
 * `CONTAINER_MOVEMENT_TRANSITIONS` in the service, not by class-validator —
 * which side may be null depends on `type`, so no single per-field rule can
 * express it): null means the container is crossing the fleet's boundary on
 * that side. `container_movements_quantity_check` already enforces quantity
 * > 0 in the database; `@Min` here only turns that into a message the office
 * can act on before the insert ever runs.
 */
export class CreateContainerMovementDto {
  @ApiProperty({ enum: ContainerMovementType })
  @IsEnum(ContainerMovementType, { message: "El tipo de movimiento no es válido" })
  type!: ContainerMovementType;

  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El tipo de envase debe ser un identificador válido" })
  containerTypeId!: string;

  @ApiProperty({ minimum: 1, example: 10 })
  @IsInt({ message: "La cantidad debe ser un número entero" })
  @Min(1, { message: "La cantidad debe ser mayor que 0" })
  quantity!: number;

  @ApiPropertyOptional({ enum: ContainerState })
  @IsOptional()
  @IsEnum(ContainerState, { message: "El estado de origen no es válido" })
  fromState?: ContainerState;

  @ApiPropertyOptional({ enum: ContainerState })
  @IsOptional()
  @IsEnum(ContainerState, { message: "El estado de destino no es válido" })
  toState?: ContainerState;

  @ApiPropertyOptional({
    format: "uuid",
    description: 'Obligatoria cuando el origen o el destino es "en cliente"',
  })
  @IsOptional()
  @IsUUID("4", { message: "La ubicación debe ser un identificador válido" })
  locationId?: string;
}
