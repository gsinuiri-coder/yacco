import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ContainerMovementType, ContainerState } from "@prisma/client";

/** Minimum the office needs to recognise the container type without a second call. */
export class ContainerMovementContainerTypeDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

/** Minimum the office needs to recognise the location without a second call. */
export class ContainerMovementLocationDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class ContainerMovementResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "date-time" })
  occurredAt!: Date;

  @ApiProperty({ enum: ContainerMovementType })
  type!: ContainerMovementType;

  @ApiProperty({ format: "uuid" })
  containerTypeId!: string;

  @ApiProperty({ type: ContainerMovementContainerTypeDto })
  containerType!: ContainerMovementContainerTypeDto;

  @ApiProperty({ minimum: 1, example: 10 })
  quantity!: number;

  /** Null means the container crossed the fleet's boundary on this side. */
  @ApiPropertyOptional({ enum: ContainerState, nullable: true })
  fromState!: ContainerState | null;

  @ApiPropertyOptional({ enum: ContainerState, nullable: true })
  toState!: ContainerState | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  locationId!: string | null;

  @ApiPropertyOptional({ type: ContainerMovementLocationDto, nullable: true })
  location!: ContainerMovementLocationDto | null;

  @ApiProperty({ format: "uuid" })
  recordedById!: string;
}

export class PaginatedContainerMovementsDto {
  @ApiProperty({ type: ContainerMovementResponseDto, isArray: true })
  data!: ContainerMovementResponseDto[];

  @ApiProperty({ description: "Total de movimientos que cumplen el filtro" })
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty({ description: "Número total de páginas para el filtro actual" })
  totalPages!: number;
}

/** One (container type, state) cell of the inventory snapshot derived from the ledger. */
export class ContainerInventoryItemDto {
  @ApiProperty({ format: "uuid" })
  containerTypeId!: string;

  @ApiProperty({ type: ContainerMovementContainerTypeDto })
  containerType!: ContainerMovementContainerTypeDto;

  @ApiProperty({ enum: ContainerState })
  state!: ContainerState;

  @ApiProperty({ example: 42 })
  quantity!: number;
}
