import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { ContainerTypeResponseDto } from "./dto/container-type-response.dto.js";
import type { CreateContainerTypeDto } from "./dto/create-container-type.dto.js";
import type { ListContainerTypesQueryDto } from "./dto/list-container-types-query.dto.js";
import type { UpdateContainerTypeDto } from "./dto/update-container-type.dto.js";

const CONTAINER_TYPE_SELECT = { id: true, name: true, active: true } as const;

function isPrismaKnownError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/**
 * Manageable catalog — the plant's containers are told apart by label
 * ((V), (R), ...) and those are distinct types for the inventory, so the
 * owner creates and withdraws them from the office. Same shape as
 * Users/Customers: create, list, findOne, update. No delete, on purpose:
 *
 * A container type is referenced by products, batch_items,
 * container_movements, customer_container_balances and container_counts.
 * Withdrawing (`active: false`) is the only possible removal: every
 * historical movement must keep resolving its type, and the reconciliation
 * routine depends on it — its LEFT JOIN would surface a type-less row as a
 * finding, but that finding would be damage we caused ourselves, not
 * something in the field. Withdrawing does not erase what is already out
 * there either: an inactive type keeps showing in balances and historical
 * reports; it only stops being offered for new movements, counts and
 * batches.
 */
@Injectable()
export class ContainerTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateContainerTypeDto): Promise<ContainerTypeResponseDto> {
    try {
      return await this.prisma.containerType.create({
        data: { name: dto.name },
        select: CONTAINER_TYPE_SELECT,
      });
    } catch (error) {
      throw translateUniqueName(error, dto.name);
    }
  }

  /**
   * No pagination: a handful of rows managed by hand — mirrors
   * ProductsService. If it ever grows past a page's worth, this is the
   * place to add it.
   *
   * `active` defaults to true: a production batch or a movement form must
   * never offer a container type the API would then reject as withdrawn.
   */
  async findAll(query: ListContainerTypesQueryDto): Promise<ContainerTypeResponseDto[]> {
    return this.prisma.containerType.findMany({
      where: { active: query.active ?? true },
      orderBy: { name: "asc" },
      select: CONTAINER_TYPE_SELECT,
    });
  }

  async findOne(id: string): Promise<ContainerTypeResponseDto> {
    const containerType = await this.prisma.containerType.findUnique({
      where: { id },
      select: CONTAINER_TYPE_SELECT,
    });
    if (containerType === null) {
      throw new NotFoundException(`El tipo de envase "${id}" no existe`);
    }
    return containerType;
  }

  async update(id: string, dto: UpdateContainerTypeDto): Promise<ContainerTypeResponseDto> {
    try {
      return await this.prisma.containerType.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
        select: CONTAINER_TYPE_SELECT,
      });
    } catch (error) {
      if (isPrismaKnownError(error, "P2025")) {
        throw new NotFoundException(`El tipo de envase "${id}" no existe`);
      }
      throw translateUniqueName(error, dto.name);
    }
  }
}

/**
 * P2002 on container_types.name. This is an everyday path, not a race: the
 * owner will try to create a type that already exists (or rename one onto
 * another's name), so it needs a message the UI can show as-is — the same
 * treatment sales.external_id gets in SalesService.
 */
function translateUniqueName(error: unknown, name: string | undefined): unknown {
  if (isPrismaKnownError(error, "P2002")) {
    return new BadRequestException(`Ya existe un tipo de envase con el nombre "${name}"`);
  }
  return error;
}
