import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { CreateZoneDto } from "./dto/create-zone.dto.js";
import type { ListZonesQueryDto } from "./dto/list-zones-query.dto.js";
import type { UpdateZoneDto } from "./dto/update-zone.dto.js";
import type { ZoneResponseDto } from "./dto/zone-response.dto.js";

const ZONE_SELECT = { id: true, name: true, deliveryDays: true, active: true } as const;

function isPrismaKnownError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/**
 * Manageable catalog, same shape as ContainerTypes: create, list, findOne,
 * update. The owner organizes the work by zone — the container audit of
 * ~500 locations is walked zone by zone, not alphabetically — so zones
 * must exist before anything else can be filtered by them, and the office
 * must be able to create and correct them without touching the database.
 *
 * No delete, on purpose. A zone is referenced by customers and routes with
 * onDelete: Restrict; a hard delete would either fail once anything points
 * at it or, if forced, orphan every customer and route that used it for
 * grouping. Withdrawing (`active: false`) is the only possible removal: the
 * zone stops being offered for new customers and filters, and everything
 * already grouped under it keeps resolving its name.
 */
@Injectable()
export class ZonesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateZoneDto): Promise<ZoneResponseDto> {
    try {
      return await this.prisma.zone.create({
        data: { name: dto.name, deliveryDays: dto.deliveryDays ?? [] },
        select: ZONE_SELECT,
      });
    } catch (error) {
      throw translateUniqueName(error, dto.name);
    }
  }

  /**
   * No pagination: a handful of rows managed by hand — mirrors
   * ContainerTypesService. `active` defaults to true: a customer form or a
   * report filter must never offer a zone that has been withdrawn.
   */
  async findAll(query: ListZonesQueryDto): Promise<ZoneResponseDto[]> {
    return this.prisma.zone.findMany({
      where: { active: query.active ?? true },
      orderBy: { name: "asc" },
      select: ZONE_SELECT,
    });
  }

  async findOne(id: string): Promise<ZoneResponseDto> {
    const zone = await this.prisma.zone.findUnique({ where: { id }, select: ZONE_SELECT });
    if (zone === null) {
      throw new NotFoundException(`La zona "${id}" no existe`);
    }
    return zone;
  }

  async update(id: string, dto: UpdateZoneDto): Promise<ZoneResponseDto> {
    try {
      return await this.prisma.zone.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.deliveryDays !== undefined ? { deliveryDays: dto.deliveryDays } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
        select: ZONE_SELECT,
      });
    } catch (error) {
      if (isPrismaKnownError(error, "P2025")) {
        throw new NotFoundException(`La zona "${id}" no existe`);
      }
      throw translateUniqueName(error, dto.name);
    }
  }
}

/**
 * P2002 on zones.name. An everyday path, not a race: the owner will try to
 * create a zone that already exists (or rename one onto another's name), so
 * it needs a message the UI can show as-is.
 */
function translateUniqueName(error: unknown, name: string | undefined): unknown {
  if (isPrismaKnownError(error, "P2002")) {
    return new BadRequestException(`Ya existe una zona con el nombre "${name}"`);
  }
  return error;
}
