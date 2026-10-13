import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MaquilaMovementType, Prisma, ProductType, UserRole } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { SalesService } from "../sales/sales.service.js";
import type { FillMaquilaDto } from "./dto/fill-maquila.dto.js";
import type { ListMaquilaMovementsQueryDto } from "./dto/list-maquila-movements-query.dto.js";
import type {
  MaquilaBalanceResponseDto,
  MaquilaCustomerSummaryResponseDto,
  MaquilaDiscrepancyResponseDto,
  MaquilaMovementResponseDto,
  MaquilaReconciliationResponseDto,
  PaginatedMaquilaMovementsResponseDto,
} from "./dto/maquila-response.dto.js";
import type { ReceiveMaquilaDto } from "./dto/receive-maquila.dto.js";
import type { ReturnMaquilaDto } from "./dto/return-maquila.dto.js";
import type { VoidMaquilaMovementDto } from "./dto/void-maquila-movement.dto.js";

const MOVEMENT_INCLUDE = {
  customer: { select: { id: true, name: true } },
  containerType: { select: { id: true, name: true } },
  recordedBy: { select: { id: true, name: true } },
  sale: { select: { id: true, total: true } },
} satisfies Prisma.MaquilaContainerMovementInclude;

type MovementWithRelations = Prisma.MaquilaContainerMovementGetPayload<{
  include: typeof MOVEMENT_INCLUDE;
}>;

type MaquilaReader = { id: string; roles: UserRole[] };

type BalanceReference = {
  customerId: string;
  containerTypeId: string;
};

