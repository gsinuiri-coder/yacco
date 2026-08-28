import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ContainerMovementType, ContainerState, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ContainerMovementsService } from "../container-movements/container-movements.service.js";
import { formatBusinessDate, parseBusinessDate } from "../orders/orders.service.js";
import type { CreateProductionBatchDto } from "./dto/create-production-batch.dto.js";
import type {
  CreateProductionBatchResponseDto,
  PaginatedProductionBatchesDto,
  ProductionBatchResponseDto,
  ProductionBatchWarningDto,
} from "./dto/production-batch-response.dto.js";
import type { ListProductionBatchesQueryDto } from "./dto/list-production-batches-query.dto.js";

function isPrismaKnownError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/** Everything the wire shape needs, and nothing else. */
const BATCH_INCLUDE = {
  filledBy: { select: { id: true, name: true } },
  items: { include: { containerType: { select: { id: true, name: true } } } },
} satisfies Prisma.ProductionBatchInclude;

type BatchWithRelations = Prisma.ProductionBatchGetPayload<{ include: typeof BATCH_INCLUDE }>;

function toBatchResponse(batch: BatchWithRelations): ProductionBatchResponseDto {
  return {
    id: batch.id,
    code: batch.code,
    date: formatBusinessDate(batch.date),
    filledById: batch.filledById,
    filledBy: batch.filledBy,
    notes: batch.notes,
    items: batch.items.map((item) => ({
      id: item.id,
      containerTypeId: item.containerTypeId,
      containerType: item.containerType,
      producedQty: item.producedQty,
      availableQty: item.availableQty,
    })),
  };
}

/** Every containerTypeId that appears more than once across the batch's lines. */
function findDuplicateContainerTypeIds(items: { containerTypeId: string }[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (seen.has(item.containerTypeId)) duplicates.add(item.containerTypeId);
    seen.add(item.containerTypeId);
  }
  return [...duplicates];
}

