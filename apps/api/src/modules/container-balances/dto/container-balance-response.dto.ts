import { ApiProperty } from "@nestjs/swagger";

export class NamedReferenceDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class LocationContainerBalanceDto {
  @ApiProperty({ type: NamedReferenceDto })
  containerType!: NamedReferenceDto;

  /** What the system believes; may be negative (an unrecorded delivery). */
  @ApiProperty()
  quantity!: number;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  lastCountedAt!: Date | null;
}

/**
 * One row per customer LOCATION, not per container type: ~500 locations by
 * 4 types would be 2000 rows of noise. There is deliberately no "certainty"
 * field — certainty is derived from `lastCountedAt` and how old it is, a
 * decision already taken and documented in the backlog; the consumer reads
 * it from the date.
 */
export class ContainerBalanceRowDto {
  @ApiProperty({ type: NamedReferenceDto })
  customer!: NamedReferenceDto;

  @ApiProperty({ type: NamedReferenceDto })
  location!: NamedReferenceDto;

  @ApiProperty({ type: NamedReferenceDto, nullable: true })
  zone!: NamedReferenceDto | null;

  @ApiProperty({ description: "Suma de todos los tipos de envase en esta ubicación" })
  totalQuantity!: number;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    description: "Conteo más reciente de la ubicación, de cualquier tipo; null si nunca se contó",
  })
  lastCountedAt!: Date | null;

  @ApiProperty({ type: LocationContainerBalanceDto, isArray: true })
  containers!: LocationContainerBalanceDto[];
}

export class PaginatedContainerBalancesDto {
  @ApiProperty({ type: ContainerBalanceRowDto, isArray: true })
  data!: ContainerBalanceRowDto[];

  @ApiProperty({ description: "Total de ubicaciones que cumplen el filtro" })
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty({ description: "Número total de páginas para el filtro actual" })
  totalPages!: number;
}
