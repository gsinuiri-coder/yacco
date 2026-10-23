import { ApiProperty } from "@nestjs/swagger";

export class DeliveryLineProductDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

/**
 * Una línea del pedido o de la venta vigente, para «pedido» y «entregado» lado
 * a lado. Sin precio a propósito: entregar distinto es otro producto u otra
 * cantidad, no otro precio. Contrato `DeliveryLine` de `@yacco/shared`.
 */
export class DeliveryLineDto {
  @ApiProperty({ format: "uuid" })
  productId!: string;

  @ApiProperty({ type: DeliveryLineProductDto })
  product!: DeliveryLineProductDto;

  @ApiProperty({ example: 3 })
  quantity!: number;
}