@Injectable()
export class ProductionBatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly containerMovementsService: ContainerMovementsService,
  ) {}

  /**
   * Registers what the plant filled on a day, and — in the SAME transaction
   * — the FILLING movement (empty at plant -> full at plant) that fact
   * implies for every line. Writes through `ContainerMovementsService`, the
   * only place the ledger is ever inserted: a second write path here would
   * eventually skip the transition-matrix validation that lives there.
   *
   * If a line produces more than the plant had empty, the batch is recorded
   * anyway and the resulting (derived) empty-at-plant inventory goes
   * negative — spec, decided with the client: the owner really did fill
   * those containers, and the system cannot retroactively say it didn't.
   * The negative means "fleet entries are missing, go record them" and
   * clears itself once someone does. This is the same "warn, never block"
   * philosophy as the credit limit. The response names every line this
   * happened to, with the numbers, so the caller can surface it — a silent
   * negative is worse than a block, because nobody looks at it.
   */
  async create(
    dto: CreateProductionBatchDto,
    filledById: string,
  ): Promise<CreateProductionBatchResponseDto> {
    const date = parseBusinessDate(dto.date, "La fecha del lote");

    const duplicateIds = findDuplicateContainerTypeIds(dto.items);
    if (duplicateIds.length > 0) {
      throw new BadRequestException(
        `Un tipo de envase no puede repetirse en el mismo lote: ${duplicateIds.join(", ")}`,
      );
    }

    const requestedIds = [...new Set(dto.items.map((item) => item.containerTypeId))];
    const containerTypes = await this.prisma.containerType.findMany({
      where: { id: { in: requestedIds } },
    });
    if (containerTypes.length !== requestedIds.length) {
      const found = new Set(containerTypes.map((containerType) => containerType.id));
      const missing = requestedIds.filter((id) => !found.has(id));
      throw new BadRequestException(`No existen los tipos de envase: ${missing.join(", ")}`);
    }
    const inactive = containerTypes.filter((containerType) => !containerType.active);
    if (inactive.length > 0) {
      const names = inactive.map((containerType) => `"${containerType.name}"`).join(", ");
      throw new BadRequestException(`Ya no están activos los tipos de envase: ${names}`);
    }
    const containerTypeById = new Map(containerTypes.map((ct) => [ct.id, ct] as const));

    try {
      const { batch, warnings } = await this.prisma.$transaction(async (tx) => {
        const created = await tx.productionBatch.create({
          data: {
            code: dto.code,
            date,
            filledById,
            notes: dto.notes ?? null,
            items: {
              create: dto.items.map((item) => ({
                containerTypeId: item.containerTypeId,
                producedQty: item.producedQty,
                availableQty: item.producedQty,
              })),
            },
          },
          include: BATCH_INCLUDE,
        });

        const warnings: ProductionBatchWarningDto[] = [];
        for (const item of dto.items) {
          const emptyAvailable = await this.emptyAtPlantQuantity(tx, item.containerTypeId);

          await this.containerMovementsService.createWithinTransaction(
            tx,
            {
              type: ContainerMovementType.FILLING,
              containerTypeId: item.containerTypeId,
              quantity: item.producedQty,
              fromState: ContainerState.EMPTY_AT_PLANT,
              toState: ContainerState.FULL_AT_PLANT,
            },
            filledById,
            { batchId: created.id },
          );

          if (item.producedQty > emptyAvailable) {
            // Non-null: this id was resolved above, before the transaction.
            const containerType = containerTypeById.get(item.containerTypeId)!;
            warnings.push({
              containerTypeId: item.containerTypeId,
              containerType: { id: containerType.id, name: containerType.name },
              emptyAvailable,
              produced: item.producedQty,
            });
          }
        }

        return { batch: created, warnings };
      });

      return { ...toBatchResponse(batch), warnings };
    } catch (error) {
      // production_batches_code_key: the office reuses codes across days by
      // mistake more often than any other input here.
      if (isPrismaKnownError(error, "P2002")) {
        throw new ConflictException(`Ya existe un lote con el código "${dto.code}"`);
      }
      throw error;
    }
  }

  /** Always paginated; the count runs against the same filter as the page. */
  async findAll(query: ListProductionBatchesQueryDto): Promise<PaginatedProductionBatchesDto> {
    const { page, limit } = query;
    const where = buildBatchFilter(query);

    const [total, batches] = await this.prisma.$transaction([
      this.prisma.productionBatch.count({ where }),
      this.prisma.productionBatch.findMany({
        where,
        include: BATCH_INCLUDE,
        orderBy: [{ date: "asc" }, { code: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: batches.map(toBatchResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string): Promise<ProductionBatchResponseDto> {
    const batch = await this.prisma.productionBatch.findUnique({
      where: { id },
      include: BATCH_INCLUDE,
    });
    if (batch === null) {
      throw new NotFoundException(`El lote "${id}" no existe`);
    }
    return toBatchResponse(batch);
  }

  /**
   * Net empty-at-plant quantity for one container type, derived from the
   * ledger the same way `ContainerMovementsService.inventory` does — every
   * movement that landed there minus every movement that left it — but
   * scoped to a single type and read inside the caller's own transaction, so
   * it reflects exactly what is on the books the instant before this
   * batch's own FILLING movements are added to it.
   */
  private async emptyAtPlantQuantity(
    client: Prisma.TransactionClient,
    containerTypeId: string,
  ): Promise<number> {
    const [into, outOf] = await Promise.all([
      client.containerMovement.aggregate({
        where: { containerTypeId, toState: ContainerState.EMPTY_AT_PLANT },
        _sum: { quantity: true },
      }),
      client.containerMovement.aggregate({
        where: { containerTypeId, fromState: ContainerState.EMPTY_AT_PLANT },
        _sum: { quantity: true },
      }),
    ]);
    return (into._sum.quantity ?? 0) - (outOf._sum.quantity ?? 0);
  }
}

function buildBatchFilter(query: ListProductionBatchesQueryDto): Prisma.ProductionBatchWhereInput {
  const { dateFrom, dateTo, withStock } = query;
  const from = dateFrom === undefined ? undefined : parseBusinessDate(dateFrom, "La fecha desde");
  const to = dateTo === undefined ? undefined : parseBusinessDate(dateTo, "La fecha hasta");

  if (from !== undefined && to !== undefined && from > to) {
    throw new BadRequestException("La fecha desde no puede ser posterior a la fecha hasta");
  }

  return {
    ...(from !== undefined || to !== undefined
      ? {
          date: {
            ...(from !== undefined ? { gte: from } : {}),
            ...(to !== undefined ? { lte: to } : {}),
          },
        }
      : {}),
    // `some` y no un filtro sobre `items` en el include: el lote entra o no
    // entra en la página, y sus líneas siguen viajando completas — una línea
    // agotada de un lote que todavía tiene otra con stock es información que
    // la pantalla de carga necesita para no ofrecerla.
    ...(withStock === true ? { items: { some: { availableQty: { gt: 0 } } } } : {}),
    ...(withStock === false ? { items: { every: { availableQty: { lte: 0 } } } } : {}),
  };
}
