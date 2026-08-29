import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
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

/**
 * Los mensajes de excepción de este servicio van en ESPAÑOL, a diferencia de
 * los identificadores y los comentarios.
 *
 * No es una excepción a la regla de idioma: es la regla. El mensaje de una
 * excepción HTTP no es código, es texto que lee una persona — la web lo muestra
 * tal cual, sin traducir (`errorMessage()` en `users-page.tsx` devuelve
 * `error.message` a propósito, para que el 409 nombre el usuario repetido en
 * vez de esconderlo detrás de un genérico). Es el mismo criterio que ya siguen
 * los `message:` de los DTOs de este módulo y los servicios de `customers`,
 * `orders`, `routes` y el resto.
 *
 * Un mensaje que solo va a un log o que solo lee un desarrollador puede
 * quedarse en inglés; la pregunta a hacerse es si puede terminar en pantalla.
 */
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
        throw new ConflictException(
          `Ya existe un usuario con el nombre de usuario "${dto.username}"`,
        );
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

  /**
   * `actorId` es quien manda el cambio, sacado del token en el controller.
   *
   * Existe solo para una guarda: nadie puede cerrarse la puerta desde adentro,
   * ni quitándose el rol ADMIN ni desactivándose. Hasta ahora esa regla vivía
   * únicamente en la web (`users-page.tsx` no ofrece "Desactivar" en la propia
   * fila), y Swagger o un `curl` la salteaban.
   *
   * **No hace falta contar administradores, y no se debe.** Si nadie puede
   * quitarse a sí mismo, siempre queda al menos quien está haciendo el cambio:
   * la invariante «existe un ADMIN activo» se sostiene sin mirar a los demás.
   * Un `countAdmins()` agregaría una consulta y una condición de carrera —dos
   * administradores degradándose a la vez, cada uno viendo al otro— sin cubrir
   * ningún caso que esta guarda deje afuera. Es el primer refactor que alguien
   * va a querer hacerle; no lo hagas.
   */
  async update(id: string, dto: UpdateUserDto, actorId: string): Promise<UserResponseDto> {
    if (actorId === id) {
      if (dto.active === false) {
        throw new BadRequestException("No puedes desactivar tu propio usuario");
      }
      if (dto.roles !== undefined && !dto.roles.includes(UserRole.ADMIN)) {
        throw new BadRequestException("No puedes quitarte a ti mismo la administración");
      }
    }

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
        throw new NotFoundException(`El usuario "${id}" no existe`);
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
