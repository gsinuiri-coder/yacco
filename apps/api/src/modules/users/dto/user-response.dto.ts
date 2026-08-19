import { ApiProperty } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";

export class UserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({ enum: UserRole, isArray: true })
  roles!: UserRole[];
}
