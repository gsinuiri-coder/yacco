import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
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

  @ApiPropertyOptional({ example: "DNI", nullable: true })
  documentType?: string | null;

  @ApiPropertyOptional({ example: "12345678", nullable: true })
  documentNumber?: string | null;

  @ApiPropertyOptional({ example: "Q12345678", nullable: true })
  licenseNumber?: string | null;

  @ApiPropertyOptional({ example: "A-IIb", nullable: true })
  licenseCategory?: string | null;

  @ApiPropertyOptional({ example: "2027-10-12", nullable: true })
  licenseExpiresOn?: string | null;
}
