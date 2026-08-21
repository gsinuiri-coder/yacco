import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

// Money stays a string end to end (NUMERIC(10,2), never a float): a JSON
// number is an IEEE-754 double, so accepting one here would put S/ amounts
// through binary floating point before they ever reach Postgres.
// NUMERIC(10,2) => at most 8 integer digits and 2 decimals.
export const MONEY_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;
export const MONEY_MESSAGE =
  'debe ser un monto en soles con hasta 8 enteros y 2 decimales, como texto (ej. "150.00")';

export class CreateCustomerDto {
  @ApiProperty({ example: "Bodega Santa Rosa" })
  @IsString()
  @MinLength(1, { message: "El nombre es obligatorio" })
  @MaxLength(160, { message: "El nombre no puede superar los 160 caracteres" })
  name!: string;

  @ApiProperty({ example: "987654321" })
  @IsString()
  @MinLength(1, { message: "El teléfono es obligatorio" })
  @MaxLength(30, { message: "El teléfono no puede superar los 30 caracteres" })
  phone!: string;

  @ApiProperty({ example: "Av. Los Álamos 452" })
  @IsString()
  @MinLength(1, { message: "La dirección es obligatoria" })
  @MaxLength(255, { message: "La dirección no puede superar los 255 caracteres" })
  address!: string;

  @ApiProperty({ example: "Portón azul frente al parque" })
  @IsString()
  @MinLength(1, { message: "La referencia de dirección es obligatoria" })
  @MaxLength(255, { message: "La referencia no puede superar los 255 caracteres" })
  addressReference!: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4", { message: "La zona debe ser un identificador válido" })
  zoneId?: string;

  @ApiPropertyOptional({ type: String, example: "150.00", description: "Monto en soles (S/)" })
  @IsOptional()
  @IsString({ message: `El límite de crédito ${MONEY_MESSAGE}` })
  @Matches(MONEY_PATTERN, { message: `El límite de crédito ${MONEY_MESSAGE}` })
  creditLimit?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: "El estado activo debe ser verdadero o falso" })
  active?: boolean;
}
