import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { CreateUserDto } from "./dto/create-user.dto.js";
import type { ListUsersQueryDto } from "./dto/list-users-query.dto.js";
import type { UpdateUserDto } from "./dto/update-user.dto.js";
import type { UserResponseDto } from "./dto/user-response.dto.js";

const PASSWORD_HASH_ROUNDS = 10;

interface UserScalars {
  id: string;
  name: string;
  username: string;
  active: boolean;
}

interface UserWithRoleAssignments extends UserScalars {
  roles: { role: { name: UserRole } }[];
}

function isPrismaKnownError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function toSafeUser(user: UserScalars, roles: UserRole[]): UserResponseDto {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    active: user.active,
    roles,
  };
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_HASH_ROUNDS);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const roles = await tx.role.findMany({ where: { name: { in: dto.roles } } });
        const roleByName = new Map(roles.map((role) => [role.name, role.id]));

        const user = await tx.user.create({
          data: { name: dto.name, username: dto.username, passwordHash },
        });

        await tx.userRoleAssignment.createMany({
          data: dto.roles.map((roleName) => ({
            userId: user.id,
            roleId: roleByName.get(roleName)!,
          })),
        });

        return toSafeUser(user, dto.roles);
      });
    } catch (error) {
      if (isPrismaKnownError(error, "P2002")) {
        throw new ConflictException(`Username "${dto.username}" is already taken`);
      }
      throw error;
    }
  }

  /**
   * `active` por defecto en true, misma regla que ZonesService.findAll: un
   * select de chofer nunca debe ofrecer un usuario desactivado, y
   * RoutesService.create rechaza a un chofer inactivo con 400, así que
   * ofrecerlo sería construir un error. La pantalla de gestión de usuarios,
   * el día que exista, pide active=false explícito.
   *
   * `roles: { some: ... }` y no un match exacto: un usuario con SELLER y
   * DRIVER es un chofer válido para role=DRIVER.
   */
  async findAll(query: ListUsersQueryDto): Promise<UserResponseDto[]> {
    const users = await this.prisma.user.findMany({
      where: {
        active: query.active ?? true,
        ...(query.role === undefined ? {} : { roles: { some: { role: { name: query.role } } } }),
      },
      include: { roles: { include: { role: true } } },
      orderBy: { name: "asc" },
    });
    return users.map((user) => this.toSafeUserWithRoles(user));
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserResponseDto> {
    const passwordHash = dto.password
      ? await bcrypt.hash(dto.password, PASSWORD_HASH_ROUNDS)
      : undefined;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.active !== undefined ? { active: dto.active } : {}),
            ...(passwordHash !== undefined ? { passwordHash } : {}),
          },
        });

        if (dto.roles === undefined) {
          const assignments = await tx.userRoleAssignment.findMany({
            where: { userId: id },
            include: { role: true },
          });
          return toSafeUser(
            user,
            assignments.map((assignment) => assignment.role.name),
          );
        }

        await tx.userRoleAssignment.deleteMany({ where: { userId: id } });
        const roles = await tx.role.findMany({ where: { name: { in: dto.roles } } });
        const roleByName = new Map(roles.map((role) => [role.name, role.id]));
        await tx.userRoleAssignment.createMany({
          data: dto.roles.map((roleName) => ({
            userId: id,
            roleId: roleByName.get(roleName)!,
          })),
        });

        return toSafeUser(user, dto.roles);
      });
    } catch (error) {
      if (isPrismaKnownError(error, "P2025")) {
        throw new NotFoundException(`User "${id}" not found`);
      }
      throw error;
    }
  }

  /** Internal only — includes passwordHash; never expose over HTTP. */
  async findByUsername(username: string) {
    return this.prisma.user.findUnique({
      where: { username },
      include: { roles: { include: { role: true } } },
    });
  }

  /** Internal only — includes passwordHash; never expose over HTTP. */
  async findByIdWithPassword(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { roles: { include: { role: true } } },
    });
  }

  private toSafeUserWithRoles(user: UserWithRoleAssignments): UserResponseDto {
    return toSafeUser(
      user,
      user.roles.map((assignment) => assignment.role.name),
    );
  }
}
