import { ApiProperty } from "@nestjs/swagger";

export class LocationTrackingResponseDto {
  @ApiProperty({
    example: 300,
    description: "Cada cuántos segundos manda su ubicación el celular con la ruta en curso",
  })
  intervalSeconds!: number;
}
