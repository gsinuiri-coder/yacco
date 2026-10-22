import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export const SYNC_RESULT_STATUSES = ["APPLIED", "DUPLICATE", "REJECTED"] as const;
export type SyncResultStatus = (typeof SYNC_RESULT_STATUSES)[number];

/**
 * Qué pasó con una operación del lote. `REJECTED` con `quarantined: false`
 * todavía tiene otro intento: el celular la deja en su cola y la vuelve a
 * mandar. Con `quarantined: true` ya no se reintenta: la revisa la oficina.
 */
export class SyncOperationResultDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ enum: SYNC_RESULT_STATUSES })
  status!: SyncResultStatus;

  @ApiProperty()
  quarantined!: boolean;

  @ApiPropertyOptional({ description: "Por qué no se aplicó" })
  reason?: string;
}

export class SyncBatchResultDto {
  @ApiProperty({ type: SyncOperationResultDto, isArray: true })
  results!: SyncOperationResultDto[];
}

/** Lo que la oficina necesita para reconocer la parada sin abrir el payload. */
export class SyncOperationStopContextDto {
  @ApiProperty({ format: "uuid" })
  routeId!: string;

  @ApiProperty({ example: "2026-10-22", description: "Día de la ruta, AAAA-MM-DD" })
  routeDate!: string;

  @ApiProperty({ format: "uuid" })
  stopId!: string;

  @ApiProperty()
  customerName!: string;

  @ApiProperty()
  locationName!: string;

  @ApiProperty({ description: "Estado de la parada HOY en el servidor" })
  stopStatus!: string;
}

export class SyncOperationInReviewDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty({ type: Object, description: "Lo que el chofer quiso hacer, tal como llegó" })
  payload!: unknown;

  @ApiProperty()
  driverName!: string;

  @ApiProperty({ type: String, format: "date-time", description: "Hora del celular" })
  clientTimestamp!: Date;

  @ApiProperty({ type: String, format: "date-time", description: "Hora de llegada" })
  receivedAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  quarantinedAt!: Date;

  @ApiProperty()
  attempts!: number;

  @ApiProperty()
  rejectionReason!: string;

  @ApiPropertyOptional({ type: SyncOperationStopContextDto })
  stop?: SyncOperationStopContextDto;
}

export class ResolveSyncOperationDto {
  @ApiProperty({ description: "Qué se hizo con la operación", example: "Se corrigió la parada" })
  @IsString()
  @IsNotEmpty({ message: "La nota de la revisión no puede estar vacía" })
  @MaxLength(500, { message: "La nota de la revisión admite hasta 500 caracteres" })
  note!: string;
}

export class SyncOperationResolutionDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ type: String, format: "date-time" })
  resolvedAt!: Date;

  @ApiProperty()
  resolutionNote!: string;
}
