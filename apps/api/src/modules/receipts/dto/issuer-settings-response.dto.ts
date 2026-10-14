import { ApiProperty } from "@nestjs/swagger";

class IssuerSettingsUserDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  username!: string;
}

export class IssuerSettingsResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  taxId!: string;

  @ApiProperty()
  legalName!: string;

  @ApiProperty()
  fiscalAddress!: string;

  @ApiProperty({ example: "18.00" })
  taxRate!: string;

  @ApiProperty({ example: "700.00" })
  receiptDocumentThreshold!: string;

  @ApiProperty({ format: "uuid" })
  createdById!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ type: IssuerSettingsUserDto })
  createdBy!: IssuerSettingsUserDto;
}
