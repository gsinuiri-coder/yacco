import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ContactUserReferenceDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class CustomerContactResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  customerId!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  phone!: string | null;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({ format: "uuid" })
  createdById!: string;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  removedById!: string | null;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  removedAt!: Date | null;

  @ApiPropertyOptional({ type: ContactUserReferenceDto })
  createdBy?: ContactUserReferenceDto;

  @ApiPropertyOptional({ type: ContactUserReferenceDto, nullable: true })
  removedBy?: ContactUserReferenceDto | null;
}
