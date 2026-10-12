import { ApiProperty } from "@nestjs/swagger";

export class VehicleReviewTypeResponseDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  id!: string;

  @ApiProperty({ example: "SOAT" })
  name!: string;

  @ApiProperty({ example: true })
  active!: boolean;

  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  createdById!: string;

  @ApiProperty({ example: "2026-10-12T08:00:00.000Z" })
  createdAt!: string;
}
