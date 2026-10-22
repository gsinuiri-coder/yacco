import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

/** Respuesta de POST /auth/mobile/login: el refresh va en el cuerpo, no en cookie. */
export class MobileSessionDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty({ description: "Dura 30 días; el celular lo guarda cifrado" })
  refreshToken!: string;
}

export class MobileRefreshDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
