import { ApiProperty } from "@nestjs/swagger";
import { Weekday } from "@prisma/client";

export class ZoneResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;

  /** Empty until routing decides them — see CreateZoneDto. */
  @ApiProperty({ enum: Weekday, isArray: true })
  deliveryDays!: Weekday[];

  @ApiProperty()
  active!: boolean;
}
