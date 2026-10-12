import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class VehicleSummaryDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  id!: string;

  @ApiProperty({ example: "ABC123" })
  plate!: string;

  @ApiProperty({ example: "Camión 1" })
  name!: string;

  @ApiProperty({ example: "Toyota" })
  brand!: string;

  @ApiProperty({ example: "Dyna" })
  model!: string;

  @ApiPropertyOptional({ example: 80, nullable: true })
  capacityUnits!: number | null;
}

export class VehicleResponseDto extends VehicleSummaryDto {
  @ApiPropertyOptional({ example: "N2", nullable: true })
  vehicleClass!: string | null;

  @ApiPropertyOptional({ example: "TUC-987654321", nullable: true })
  circulationCardNumber!: string | null;

  @ApiProperty({ example: true })
  active!: boolean;

  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  createdById!: string;

  @ApiProperty({ example: "2026-10-12T08:00:00.000Z" })
  createdAt!: string;

  @ApiPropertyOptional({ example: "550e8400-e29b-41d4-a716-446655440000", nullable: true })
  updatedById!: string | null;

  @ApiPropertyOptional({ example: "2026-10-12T09:30:00.000Z", nullable: true })
  updatedAt!: string | null;
}
