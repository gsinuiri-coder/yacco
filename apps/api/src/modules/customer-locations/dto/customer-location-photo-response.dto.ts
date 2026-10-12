import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { LocationPhotoStatus } from "@prisma/client";

export class PhotoUserReferenceDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class PhotoLocationCustomerDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class PhotoLocationReferenceDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ type: PhotoLocationCustomerDto })
  customer?: PhotoLocationCustomerDto;
}

export class CustomerLocationPhotoResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  locationId!: string;

  @ApiProperty()
  objectKey!: string;

  @ApiProperty()
  contentType!: string;

  @ApiProperty()
  sizeBytes!: number;

  @ApiProperty({ enum: LocationPhotoStatus })
  status!: LocationPhotoStatus;

  @ApiProperty({ format: "uuid" })
  uploadedById!: string;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  reviewedById!: string | null;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  reviewedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  rejectionReason!: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  hiddenById!: string | null;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  hiddenAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  hiddenReason!: string | null;

  @ApiPropertyOptional({ type: PhotoUserReferenceDto })
  uploadedBy?: PhotoUserReferenceDto;

  @ApiPropertyOptional({ type: PhotoUserReferenceDto, nullable: true })
  reviewedBy?: PhotoUserReferenceDto | null;

  @ApiPropertyOptional({ type: PhotoUserReferenceDto, nullable: true })
  hiddenBy?: PhotoUserReferenceDto | null;

  @ApiPropertyOptional({ type: PhotoLocationReferenceDto })
  location?: PhotoLocationReferenceDto;
}
