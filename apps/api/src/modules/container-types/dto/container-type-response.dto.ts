import { ApiProperty } from "@nestjs/swagger";

export class ContainerTypeResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  active!: boolean;
}
