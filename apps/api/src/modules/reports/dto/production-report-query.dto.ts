import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches } from "class-validator";
import { BUSINESS_DATE_MESSAGE, BUSINESS_DATE_PATTERN } from "../../orders/dto/create-order.dto.js";

/** HU-21: el período es obligatorio. Un reporte "de siempre" no es un período. */
export class ProductionReportQueryDto {
  @ApiProperty({ example: "2026-08-01", description: "Desde (inclusive, día de Lima)" })
  @IsString({ message: `La fecha desde ${BUSINESS_DATE_MESSAGE}` })
  @Matches(BUSINESS_DATE_PATTERN, { message: `La fecha desde ${BUSINESS_DATE_MESSAGE}` })
  dateFrom!: string;

  @ApiProperty({ example: "2026-08-31", description: "Hasta (inclusive, día de Lima)" })
  @IsString({ message: `La fecha hasta ${BUSINESS_DATE_MESSAGE}` })
  @Matches(BUSINESS_DATE_PATTERN, { message: `La fecha hasta ${BUSINESS_DATE_MESSAGE}` })
  dateTo!: string;
}
