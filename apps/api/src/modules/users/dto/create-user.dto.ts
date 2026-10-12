import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";

export class CreateUserDto {
  @ApiProperty({ example: "Juana Pérez" })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: "jperez" })
  @IsString()
  @MinLength(1)
  username!: string;

  @ApiProperty({ example: "s3cr3t-password" })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ enum: UserRole, isArray: true, example: [UserRole.SELLER, UserRole.DRIVER] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(UserRole, { each: true })
  roles!: UserRole[];

  @ApiPropertyOptional({ example: "DNI" })
  @IsOptional()
  @IsString()
  documentType?: string;

  @ApiPropertyOptional({ example: "12345678" })
  @IsOptional()
  @IsString()
  documentNumber?: string;

  @ApiPropertyOptional({ example: "Q12345678" })
  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @ApiPropertyOptional({ example: "A-IIb" })
  @IsOptional()
  @IsString()
  licenseCategory?: string;

  @ApiPropertyOptional({ example: "2027-10-12" })
  @IsOptional()
  @IsString()
  licenseExpiresOn?: string;
}
