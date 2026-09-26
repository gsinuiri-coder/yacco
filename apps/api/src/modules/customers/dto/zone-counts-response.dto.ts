import { ApiProperty } from "@nestjs/swagger";

export class ZoneCustomerCountDto {
  @ApiProperty({ format: "uuid" })
  zoneId!: string;

  @ApiProperty({ example: 476, description: "Clientes activos de la zona" })
  activeCustomers!: number;
}

/**
 * How many ACTIVE customers each zone has, and how many active customers have
 * no zone. Only zones with at least one active customer appear: the zones
 * screen already has the catalog and reads a missing zone as zero.
 */
export class ZoneCustomerCountsDto {
  @ApiProperty({ type: [ZoneCustomerCountDto] })
  zones!: ZoneCustomerCountDto[];

  @ApiProperty({ example: 68, description: "Clientes activos sin zona" })
  withoutZone!: number;
}
