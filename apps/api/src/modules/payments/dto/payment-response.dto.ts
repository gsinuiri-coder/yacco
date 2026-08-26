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
