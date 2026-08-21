import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { MONEY_MESSAGE, MONEY_PATTERN } from "./create-customer.dto.js";

/**
 * Every field is optional (PATCH semantics). `debtBalance` is deliberately
 * absent and must stay that way: it is a ledger balance that only sales and
 * payments may move, inside the same transaction as their source row. With
 * the global ValidationPipe's forbidNonWhitelisted, a body carrying
 * debtBalance is rejected with 400 rather than silently ignored.
 *
 * Deactivating a customer is `active: false` here — there is no DELETE route.
 * Customer's relations are all onDelete: Restrict, so a hard delete would
 * fail as soon as the customer had an order, a sale or a movement.
 */
export class UpdateCustomerDto {
  @ApiPropertyOptional({ example: "Bodega Santa Rosa" })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: "El nombre es obligatorio" })
  @MaxLength(160, { message: "El nombre no puede superar los 160 caracteres" })
  name?: string;

  @ApiPropertyOptional({ example: "987654321" })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: "El teléfono es obligatorio" })
  @MaxLength(30, { message: "El teléfono no puede superar los 30 caracteres" })
  phone?: string;

  @ApiPropertyOptional({ example: "Av. Los Álamos 452" })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: "La dirección es obligatoria" })
  @MaxLength(255, { message: "La dirección no puede superar los 255 caracteres" })
  address?: string;

  @ApiPropertyOptional({ example: "Portón azul frente al parque" })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: "La referencia de dirección es obligatoria" })
  @MaxLength(255, { message: "La referencia no puede superar los 255 caracteres" })
  addressReference?: string;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID("4", { message: "La zona debe ser un identificador válido" })
  zoneId?: string;

  @ApiPropertyOptional({ type: String, example: "150.00", description: "Monto en soles (S/)" })
  @IsOptional()
  @IsString({ message: `El límite de crédito ${MONEY_MESSAGE}` })
  @Matches(MONEY_PATTERN, { message: `El límite de crédito ${MONEY_MESSAGE}` })
  creditLimit?: string;

  @ApiPropertyOptional({ description: "false desactiva al cliente (no se borra la fila)" })
  @IsOptional()
  @IsBoolean({ message: "El estado activo debe ser verdadero o falso" })
  active?: boolean;
}
