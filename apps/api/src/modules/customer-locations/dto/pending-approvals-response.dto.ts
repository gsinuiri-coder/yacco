import { ApiProperty } from "@nestjs/swagger";
import { CustomerLocationPhotoResponseDto } from "./customer-location-photo-response.dto.js";
import { CustomerLocationCoordinateRequestResponseDto } from "./customer-location-coordinate-request-response.dto.js";

export class PendingApprovalsResponseDto {
  @ApiProperty({ type: CustomerLocationPhotoResponseDto, isArray: true })
  photos!: CustomerLocationPhotoResponseDto[];

  @ApiProperty({ type: CustomerLocationCoordinateRequestResponseDto, isArray: true })
  coordinateRequests!: CustomerLocationCoordinateRequestResponseDto[];

  @ApiProperty({ example: 3, description: "Total de solicitudes pendientes" })
  totalPending!: number;
}
