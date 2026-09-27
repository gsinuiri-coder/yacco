import { ApiProperty } from "@nestjs/swagger";

export class AuthTokensDto {
  @ApiProperty()
  accessToken!: string;
}
