import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ProductType } from "@prisma/client";
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, Matches } from "class-validator";
import { MONEY_MESSAGE, MONEY_PATTERN } from "../../customers/dto/create-customer.dto.js";

export class CreateProductDto {
  @ApiProperty({ description: "Nombre del producto", example: "Bomba manual" })
  @IsString({ message: "El nombre debe ser un texto" })
  @IsNotEmpty({ message: "El nombre no puede estar vacío" })
  name!: string;

  @ApiProperty({ enum: ProductType, description: "Tipo de producto" })
  @IsEnum(ProductType, { message: "El tipo de producto no es válido" })
  type!: ProductType;

  @ApiPropertyOptional({
    format: "uuid",
    description: "Tipo de envase (recarga, venta de bidón o servicio de maquila)",
  })
  @IsOptional()
  @IsUUID("4", { message: "El tipo de envase debe ser un UUID válido" })
  containerTypeId?: string;

  @ApiProperty({ type: String, example: "15.00", description: "Precio de lista en soles (S/)" })
  @IsString({ message: `El precio de lista ${MONEY_MESSAGE}` })
  @Matches(MONEY_PATTERN, { message: `El precio de lista ${MONEY_MESSAGE}` })
  listPrice!: string;
}
