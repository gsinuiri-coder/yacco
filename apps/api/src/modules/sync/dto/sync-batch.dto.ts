import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from "class-validator";

/** Cuántas operaciones entran en un lote: lo que junta un día entero sin señal. */
export const MAX_OPERATIONS_PER_BATCH = 200;

/**
 * El sobre de una operación (sync-protocol, D-06): genérico y versionado. El
 * `payload` se valida recién al aplicarla, con el DTO de su `(type, version)`:
 * un payload malo es un rechazo de ESA operación, no un 400 del lote entero.
 */
export class SyncOperationEnvelopeDto {
  @ApiProperty({ format: "uuid", description: "Generado en el celular" })
  @IsUUID("4", { message: "El id de la operación debe ser un UUID" })
  id!: string;

  @ApiProperty({ example: "STOP_MARK" })
  @IsString()
  @IsNotEmpty({ message: "La operación necesita un tipo" })
  type!: string;

  @ApiProperty({ minimum: 1, example: 1 })
  @IsInt({ message: "La versión del sobre debe ser un número entero" })
  @Min(1, { message: "La versión del sobre empieza en 1" })
  version!: number;

  @ApiProperty({ type: String, format: "date-time", description: "Hora del celular" })
  @IsISO8601({ strict: true }, { message: "La hora de la operación debe ser ISO 8601" })
  clientTimestamp!: string;

  @ApiProperty({ type: Object })
  @IsObject({ message: "El contenido de la operación debe ser un objeto" })
  payload!: Record<string, unknown>;
}

export class SyncBatchDto {
  @ApiProperty({ type: SyncOperationEnvelopeDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1, { message: "El lote debe traer al menos una operación" })
  @ArrayMaxSize(MAX_OPERATIONS_PER_BATCH, {
    message: `Un lote admite hasta ${MAX_OPERATIONS_PER_BATCH} operaciones`,
  })
  @ValidateNested({ each: true })
  @Type(() => SyncOperationEnvelopeDto)
  operations!: SyncOperationEnvelopeDto[];
}
