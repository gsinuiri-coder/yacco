import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { ListContainerTypesQueryDto } from "./dto/list-container-types-query.dto.js";
import type { ContainerTypeResponseDto } from "./dto/container-type-response.dto.js";

@Injectable()
export class ContainerTypesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * No pagination: the catalog is seeded (con caño / sin caño) and not
   * managed from the UI in this phase — mirrors ProductsService. If it ever
   * grows past a page's worth, this is the place to add it.
   *
   * `active` defaults to true: a production batch or a movement form must
   * never offer a container type the API would then reject as withdrawn.
   */
  async findAll(query: ListContainerTypesQueryDto): Promise<ContainerTypeResponseDto[]> {
    return this.prisma.containerType.findMany({
      where: { active: query.active ?? true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, active: true },
    });
  }
}
