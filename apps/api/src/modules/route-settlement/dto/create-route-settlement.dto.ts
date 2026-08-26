import { ApiPropertyOptional, ApiProperty } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Min } from "class-validator";

/**
 * The only two numbers a human enters: physical counts at the plant door
 * when the truck comes back. Everything else in a settlement — fullOut,
 * fullDelivered, fullSold, every money figure — is derived from the ledger
 * inside RouteSettlementService.settle, never accepted from the caller.
 */
export class CreateRouteSettlementDto {
  @ApiProperty({ minimum: 0, example: 6, description: "Llenos que vuelven sin entregar ni vender" })
  @IsInt({ message: "Los llenos retornados deben ser un número entero" })
  @Min(0, { message: "Los llenos retornados no pueden ser negativos" })
  fullReturned!: number;

  @ApiProperty({ minimum: 0, example: 14, description: "Vacíos contados al descargar el camión" })
  @IsInt({ message: "Los vacíos recogidos deben ser un número entero" })
  @Min(0, { message: "Los vacíos recogidos no pueden ser negativos" })
  emptiesCollected!: number;

  @ApiPropertyOptional({ description: "Aclaración libre, típicamente sobre una diferencia" })
  @IsOptional()
  @IsString({ message: "Las notas deben ser texto" })
  notes?: string;
}
