import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CoordinateRequestStatus } from "@prisma/client";
import {
  PhotoLocationReferenceDto,
  PhotoUserReferenceDto,
} from "./customer-location-photo-response.dto.js";

export class CustomerLocationCoordinateRequestResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  locationId!: string;

  @ApiProperty({ example: "-12.046374" })
  latitude!: string;

  @ApiProperty({ example: "-77.042793" })
  longitude!: string;

  @ApiPropertyOptional({ example: "5.50", nullable: true })
  accuracyM!: string | null;

  @ApiPropertyOptional({ example: "-12.046000", nullable: true })
  previousLatitude!: string | null;

  @ApiPropertyOptional({ example: "-77.042000", nullable: true })
  previousLongitude!: string | null;

  @ApiProperty({ enum: CoordinateRequestStatus })
  status!: CoordinateRequestStatus;

  @ApiProperty({ format: "uuid" })
  requestedById!: string;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  reviewedById!: string | null;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  reviewedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  rejectionReason!: string | null;

  @ApiPropertyOptional({ type: PhotoUserReferenceDto })
  requestedBy?: PhotoUserReferenceDto;

  @ApiPropertyOptional({ type: PhotoUserReferenceDto, nullable: true })
  reviewedBy?: PhotoUserReferenceDto | null;

  @ApiPropertyOptional({ type: PhotoLocationReferenceDto })
  location?: PhotoLocationReferenceDto;
}
