import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";

/**
 * Query params arrive as strings, so booleans need an explicit transform —
 * `Boolean("false")` is `true`. Anything other than "true"/"false" is left
 * untouched so @IsBoolean reports it instead of it silently becoming false.
 */
function toOptionalBoolean({ value }: { value: unknown }): unknown {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return value;
}

export class ListProductsQueryDto {
  @ApiPropertyOptional({
    description: "Filtra por productos activos o retirados; por defecto solo los activos",
  })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean({ message: "El filtro activo debe ser verdadero o falso" })
  active?: boolean;
}
