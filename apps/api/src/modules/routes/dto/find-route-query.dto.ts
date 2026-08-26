import { ApiPropertyOptional } from "@nestjs/swagger";
import { StopStatus } from "@prisma/client";
import { IsEnum, IsOptional } from "class-validator";

/**
 * Lets the office pull up a route and see only what's left to resolve
 * (`?stopStatus=PENDING`) instead of scrolling past every DELIVERED/FAILED
 * stop — without idempotency's PENDING-only guard on markStop, this filter
 * is the only way to find what still needs a visit.
 */
export class FindRouteQueryDto {
  @ApiPropertyOptional({ enum: StopStatus })
  @IsOptional()
  @IsEnum(StopStatus, { message: "El estado de la parada no es válido" })
  stopStatus?: StopStatus;
}
