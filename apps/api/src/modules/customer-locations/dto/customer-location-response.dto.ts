import { ApiProperty } from "@nestjs/swagger";

export class CustomerLocationResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  address!: string;

  @ApiProperty()
  addressReference!: string;

  @ApiProperty()
  phone!: string;

  @ApiProperty()
  isPrimary!: boolean;

  @ApiProperty()
  active!: boolean;
}
