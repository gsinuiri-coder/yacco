import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

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

  @ApiPropertyOptional({ nullable: true })
  contactName!: string | null;

  @ApiPropertyOptional({ type: String, example: "-12.046374", nullable: true })
  latitude!: string | null;

  @ApiPropertyOptional({ type: String, example: "-77.042793", nullable: true })
  longitude!: string | null;

  @ApiProperty()
  isPrimary!: boolean;

  @ApiProperty()
  active!: boolean;

  /**
   * Read-only. Written only by the roster loader — never by a public write
   * route, since this module has none yet. Null for a web-created location.
   */
  @ApiPropertyOptional({ type: String, nullable: true })
  externalCode!: string | null;
}
