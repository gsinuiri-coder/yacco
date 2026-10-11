import { ApiProperty } from "@nestjs/swagger";

export class PlantLocationResponseDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: "-12.046374",
    description: "Plant latitude, or null while it has not been configured",
  })
  latitude!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "-77.042793",
    description: "Plant longitude, or null while it has not been configured",
  })
  longitude!: string | null;
}
