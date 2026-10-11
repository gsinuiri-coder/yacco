import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches } from "class-validator";
import { BUSINESS_DATE_MESSAGE, BUSINESS_DATE_PATTERN } from "../../orders/dto/create-order.dto.js";

export class ProductionBatchCodeProposalQueryDto {
  @ApiProperty({ example: "2026-10-22", description: "Día de producción (America/Lima)" })
  @IsString({ message: `La fecha del lote ${BUSINESS_DATE_MESSAGE}` })
  @Matches(BUSINESS_DATE_PATTERN, { message: `La fecha del lote ${BUSINESS_DATE_MESSAGE}` })
  date!: string;
}

export class ProductionBatchCodeProposalDto {
  @ApiProperty({ example: "L-22102026" })
  code!: string;

  @ApiProperty({ description: "True when this filling will be appended to the existing batch" })
  willAppend!: boolean;
}
