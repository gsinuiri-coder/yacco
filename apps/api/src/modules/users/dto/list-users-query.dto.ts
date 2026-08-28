import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsEnum, IsOptional } from "class-validator";
import { UserRole } from "@prisma/client";

/**
 * Query params arrive as strings, so booleans need an explicit transform —
 * `Boolean("false")` is `true`. Anything other than "true"/"false" is left
 * untouched so @IsBoolean reports it instead of it silently becoming false.
 * Copied from ListZonesQueryDto rather than imported: two unrelated
 * catalogs sharing this helper through a cross-import would couple them for
 * no reason.
 */
function toOptionalBoolean({ value }: { value: unknown }): unknown {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return value;
}

export class ListUsersQueryDto {
  @ApiPropertyOptional({
    enum: UserRole,
    description: "Filtra por usuarios que tienen el rol indicado",
  })
  @IsOptional()
  @IsEnum(UserRole, { message: "El rol no es un rol válido" })
  role?: UserRole;

  @ApiPropertyOptional({
    description: "Filtra por usuarios activos o desactivados; por defecto solo los activos",
  })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean({ message: "El filtro activo debe ser verdadero o falso" })
  active?: boolean;
}
