import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/** Minimum the office needs to recognise who filled the batch without a second call. */
export class ProductionBatchFilledByDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

/** Minimum the office needs to recognise the container type without a second call. */
export class ProductionBatchContainerTypeDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class ProductionBatchItemResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  containerTypeId!: string;

  @ApiProperty({ type: ProductionBatchContainerTypeDto })
  containerType!: ProductionBatchContainerTypeDto;

  @ApiProperty({ example: 200 })
  producedQty!: number;

  /** Born equal to producedQty; consumed by route loading (S5), never here. */
  @ApiProperty({ example: 200 })
  availableQty!: number;
}

export class ProductionBatchResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  code!: string;

  /** Calendar day in America/Lima, as YYYY-MM-DD — a DATE column, never an instant. */
  @ApiProperty({ type: String, example: "2026-08-22" })
  date!: string;

  @ApiProperty({ format: "uuid" })
  filledById!: string;

  @ApiProperty({ type: ProductionBatchFilledByDto })
  filledBy!: ProductionBatchFilledByDto;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty({ type: ProductionBatchItemResponseDto, isArray: true })
  items!: ProductionBatchItemResponseDto[];
}

export class PaginatedProductionBatchesDto {
  @ApiProperty({ type: ProductionBatchResponseDto, isArray: true })
  data!: ProductionBatchResponseDto[];

  @ApiProperty({ description: "Total de lotes que cumplen el filtro" })
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty({ description: "Número total de páginas para el filtro actual" })
  totalPages!: number;
}

/**
 * One container type's shortfall on this batch: it produced more than the
 * plant had empty. Deliberate, not a bug (spec, decided with the client) —
 * see ProductionBatchesService.create. Shown only in the create response:
 * it is a moment-in-time signal, not a persisted fact about the batch.
 */
export class ProductionBatchWarningDto {
  @ApiProperty({ format: "uuid" })
  containerTypeId!: string;

  @ApiProperty({ type: ProductionBatchContainerTypeDto })
  containerType!: ProductionBatchContainerTypeDto;

  @ApiProperty({ example: 50, description: "Vacíos en planta antes de este lote" })
  emptyAvailable!: number;

  @ApiProperty({ example: 80, description: "Cantidad producida en esta línea" })
  produced!: number;
}

export class CreateProductionBatchResponseDto extends ProductionBatchResponseDto {
  @ApiProperty({ type: ProductionBatchWarningDto, isArray: true })
  warnings!: ProductionBatchWarningDto[];
}
