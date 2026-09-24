import { ApiProperty } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";

/** Quién es el dueño del token de acceso, tal como lo firmó la API. */
export class SessionUserDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty({ enum: UserRole, isArray: true })
  roles!: UserRole[];
}
