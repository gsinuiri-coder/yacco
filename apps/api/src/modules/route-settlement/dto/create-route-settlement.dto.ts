import { ApiPropertyOptional, ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsInt, IsOptional, IsString, IsUUID, Min, ValidateNested } from "class-validator";

/** Un tipo de envase y cuántos vacíos de ese tipo se contaron en la puerta. */
export class SettlementEmptiesLineDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El tipo de envase debe ser un UUID válido" })
  containerTypeId!: string;

  @ApiProperty({ minimum: 0, example: 8 })
  @IsInt({ message: "Los vacíos contados deben ser un número entero" })
  @Min(0, { message: "Los vacíos contados no pueden ser negativos" })
  quantity!: number;
}

/**
 * The only numbers a human enters: physical counts at the plant door when the
 * truck comes back. Everything else in a settlement — fullOut, fullDelivered,
 * fullSold, every money figure — is derived from the ledger inside
 * RouteSettlementService.settle, never accepted from the caller.
 *
 * Los vacíos van desglosados POR TIPO y no como un total: liquidar emite un
 * `EMPTY_UNLOAD` por cada línea, y un movimiento de envases siempre nombra de
 * qué tipo es. Un total no alcanza para escribirlo. `fullReturned` sigue
 * siendo un número solo porque no emite ningún movimiento — ver la entrada
 * «Devolver llenos al galpón no repone el lote» en docs/backlog-tecnico.md.
 */
export class CreateRouteSettlementDto {
  @ApiProperty({ minimum: 0, example: 6, description: "Llenos que vuelven sin entregar ni vender" })
  @IsInt({ message: "Los llenos retornados deben ser un número entero" })
  @Min(0, { message: "Los llenos retornados no pueden ser negativos" })
  fullReturned!: number;

  /**
   * El arreglo vacío es válido: puede no volver ningún vacío. Una línea en
   * cero también, y no emite movimiento. Repetir un tipo es un 400: sumar dos
   * líneas del mismo tipo en silencio taparía un error de quien llama.
   */
  @ApiProperty({
    type: [SettlementEmptiesLineDto],
    description: "Vacíos contados al descargar el camión, por tipo de envase",
  })
  @IsArray({ message: "Los vacíos recogidos deben ser una lista por tipo de envase" })
  @ValidateNested({ each: true })
  @Type(() => SettlementEmptiesLineDto)
  emptiesCollected!: SettlementEmptiesLineDto[];

  @ApiPropertyOptional({ description: "Aclaración libre, típicamente sobre una diferencia" })
  @IsOptional()
  @IsString({ message: "Las notas deben ser texto" })
  notes?: string;
}
