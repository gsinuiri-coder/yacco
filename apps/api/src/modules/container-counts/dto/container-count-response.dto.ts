import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/** Minimum the office needs to recognise the location without a second call. */
export class ContainerCountLocationDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

/** Minimum the office needs to recognise the container type without a second call. */
export class ContainerCountContainerTypeDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class ContainerCountResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  locationId!: string;

  @ApiProperty({ type: ContainerCountLocationDto })
  location!: ContainerCountLocationDto;

  @ApiProperty({ format: "uuid" })
  containerTypeId!: string;

  @ApiProperty({ type: ContainerCountContainerTypeDto })
  containerType!: ContainerCountContainerTypeDto;

  @ApiProperty()
  countedAt!: Date;

  @ApiProperty({ example: 12 })
  countedQuantity!: number;

  /** What CustomerContainerBalance held at the moment of the count — a snapshot, not derived. */
  @ApiProperty({ example: 10 })
  expectedQuantity!: number;

  /** Null when the count matched the balance exactly — no COUNT_ADJUSTMENT was emitted. */
  @ApiPropertyOptional({ format: "uuid", nullable: true })
  adjustmentId!: string | null;

  @ApiProperty({ format: "uuid" })
  countedById!: string;
}
