import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaymentStatus } from "@prisma/client";

export class PaymentCustomerDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class PaymentLocationDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class PaymentMethodRefDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class PaymentUserRefDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  username!: string;
}

export class PaymentRowDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ type: PaymentCustomerDto })
  customer!: PaymentCustomerDto;

  @ApiPropertyOptional({ type: PaymentLocationDto, nullable: true })
  location!: PaymentLocationDto | null;

  @ApiProperty({ type: PaymentMethodRefDto })
  paymentMethod!: PaymentMethodRefDto;

  /** 2-decimal string: a NUMERIC(10,2) never round-trips through a JSON number. */
  @ApiProperty({ type: String, example: "25.00" })
  amount!: string;

  @ApiProperty({ enum: PaymentStatus })
  status!: PaymentStatus;

  @ApiProperty({ format: "date-time" })
  paidAt!: Date;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  saleId!: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  stopId!: string | null;

  @ApiProperty({ type: PaymentUserRefDto })
  recordedBy!: PaymentUserRefDto;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  confirmedAt!: Date | null;

  @ApiPropertyOptional({ type: PaymentUserRefDto, nullable: true })
  confirmedBy!: PaymentUserRefDto | null;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  rejectedAt!: Date | null;

  @ApiPropertyOptional({ type: PaymentUserRefDto, nullable: true })
  rejectedBy!: PaymentUserRefDto | null;

  @ApiPropertyOptional({ nullable: true })
  rejectionReason!: string | null;

  /**
   * Cuándo se anuló este cobro, y por qué; `null` mientras siga en pie. No es
   * lo mismo que `status: REJECTED` — rechazar dice que el dinero nunca llegó,
   * anular dice que el dinero llegó y se anotó mal, y por eso la anulación sí
   * devolvió la deuda. Un cobro anulado SIGUE viniendo en la bandeja, con su
   * monto original: ver `PaymentsService.findAll`.
   *
   * `voidedBy` no viaja: sería un join más contra `users` en cada página de la
   * bandeja, y la pantalla que la lee muestra que el cobro está anulado y su
   * motivo, no quién lo anuló. Cuando alguna pantalla necesite el nombre, se
   * agrega al include entonces.
   */
  @ApiPropertyOptional({ format: "date-time", nullable: true })
  voidedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  voidReason!: string | null;

  @ApiProperty()
  isOpeningBalance!: boolean;
}

/** Sums the FULL filtered set, never just the page — see PaymentsService.findAll. */
export class PaymentTotalsDto {
  @ApiProperty({ description: "Cantidad de pagos que cumplen el filtro" })
  count!: number;

  @ApiProperty({ type: String, example: "1250.00" })
  amount!: string;
}

export class PaginatedPaymentsDto {
  @ApiProperty({ type: PaymentRowDto, isArray: true })
  data!: PaymentRowDto[];

  @ApiProperty({ description: "Total de pagos que cumplen el filtro" })
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty({ description: "Número total de páginas para el filtro actual" })
  totalPages!: number;

  @ApiProperty({ type: PaymentTotalsDto })
  totals!: PaymentTotalsDto;
}

/** Response of confirm/reject: the updated row plus where the customer's debt landed. */
export class PaymentActionResponseDto {
  @ApiProperty({ type: PaymentRowDto })
  payment!: PaymentRowDto;

  @ApiProperty({ type: String, example: "40.00" })
  debtBalance!: string;
}

/**
 * Response of POST /payments. `exceedsDebt` is never an error — the office
 * collection screen uses it to show "queda a favor S/X", and it is the only
 * signal that a S/500 typed instead of S/50 landed where it shouldn't have.
 */
export class CreateOfficePaymentResponseDto {
  @ApiProperty({ type: PaymentRowDto })
  payment!: PaymentRowDto;

  @ApiProperty({ type: String, example: "-10.00" })
  debtBalance!: string;

  @ApiProperty({ description: "true si el monto pagado superaba la deuda previa del cliente" })
  exceedsDebt!: boolean;
}
