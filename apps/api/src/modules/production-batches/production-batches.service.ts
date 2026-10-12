import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ContainerMovementType, ContainerState, Prisma, UserRole } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import {
  ContainerMovementsService,
  lockContainerTypes,
} from "../container-movements/container-movements.service.js";
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

export interface RequestUser {
  sub: string;
  roles: UserRole[];
}

export function shouldFilterToOperatorFilling(user?: RequestUser): boolean {
  if (!user) return false;
  const canSeeAll = user.roles.some(
    (role) =>
      role === UserRole.ADMIN || role === UserRole.SELLER || role === UserRole.PLANT_SUPERVISOR,
  );
  return !canSeeAll && user.roles.includes(UserRole.PLANT_OPERATOR);
}

/** Everything the wire shape needs, and nothing else. */
const BATCH_INCLUDE = {
  filledBy: { select: { id: true, name: true } },
  items: {
    orderBy: [{ createdAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    include: {
      containerType: { select: { id: true, name: true } },
      recordedBy: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.ProductionBatchInclude;

type BatchWithRelations = Prisma.ProductionBatchGetPayload<{ include: typeof BATCH_INCLUDE }>;
type BatchCodeDatabase = Pick<Prisma.TransactionClient, "productionBatch">;
type BatchIdentity = { id: string; code: string };

function automaticBatchCodeBase(date: string): string {
  const [year, month, day] = date.split("-") as [string, string, string];
  return `L-${day}${month}${year}`;
}

async function findCanonicalBatch(
  database: BatchCodeDatabase,
  date: Date,
  dateText: string,
): Promise<BatchIdentity | null> {
  const defaultCode = automaticBatchCodeBase(dateText);
  const preferred = await database.productionBatch.findFirst({
    where: { date, code: defaultCode },
    select: { id: true, code: true },
  });
  if (preferred !== null) return preferred;
  return database.productionBatch.findFirst({
    where: { date },
    orderBy: { code: "asc" },
    select: { id: true, code: true },
  });
}

function toBatchResponse(
  batch: BatchWithRelations,
  operatorRecordedById?: string,
): ProductionBatchResponseDto {
  const items = operatorRecordedById
    ? batch.items.filter((item) => item.recordedById === operatorRecordedById)
    : batch.items;
  return {
    id: batch.id,
    code: batch.code,
    date: formatBusinessDate(batch.date),
    filledById: batch.filledById,
    filledBy: batch.filledBy,
    notes: batch.notes,
    items: items.map((item) => ({
      id: item.id,
      containerTypeId: item.containerTypeId,
      containerType: item.containerType,
      producedQty: item.producedQty,
      availableQty: item.availableQty,
      createdAt: item.createdAt?.toISOString() ?? null,
      recordedById: item.recordedById,
      recordedBy: item.recordedBy,
      notes: item.notes,
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
    user?: RequestUser,
  ): Promise<CreateProductionBatchResponseDto> {
    const date = parseBusinessDate(dto.date, "La fecha del lote");
    const requestedCode = dto.code?.trim() ?? "";
    let resolvedCode = requestedCode;

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
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`production-batch-code:${dto.date}`}))`;
        const existing = await findCanonicalBatch(tx, date, dto.date);
        resolvedCode = existing?.code ?? (requestedCode || automaticBatchCodeBase(dto.date));
        await lockContainerTypes(tx, requestedIds);
        const recordedAt = new Date();
        const itemData = dto.items.map((item) => ({
          containerTypeId: item.containerTypeId,
          producedQty: item.producedQty,
          availableQty: item.producedQty,
          createdAt: recordedAt,
          recordedById: filledById,
          notes: dto.notes ?? null,
        }));
        const created =
          existing === null
            ? await tx.productionBatch.create({
                data: {
                  code: resolvedCode,
                  date,
                  filledById,
                  notes: dto.notes ?? null,
                  items: { create: itemData },
                },
                include: BATCH_INCLUDE,
              })
            : await appendFilling(tx, existing.id, itemData);

        const warnings: ProductionBatchWarningDto[] = [];
        for (const item of dto.items) {
          const emptyAvailable = await this.containerMovementsService.getStateBalance(
            tx,
            item.containerTypeId,
            ContainerState.EMPTY_AT_PLANT,
          );

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

      const operatorRecordedById = shouldFilterToOperatorFilling(user) ? filledById : undefined;
      return { ...toBatchResponse(batch, operatorRecordedById), warnings };
    } catch (error) {
      // production_batches_code_key: the office reuses codes across days by
      // mistake more often than any other input here.
      if (isPrismaKnownError(error, "P2002")) {
        throw new ConflictException(`Ya existe un lote con el código "${resolvedCode}"`);
      }
      throw error;
    }
  }

  async proposeCode(dateText: string): Promise<{ code: string; willAppend: boolean }> {
    const date = parseBusinessDate(dateText, "La fecha del lote");
    const existing = await findCanonicalBatch(this.prisma, date, dateText);
    return existing === null
      ? { code: automaticBatchCodeBase(dateText), willAppend: false }
      : { code: existing.code, willAppend: true };
  }

  /** Always paginated; the count runs against the same filter as the page. */
  async findAll(
    query: ListProductionBatchesQueryDto,
    user?: RequestUser,
  ): Promise<PaginatedProductionBatchesDto> {
    const { page, limit } = query;
    const operatorRecordedById = shouldFilterToOperatorFilling(user) ? user!.sub : undefined;
    const where = buildBatchFilter(query, operatorRecordedById);

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
      data: batches.map((batch) => toBatchResponse(batch, operatorRecordedById)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, user?: RequestUser): Promise<ProductionBatchResponseDto> {
    const operatorRecordedById = shouldFilterToOperatorFilling(user) ? user!.sub : undefined;
    const batch = await this.prisma.productionBatch.findUnique({
      where: { id },
      include: BATCH_INCLUDE,
    });
    if (batch === null) {
      throw new NotFoundException(`El lote "${id}" no existe`);
    }
    const response = toBatchResponse(batch, operatorRecordedById);
    if (operatorRecordedById !== undefined && response.items.length === 0) {
      throw new NotFoundException(`El lote "${id}" no existe`);
    }
    return response;
  }
}

async function appendFilling(
  tx: Prisma.TransactionClient,
  batchId: string,
  items: Array<Omit<Prisma.BatchItemCreateManyInput, "batchId">>,
): Promise<BatchWithRelations> {
  await tx.batchItem.createMany({
    data: items.map((item) => ({ ...item, batchId })),
  });
  return tx.productionBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: BATCH_INCLUDE,
  });
}

function buildBatchFilter(
  query: ListProductionBatchesQueryDto,
  operatorRecordedById?: string,
): Prisma.ProductionBatchWhereInput {
  const { dateFrom, dateTo, withStock } = query;
  const from = dateFrom === undefined ? undefined : parseBusinessDate(dateFrom, "La fecha desde");
  const to = dateTo === undefined ? undefined : parseBusinessDate(dateTo, "La fecha hasta");

  if (from !== undefined && to !== undefined && from > to) {
    throw new BadRequestException("La fecha desde no puede ser posterior a la fecha hasta");
  }

  const itemsFilter: Prisma.BatchItemWhereInput = {
    ...(operatorRecordedById ? { recordedById: operatorRecordedById } : {}),
    ...(withStock === true ? { availableQty: { gt: 0 } } : {}),
  };

  const hasItemsCondition = operatorRecordedById !== undefined || withStock !== undefined;

  return {
    ...(from !== undefined || to !== undefined
      ? {
          date: {
            ...(from !== undefined ? { gte: from } : {}),
            ...(to !== undefined ? { lte: to } : {}),
          },
        }
      : {}),
    ...(hasItemsCondition
      ? withStock === false
        ? {
            items: {
              ...(operatorRecordedById ? { some: { recordedById: operatorRecordedById } } : {}),
              every: { availableQty: { lte: 0 } },
            },
          }
        : { items: { some: itemsFilter } }
      : {}),
  };
}
