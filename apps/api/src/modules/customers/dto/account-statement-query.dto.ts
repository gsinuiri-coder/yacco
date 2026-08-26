import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Matches, Max, Min } from "class-validator";
import { BUSINESS_DATE_MESSAGE, BUSINESS_DATE_PATTERN } from "../../orders/dto/create-order.dto.js";

export const ACCOUNT_STATEMENT_DEFAULT_LIMIT = 50;
export const ACCOUNT_STATEMENT_MAX_LIMIT = 200;

/**
 * `from`/`to` are calendar days in America/Lima, same wire shape as every
 * other business-date filter in this codebase (CLAUDE.md) — never instants,
 * even though `soldAt`/`paidAt` themselves are timestamptz. `limit` bounds
 * only how many `entries` come back; `openingBalance`/`closingBalance` are
 * always computed over the FULL window regardless of it — see
 * CustomersService.getAccountStatement.
 */
export class AccountStatementQueryDto {
  @ApiPropertyOptional({ example: "2026-08-01", description: "Desde (inclusive, America/Lima)" })
  @IsOptional()
  @IsString({ message: `La fecha desde ${BUSINESS_DATE_MESSAGE}` })
  @Matches(BUSINESS_DATE_PATTERN, { message: `La fecha desde ${BUSINESS_DATE_MESSAGE}` })
  from?: string;

  @ApiPropertyOptional({ example: "2026-08-31", description: "Hasta (inclusive, America/Lima)" })
  @IsOptional()
  @IsString({ message: `La fecha hasta ${BUSINESS_DATE_MESSAGE}` })
  @Matches(BUSINESS_DATE_PATTERN, { message: `La fecha hasta ${BUSINESS_DATE_MESSAGE}` })
  to?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: ACCOUNT_STATEMENT_MAX_LIMIT,
    default: ACCOUNT_STATEMENT_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "El límite debe ser un número entero" })
  @Min(1, { message: "El límite debe ser 1 o mayor" })
  @Max(ACCOUNT_STATEMENT_MAX_LIMIT, {
    message: `El límite no puede superar ${ACCOUNT_STATEMENT_MAX_LIMIT}`,
  })
  limit: number = ACCOUNT_STATEMENT_DEFAULT_LIMIT;
}
