import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/**
 * PATCH semantics: every field optional. Withdrawing a type is
 * `active: false` here — there is no DELETE route, see
 * ContainerTypesService for why. Reactivating is `active: true`.
 */
export class UpdateContainerTypeDto {
  @ApiPropertyOptional({ example: "Bidón (R)" })
  @IsOptional()
  @IsString({ message: "El nombre es obligatorio" })
  @MinLength(1, { message: "El nombre es obligatorio" })
  @MaxLength(80, { message: "El nombre no puede superar los 80 caracteres" })
  name?: string;

  @ApiPropertyOptional({ description: "false retira el tipo de envase (no se borra la fila)" })
  @IsOptional()
  @IsBoolean({ message: "El estado activo debe ser verdadero o falso" })
  active?: boolean;
}
