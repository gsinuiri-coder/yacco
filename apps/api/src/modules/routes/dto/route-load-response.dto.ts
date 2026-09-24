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

/** One container type on the truck: what went up and what is still on it. */
export class RouteTruckStockLineDto {
  @ApiProperty({ type: RouteLoadContainerTypeDto })
  containerType!: RouteLoadContainerTypeDto;

  @ApiProperty({ example: 6, description: "Llenos cargados en la ruta" })
  loaded!: number;

  @ApiProperty({
    example: 4,
    description:
      "Llenos que siguen arriba: cargados menos entregados menos vendidos, según el libro",
  })
  onBoard!: number;
}
