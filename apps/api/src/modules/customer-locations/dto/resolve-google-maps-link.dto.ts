import { ApiProperty } from "@nestjs/swagger";
import { IsUrl } from "class-validator";

export class ResolveGoogleMapsLinkDto {
  @ApiProperty({ example: "https://maps.app.goo.gl/AbC123" })
  @IsUrl(
    { protocols: ["https"], require_protocol: true },
    { message: "El enlace de Google Maps no es válido" },
  )
  url!: string;
}

export class GoogleMapsLinkResolutionDto {
  @ApiProperty({ example: "https://www.google.com/maps/place/Local/@-12.046374,-77.042793,17z" })
  url!: string;
}