@Injectable()
export class MaquilaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesService: SalesService,
  ) {}

  private toMovementResponse(
    movement: MovementWithRelations,
    includeCommercialData = true,
  ): MaquilaMovementResponseDto {
    return {
      id: movement.id,
      customerId: movement.customerId,
      customerName: movement.customer.name,
      containerTypeId: movement.containerTypeId,
      containerTypeName: movement.containerType.name,
      type: movement.type,
      quantity: movement.quantity,
      ...(includeCommercialData
        ? {
            saleId: movement.saleId,
            saleTotal: movement.sale ? movement.sale.total.toFixed(2) : null,
          }
        : {}),
      reversesMovementId: movement.reversesMovementId,
      reason: movement.reason,
      recordedById: movement.recordedById,
      recordedByName: movement.recordedBy.name,
      occurredAt: movement.occurredAt.toISOString(),
      createdAt: movement.createdAt.toISOString(),
    };
  }

  private canReadCommercialData(actor: MaquilaReader): boolean {
    return actor.roles.includes(UserRole.ADMIN) || actor.roles.includes(UserRole.SELLER);
  }

  private async recordVoid(
    operation: () => Promise<MovementWithRelations>,
  ): Promise<MovementWithRelations> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("El movimiento ya ha sido anulado previamente");
      }
      throw error;
    }
  }

  private async assertActiveReferences(customerId: string, containerTypeId: string): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, active: true },
    });
    if (!customer) {
      throw new BadRequestException(`El cliente "${customerId}" no existe`);
    }
    if (!customer.active) {
      throw new BadRequestException(`El cliente "${customerId}" no está activo`);
    }

    const containerType = await this.prisma.containerType.findUnique({
      where: { id: containerTypeId },
      select: { id: true, active: true },
    });
    if (!containerType) {
      throw new BadRequestException(`El tipo de envase "${containerTypeId}" no existe`);
    }
    if (!containerType.active) {
      throw new BadRequestException(`El tipo de envase "${containerTypeId}" no está activo`);
    }
  }

  private async withCommercialData<T extends BalanceReference>(
    balances: T[],
  ): Promise<Array<T & { productId: string | null; unitPrice: string | null }>> {
    const containerTypeIds = [...new Set(balances.map((balance) => balance.containerTypeId))];
    const maquilaProducts = await this.prisma.product.findMany({
      where: {
        type: ProductType.MAQUILA_SERVICE,
        containerTypeId: { in: containerTypeIds },
        active: true,
      },
      select: { id: true, containerTypeId: true, listPrice: true },
    });
    const productMap = new Map<string, { id: string; listPrice: Prisma.Decimal }>();
    for (const product of maquilaProducts) {
      if (product.containerTypeId) {
        productMap.set(product.containerTypeId, {
          id: product.id,
          listPrice: product.listPrice,
        });
      }
    }

    const customerPrices = await this.prisma.customerPrice.findMany({
      where: {
        customerId: { in: [...new Set(balances.map((balance) => balance.customerId))] },
        productId: { in: maquilaProducts.map((product) => product.id) },
        locationId: null,
      },
    });

    return balances.map((balance) => {
      const product = productMap.get(balance.containerTypeId);
      if (!product) {
        return { ...balance, productId: null, unitPrice: null };
      }
      const customerPrice = customerPrices.find(
        (price) => price.customerId === balance.customerId && price.productId === product.id,
      );
      return {
        ...balance,
        productId: product.id,
        unitPrice: (customerPrice?.price ?? product.listPrice).toFixed(2),
      };
    });
  }

  async receive(dto: ReceiveMaquilaDto, recordedById: string): Promise<MaquilaMovementResponseDto> {
    await this.assertActiveReferences(dto.customerId, dto.containerTypeId);

    const occurredAt = new Date();
    const movement = await this.prisma.$transaction(async (tx) => {
      await tx.maquilaBalance.upsert({
        where: {
          customerId_containerTypeId: {
            customerId: dto.customerId,
            containerTypeId: dto.containerTypeId,
          },
        },
        update: { emptyAtPlant: { increment: dto.quantity } },
        create: {
          customerId: dto.customerId,
          containerTypeId: dto.containerTypeId,
          emptyAtPlant: dto.quantity,
          fullToReturn: 0,
        },
      });

      return tx.maquilaContainerMovement.create({
        data: {
          customerId: dto.customerId,
          containerTypeId: dto.containerTypeId,
          type: MaquilaMovementType.RECEIVED,
          quantity: dto.quantity,
          recordedById,
          occurredAt,
        },
        include: MOVEMENT_INCLUDE,
      });
    });

    return this.toMovementResponse(movement);
  }

  async fill(dto: FillMaquilaDto, recordedById: string): Promise<MaquilaMovementResponseDto> {
    await this.assertActiveReferences(dto.customerId, dto.containerTypeId);

    const balance = await this.prisma.maquilaBalance.findUnique({
      where: {
        customerId_containerTypeId: {
          customerId: dto.customerId,
          containerTypeId: dto.containerTypeId,
        },
      },
      select: { emptyAtPlant: true },
    });

    const emptyAtPlant = balance?.emptyAtPlant ?? 0;
    if (emptyAtPlant < dto.quantity) {
      throw new BadRequestException(
        `No hay suficientes vacíos en planta para llenar (hay ${emptyAtPlant}, se intentó llenar ${dto.quantity})`,
      );
    }

    const occurredAt = new Date();
    const movement = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.maquilaBalance.updateMany({
        where: {
          customerId: dto.customerId,
          containerTypeId: dto.containerTypeId,
          emptyAtPlant: { gte: dto.quantity },
        },
        data: {
          emptyAtPlant: { decrement: dto.quantity },
          fullToReturn: { increment: dto.quantity },
        },
      });
      if (updated.count === 0) {
        const current = await tx.maquilaBalance.findUnique({
          where: {
            customerId_containerTypeId: {
              customerId: dto.customerId,
              containerTypeId: dto.containerTypeId,
            },
          },
          select: { emptyAtPlant: true },
        });
        throw new BadRequestException(
          `No hay suficientes vacíos en planta para llenar (hay ${current?.emptyAtPlant ?? 0}, se intentó llenar ${dto.quantity})`,
        );
      }

      return tx.maquilaContainerMovement.create({
        data: {
          customerId: dto.customerId,
          containerTypeId: dto.containerTypeId,
          type: MaquilaMovementType.FILLED,
          quantity: dto.quantity,
          recordedById,
          occurredAt,
        },
        include: MOVEMENT_INCLUDE,
      });
    });

    return this.toMovementResponse(movement);
  }

  async return(dto: ReturnMaquilaDto, recordedById: string): Promise<MaquilaMovementResponseDto> {
    await this.assertActiveReferences(dto.customerId, dto.containerTypeId);

    const balance = await this.prisma.maquilaBalance.findUnique({
      where: {
        customerId_containerTypeId: {
          customerId: dto.customerId,
          containerTypeId: dto.containerTypeId,
        },
      },
      select: { fullToReturn: true },
    });

    const fullToReturn = balance?.fullToReturn ?? 0;
    if (fullToReturn < dto.quantity) {
      throw new BadRequestException(
        `No hay suficientes llenos para devolver (hay ${fullToReturn}, se intentó devolver ${dto.quantity})`,
      );
    }

    // Buscar producto del servicio de maquila para este tipo de envase
    const maquilaProduct = await this.prisma.product.findFirst({
      where: {
        type: ProductType.MAQUILA_SERVICE,
        containerTypeId: dto.containerTypeId,
        active: true,
      },
      select: { id: true },
    });

    if (!maquilaProduct) {
      throw new BadRequestException("Falta el precio de maquila de este cliente");
    }

    // Ubicación del cliente
    let locationId = dto.locationId;
    if (locationId) {
      const location = await this.prisma.customerLocation.findUnique({
        where: { id: locationId },
        select: { id: true, customerId: true, active: true },
      });
      if (!location) {
        throw new BadRequestException(`La ubicación "${locationId}" no existe`);
      }
      if (location.customerId !== dto.customerId) {
        throw new BadRequestException(`La ubicación "${locationId}" no pertenece a este cliente`);
      }
      if (!location.active) {
        throw new BadRequestException(`La ubicación "${locationId}" no está activa`);
      }
    } else {
      const primaryLoc = await this.prisma.customerLocation.findFirst({
        where: { customerId: dto.customerId, isPrimary: true, active: true },
        select: { id: true },
      });
      if (!primaryLoc) {
        throw new BadRequestException(
          `El cliente "${dto.customerId}" no tiene una ubicación principal`,
        );
      }
      locationId = primaryLoc.id;
    }

    const occurredAt = new Date();

    const movement = await this.prisma.$transaction(async (tx) => {
      // 1. Descontar llenos por devolver
      const updated = await tx.maquilaBalance.updateMany({
        where: {
          customerId: dto.customerId,
          containerTypeId: dto.containerTypeId,
          fullToReturn: { gte: dto.quantity },
        },
        data: { fullToReturn: { decrement: dto.quantity } },
      });
      if (updated.count === 0) {
        const current = await tx.maquilaBalance.findUnique({
          where: {
            customerId_containerTypeId: {
              customerId: dto.customerId,
              containerTypeId: dto.containerTypeId,
            },
          },
          select: { fullToReturn: true },
        });
        throw new BadRequestException(
          `No hay suficientes llenos para devolver (hay ${current?.fullToReturn ?? 0}, se intentó devolver ${dto.quantity})`,
        );
      }

      const sale = await this.salesService.registerServiceSaleWithinTransaction(tx, {
        locationId,
        productId: maquilaProduct.id,
        quantity: dto.quantity,
        ...(dto.payment === undefined ? {} : { payment: dto.payment }),
        recordedById,
        occurredAt,
      });

      // Venta, cobro, deuda, saldo físico y libro se confirman o revierten juntos.
      return tx.maquilaContainerMovement.create({
        data: {
          customerId: dto.customerId,
          containerTypeId: dto.containerTypeId,
          type: MaquilaMovementType.RETURNED,
          quantity: dto.quantity,
          saleId: sale.sale.id,
          recordedById,
          occurredAt,
        },
        include: MOVEMENT_INCLUDE,
      });
    });

    return this.toMovementResponse(movement);
  }

  async voidMovement(
    id: string,
    dto: VoidMaquilaMovementDto,
    actor: { id: string; roles: UserRole[] },
  ): Promise<MaquilaMovementResponseDto> {
    const reason = dto.reason.trim();
    if (reason.length === 0) {
      throw new BadRequestException("El motivo de la anulación no puede estar vacío");
    }

    const movement = await this.prisma.maquilaContainerMovement.findUnique({
      where: { id },
      include: {
        sale: {
          select: { id: true, voidedAt: true },
        },
        reversedBy: { select: { id: true } },
      },
    });

    if (!movement) {
      throw new NotFoundException(`El movimiento "${id}" no existe`);
    }

    if (movement.reversedBy !== null) {
      throw new BadRequestException("El movimiento ya ha sido anulado previamente");
    }

    if (
      movement.type === MaquilaMovementType.RECEIVED_VOID ||
      movement.type === MaquilaMovementType.FILLED_VOID ||
      movement.type === MaquilaMovementType.RETURNED_VOID
    ) {
      throw new BadRequestException("No se puede anular un movimiento de anulación");
    }

    const isAdmin = actor.roles.includes(UserRole.ADMIN);
    const isSupervisor = actor.roles.includes(UserRole.PLANT_SUPERVISOR);

    if (movement.type === MaquilaMovementType.RECEIVED) {
      if (!isAdmin) {
        throw new ForbiddenException("Solo el administrador puede anular un recibido de maquila");
      }

      const balance = await this.prisma.maquilaBalance.findUnique({
        where: {
          customerId_containerTypeId: {
            customerId: movement.customerId,
            containerTypeId: movement.containerTypeId,
          },
        },
        select: { emptyAtPlant: true },
      });

      const emptyAtPlant = balance?.emptyAtPlant ?? 0;
      if (emptyAtPlant < movement.quantity) {
        throw new BadRequestException(
          "No se puede anular el recibido: los vacíos en planta quedarían en negativo",
        );
      }

      const occurredAt = new Date();
      const voidedMovement = await this.recordVoid(() =>
        this.prisma.$transaction(async (tx) => {
          const updated = await tx.maquilaBalance.updateMany({
            where: {
              customerId: movement.customerId,
              containerTypeId: movement.containerTypeId,
              emptyAtPlant: { gte: movement.quantity },
            },
            data: { emptyAtPlant: { decrement: movement.quantity } },
          });
          if (updated.count === 0) {
            throw new BadRequestException(
              "No se puede anular el recibido: los vacíos en planta quedarían en negativo",
            );
          }

          return tx.maquilaContainerMovement.create({
            data: {
              customerId: movement.customerId,
              containerTypeId: movement.containerTypeId,
              type: MaquilaMovementType.RECEIVED_VOID,
              quantity: movement.quantity,
              reversesMovementId: movement.id,
              reason,
              recordedById: actor.id,
              occurredAt,
            },
            include: MOVEMENT_INCLUDE,
          });
        }),
      );

      return this.toMovementResponse(voidedMovement);
    }

    if (movement.type === MaquilaMovementType.FILLED) {
      if (!isAdmin && !isSupervisor) {
        throw new ForbiddenException(
          "Solo el supervisor o administrador pueden anular un llenado de maquila",
        );
      }

      const balance = await this.prisma.maquilaBalance.findUnique({
        where: {
          customerId_containerTypeId: {
            customerId: movement.customerId,
            containerTypeId: movement.containerTypeId,
          },
        },
        select: { fullToReturn: true },
      });

      const fullToReturn = balance?.fullToReturn ?? 0;
      if (fullToReturn < movement.quantity) {
        throw new BadRequestException(
          "No se puede anular el llenado: los llenos por devolver quedarían en negativo",
        );
      }

      const occurredAt = new Date();
      const voidedMovement = await this.recordVoid(() =>
        this.prisma.$transaction(async (tx) => {
          const updated = await tx.maquilaBalance.updateMany({
            where: {
              customerId: movement.customerId,
              containerTypeId: movement.containerTypeId,
              fullToReturn: { gte: movement.quantity },
            },
            data: {
              fullToReturn: { decrement: movement.quantity },
              emptyAtPlant: { increment: movement.quantity },
            },
          });
          if (updated.count === 0) {
            throw new BadRequestException(
              "No se puede anular el llenado: los llenos por devolver quedarían en negativo",
            );
          }

          return tx.maquilaContainerMovement.create({
            data: {
              customerId: movement.customerId,
              containerTypeId: movement.containerTypeId,
              type: MaquilaMovementType.FILLED_VOID,
              quantity: movement.quantity,
              reversesMovementId: movement.id,
              reason,
              recordedById: actor.id,
              occurredAt,
            },
            include: MOVEMENT_INCLUDE,
          });
        }),
      );

      return this.toMovementResponse(voidedMovement);
    }

    if (movement.type === MaquilaMovementType.RETURNED) {
      if (!isAdmin) {
        throw new ForbiddenException(
          "Solo el administrador puede anular una devolución de maquila",
        );
      }

      const sale = movement.sale;
      if (!sale) {
        throw new BadRequestException("El movimiento no tiene una venta asociada");
      }
      if (sale.voidedAt !== null) {
        throw new BadRequestException("La venta asociada ya está anulada");
      }

      const occurredAt = new Date();
      const voidedMovement = await this.recordVoid(() =>
        this.prisma.$transaction(async (tx) => {
          const voidedSale = await this.salesService.voidSaleWithinTransaction(tx, {
            saleId: sale.id,
            voidedById: actor.id,
            voidReason: reason,
          });
          if (voidedSale.sale === null) {
            throw new BadRequestException("La venta asociada ya está anulada");
          }

          // Venta, cobro, deuda, saldo físico y libro se confirman o revierten juntos.
          await tx.maquilaBalance.update({
            where: {
              customerId_containerTypeId: {
                customerId: movement.customerId,
                containerTypeId: movement.containerTypeId,
              },
            },
            data: { fullToReturn: { increment: movement.quantity } },
          });

          return tx.maquilaContainerMovement.create({
            data: {
              customerId: movement.customerId,
              containerTypeId: movement.containerTypeId,
              type: MaquilaMovementType.RETURNED_VOID,
              quantity: movement.quantity,
              saleId: movement.saleId,
              reversesMovementId: movement.id,
              reason,
              recordedById: actor.id,
              occurredAt,
            },
            include: MOVEMENT_INCLUDE,
          });
        }),
      );

      return this.toMovementResponse(voidedMovement);
    }

    throw new BadRequestException("Tipo de movimiento no soportado");
  }

  async listBalances(
    customerId: string | undefined,
    actor: MaquilaReader,
  ): Promise<MaquilaBalanceResponseDto[]> {
    const where: Prisma.MaquilaBalanceWhereInput = customerId ? { customerId } : {};

    const balances = await this.prisma.maquilaBalance.findMany({
      where,
      include: {
        containerType: { select: { id: true, name: true } },
      },
      orderBy: [{ customerId: "asc" }, { containerTypeId: "asc" }],
    });

    if (!this.canReadCommercialData(actor)) {
      return balances.map((balance) => ({
        customerId: balance.customerId,
        containerTypeId: balance.containerTypeId,
        containerTypeName: balance.containerType.name,
        emptyAtPlant: balance.emptyAtPlant,
        fullToReturn: balance.fullToReturn,
      }));
    }

    const balancesWithCommercialData = await this.withCommercialData(balances);
    return balancesWithCommercialData.map((balance) => ({
      customerId: balance.customerId,
      containerTypeId: balance.containerTypeId,
      containerTypeName: balance.containerType.name,
      emptyAtPlant: balance.emptyAtPlant,
      fullToReturn: balance.fullToReturn,
      unitPrice: balance.unitPrice,
      productId: balance.productId,
    }));
  }

  async listCustomersWithBalances(
    actor: MaquilaReader,
  ): Promise<MaquilaCustomerSummaryResponseDto[]> {
    const balances = await this.prisma.maquilaBalance.findMany({
      where: {
        OR: [{ emptyAtPlant: { gt: 0 } }, { fullToReturn: { gt: 0 } }],
      },
      include: {
        customer: { select: { id: true, name: true } },
        containerType: { select: { id: true, name: true } },
      },
      orderBy: [{ customer: { name: "asc" } }, { containerTypeId: "asc" }],
    });

    if (!this.canReadCommercialData(actor)) {
      const byCustomer = new Map<string, MaquilaCustomerSummaryResponseDto>();
      for (const balance of balances) {
        const existing = byCustomer.get(balance.customerId) ?? {
          customerId: balance.customerId,
          customerName: balance.customer.name,
          emptyAtPlantTotal: 0,
          fullToReturnTotal: 0,
          balances: [],
        };
        existing.emptyAtPlantTotal += balance.emptyAtPlant;
        existing.fullToReturnTotal += balance.fullToReturn;
        existing.balances.push({
          customerId: balance.customerId,
          containerTypeId: balance.containerTypeId,
          containerTypeName: balance.containerType.name,
          emptyAtPlant: balance.emptyAtPlant,
          fullToReturn: balance.fullToReturn,
        });
        byCustomer.set(balance.customerId, existing);
      }
      return [...byCustomer.values()];
    }

    const balancesWithCommercialData = await this.withCommercialData(balances);

    const byCustomer = new Map<
      string,
      {
        customerId: string;
        customerName: string;
        emptyAtPlantTotal: number;
        fullToReturnTotal: number;
        balances: MaquilaBalanceResponseDto[];
      }
    >();

    for (const b of balancesWithCommercialData) {
      const balanceItem: MaquilaBalanceResponseDto = {
        customerId: b.customerId,
        containerTypeId: b.containerTypeId,
        containerTypeName: b.containerType.name,
        emptyAtPlant: b.emptyAtPlant,
        fullToReturn: b.fullToReturn,
        unitPrice: b.unitPrice,
        productId: b.productId,
      };

      const existing = byCustomer.get(b.customerId) ?? {
        customerId: b.customerId,
        customerName: b.customer.name,
        emptyAtPlantTotal: 0,
        fullToReturnTotal: 0,
        balances: [],
      };

      existing.emptyAtPlantTotal += b.emptyAtPlant;
      existing.fullToReturnTotal += b.fullToReturn;
      existing.balances.push(balanceItem);
      byCustomer.set(b.customerId, existing);
    }

    return [...byCustomer.values()];
  }

  async listMovements(
    query: ListMaquilaMovementsQueryDto,
    actor: MaquilaReader,
  ): Promise<PaginatedMaquilaMovementsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.MaquilaContainerMovementWhereInput = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    // Los roles de planta nunca ven operaciones comerciales. El supervisor ve
    // todos los llenados y el operador únicamente los que registró él.
    const isOperator = actor.roles.includes(UserRole.PLANT_OPERATOR);
    const isSupervisor = actor.roles.includes(UserRole.PLANT_SUPERVISOR);
    const canReadCommercialData = this.canReadCommercialData(actor);

    if (!canReadCommercialData) {
      where.type = isSupervisor
        ? { in: [MaquilaMovementType.FILLED, MaquilaMovementType.FILLED_VOID] }
        : MaquilaMovementType.FILLED;
      if (isOperator && !isSupervisor) {
        where.recordedById = actor.id;
      }
    }

    if (query.startDate || query.endDate) {
      where.occurredAt = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(`${query.endDate}T23:59:59.999Z`) } : {}),
      };
    }

    const [total, movements] = await this.prisma.$transaction([
      this.prisma.maquilaContainerMovement.count({ where }),
      this.prisma.maquilaContainerMovement.findMany({
        where,
        include: MOVEMENT_INCLUDE,
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: movements.map((movement) => this.toMovementResponse(movement, canReadCommercialData)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async reconcile(): Promise<MaquilaReconciliationResponseDto> {
    const [balances, movements] = await this.prisma.$transaction(
      async (tx) =>
        Promise.all([
          tx.maquilaBalance.findMany({
            include: {
              customer: { select: { name: true } },
              containerType: { select: { name: true } },
            },
          }),
          tx.maquilaContainerMovement.findMany({
            include: {
              customer: { select: { name: true } },
              containerType: { select: { name: true } },
            },
          }),
        ]),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    // Sumar movimientos por cliente y tipo de envase
    const ledger = new Map<
      string,
      {
        empty: number;
        full: number;
        customerName: string;
        containerTypeName: string;
        customerId: string;
        containerTypeId: string;
      }
    >();

    for (const m of movements) {
      const key = `${m.customerId}:${m.containerTypeId}`;
      const current = ledger.get(key) ?? {
        empty: 0,
        full: 0,
        customerName: m.customer.name,
        containerTypeName: m.containerType.name,
        customerId: m.customerId,
        containerTypeId: m.containerTypeId,
      };

      switch (m.type) {
        case MaquilaMovementType.RECEIVED:
          current.empty += m.quantity;
          break;
        case MaquilaMovementType.FILLED:
          current.empty -= m.quantity;
          current.full += m.quantity;
          break;
        case MaquilaMovementType.RETURNED:
          current.full -= m.quantity;
          break;
        case MaquilaMovementType.RECEIVED_VOID:
          current.empty -= m.quantity;
          break;
        case MaquilaMovementType.FILLED_VOID:
          current.empty += m.quantity;
          current.full -= m.quantity;
          break;
        case MaquilaMovementType.RETURNED_VOID:
          current.full += m.quantity;
          break;
      }

      ledger.set(key, current);
    }

    const discrepancies: MaquilaDiscrepancyResponseDto[] = [];
    const checkedKeys = new Set<string>();

    // Validar cada saldo materializado contra el ledger
    for (const b of balances) {
      const key = `${b.customerId}:${b.containerTypeId}`;
      checkedKeys.add(key);
      const expected = ledger.get(key) ?? { empty: 0, full: 0 };

      if (b.emptyAtPlant !== expected.empty || b.fullToReturn !== expected.full) {
        discrepancies.push({
          customerId: b.customerId,
          customerName: b.customer.name,
          containerTypeId: b.containerTypeId,
          containerTypeName: b.containerType.name,
          bookEmpty: b.emptyAtPlant,
          bookFull: b.fullToReturn,
          ledgerEmpty: expected.empty,
          ledgerFull: expected.full,
        });
      }
    }

    // Validar pares en ledger con saldo distinto de cero que no tienen fila materializada
    for (const [key, l] of ledger.entries()) {
      if (!checkedKeys.has(key) && (l.empty !== 0 || l.full !== 0)) {
        discrepancies.push({
          customerId: l.customerId,
          customerName: l.customerName,
          containerTypeId: l.containerTypeId,
          containerTypeName: l.containerTypeName,
          bookEmpty: 0,
          bookFull: 0,
          ledgerEmpty: l.empty,
          ledgerFull: l.full,
        });
      }
    }

    return {
      isBalanced: discrepancies.length === 0,
      discrepancies,
    };
  }
}
