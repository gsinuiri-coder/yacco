import { ApiProperty } from "@nestjs/swagger";

export class NamedReferenceDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

/**
 * The list deliberately includes deactivated customers and locations: a
 * customer taken off the books while still holding containers out on the
 * street is the MOST urgent case of the audit, not one to hide. But seeing
 * them mixed in without telling them apart is useless: an active customer
 * gets counted on the next visit; an inactive one has to be chased down, or
 * the containers written off as lost. The report informs; the owner decides.
 */
export class ActiveNamedReferenceDto extends NamedReferenceDto {
  @ApiProperty()
  active!: boolean;
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
  @ApiProperty({ type: ActiveNamedReferenceDto })
  customer!: ActiveNamedReferenceDto;

  @ApiProperty({ type: ActiveNamedReferenceDto })
  location!: ActiveNamedReferenceDto;

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
