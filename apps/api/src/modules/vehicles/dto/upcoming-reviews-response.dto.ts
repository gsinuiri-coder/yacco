import { ApiProperty } from "@nestjs/swagger";

export class UpcomingReviewAlertDto {
  @ApiProperty({ example: "VEHICLE_REVIEW", enum: ["VEHICLE_REVIEW", "DRIVER_LICENSE"] })
  type!: "VEHICLE_REVIEW" | "DRIVER_LICENSE";

  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  targetId!: string;

  @ApiProperty({ example: "ABC123 (Camión 1)" })
  targetName!: string;

  @ApiProperty({ example: "SOAT" })
  detail!: string;

  @ApiProperty({ example: "2026-10-25" })
  expiresOn!: string;

  @ApiProperty({ example: 13 })
  daysRemaining!: number;

  @ApiProperty({ example: "POR_VENCER", enum: ["POR_VENCER", "VENCIDA"] })
  status!: "POR_VENCER" | "VENCIDA";
}
