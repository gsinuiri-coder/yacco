import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, IsUUID, Matches, Min, ValidateNested } from "class-validator";
import { MONEY_MESSAGE, MONEY_PATTERN } from "../../customers/dto/create-customer.dto.js";

export class MaquilaPaymentDto {
  @ApiProperty({ description: "ID del método de pago", format: "uuid" })
  @IsUUID("4", { message: "El método de pago debe ser un UUID válido" })
  paymentMethodId!: string;

  @ApiProperty({ description: "Monto pagado en soles", example: "12.00" })
  @IsString({ message: `El monto ${MONEY_MESSAGE}` })
  @Matches(MONEY_PATTERN, { message: `El monto ${MONEY_MESSAGE}` })
  amount!: string;
}

export class ReturnMaquilaDto {
  @ApiProperty({ description: "ID del cliente", format: "uuid" })
  @IsUUID("4", { message: "El ID del cliente debe ser un UUID válido" })
  customerId!: string;

  @ApiProperty({ description: "ID del tipo de envase", format: "uuid" })
  @IsUUID("4", { message: "El tipo de envase debe ser un UUID válido" })
  containerTypeId!: string;

  @ApiProperty({ description: "Cantidad de envases devueltos llenos", minimum: 1, example: 4 })
  @IsInt({ message: "La cantidad debe ser un número entero" })
  @Min(1, { message: "La cantidad debe ser mayor que 0" })
  quantity!: number;

  @ApiPropertyOptional({
    description: "ID de la ubicación del cliente para asociar la venta (opcional)",
    format: "uuid",
  })
  @IsOptional()
  @IsUUID("4", { message: "La ubicación debe ser un UUID válido" })
  locationId?: string;

  @ApiPropertyOptional({
    description: "Pago en el momento de la entrega (opcional, si es fiado se omite)",
    type: () => MaquilaPaymentDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => MaquilaPaymentDto)
  payment?: MaquilaPaymentDto;
}
