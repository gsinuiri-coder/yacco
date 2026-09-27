import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PLANT_COUNT_STATES, type PlantCountState } from "./create-plant-count.dto.js";

export class PlantCountContainerTypeDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class PlantCountBatchDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  code!: string;
}

export class PlantCountAdjustmentDto {
  /** El COUNT_ADJUSTMENT que quedó en el libro. */
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: 5 })
  quantity!: number;

  /** El lote del que salieron esos llenos; null en un ajuste de vacíos. */
  @ApiPropertyOptional({ type: PlantCountBatchDto, nullable: true })
  batch!: PlantCountBatchDto | null;
}

export class PlantCountResponseDto {
  @ApiProperty({ type: PlantCountContainerTypeDto })
  containerType!: PlantCountContainerTypeDto;

  @ApiProperty({ enum: PLANT_COUNT_STATES })
  state!: PlantCountState;

  /** Lo que decía el libro un momento antes del conteo; puede ser negativo. */
  @ApiProperty({ example: 50 })
  expectedQuantity!: number;

  @ApiProperty({ example: 40 })
  countedQuantity!: number;

  /** Vacío cuando lo contado coincidió con el libro. */
  @ApiProperty({ type: [PlantCountAdjustmentDto] })
  adjustments!: PlantCountAdjustmentDto[];
}
