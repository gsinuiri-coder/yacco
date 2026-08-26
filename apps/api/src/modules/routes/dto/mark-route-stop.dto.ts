import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { StopStatus } from "@prisma/client";
import { IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";

const MARKABLE_STATUSES = [StopStatus.DELIVERED, StopStatus.FAILED] as const;

/**
 * Only the two terminal statuses are settable through this route — PENDING
 * is the only status a stop is ever created with, never assigned back to.
 * Whether `failureReason` is required/forbidden depends on `status`, so — as
 * in CreateRouteStopDto — the field stays optional here and
 * RoutesService.markStop enforces the actual combination.
 */
export class MarkRouteStopDto {
  @ApiProperty({ enum: MARKABLE_STATUSES })
  @IsIn(MARKABLE_STATUSES, { message: "El estado debe ser DELIVERED o FAILED" })
  status!: StopStatus;

  @ApiPropertyOptional({ description: "Obligatorio cuando status=FAILED" })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: "El motivo de falla no puede estar vacío" })
  failureReason?: string;
}
