import { ApiProperty } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsString, MinLength } from "class-validator";

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
}
