import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

class NamedDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class RoutePitStopCountDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  pitStopId!: string;

  @ApiProperty({ format: "uuid" })
  containerTypeId!: string;

  @ApiProperty({ type: NamedDto })
  containerType!: NamedDto;

  @ApiProperty()
  expectedFull!: number;

  @ApiProperty()
  countedFull!: number;

  @ApiProperty()
  expectedEmpty!: number;

  @ApiProperty()
  countedEmpty!: number;

  @ApiPropertyOptional({ nullable: true })
  differenceReason!: string | null;
}

export class RoutePitStopLoadDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  batchItemId!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  batchItem!: {
    id: string;
    containerTypeId: string;
    containerType: NamedDto;
    batchId: string;
    batch: { id: string; code: string };
  };
}

export class RoutePitStopUnloadDto {
  @ApiProperty({ enum: ["EMPTY_UNLOAD", "FULL_RETURN"] })
  type!: "EMPTY_UNLOAD" | "FULL_RETURN";

  @ApiProperty({ format: "uuid" })
  containerTypeId!: string;

  @ApiProperty({ type: NamedDto })
  containerType!: NamedDto;

  @ApiProperty()
  quantity!: number;
}

export class RoutePitStopResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  routeId!: string;

  @ApiProperty({ format: "uuid" })
  recordedById!: string;

  @ApiProperty({ type: NamedDto })
  recordedBy!: NamedDto;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiPropertyOptional({ nullable: true, example: "100.00" })
  cashExpected!: string | null;

  @ApiPropertyOptional({ nullable: true, example: "80.00" })
  cashDelivered!: string | null;

  @ApiPropertyOptional({ nullable: true })
  cashReason!: string | null;

  @ApiPropertyOptional({ nullable: true, format: "date-time" })
  voidedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true, format: "uuid" })
  voidedById!: string | null;

  @ApiPropertyOptional({ nullable: true, type: NamedDto })
  voidedBy!: NamedDto | null;

  @ApiPropertyOptional({ nullable: true })
  voidReason!: string | null;

  @ApiProperty({ type: [RoutePitStopCountDto] })
  counts!: RoutePitStopCountDto[];

  @ApiProperty({ type: [RoutePitStopLoadDto] })
  loads!: RoutePitStopLoadDto[];

  @ApiProperty({ type: [RoutePitStopUnloadDto] })
  unloads!: RoutePitStopUnloadDto[];
}

export class RoutePitStopContainerPreviewDto {
  @ApiProperty({ format: "uuid" })
  containerTypeId!: string;

  @ApiProperty()
  containerTypeName!: string;

  @ApiProperty()
  expectedFull!: number;

  @ApiProperty()
  expectedEmpty!: number;
}

export class RoutePitStopCashPreviewDto {
  @ApiProperty({ example: "200.00" })
  cashCollected!: string;

  @ApiProperty({ example: "50.00" })
  cashDeliveredInPreviousPits!: string;

  @ApiProperty({ example: "150.00" })
  cashExpected!: string;
}

export class RoutePitStopPreviewDto {
  @ApiProperty({ type: [RoutePitStopContainerPreviewDto] })
  containers!: RoutePitStopContainerPreviewDto[];

  @ApiProperty({ type: RoutePitStopCashPreviewDto })
  cash!: RoutePitStopCashPreviewDto;
}
