import { ApiProperty } from "@nestjs/swagger";

export class RouteLoadContainerTypeDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class RouteLoadBatchDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  code!: string;
}

export class RouteLoadBatchItemDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  containerTypeId!: string;

  @ApiProperty({ type: RouteLoadContainerTypeDto })
  containerType!: RouteLoadContainerTypeDto;

  @ApiProperty({ format: "uuid" })
  batchId!: string;

  @ApiProperty({ type: RouteLoadBatchDto })
  batch!: RouteLoadBatchDto;
}

export class RouteLoadResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  routeId!: string;

  @ApiProperty({ format: "uuid" })
  batchItemId!: string;

  @ApiProperty({ type: RouteLoadBatchItemDto })
  batchItem!: RouteLoadBatchItemDto;

  @ApiProperty({ example: 50 })
  quantity!: number;
}
