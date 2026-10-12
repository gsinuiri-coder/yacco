import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export type VehicleReviewStatusCode = "VIGENTE" | "POR_VENCER" | "VENCIDA" | "SIN_REGISTRO";

class ReviewTypeNamedDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  id!: string;

  @ApiProperty({ example: "SOAT" })
  name!: string;
}

class UserNamedDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  id!: string;

  @ApiProperty({ example: "Administrador" })
  name!: string;
}

export class VehicleReviewResponseDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  id!: string;

  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  vehicleId!: string;

  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  reviewTypeId!: string;

  @ApiProperty({ type: ReviewTypeNamedDto })
  reviewType!: ReviewTypeNamedDto;

  @ApiProperty({ example: "2026-10-12" })
  startsOn!: string;

  @ApiProperty({ example: "2027-10-12" })
  endsOn!: string;

  @ApiPropertyOptional({ example: "Póliza RIMAC N° 123456", nullable: true })
  notes!: string | null;

  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  recordedById!: string;

  @ApiProperty({ type: UserNamedDto })
  recordedBy!: UserNamedDto;

  @ApiProperty({ example: "2026-10-12T08:00:00.000Z" })
  createdAt!: string;

  @ApiPropertyOptional({ example: "2026-10-12T09:00:00.000Z", nullable: true })
  voidedAt!: string | null;

  @ApiPropertyOptional({ example: "550e8400-e29b-41d4-a716-446655440000", nullable: true })
  voidedById!: string | null;

  @ApiPropertyOptional({ type: UserNamedDto, nullable: true })
  voidedBy!: UserNamedDto | null;

  @ApiPropertyOptional({ example: "Error en fecha", nullable: true })
  voidReason!: string | null;
}

export class VehicleReviewTypeStatusDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  reviewTypeId!: string;

  @ApiProperty({ example: "SOAT" })
  reviewTypeName!: string;

  @ApiProperty({ example: "VIGENTE", enum: ["VIGENTE", "POR_VENCER", "VENCIDA", "SIN_REGISTRO"] })
  status!: VehicleReviewStatusCode;

  @ApiPropertyOptional({ example: 120, nullable: true })
  daysRemaining!: number | null;

  @ApiPropertyOptional({ type: VehicleReviewResponseDto, nullable: true })
  latestReview!: VehicleReviewResponseDto | null;
}
